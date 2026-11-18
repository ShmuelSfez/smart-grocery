// Bounded, linear-time, zero-dependency OpenXML (.xlsx) reader for browser and Node.
// - Enforces strict archive, entry-count, streaming-decompression, row, and column caps (mitigates zip bombs / DoS).
// - Uses linear `indexOf` XML tag scanning (immune to ReDoS & handles self-closing `<c/>`, `<row/>`, `<xf/>` cleanly).
// - Resolves worksheet order via `xl/workbook.xml` + `xl/_rels/workbook.xml.rels`.
// - Detects `<strike/>` in both cell styles (`xl/styles.xml`) and rich-text inline runs (`<rPr><strike/>`).
import { listZipEntries } from './zip.js';

export const XLSX_LIMITS = {
  maxArchiveBytes: 10 * 1024 * 1024, // 10 MB compressed .xlsx
  maxEntries: 64,
  maxXmlBytes: 8 * 1024 * 1024,      // 8 MB per inflated XML part
  maxRows: 5000,
  maxCols: 64,
};

async function inflateRawBounded(compBytes, maxBytes) {
  if (typeof DecompressionStream !== 'undefined') {
    let reader = null;
    try {
      const ds = new DecompressionStream('deflate-raw');
      const stream = new Blob([compBytes]).stream().pipeThrough(ds);
      reader = stream.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch {}
          throw new Error(`XLSX_ENTRY_TOO_LARGE: inflated XML exceeds ${maxBytes} bytes`);
        }
        chunks.push(value);
      }
      const out = new Uint8Array(total);
      let off = 0;
      for (const ch of chunks) { out.set(ch, off); off += ch.byteLength; }
      return out;
    } catch (err) {
      if (String(err?.message || '').startsWith('XLSX_ENTRY_TOO_LARGE')) throw err;
      // Node 18 lacks 'deflate-raw' in DecompressionStream; fall back to node:zlib below
    }
  }
  if (typeof process !== 'undefined' && process.versions?.node) {
    const zlib = await import('node:zlib');
    try {
      return new Uint8Array(zlib.inflateRawSync(compBytes, { maxOutputLength: maxBytes }));
    } catch (err) {
      if (err?.code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength/i.test(String(err?.message))) {
        throw new Error(`XLSX_ENTRY_TOO_LARGE: inflated XML exceeds ${maxBytes} bytes`);
      }
      throw err;
    }
  }
  throw new Error('DEFLATE decompression unsupported in this environment');
}

async function readEntryUtf8(entry, maxBytes) {
  if (!entry) return '';
  if (entry.size > maxBytes) {
    throw new Error(`XLSX_ENTRY_TOO_LARGE: declared entry size ${entry.size} exceeds ${maxBytes} bytes`);
  }
  let raw;
  if (entry.method === 8) {
    raw = await inflateRawBounded(entry.data, maxBytes);
  } else {
    if (entry.data.byteLength > maxBytes) {
      throw new Error(`XLSX_ENTRY_TOO_LARGE: stored entry exceeds ${maxBytes} bytes`);
    }
    raw = entry.data;
  }
  return new TextDecoder('utf-8').decode(raw);
}

function unescapeXml(str) {
  if (!str || !str.includes('&')) return str || '';
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

function getAttr(attrs, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m = re.exec(attrs);
  return m ? (m[1] ?? m[2] ?? '') : null;
}

function isTagNameBoundary(chCode) {
  // '>', '/', ' ', '\t', '\n', '\r'
  return chCode === 62 || chCode === 47 || chCode === 32 || chCode === 9 || chCode === 10 || chCode === 13;
}

/**
 * Linear O(N) XML element scanner supporting both `<tag .../>` self-closing elements and `<tag ...>...</tag>`.
 * Immune to quadratic backtracking on malformed/unterminated tags and never merges adjacent self-closing cells.
 */
export function scanXmlElements(xml, tagName) {
  const out = [];
  if (!xml) return out;
  const openToken = `<${tagName}`;
  const closeToken = `</${tagName}>`;
  const n = xml.length;
  let pos = 0;

  while (pos < n) {
    const start = xml.indexOf(openToken, pos);
    if (start < 0) break;
    const afterNameIdx = start + openToken.length;
    if (afterNameIdx >= n || !isTagNameBoundary(xml.charCodeAt(afterNameIdx))) {
      pos = afterNameIdx;
      continue;
    }

    const gt = xml.indexOf('>', afterNameIdx);
    if (gt < 0) break;

    const selfClosing = xml.charCodeAt(gt - 1) === 47; // '/'
    const attrs = xml.slice(afterNameIdx, selfClosing ? gt - 1 : gt).trim();

    if (selfClosing) {
      out.push({ attrs, inner: '', selfClosing: true });
      pos = gt + 1;
    } else {
      const closeIdx = xml.indexOf(closeToken, gt + 1);
      if (closeIdx < 0) break; // Unterminated tag: stop cleanly in O(1) instead of backtracking!
      out.push({ attrs, inner: xml.slice(gt + 1, closeIdx), selfClosing: false });
      pos = closeIdx + closeToken.length;
    }
  }
  return out;
}

function hasActiveStrikeTag(xmlFragment) {
  if (!xmlFragment || !xmlFragment.includes('<strike')) return false;
  for (const el of scanXmlElements(xmlFragment, 'strike')) {
    const val = getAttr(el.attrs, 'val');
    if (val === null || !/^(?:0|false)$/i.test(val.trim())) return true;
  }
  return false;
}

function extractTextAndRichStrike(siOrIsInner) {
  const runs = scanXmlElements(siOrIsInner, 'r');
  if (runs.length > 0) {
    const parts = [];
    let allNonEmptyRunsStruck = true;
    let hasText = false;
    for (const r of runs) {
      const tEls = scanXmlElements(r.inner, 't');
      const runTxt = tEls.map((t) => unescapeXml(t.inner)).join('');
      parts.push(runTxt);
      if (runTxt.trim()) {
        hasText = true;
        const rPr = scanXmlElements(r.inner, 'rPr')[0]?.inner || '';
        if (!hasActiveStrikeTag(rPr)) allNonEmptyRunsStruck = false;
      }
    }
    return { text: parts.join(''), struck: hasText && allNonEmptyRunsStruck };
  }
  const tEls = scanXmlElements(siOrIsInner, 't');
  return { text: tEls.map((t) => unescapeXml(t.inner)).join(''), struck: false };
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const items = [];
  for (const si of scanXmlElements(xml, 'si')) {
    items.push(extractTextAndRichStrike(si.inner));
  }
  return items;
}

function parseStrikeStyleIndices(stylesXml) {
  const strikeXfs = new Set();
  if (!stylesXml) return strikeXfs;

  const fontsEl = scanXmlElements(stylesXml, 'fonts')[0];
  if (!fontsEl) return strikeXfs;

  const strikeFontIds = new Set();
  const fonts = scanXmlElements(fontsEl.inner, 'font');
  for (let i = 0; i < fonts.length; i++) {
    if (hasActiveStrikeTag(fonts[i].inner)) {
      strikeFontIds.add(i);
    }
  }
  if (!strikeFontIds.size) return strikeXfs;

  const cellXfsEl = scanXmlElements(stylesXml, 'cellXfs')[0];
  if (!cellXfsEl) return strikeXfs;

  const xfs = scanXmlElements(cellXfsEl.inner, 'xf');
  for (let xfIdx = 0; xfIdx < xfs.length; xfIdx++) {
    const fontIdStr = getAttr(xfs[xfIdx].attrs, 'fontId');
    const applyFont = getAttr(xfs[xfIdx].attrs, 'applyFont');
    if (applyFont !== null && /^(?:0|false)$/i.test(applyFont.trim())) continue;
    if (fontIdStr !== null && strikeFontIds.has(Number(fontIdStr))) {
      strikeXfs.add(xfIdx);
    }
  }
  return strikeXfs;
}

function colLettersToIndex(letters) {
  if (!letters || letters.length > 3) return -1;
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    const code = letters.charCodeAt(i);
    if (code < 65 || code > 90) return -1;
    idx = idx * 26 + (code - 64);
  }
  return idx - 1;
}

async function resolveFirstWorksheetEntry(byName, entries, maxXmlBytes) {
  const wbEntry = byName.get('xl/workbook.xml');
  const relsEntry = byName.get('xl/_rels/workbook.xml.rels');
  if (wbEntry && relsEntry) {
    const wbXml = await readEntryUtf8(wbEntry, maxXmlBytes);
    const relsXml = await readEntryUtf8(relsEntry, maxXmlBytes);
    const firstSheet = scanXmlElements(wbXml, 'sheet')[0];
    const rId = firstSheet ? (getAttr(firstSheet.attrs, 'r:id') || getAttr(firstSheet.attrs, 'id')) : null;
    if (rId) {
      for (const rel of scanXmlElements(relsXml, 'Relationship')) {
        if (getAttr(rel.attrs, 'Id') === rId) {
          const target = (getAttr(rel.attrs, 'Target') || '').replace(/^\/+/, '');
          const resolvedPath = target.startsWith('xl/') ? target : `xl/${target}`;
          if (byName.has(resolvedPath)) return byName.get(resolvedPath);
        }
      }
    }
  }
  return byName.get('xl/worksheets/sheet1.xml')
    || entries.find((e) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(e.name.replace(/^\/+/, '')));
}

async function toUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return new Uint8Array(await input.arrayBuffer());
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new Error('Unsupported XLSX buffer input type');
}

export async function parseXlsxBuffer(bufferLike, customLimits = {}) {
  const limits = { ...XLSX_LIMITS, ...customLimits };
  const bytes = await toUint8Array(bufferLike);
  const entries = listZipEntries(bytes, {
    maxArchiveBytes: limits.maxArchiveBytes,
    maxEntries: limits.maxEntries,
    maxEntryBytes: limits.maxXmlBytes,
  });
  const byName = new Map(entries.map((e) => [e.name.replace(/^\/+/, ''), e]));

  const sstXml = await readEntryUtf8(byName.get('xl/sharedStrings.xml'), limits.maxXmlBytes);
  const stylesXml = await readEntryUtf8(byName.get('xl/styles.xml'), limits.maxXmlBytes);
  const sheetEntry = await resolveFirstWorksheetEntry(byName, entries, limits.maxXmlBytes);
  if (!sheetEntry) throw new Error('No worksheet found in .xlsx file');
  const sheetXml = await readEntryUtf8(sheetEntry, limits.maxXmlBytes);

  const sharedStrings = parseSharedStrings(sstXml);
  const strikeStyleIds = parseStrikeStyleIndices(stylesXml);

  const sparseRows = new Map();
  const strikeCells = new Set();
  let maxRow = -1;
  let maxCol = -1;

  let autoRow = 0;
  for (const rowEl of scanXmlElements(sheetXml, 'row')) {
    const rAttr = getAttr(rowEl.attrs, 'r');
    const rIdx = rAttr !== null ? Number(rAttr) - 1 : autoRow;
    if (!Number.isInteger(rIdx) || rIdx < 0) continue;
    if (rIdx >= limits.maxRows) {
      throw new Error(`XLSX_LIMIT_EXCEEDED: row index ${rIdx + 1} exceeds maxRows (${limits.maxRows})`);
    }
    autoRow = rIdx + 1;
    if (rowEl.selfClosing || !rowEl.inner) continue;

    let autoCol = 0;
    for (const cEl of scanXmlElements(rowEl.inner, 'c')) {
      const refAttr = getAttr(cEl.attrs, 'r');
      let cIdx = autoCol;
      if (refAttr) {
        const m = /^([A-Za-z]+)\d+$/.exec(refAttr.trim());
        if (!m) continue;
        cIdx = colLettersToIndex(m[1].toUpperCase());
      }
      if (cIdx < 0 || cIdx >= limits.maxCols) {
        throw new Error(`XLSX_LIMIT_EXCEEDED: column index ${cIdx + 1} exceeds maxCols (${limits.maxCols})`);
      }
      autoCol = cIdx + 1;
      if (cEl.selfClosing || !cEl.inner) continue;

      const tAttr = getAttr(cEl.attrs, 't') || '';
      const sAttr = getAttr(cEl.attrs, 's');
      const styleId = sAttr !== null ? Number(sAttr) : -1;

      let val = '';
      let richStruck = false;
      if (tAttr === 'inlineStr') {
        const isEl = scanXmlElements(cEl.inner, 'is')[0];
        const parsedIs = extractTextAndRichStrike(isEl ? isEl.inner : cEl.inner);
        val = parsedIs.text;
        richStruck = parsedIs.struck;
      } else {
        const vEl = scanXmlElements(cEl.inner, 'v')[0];
        if (vEl !== undefined) {
          const rawV = vEl.inner;
          if (tAttr === 's') {
            const sstRec = sharedStrings[Number(rawV)];
            val = sstRec ? sstRec.text : '';
            richStruck = Boolean(sstRec && sstRec.struck);
          } else if (tAttr === 'b') {
            val = rawV.trim() === '1' ? 'TRUE' : 'FALSE';
          } else {
            val = unescapeXml(rawV.trim());
          }
        }
      }

      val = String(val || '').trim();
      if (!val) continue;

      if (!sparseRows.has(rIdx)) sparseRows.set(rIdx, new Map());
      sparseRows.get(rIdx).set(cIdx, val);
      if (strikeStyleIds.has(styleId) || richStruck) {
        strikeCells.add(`${rIdx}:${cIdx}`);
      }
      if (rIdx > maxRow) maxRow = rIdx;
      if (cIdx > maxCol) maxCol = cIdx;
    }
  }

  const grid = [];
  for (let r = 0; r <= maxRow; r++) {
    const rowMap = sparseRows.get(r);
    if (!rowMap) {
      grid.push([]);
      continue;
    }
    const arr = new Array(maxCol + 1).fill('');
    for (const [c, v] of rowMap.entries()) arr[c] = v;
    grid.push(arr);
  }

  return { grid, strikeCells };
}
