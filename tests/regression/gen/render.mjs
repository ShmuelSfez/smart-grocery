// Renders abstract shopping-list stimuli into concrete input formats:
// - text layouts: lines, commas, bullets, numbered, checkboxes, whatsapp
// - tsv layouts: tsv_vertical, tsv_horizontal (orthogonal columns), tsv_cols_qty
// - csv layout: csv_quoted (UTF-8 BOM, quoted commas & multiline notes)
// - xlsx layout: xlsx_styled (real OpenXML .xlsx ZIP with colors, bold headers, merged cells & strikethrough)
import { writeZip } from '../lib/zip-writer.mjs';

const HEB_NUM_WORDS = new Map([
  [1, 'אחד'],
  [2, 'שתי'],
  [3, 'שלוש'],
  [4, 'ארבע'],
  [5, 'חמש'],
]);

const DECOR_EMOJIS = ['🥛', '🍅', '🥖', '🧀', '🍎', '🛒', '✨', '🥗'];

export function formatLineText(item, qtyStyle, rng) {
  const { text, qty, unit, note } = item;
  const n = note ? ` ${note}` : '';

  if (unit === 'kg') {
    if (qty === 0.5 && (qtyStyle === 'hebrew_words' || (qtyStyle === 'mixed_styles' && rng() < 0.5))) {
      return `חצי קילו ${text}${n}`;
    }
    if (qty === 0.5 && qtyStyle === 'fractions_weights') {
      return `1/2 ק"ג ${text}${n}`;
    }
    if (qty === 1 && qtyStyle === 'hebrew_words') {
      return `קילו ${text}${n}`;
    }
    if (qty === 1.5 && qtyStyle === 'fractions_weights') {
      return `1500 גרם ${text}${n}`;
    }
    if (qtyStyle === 'fractions_weights' && rng() < 0.4) {
      return `${qty}ק"ג ${text}${n}`;
    }
    return rng() < 0.5 ? `${qty} ק"ג ${text}${n}` : `${text} ${qty} קילו${n}`;
  }

  if (unit === 'pack') {
    if (qty === 2 && (qtyStyle === 'hebrew_words' || (qtyStyle === 'mixed_styles' && rng() < 0.4))) {
      return `שתי חבילות ${text}${n}`;
    }
    if (qty === 1) return `${text}${n}`;
    return `${qty} חבילות ${text}${n}`;
  }

  // unit === 'unit'
  if (qty === 1) return `${text}${n}`;
  if (qtyStyle === 'mult_x' || (qtyStyle === 'mixed_styles' && rng() < 0.35)) {
    return rng() < 0.5 ? `${text} x${qty}` : `x${qty} ${text}`;
  }
  if (qtyStyle === 'hebrew_words' && HEB_NUM_WORDS.has(qty) && qty >= 2) {
    return `${HEB_NUM_WORDS.get(qty)} ${text}${n}`;
  }
  return rng() < 0.65 ? `${qty} ${text}${n}` : `${text} ${qty} יח'`;
}

function csvEscape(cell) {
  const s = String(cell ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function renderStimulus(spec, rng) {
  const { layout, rows } = spec;
  // rows entries: { rowKind: 'item' | 'header' | 'non_grocery', text, qty, unit, catLabel, bought, note, qtyStyle }

  if (layout === 'lines') {
    const out = rows.map((r) => {
      if (r.rowKind === 'header') return r.text;
      if (r.rowKind === 'non_grocery') return r.text;
      const base = formatLineText(r, r.qtyStyle, rng);
      return r.bought ? `✅ ${base}` : base;
    });
    return { channel: 'text', payload: out.join('\n') };
  }

  if (layout === 'commas') {
    const parts = rows
      .filter((r) => r.rowKind !== 'header')
      .map((r) => {
        if (r.rowKind === 'non_grocery') return r.text;
        const base = formatLineText(r, r.qtyStyle, rng);
        return r.bought ? `✅ ${base}` : base;
      });
    const sep = () => (rng() < 0.75 ? ', ' : '; ');
    let s = '';
    parts.forEach((p, idx) => { s += (idx ? sep() : '') + p; });
    return { channel: 'text', payload: s };
  }

  if (layout === 'bullets') {
    const markers = ['•', '-', '*'];
    const out = rows.map((r, idx) => {
      if (r.rowKind === 'header') return `**${r.text}**`;
      const mk = markers[idx % markers.length];
      if (r.rowKind === 'non_grocery') return `${mk} ${r.text}`;
      const base = formatLineText(r, r.qtyStyle, rng);
      return r.bought ? `✅ ${base}` : `${mk} ${base}`;
    });
    return { channel: 'text', payload: out.join('\n') };
  }

  if (layout === 'numbered') {
    let n = 1;
    const out = rows.map((r) => {
      if (r.rowKind === 'header') return `=== ${r.text} ===`;
      const sep = n % 2 === 0 ? ')' : '.';
      const prefix = `${n++}${sep} `;
      if (r.rowKind === 'non_grocery') return prefix + r.text;
      const base = formatLineText(r, r.qtyStyle, rng);
      return r.bought ? `✅ ${base}` : prefix + base;
    });
    return { channel: 'text', payload: out.join('\n') };
  }

  if (layout === 'checkboxes') {
    const out = rows.map((r, idx) => {
      if (r.rowKind === 'header') return `${DECOR_EMOJIS[idx % DECOR_EMOJIS.length]} ${r.text}:`;
      if (r.rowKind === 'non_grocery') return `[ ] ${r.text}`;
      const base = formatLineText(r, r.qtyStyle, rng);
      const box = r.bought ? (idx % 2 === 0 ? '[x]' : '☑') : (idx % 2 === 0 ? '[ ]' : '☐');
      return `${box} ${base}`;
    });
    return { channel: 'text', payload: out.join('\n') };
  }

  if (layout === 'whatsapp') {
    const senders = ['שמואל', 'רוני', 'אמא', 'דני'];
    let minute = 10;
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const hh = 18 + Math.floor(minute / 60);
      const mm = String(minute % 60).padStart(2, '0');
      minute += 1 + Math.floor(rng() * 3);
      const sender = senders[i % senders.length];
      const prefix = `[18/11/2026, ${hh}:${mm}] ${sender}: `;
      if (r.rowKind === 'header') {
        out.push(`${prefix}${r.text}`);
      } else if (r.rowKind === 'non_grocery') {
        out.push(`${prefix}${r.text}`);
      } else {
        const base = formatLineText(r, r.qtyStyle, rng);
        out.push(`${prefix}${r.bought ? '✅ ' + base : base}`);
      }
    }
    return { channel: 'text', payload: out.join('\n') };
  }

  if (layout === 'tsv_vertical') {
    const lines = ['רשימת קניות\tהערות'];
    for (const r of rows) {
      if (r.rowKind === 'header') lines.push(`${r.text}\t`);
      else if (r.rowKind === 'non_grocery') lines.push(`${r.text}\tלא דחוף`);
      else {
        const base = formatLineText(r, r.qtyStyle, rng);
        lines.push(`${r.bought ? '✅ ' + base : base}\t${r.note || ''}`);
      }
    }
    return { channel: 'tsv', payload: lines.join('\n') };
  }

  if (layout === 'tsv_horizontal') {
    // Orthogonal multi-column layout: columns are grocery departments + optional irrelevant column
    const cols = new Map([
      ['פירות וירקות', []],
      ['מוצרי חלב', []],
      ['מזווה וכללי', []],
      ['ציוד בניה', []],
    ]);
    for (const r of rows) {
      if (r.rowKind === 'header') continue;
      if (r.rowKind === 'non_grocery') {
        cols.get('ציוד בניה').push(r.text);
      } else {
        const base = formatLineText(r, r.qtyStyle, rng);
        const cell = r.bought ? `✅ ${base}` : base;
        const bucket = r.catLabel === 'produce'
          ? 'פירות וירקות'
          : (r.catLabel === 'dairy' ? 'מוצרי חלב' : 'מזווה וכללי');
        cols.get(bucket).push(cell);
      }
    }
    // Drop empty irrelevant column if no non_grocery rows exist
    if (!cols.get('ציוד בניה').length) cols.delete('ציוד בניה');
    const headers = [...cols.keys()];
    const maxLen = Math.max(0, ...[...cols.values()].map((a) => a.length));
    const grid = [headers];
    for (let i = 0; i < maxLen; i++) {
      grid.push(headers.map((h) => cols.get(h)[i] || ''));
    }
    return { channel: 'tsv', payload: grid.map((row) => row.join('\t')).join('\n') };
  }

  if (layout === 'tsv_cols_qty') {
    const unitHe = { unit: "יח'", kg: 'ק"ג', g: 'גרם', pack: 'חבילה' };
    const grid = [['מוצר', 'כמות', 'יחידה', 'סטטוס']];
    for (const r of rows) {
      if (r.rowKind === 'header') continue;
      if (r.rowKind === 'non_grocery') {
        grid.push([r.text, '1', "יח'", '']);
      } else {
        grid.push([r.text, String(r.qty), unitHe[r.unit] || "יח'", r.bought ? 'TRUE' : 'FALSE']);
      }
    }
    return { channel: 'tsv', payload: grid.map((row) => row.join('\t')).join('\n') };
  }

  if (layout === 'csv_quoted') {
    const unitHe = { unit: "יח'", kg: 'ק"ג', g: 'גרם', pack: 'חבילה' };
    const grid = [['פריט', 'כמות', 'יחידה', 'הערות', 'נקנה']];
    for (const r of rows) {
      if (r.rowKind === 'header') grid.push([r.text, '', '', '', '']);
      else if (r.rowKind === 'non_grocery') grid.push([r.text, '1', '', 'בדיקה, לא לסופר', '']);
      else {
        grid.push([
          r.text,
          String(r.qty),
          unitHe[r.unit] || "יח'",
          r.note || 'רגיל, טרי',
          r.bought ? 'כן' : '',
        ]);
      }
    }
    return {
      channel: 'csv',
      payload: '\uFEFF' + grid.map((row) => row.map(csvEscape).join(',')).join('\r\n'),
    };
  }

  if (layout === 'xlsx_styled') {
    return { channel: 'xlsx', payload: buildStyledXlsxBuffer(rows, rng) };
  }

  throw new Error(`Unknown layout: ${layout}`);
}

function xmlEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generates a valid OpenXML .xlsx archive containing:
 * - Merged title banner (A1:D1) with colored fill + bold font (style s="1")
 * - Colored bold table header row (style s="2")
 * - Alternating pastel row fills (style s="3")
 * - Strikethrough font on already-bought rows (style s="4")
 */
export function buildStyledXlsxBuffer(rows, rng = Math.random) {
  const unitHe = { unit: "יח'", kg: 'ק"ג', g: 'גרם', pack: 'חבילה' };
  const strings = [];
  const strIdx = (val) => {
    const s = String(val ?? '');
    let idx = strings.indexOf(s);
    if (idx < 0) { idx = strings.length; strings.push(s); }
    return idx;
  };

  const sheetRows = [];
  // Row 1: merged banner A1:C1
  sheetRows.push({
    r: 1,
    cells: [
      { ref: 'A1', t: 's', v: strIdx('רשימת קניות מעוצבת לשבת'), s: 1 },
      { ref: 'B1', s: 1 },
      { ref: 'C1', s: 1 },
    ],
  });
  // Row 2: column headers
  sheetRows.push({
    r: 2,
    cells: [
      { ref: 'A2', t: 's', v: strIdx('מוצר'), s: 2 },
      { ref: 'B2', t: 's', v: strIdx('כמות'), s: 2 },
      { ref: 'C2', t: 's', v: strIdx('יחידה'), s: 2 },
    ],
  });

  let rNum = 3;
  for (const r of rows) {
    if (r.rowKind === 'header') {
      sheetRows.push({
        r: rNum,
        cells: [{ ref: `A${rNum}`, t: 's', v: strIdx(r.text), s: 2 }],
      });
      rNum++;
      continue;
    }
    const styleId = r.bought ? 4 : (rng() < 0.5 ? 3 : 0);
    if (r.rowKind === 'non_grocery') {
      sheetRows.push({
        r: rNum,
        cells: [
          { ref: `A${rNum}`, t: 's', v: strIdx(r.text), s: styleId },
          { ref: `B${rNum}`, v: 1, s: styleId },
        ],
      });
    } else {
      sheetRows.push({
        r: rNum,
        cells: [
          { ref: `A${rNum}`, t: 's', v: strIdx(r.text), s: styleId },
          { ref: `B${rNum}`, v: r.qty, s: styleId },
          { ref: `C${rNum}`, t: 's', v: strIdx(unitHe[r.unit] || "יח'"), s: styleId },
        ],
      });
    }
    rNum++;
  }

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const wbXml = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="קניות" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

  // Styles: fontId 0 = normal, fontId 1 = bold colored, fontId 2 = strikethrough
  // Mix self-closing <xf .../> with non-self-closing <xf ...><alignment readingOrder="2"/></xf> (RTL Excel/Sheets output, H5!)
  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><name val="Arial"/></font>
    <font><b/><sz val="12"/><color rgb="FF0F766E"/><name val="Arial"/></font>
    <font><strike/><sz val="11"/><color rgb="FF888888"/><name val="Arial"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFCCFBF1"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF9C3"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"><alignment horizontal="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="1" fillId="3" borderId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="0" fillId="2" borderId="0" applyFill="1"><alignment readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" applyFont="1"><alignment readingOrder="2"/></xf>
  </cellXfs>
</styleSheet>`;

  const sstXml = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">
${strings.map((s) => `  <si><t>${xmlEsc(s)}</t></si>`).join('\n')}
</sst>`;

  const sheetDataXml = sheetRows.map((row) => {
    const cellsXml = row.cells.map((c) => {
      const attrs = [`r="${c.ref}"`];
      if (c.s !== undefined) attrs.push(`s="${c.s}"`);
      if (c.t) attrs.push(`t="${c.t}"`);
      if (c.v === undefined) return `<c ${attrs.join(' ')}/>`;
      return `<c ${attrs.join(' ')}><v>${xmlEsc(c.v)}</v></c>`;
    }).join('');
    return `    <row r="${row.r}">${cellsXml}</row>`;
  }).join('\n');

  const sheetXml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
${sheetDataXml}
  </sheetData>
  <mergeCells count="1">
    <mergeCell ref="A1:C1"/>
  </mergeCells>
</worksheet>`;

  return writeZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'xl/workbook.xml', data: wbXml },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/styles.xml', data: stylesXml },
    { name: 'xl/sharedStrings.xml', data: sstXml },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
  ]);
}
