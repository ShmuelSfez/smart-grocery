// Smart Google Sheets / CSV / TSV / XLSX grid analyzer & CSV exporter.
import { parseItem, normalizeName, UNITS } from './parser.js';
import { categorize, CATEGORY_BY_ID } from './categories.js';
import { checkAmbiguousTerm, resolveGrocerySynonym } from './synonyms.js';

// Headers / section labels that describe a column rather than a buyable grocery item
export const GROCERY_HEADERS = new Set([
  'רשימת קניות', 'קניות לשבת', 'רשימת קניות מעוצבת לשבת', 'ירקות', 'פירות', 'פירות וירקות',
  'דברים שצמחו באדמה', 'דברים חלביים', 'חלבי', 'מוצרי חלב', 'דברים לטואלט', 'טואלטיקה', 'פארם',
  'טואלטיקה ופארם', 'דברים נחמדים', 'מזווה', 'מזווה ובישול', 'מזווה וכללי', 'כללי', 'מוצר',
  'שם מוצר', 'שם הפריט', 'פריט', 'כמות', 'יחידה', 'מחלקה', 'קטגוריה', 'בשר ודגים',
  'בשר ודגים לשבת', 'יינות וגבינות', 'מאפים', 'לחם ומאפים', 'חטיפים ומתוקים',
  'קפואים', 'משקאות', 'ניקיון', 'ניקיון וכביסה', 'מוצרי תינוקות', 'סופר',
  'מצרכים לארוחת שישי', 'item', 'product', 'qty', 'quantity', 'unit', 'notes', 'bought', 'status',
].map(normalizeName));

export const IRRELEVANT_HEADERS = new Set([
  'ציוד בניה', 'ציוד בנייה', 'בניה', 'עבודה', 'שיפוצים', 'כלי עבודה', 'טמבור',
  'קניות כלליות', 'לבית', 'ריהוט', 'רהיטים', 'איקאה', 'הום סנטר', 'ביגוד', 'בגדים',
  'אלקטרוניקה', 'מחשבים', 'משימות', 'מטלות', 'ארוחות לשבת', 'ארוחות', 'מתכונים',
  'קניות לקמפינג', 'קמפינג', 'טיול', 'מלון', 'אטרקציה', 'מסעדה', 'הערות', 'הערה', 'קישור',
  'שמואל', 'רוני', 'למי', 'מחיר', 'סטטוס', 'נקנה', 'בוצע',
].map(normalizeName));

const ITEM_COL_HEADERS = new Set(['מוצר', 'שם מוצר', 'שם הפריט', 'פריט', 'item', 'product'].map(normalizeName));
const QTY_COL_HEADERS = new Set(['כמות', 'qty', 'quantity'].map(normalizeName));
const UNIT_COL_HEADERS = new Set(['יחידה', 'יחידות מידה', 'unit'].map(normalizeName));
const BOUGHT_COL_HEADERS = new Set(['נקנה', 'סטטוס', 'בוצע', 'bought', 'done', 'status'].map(normalizeName));
const NOTE_COL_HEADERS = new Set(['הערה', 'הערות', 'note', 'notes'].map(normalizeName));

// Build a strict Hebrew whole-phrase boundary regex (no JS \b on Hebrew, no lookbehind for Safari < 16.4!)
// Matches ONLY when preceded by start/space/punctuation (plus optional conjunction 'ו' or article 'ה')
// and followed by end/space/punctuation — so "בורג" NEVER matches "בורגול"/"המבורגר", "סיר" NEVER matches "מסיר אבנית",
// and "שולחן" only matches furniture phrases or standalone "שולחן" (never "מלח שולחן" / "מפיות נייר לשולחן")!
function hebTokenRule(phrases, allowWawHePrefix = true) {
  const escaped = phrases.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pref = allowWawHePrefix ? '(?:ו|ה)?' : '';
  return new RegExp(`(?:^|[\\s,./()\\-])${pref}(?:${escaped.join('|')})(?=$|[\\s,./()\\-])`, 'i');
}

// Explicit grocery compounds that contain furniture/appliance words as modifiers ("מלח שולחן", "מפיות לשולחן", "מסיר אבנית")
const GROCERY_ALLOW_OVERRIDES = /(מלח שולחן|מפיות.*לשולחן|מפיות שולחן|מסיר אבנית|מסיר שומנים|נייר אפייה|נייר אפיה|בורגול|המבורגר|כוסות חד פעמ|כוסות נייר|כוסות פלסטיק|צלחות חד פעמ)/i;

export const IRRELEVANT_ITEM_RULES = [
  {
    reason: 'ציוד בנייה וכלי עבודה',
    re: hebTokenRule([
      'מקדחה', 'מקדח', 'מקדחים', 'דיבל', 'דיבלים', 'מסמר', 'מסמרים', 'בורג', 'ברגים', 'שייבה',
      'פטיש', 'מברג', 'פלאייר', 'מפתח שוודי', 'מטר מדידה', 'פלס בנאים', 'פלס', 'שפכטל',
      'נייר שיוף', 'ספריי צבע', 'פח צבע', 'צבע אקרילי', 'צבע קיר', 'רובה אקרילית', 'רובה', 'דבק נגרים',
    ]),
  },
  {
    reason: 'ציוד בנייה וכלי עבודה',
    re: /(?:^|[\s,])\d+(?:[.,]\d+)*\s*מ["״'׳]{1,2}מ(?=$|[\s,])/i,
  },
  {
    reason: 'ריהוט וציוד לבית',
    re: hebTokenRule([
      'כיסא', 'כסא', 'כסאות', 'שולחן פינת אוכל', 'שולחן אוכל', 'שולחן סלון', 'שולחן כתיבה', 'שולחן משרדי',
      'ספה', 'כורסא', 'כורסה', 'כורסת', 'ארון בגדים', 'ארון', 'שידה', 'שידת', 'מיטה', 'מזרן',
      'שטיח', 'וילון', 'מראה', 'מדף', 'מתלה', 'גוף תאורה', 'מנורת', 'מנורה',
    ]),
  },
  {
    reason: 'כלי מטבח ומכשירי חשמל (לא סופר)',
    re: hebTokenRule([
      'קרש חיתוך', 'כפות עץ', 'סכום בשרי', 'סט סכו"ם', 'סט סכום', 'כוסות יין קריסטל', 'כוסות קפה קר',
      'צלחות כוסות קעריות', 'סט צלחות', 'סיר נירוסטה', 'סיר יציקה', 'סיר בישול', 'מחבת',
      'תבנית אפייה מסיליקון', 'מעבד מזון', 'מיקסר', 'בלנדר', 'קומקום', 'טוסטר',
    ], false),
  },
  {
    reason: 'אלקטרוניקה ומחשוב',
    re: hebTokenRule([
      'מחשב', 'לפטופ', 'מסך מחשב', 'מסך', 'מקלדת', 'עכבר אלחוטי', 'עכבר למחשב', 'טלוויזיה',
      'מדפסת', 'טלפון', 'אייפון', 'איירפודס', 'אוזניות', 'מטען מהיר', 'מטען', 'כבל hdmi', 'ראוטר',
    ]),
  },
  {
    reason: 'ביגוד והנעלה',
    re: hebTokenRule([
      'חולצה', 'חולצת', 'מכנסיים', 'מכנסי', 'נעליים', 'נעלי', 'סנדלים', 'מעיל', 'סוודר', 'שמלה', 'חצאית', 'תיק גב',
    ]),
  },
  {
    reason: 'משימה אישית / סידורים',
    re: /(להתקשר ל|לקבוע תור|לשלם חשבון|מתנה ל|כרטיסים לסרט|כרטיס לסרט|לקחת חבילה מהדואר)/i,
  },
  {
    reason: 'קישור / מספר / ג׳יבריש',
    re: /(^https?:\/\/|^www\.|^\d+([.,]\d+)?$|^[bcdfghjklmnpqrstvwxz]{5,}|^(asdf|qwer|zxcv))/i,
  },
];

const BARE_NOISE_CELLS = new Set([
  'יח', "יח'", 'יחידה', 'יחידות', 'קג', 'ק"ג', 'קילו', 'גרם', 'חבילה', 'חבילות',
  'true', 'false', 'כן', 'לא', 'v', 'x',
].map(normalizeName));

export const BOUGHT_VALUE_RE = /^(true|1|כן|v|✓|✔|✅|☑|x|נקנה|בוצע)$/i;

/**
 * RFC-4180 compliant delimited grid parser for both CSV (`,`) and TSV (`\t`).
 * Opens quote mode ONLY when `"` appears at the start of a field (ignoring leading spaces),
 * so mid-word Hebrew gershayim (`ק"ג`, `תפו"א`, `מ"ל`, `סכו"ם`) never swallow following rows!
 */
export function parseDelimitedGrid(raw, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let atFieldStart = true;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (atFieldStart && (ch === ' ' || (delimiter !== '\t' && ch === '\t'))) {
      // Skip leading whitespace before checking for opening quote
      continue;
    } else if (atFieldStart && ch === '"') {
      inQuotes = true;
      atFieldStart = false;
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
      atFieldStart = true;
    } else if (ch === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
      atFieldStart = true;
    } else {
      cell += ch;
      atFieldStart = false;
    }
  }
  if (cell.length || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

/** Parse CSV or Tab-Separated text (from Google Sheets copy-paste or /export?format=csv) into a 2D array. */
export function parseGrid(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!raw.trim()) return [];
  const firstLines = raw.split('\n').slice(0, 10).join('\n');
  const delimiter = firstLines.includes('\t') ? '\t' : ',';
  return parseDelimitedGrid(raw, delimiter);
}

export function isSectionHeaderText(rawText) {
  const s = String(rawText || '').trim();
  if (!s) return false;
  // IMPORTANT: Escape `\-` at the end of character classes so `#-:` never forms an ASCII range covering digits 0-9 (H8)!
  const unwrapped = s
    .replace(/^[\s\u{1F300}-\u{1FAFF}✨*=#\-]+|[\s\u{1F300}-\u{1FAFF}✨*=#:\-]+$/gu, '')
    .trim();
  // If the original text contained digits ("חטיפים 3", "בשר 1"), it is a quantified item, never a bare header!
  if (/\d/.test(s)) return false;
  const norm = normalizeName(unwrapped);
  if (!norm) return false;
  if (GROCERY_HEADERS.has(norm) || IRRELEVANT_HEADERS.has(norm)) return true;
  if (/^(קניות ל|רשימת קניות|מצרכים ל)/.test(norm)) return true;
  if (/^(?:={2,}|\*{2,}|#{2,}|-{2,})\s*.+\s*(?:={2,}|\*{2,}|#{2,}|-{2,})$/.test(s)) {
    return true;
  }
  if (/:\s*$/.test(s) && unwrapped.split(/\s+/).length <= 4) {
    return true;
  }
  return false;
}

export function classifyIrrelevantReason(rawText, colHeaderNorm = '') {
  const trimmed = String(rawText || '').trim();
  const norm = normalizeName(trimmed);
  if (!norm || norm.length < 2) return 'ריק / קצר מדי';
  if (BARE_NOISE_CELLS.has(norm)) return 'תא עזר / יחידת מידה';
  if (isSectionHeaderText(trimmed)) return 'כותרת עמודה / קטגוריה';

  if (!GROCERY_ALLOW_OVERRIDES.test(trimmed) && !GROCERY_ALLOW_OVERRIDES.test(norm)) {
    for (const rule of IRRELEVANT_ITEM_RULES) {
      if (rule.re.test(trimmed) || rule.re.test(norm)) return rule.reason;
    }
  }

  if (colHeaderNorm && IRRELEVANT_HEADERS.has(colHeaderNorm)) {
    return `עמודה לא רלוונטית (${colHeaderNorm})`;
  }
  return null;
}

function parseUnitToken(uRaw) {
  const s = String(uRaw || '').trim();
  if (!s) return null;
  if (/^(ק["״'׳]?ג|קג|קילו|קילוגרם|kg|kilo)$/i.test(s)) return 'kg';
  if (/^(גרם|גר["'׳]?|g|gr|gram|grams)$/i.test(s)) return 'g';
  if (/^(חבילה|חבילות|חב["'׳]|מארז|אריזה|שקית|pack|packs|bag)$/i.test(s)) return 'pack';
  if (/^(יח["'׳]?|יחידה|יחידות|unit|units|pcs)$/i.test(s)) return 'unit';
  return null;
}

export function stripInlineBoughtMarker(raw) {
  let s = String(raw || '').trim();
  let bought = false;
  if (/^([✅☑✔]|\[\s*[xXvV✓✔]\s*\])\s*/.test(s)) {
    bought = true;
    s = s.replace(/^([✅☑✔]|\[\s*[xXvV✓✔]\s*\])\s*/, '').trim();
  }
  if (/~~([^~]+)~~/.test(s)) {
    bought = true;
    s = s.replace(/~~([^~]+)~~/g, '$1').replace(/\s+/g, ' ').trim();
  }
  if (/^([☐]|\[\s*\])\s*/.test(s)) {
    s = s.replace(/^([☐]|\[\s*\])\s*/, '').trim();
  }
  return { text: s, bought };
}

function detectStructuredTableHeader(grid) {
  for (let r = 0; r < Math.min(grid.length, 5); r++) {
    const norms = (grid[r] || []).map((c) => normalizeName(c));
    const itemCol = norms.findIndex((n) => ITEM_COL_HEADERS.has(n));
    if (itemCol < 0) continue;
    const qtyCol = norms.findIndex((n) => QTY_COL_HEADERS.has(n));
    const unitCol = norms.findIndex((n) => UNIT_COL_HEADERS.has(n));
    const boughtCol = norms.findIndex((n) => BOUGHT_COL_HEADERS.has(n));
    const noteCol = norms.findIndex((n) => NOTE_COL_HEADERS.has(n));
    if (qtyCol >= 0 || unitCol >= 0 || boughtCol >= 0) {
      return { headerRow: r, itemCol, qtyCol, unitCol, boughtCol, noteCol };
    }
  }
  return null;
}

// Default tautological descriptors allowed in safe subsumption merging ("אפונה" + "אפונה קפואה", "כמון" + "כמון טחון")
const SAFE_SUBSUMPTION_STEMS = new Set([
  'קפוא', 'טחון', 'גבעול', 'על', 'לבישול', 'מתוק', 'שמנת', 'נוגט', 'שיבולת', 'שועל', 'שחור',
  'אורנג', 'גריל', 'מנט', 'תירוש', 'אפרסק', 'חריף',
]);

export function canMergeResolvedConcepts(resA, resB) {
  if (!resA.conceptKey || !resB.conceptKey) return false;
  if (resA.brandTag && resB.brandTag && resA.brandTag !== resB.brandTag) return false;
  if (resA.conceptKey === resB.conceptKey) return true;

  // Safe subsumption: head stem matches AND all extra stems in the longer item are non-conflicting defaults
  const stA = resA.stems || [];
  const stB = resB.stems || [];
  if (!stA.length || !stB.length || stA[0] !== stB[0]) return false;
  const [shorter, longer] = stA.length <= stB.length ? [stA, stB] : [stB, stA];
  if (!shorter.every((s) => longer.includes(s))) return false;
  const diff = longer.filter((s) => !shorter.includes(s));
  if (stA[0] === 'מפי' && diff.length === 1 && diff[0] === 'ניר') return true;
  return diff.length > 0 && diff.every((s) => SAFE_SUBSUMPTION_STEMS.has(s));
}

export function mergeUnitsIfCompatible(prev, incoming) {
  if (prev.unit === incoming.unit) {
    prev.qty = Math.round((prev.qty + incoming.qty) * 1000) / 1000;
    return true;
  }
  // Both 'unit' and 'pack' represent retail item counts (vs 'kg'/'g' weights)
  if ((prev.unit === 'unit' || prev.unit === 'pack') && (incoming.unit === 'unit' || incoming.unit === 'pack')) {
    prev.unit = 'unit';
    prev.qty = Math.round((prev.qty + incoming.qty) * 1000) / 1000;
    return true;
  }
  if ((prev.unit === 'kg' || prev.unit === 'g') && (incoming.unit === 'kg' || incoming.unit === 'g')) {
    const totalG = (prev.unit === 'kg' ? prev.qty * 1000 : prev.qty)
      + (incoming.unit === 'kg' ? incoming.qty * 1000 : incoming.qty);
    prev.unit = totalG >= 1000 ? 'kg' : 'g';
    prev.qty = Math.round((totalG >= 1000 ? totalG / 1000 : totalG) * 1000) / 1000;
    return true;
  }
  return false;
}

/**
 * Single unified deduplication & enrichment pass shared by `sheets.js`, `importer.js`, and `app.js` (M6).
 * - Preserves `checked` (`false` for bought items).
 * - Flags ambiguous bare hypernyms (`ambiguous: { term, choices }`).
 * - Merges true synonyms with compatible units; keeps separate lines when units are incompatible (`unit` vs `kg`).
 */
export function mergeGroceryCandidates(candidates, overrides = {}) {
  const merged = [];

  for (const it of candidates) {
    if (!it || !it.name) continue;
    const checked = it.checked !== false;
    const amb = it.ambiguous || checkAmbiguousTerm(it.name);

    if (amb) {
      const prevAmb = merged.find(
        (m) => m.ambiguous && normalizeName(m.ambiguous.term) === normalizeName(amb.term) && Boolean(m.checked) === checked && mergeUnitsIfCompatible(m, it),
      );
      if (prevAmb) continue;

      merged.push({
        name: amb.term,
        canonicalName: amb.term,
        qty: it.qty || 1,
        unit: it.unit || 'unit',
        category: it.category || categorize(amb.term, overrides),
        checked,
        note: it.note || '',
        raw: it.raw || it.name,
        sourceHeader: it.sourceHeader || '',
        ambiguous: { term: amb.term, choices: [...amb.choices] },
      });
      continue;
    }

    const syn = resolveGrocerySynonym(it.name);
    const displayIsEnglish = !/[\u0590-\u05FF]/.test(it.name) && /[\u0590-\u05FF]/.test(syn.canonicalName);
    const chosenName = displayIsEnglish ? syn.canonicalName : it.name;

    const prev = merged.find(
      (m) => !m.ambiguous && Boolean(m.checked) === checked && canMergeResolvedConcepts(m._syn, syn) && mergeUnitsIfCompatible(m, it),
    );
    if (prev) {
      if (!/[\u0590-\u05FF]/.test(prev.name) && /[\u0590-\u05FF]/.test(chosenName)) {
        prev.name = chosenName;
      }
      if (!prev._syn.brandTag && syn.brandTag) {
        prev._syn = syn;
        prev.name = chosenName;
      }
      if (!prev.note && it.note) prev.note = it.note;
      continue;
    }

    merged.push({
      name: chosenName,
      canonicalName: syn.canonicalName,
      qty: it.qty || 1,
      unit: it.unit || 'unit',
      category: it.category || categorize(syn.canonicalName || chosenName, overrides),
      checked,
      note: it.note || '',
      raw: it.raw || it.name,
      sourceHeader: it.sourceHeader || '',
      _syn: syn,
    });
  }

  for (const m of merged) delete m._syn;
  return merged;
}

/**
 * Analyze a 2D grid from Google Sheets / CSV / XLSX and separate buyable supermarket items
 * from headers and non-supermarket items.
 */
export function analyzeSheetGrid(grid, overrides = {}, opts = {}) {
  const strikeCells = opts.strikeCells || null;
  const candidates = [];
  const skipped = [];

  const structured = detectStructuredTableHeader(grid);
  if (structured) {
    const { headerRow, itemCol, qtyCol, unitCol, boughtCol, noteCol } = structured;
    for (let r = headerRow + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const rawCell = (row[itemCol] || '').trim();
      if (!rawCell) continue;

      const { text: cleanedCell, bought: inlineBought } = stripInlineBoughtMarker(rawCell);
      if (isSectionHeaderText(cleanedCell)) {
        skipped.push({ raw: rawCell, reason: 'כותרת סעיף', col: itemCol });
        continue;
      }
      const irrel = classifyIrrelevantReason(cleanedCell, '');
      if (irrel) {
        skipped.push({ raw: rawCell, reason: irrel, col: itemCol });
        continue;
      }

      const parsed = parseItem(cleanedCell);
      if (!parsed || !parsed.name) {
        skipped.push({ raw: rawCell, reason: 'לא זוהה כמוצר', col: itemCol });
        continue;
      }
      const irrelParsed = classifyIrrelevantReason(parsed.name, '');
      if (irrelParsed) {
        skipped.push({ raw: rawCell, reason: irrelParsed, col: itemCol });
        continue;
      }

      let qty = parsed.qty || 1;
      let unit = parsed.unit || 'unit';
      if (qtyCol >= 0 && row[qtyCol]) {
        const qVal = parseFloat(String(row[qtyCol]).replace(',', '.'));
        if (Number.isFinite(qVal) && qVal > 0) qty = qVal;
      }
      if (unitCol >= 0 && row[unitCol]) {
        const uVal = parseUnitToken(row[unitCol]);
        if (uVal) unit = uVal;
      }
      if (unit === 'g' && qty >= 1000) {
        qty = qty / 1000;
        unit = 'kg';
      }

      const colBought = boughtCol >= 0 && BOUGHT_VALUE_RE.test(String(row[boughtCol] || '').trim());
      const strikeBought = Boolean(strikeCells && strikeCells.has(`${r}:${itemCol}`));
      const isBought = inlineBought || colBought || strikeBought;
      const note = noteCol >= 0 && row[noteCol] ? String(row[noteCol]).trim() : (parsed.note || '');

      candidates.push({
        name: parsed.name,
        qty: Math.round(qty * 1000) / 1000,
        unit,
        note,
        checked: !isBought,
        category: categorize(parsed.name, overrides),
        raw: rawCell,
        sourceHeader: '',
      });
    }
    const relevant = mergeGroceryCandidates(candidates, overrides);
    if (!relevant.length && !skipped.length && grid[headerRow]) {
      const hdrRaw = grid[headerRow].filter(Boolean).join(' | ');
      if (hdrRaw) skipped.push({ raw: hdrRaw, reason: 'כותרת טבלה בלבד (ללא שורות מוצרים)', col: itemCol });
    }
    return { relevant, skipped };
  }

  // Orthogonal / multi-column / free-form sheet scan
  const maxCols = grid.reduce((m, r) => Math.max(m, r.length), 0);
  const colHeaders = new Array(maxCols).fill('');

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    for (let c = 0; c < maxCols; c++) {
      const rawCell = (row[c] || '').trim();
      if (!rawCell) continue;
      const { text: cell, bought: inlineBought } = stripInlineBoughtMarker(rawCell);
      const norm = normalizeName(cell);

      if (isSectionHeaderText(cell)) {
        // An unset column records its initial header; an already-named grocery column must not be overwritten into 'הערות' mid-sheet (RND_0161/0414).
        if (!colHeaders[c] || !IRRELEVANT_HEADERS.has(norm)) {
          colHeaders[c] = norm;
        }
        skipped.push({ raw: rawCell, reason: 'כותרת עמודה / קטגוריה', col: c });
        continue;
      }

      const irrelReason = classifyIrrelevantReason(cell, colHeaders[c]);
      if (irrelReason) {
        skipped.push({ raw: rawCell, reason: irrelReason, col: c });
        continue;
      }

      const parsed = parseItem(cell);
      if (!parsed || !parsed.name) {
        skipped.push({ raw: rawCell, reason: 'לא זוהה כמוצר', col: c });
        continue;
      }
      const irrelParsed = classifyIrrelevantReason(parsed.name, colHeaders[c]);
      if (irrelParsed) {
        skipped.push({ raw: rawCell, reason: irrelParsed, col: c });
        continue;
      }

      const strikeBought = Boolean(strikeCells && strikeCells.has(`${r}:${c}`));
      const isBought = inlineBought || strikeBought;

      candidates.push({
        ...parsed,
        checked: !isBought,
        category: categorize(parsed.name, overrides),
        raw: rawCell,
        sourceHeader: colHeaders[c] || '',
      });
    }
  }

  const relevant = mergeGroceryCandidates(candidates, overrides);
  return { relevant, skipped };
}

/** Build a UTF-8 BOM CSV string of the current list + supermarket prices for export to Excel/Sheets. */
export function exportListToCsv(list, chainById, activeChainId) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const activeChainName = chainById[activeChainId]?.name || 'רשת נבחרת';
  const rows = [
    ['מחלקה', 'מוצר', 'כמות', 'יחידה', 'נכלל בסל', 'מותג / תיאור מדויק', `מחיר (${activeChainName})`, 'הערה'],
  ];
  for (const it of list) {
    const cat = CATEGORY_BY_ID[it.category]?.he || 'אחר';
    const unitLabel = UNITS[it.unit]?.he || it.unit;
    const prodName = it.product ? `${it.product.brand ? it.product.brand + ' - ' : ''}${it.product.name}` : '';
    const chainPrice = it.product?.chainPrices?.[activeChainId];
    const price = typeof chainPrice === 'number' && chainPrice > 0
      ? chainPrice.toFixed(2)
      : (it.product?.chain === activeChainId && typeof it.product?.priceNum === 'number' && it.product.priceNum > 0
        ? it.product.priceNum.toFixed(2)
        : '');
    rows.push([
      cat,
      it.name,
      it.qty,
      unitLabel,
      it.checked ? 'כן' : 'לא',
      prodName,
      price,
      it.note || '',
    ]);
  }
  return '\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}
