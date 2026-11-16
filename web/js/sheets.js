// Smart Google Sheets / CSV / TSV import analyzer & CSV exporter.
import { parseItem, normalizeName, UNITS } from './parser.js';
import { categorize, CATEGORY_BY_ID } from './categories.js';

// Headers / section labels that describe a column rather than a buyable grocery item
const GROCERY_HEADERS = new Set([
  'רשימת קניות', 'ירקות', 'פירות', 'פירות וירקות', 'דברים שצמחו באדמה',
  'דברים חלביים', 'חלבי', 'מוצרי חלב', 'דברים לטואלט', 'טואלטיקה', 'פארם',
  'דברים נחמדים', 'מזווה', 'כללי', 'מוצר', 'שם מוצר', 'פריט', 'כמות', 'יחידה',
  'מחלקה', 'בשר', 'בשר ודגים', 'מאפים', 'חטיפים', 'קפואים', 'משקאות', 'ניקיון',
].map(normalizeName));

const IRRELEVANT_HEADERS = new Set([
  'ציוד בניה', 'ציוד בנייה', 'בניה', 'עבודה', 'שיפוצים', 'כלי עבודה', 'טמבור',
  'קניות כלליות', 'לבית', 'ריהוט', 'רהיטים', 'איקאה', 'הום סנטר', 'ביגוד', 'בגדים',
  'אלקטרוניקה', 'מחשבים', 'משימות', 'מטלות', 'ארוחות לשבת', 'ארוחות', 'מתכונים',
  'קניות לקמפינג', 'קמפינג', 'טיול', 'מלון', 'אטרקציה', 'מסעדה', 'הערות', 'קישור',
  'שמואל', 'רוני', 'למי', 'מחיר', 'סטטוס',
].map(normalizeName));

// Specific non-supermarket item rules (caught regardless of which column they appear in)
const IRRELEVANT_ITEM_RULES = [
  { reason: 'ציוד בנייה וכלי עבודה', re: /(מקדח|דיבל|מסמר|בורג|ברגים|אום|שייבה|פטיש|מברג|פלאייר|מפתח שוודי|מטר מדידה|פלס|שפכטל|נייר שיוף|ספריי צבע|צבע קיר|רובה|דבק נגרים|מ["״'׳]{1,2}מ\b)/i },
  { reason: 'ריהוט וציוד לבית', re: /(כיסא|כסא|שולחן|ספה|כורסא|כורסה|ארון|שידה|מיטה|מזרן|שטיח|וילון|מראה|מדף|מתלה|גוף תאורה|מנורת)/i },
  { reason: 'כלי מטבח קבועים (לא סופר)', re: /(קרש חיתוך|כפות עץ|סכום בשרי|סכו["״']?ם בשרי|סכו["״']?ם חלבי|כוסות יין|כוסות קפה קר|צלחות כוסות קעריות|סט צלחות|סיר |מחבת |תבנית אפייה מסיליקון|מעבד מזון|מיקסר|בלנדר|קומקום)/i },
  { reason: 'אלקטרוניקה ומחשוב', re: /(מחשב|לפטופ|מסך|מקלדת|עכבר|טלוויזיה|מדפסת|טלפון|אייפון|אוזניות|מטען|כבל hdmi|ראוטר)/i },
  { reason: 'ביגוד והנעלה', re: /(חולצה|מכנסיים|נעליים|סנדלים|מעיל|סוודר|שמלה|חצאית|תיק גב)/i },
  { reason: 'קישור / טקסט לא רלוונטי', re: /(^https?:\/\/|^www\.|^\d+([.,]\d+)?$)/i },
];

/** Parse CSV or Tab-Separated text (from Google Sheets copy-paste or /export?format=csv) into a 2D array. */
export function parseGrid(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!raw.trim()) return [];

  // Detect TSV (Google Sheets copy-paste uses tabs, rarely commas inside cells)
  const firstLines = raw.split('\n').slice(0, 10).join('\n');
  if (firstLines.includes('\t')) {
    return raw.split('\n').map((line) => line.split('\t').map((c) => c.trim()));
  }

  // Full RFC-4180 CSV parser supporting quoted commas & multiline cells
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"' && raw[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

function classifyIrrelevantReason(rawText, colHeaderNorm) {
  const norm = normalizeName(rawText);
  if (!norm || norm.length < 2) return 'ריק / קצר מדי';
  if (GROCERY_HEADERS.has(norm) || IRRELEVANT_HEADERS.has(norm)) return 'כותרת עמודה';

  for (const rule of IRRELEVANT_ITEM_RULES) {
    if (rule.re.test(rawText) || rule.re.test(norm)) return rule.reason;
  }

  if (colHeaderNorm && IRRELEVANT_HEADERS.has(colHeaderNorm)) {
    return `עמודה לא רלוונטית (${colHeaderNorm})`;
  }
  return null;
}

/**
 * Analyze a 2D grid from Google Sheets / CSV and separate buyable supermarket items
 * from headers and non-supermarket items (tools, furniture, general purchases, etc.).
 */
export function analyzeSheetGrid(grid, overrides = {}) {
  const relevant = [];
  const skipped = [];
  const seen = new Set();

  const maxCols = grid.reduce((m, r) => Math.max(m, r.length), 0);
  const colHeaders = new Array(maxCols).fill('');

  // First pass: detect active column header row-by-row as we scan top-down
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    for (let c = 0; c < maxCols; c++) {
      const cell = (row[c] || '').trim();
      if (!cell) continue;
      const norm = normalizeName(cell);

      // Update column header if this cell is a known section/category header
      if (IRRELEVANT_HEADERS.has(norm) || GROCERY_HEADERS.has(norm)) {
        colHeaders[c] = norm;
        skipped.push({ raw: cell, reason: 'כותרת עמודה / קטגוריה', col: c });
        continue;
      }

      const irrelReason = classifyIrrelevantReason(cell, colHeaders[c]);
      if (irrelReason) {
        skipped.push({ raw: cell, reason: irrelReason, col: c });
        continue;
      }

      const parsed = parseItem(cell);
      if (!parsed || !parsed.name) {
        skipped.push({ raw: cell, reason: 'לא זוהה כמוצר', col: c });
        continue;
      }

      const itemKey = normalizeName(parsed.name);
      if (seen.has(itemKey)) {
        skipped.push({ raw: cell, reason: 'כפילות ברשימה', col: c });
        continue;
      }
      seen.add(itemKey);

      const category = categorize(parsed.name, overrides);
      relevant.push({
        ...parsed,
        category,
        raw: cell,
        sourceHeader: colHeaders[c] || '',
      });
    }
  }

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
    const price = it.product?.chainPrices?.[activeChainId] ?? it.product?.price ?? '';
    rows.push([
      cat,
      it.name,
      it.qty,
      unitLabel,
      it.checked ? 'כן' : 'לא',
      prodName,
      typeof price === 'number' ? price.toFixed(2) : price,
      it.note || '',
    ]);
  }
  return '\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}
