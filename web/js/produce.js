// Deterministic Israeli Weighted-Produce Specification (Pure ES module: zero DOM, zero external deps).
// Defines how SmartCart interprets quantities on weighted items (vegetables, fruits, bulk produce):
// 1. Explicit weight ("1.5 ק״ג גזר", "500 גרם עגבניות") -> exact kg (`estimated: false`).
// 2. Explicit count ("3 גזרים", "5 מלפפונים") -> N single pieces * average piece weight (`3 * 0.12 = 0.36 kg`, `estimated: true`).
// 3. Bare produce with NO number ("גזר", "עגבניות", "שום") -> realistic household default (`1.0 kg` staples, `0.25-0.5 kg` aromatics/small items).

const FINAL_AT_WORD_END = [
  [/מ(?=\s|$)/g, 'ם'],
  [/נ(?=\s|$)/g, 'ן'],
  [/צ(?=\s|$)/g, 'ץ'],
  [/פ(?=\s|$)/g, 'ף'],
  [/כ(?=\s|$)/g, 'ך'],
];

function normHeb(str) {
  let s = String(str || '')
    .toLowerCase()
    .replace(/["״'׳`]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [re, rep] of FINAL_AT_WORD_END) s = s.replace(re, rep);
  return s;
}

// Ordered longest/most-specific phrase first so "פלפל חריף" matches before "פלפל" and "תפוח אדמה" before "תפוח".
export const PRODUCE_PIECE_RULES = [
  { phrases: ['פלפל חריף', 'פלפלים חריפים', 'צ׳ילי', 'צילי', 'חלפיניו'], pieceKg: 0.03, bareKg: 0.25 },
  { phrases: ['עגבניות שרי', 'עגבניית שרי', 'שרי תמר'], pieceKg: 0.02, bareKg: 0.50 },
  { phrases: ['ארטישוק ירושלמי', 'קסביה'], pieceKg: 0.12, bareKg: 0.50 },
  { phrases: ['תפוח אדמה', 'תפוחי אדמה', 'תפוא'], pieceKg: 0.18, bareKg: 1.00 },
  { phrases: ['תפוח עץ', 'תפוחי עץ', 'תפוחים', 'תפוח'], pieceKg: 0.18, bareKg: 1.00 },
  { phrases: ['שעועית ירוקה', 'שעועית צהובה'], pieceKg: 0.01, bareKg: 0.50 },
  { phrases: ['שורש פטרוזיליה', 'שורש סלרי', 'חזרת'], pieceKg: 0.15, bareKg: 0.30 },
  { phrases: ['שום'], pieceKg: 0.06, bareKg: 0.25 },
  { phrases: ['גינגר', 'זנגביל'], pieceKg: 0.08, bareKg: 0.25 },
  { phrases: ['פטריות', 'פטריה', 'שמפיניון', 'פורטובלו'], pieceKg: 0.03, bareKg: 0.50 },
  { phrases: ['לימון', 'לימונים', 'ליים'], pieceKg: 0.11, bareKg: 0.50 },
  { phrases: ['קלמנטינה', 'קלמנטינות', 'מנדרינה', 'מנדרינות'], pieceKg: 0.10, bareKg: 1.00 },
  { phrases: ['משמש', 'משמשים'], pieceKg: 0.07, bareKg: 0.50 },
  { phrases: ['שזיף', 'שזיפים'], pieceKg: 0.08, bareKg: 0.50 },
  { phrases: ['קיווי'], pieceKg: 0.09, bareKg: 0.50 },
  { phrases: ['גזר', 'גזרים'], pieceKg: 0.12, bareKg: 1.00 },
  { phrases: ['מלפפון', 'מלפפונים'], pieceKg: 0.13, bareKg: 1.00 },
  { phrases: ['עגבניה', 'עגבניות'], pieceKg: 0.15, bareKg: 1.00 },
  { phrases: ['בננה', 'בננות'], pieceKg: 0.15, bareKg: 1.00 },
  { phrases: ['אפרסק', 'אפרסקים', 'נקטרינה', 'נקטרינות'], pieceKg: 0.15, bareKg: 1.00 },
  { phrases: ['בצל', 'בצלים'], pieceKg: 0.16, bareKg: 1.00 },
  { phrases: ['קישוא', 'קישואים', 'זוקיני'], pieceKg: 0.16, bareKg: 1.00 },
  { phrases: ['אגס', 'אגסים'], pieceKg: 0.18, bareKg: 1.00 },
  { phrases: ['אפרסמון', 'אפרסמונים'], pieceKg: 0.18, bareKg: 1.00 },
  { phrases: ['פלפל', 'פלפלים', 'גמבה', 'גמבות'], pieceKg: 0.19, bareKg: 1.00 },
  { phrases: ['סלק', 'סלקים'], pieceKg: 0.20, bareKg: 1.00 },
  { phrases: ['לפת', 'לפתות'], pieceKg: 0.20, bareKg: 1.00 },
  { phrases: ['אבוקדו'], pieceKg: 0.22, bareKg: 0.50 },
  { phrases: ['תפוז', 'תפוזים'], pieceKg: 0.22, bareKg: 1.00 },
  { phrases: ['בטטה', 'בטטות'], pieceKg: 0.25, bareKg: 1.00 },
  { phrases: ['קולרבי', 'קולורבי'], pieceKg: 0.25, bareKg: 1.00 },
  { phrases: ['שומר'], pieceKg: 0.30, bareKg: 1.00 },
  { phrases: ['רימון', 'רימונים'], pieceKg: 0.30, bareKg: 1.00 },
  { phrases: ['חציל', 'חצילים'], pieceKg: 0.35, bareKg: 1.00 },
  { phrases: ['מנגו'], pieceKg: 0.35, bareKg: 1.00 },
  { phrases: ['אשכולית', 'אשכוליות'], pieceKg: 0.35, bareKg: 1.00 },
  { phrases: ['פומלית', 'פומלה'], pieceKg: 0.45, bareKg: 1.00 },
  { phrases: ['ענבים'], pieceKg: 0.50, bareKg: 1.00 },
  { phrases: ['דלורית'], pieceKg: 0.90, bareKg: 0.90 },
  { phrases: ['כרובית', 'כרוביות'], pieceKg: 1.00, bareKg: 1.00 },
  { phrases: ['כרוב'], pieceKg: 1.20, bareKg: 1.20 },
  { phrases: ['אננס'], pieceKg: 1.30, bareKg: 1.30 },
  { phrases: ['מלון', 'מלונים'], pieceKg: 1.80, bareKg: 1.80 },
  { phrases: ['אבטיח', 'אבטיחים'], pieceKg: 6.00, bareKg: 6.00 },
];

const DEFAULT_FALLBACK_PIECE_KG = 0.20;

function findProduceRule(rawName) {
  const n = normHeb(rawName);
  if (!n) return null;
  const padded = ` ${n} `;
  for (const rule of PRODUCE_PIECE_RULES) {
    for (const ph of rule.phrases) {
      const pn = normHeb(ph);
      if (padded.includes(` ${pn} `)) return rule;
      // Also allow prefix ה/ב/ל on single-word produce nouns
      if (!pn.includes(' ') && (padded.includes(` ה${pn} `) || padded.includes(` ל${pn} `) || padded.includes(` ב${pn} `))) {
        return rule;
      }
    }
  }
  return null;
}

export function lookupPieceWeightKg(name) {
  const r = findProduceRule(name);
  return r ? r.pieceKg : null;
}

export function lookupBareDefaultKg(name) {
  const r = findProduceRule(name);
  return r ? r.bareKg : 1.0;
}

export function isKnownWeightedProduceName(name) {
  return Boolean(findProduceRule(name));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Resolves exact or estimated kilograms to charge for a weighted supermarket item (`match.weighted === true`).
 * @param {object} line  Shopping list line `{ name, qty, unit, qtyExplicit }`
 * @param {object} match Chain match `{ weighted, productName }`
 */
export function resolveWeightedChargeKg(line, match) {
  const rawQty = Number(line?.qty) > 0 ? Number(line.qty) : 1;
  const unit = line?.unit || 'unit';

  if (unit === 'kg') {
    return { qty: rawQty, estimated: false, mode: 'explicit_kg' };
  }
  if (unit === 'g') {
    return { qty: Math.round((rawQty / 1000) * 1000) / 1000, estimated: false, mode: 'explicit_g' };
  }
  if (unit === 'pack') {
    const packs = Math.max(1, Math.round(rawQty));
    return { qty: packs * 1.0, estimated: true, mode: 'pack_estimate', packs };
  }

  // unit === 'unit': distinguish explicit count ("3 גזרים", "1 אבטיח") from bare name ("גזר")
  const isExplicitCount = line?.qtyExplicit === true || rawQty !== 1;

  if (isExplicitCount) {
    const pieces = Math.max(1, rawQty);
    const pieceKg = lookupPieceWeightKg(line?.name) ?? lookupPieceWeightKg(match?.productName) ?? DEFAULT_FALLBACK_PIECE_KG;
    const kg = Math.max(0.05, round2(pieces * pieceKg));
    return { qty: kg, estimated: true, mode: 'pieces_estimate', pieceKg, pieces };
  }

  const bareRule = findProduceRule(line?.name) || findProduceRule(match?.productName);
  const bareKg = bareRule ? bareRule.bareKg : 1.0;
  return { qty: bareKg, estimated: true, mode: 'bare_default_kg' };
}
