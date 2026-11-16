// Free-text grocery parsing: "2 חלב", "1.5 ק"ג עגבניות", "במבה x3", "milk 2", "קילו בננות"

export const UNITS = {
  unit: { he: "יח'", en: 'pcs' },
  kg: { he: 'ק"ג', en: 'kg' },
  g: { he: 'גרם', en: 'g' },
  pack: { he: 'חב\'', en: 'pack' },
};

const UNIT_PATTERNS = [
  { re: /^(ק["״'׳]?ג|קג|קילו|קילוגרם|קילוגרמים|kg|kgs|kilo|kilos)$/i, unit: 'kg' },
  { re: /^(גרם|גר["'׳]?|g|gr|gram|grams)$/i, unit: 'g' },
  { re: /^(יח["'׳]?|יחידה|יחידות|unit|units|pcs|pc)$/i, unit: 'unit' },
  { re: /^(חבילה|חבילות|חב["'׳]|מארז|מארזים|אריזה|אריזות|שקית|שקיות|pack|packs|pkg|bag|bags)$/i, unit: 'pack' },
];

// size words: a number before these is part of the product name ("2 ליטר חלב"), not a quantity
const SIZE_WORD = /^(ליטר|ליטרים|ל["'׳]?|מ["״'׳]?ל|מל|l|ltr|liter|litre|ml|%|אחוז)$/i;

const NUMBER_WORDS = {
  'אחד': 1, 'אחת': 1, 'שני': 2, 'שתי': 2, 'שניים': 2, 'שתיים': 2, 'שלוש': 3, 'שלושה': 3,
  'ארבע': 4, 'ארבעה': 4, 'חמש': 5, 'חמישה': 5, 'שש': 6, 'שישה': 6, 'עשר': 10, 'עשרה': 10,
  'חצי': 0.5, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'dozen': 12, 'half': 0.5,
};

function unitOf(token) {
  if (!token) return null;
  for (const p of UNIT_PATTERNS) if (p.re.test(token)) return p.unit;
  return null;
}

function numberOf(token) {
  if (!token) return null;
  if (/^\d+([.,]\d+)?$/.test(token)) return parseFloat(token.replace(',', '.'));
  if (/^\d+\/\d+$/.test(token)) {
    const [a, b] = token.split('/').map(Number);
    return b ? a / b : null;
  }
  const w = token.toLowerCase();
  return w in NUMBER_WORDS ? NUMBER_WORDS[w] : null;
}

function multOf(token) {
  // x3, ×3, *3, 3x
  const m = token && token.match(/^(?:[x×*](\d+)|(\d+)[x×*])$/i);
  return m ? parseInt(m[1] || m[2], 10) : null;
}

function tokenize(text) {
  const out = [];
  for (const t of text.split(/\s+/).filter(Boolean)) {
    // split glued number+unit: "2ק"ג", "500גרם", "1.5kg"
    const m = t.match(/^(\d+(?:[.,]\d+)?)(\D.*)$/);
    if (m && m[2] !== '%' && (unitOf(m[2]) || SIZE_WORD.test(m[2]))) out.push(m[1], m[2]);
    else out.push(t);
  }
  return out;
}

const QUALIFIER_WORDS = /^(לפחות|בערך|כמו|כ|בסביבות|מינימום|מקסימום|עד|approx|about|min|around)$/i;

export function parseItem(raw) {
  let uncertain = false;
  let text = String(raw || '')
    .replace(/^\s*([-•*·▪●]|\d+[.)])\s+/, '') // bullets / numbering
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  if (/\?+$/.test(text)) {
    uncertain = true;
    text = text.replace(/\?+$/, '').trim();
    if (!text) return null;
  }

  let tokens = tokenize(text);
  let qty = null;
  let unit = null;

  // "סלק לפחות 5" / "עגבניות בערך 2 ק"ג"
  const qIdx = tokens.findIndex((t, idx) => idx > 0 && QUALIFIER_WORDS.test(t) && numberOf(tokens[idx + 1]) !== null);
  if (qIdx > 0) {
    const qNum = numberOf(tokens[qIdx + 1]);
    const qUnit = unitOf(tokens[qIdx + 2]);
    qty = qNum;
    if (qUnit) {
      unit = qUnit;
      tokens.splice(qIdx, 3);
    } else {
      tokens.splice(qIdx, 2);
    }
  }

  // leading "x3" / "3x"
  const leadMult = multOf(tokens[0]);
  if (leadMult && tokens.length > 1) {
    qty = leadMult;
    tokens = tokens.slice(1);
  }

  // trailing "x3"
  const trailMult = multOf(tokens[tokens.length - 1]);
  if (qty === null && trailMult && tokens.length > 1) {
    qty = trailMult;
    tokens = tokens.slice(0, -1);
  }

  if (qty === null) {
    const n0 = numberOf(tokens[0]);
    const u0 = unitOf(tokens[0]);
    if (n0 !== null && tokens.length > 1 && !SIZE_WORD.test(tokens[1])) {
      // "2 חלב" / "1.5 ק"ג עגבניות"
      const u1 = unitOf(tokens[1]);
      if (u1 && tokens.length > 2) {
        qty = n0; unit = u1; tokens = tokens.slice(2);
      } else if (!u1) {
        qty = n0; tokens = tokens.slice(1);
      }
    } else if ((u0 === 'kg' || u0 === 'g') && tokens.length > 1) {
      // "קילו עגבניות"
      qty = 1; unit = u0; tokens = tokens.slice(1);
    }
  }

  if (qty === null && tokens.length > 2) {
    // "עגבניות 2 ק"ג"
    const uL = unitOf(tokens[tokens.length - 1]);
    const nL = numberOf(tokens[tokens.length - 2]);
    if (uL && nL !== null) {
      qty = nL; unit = uL; tokens = tokens.slice(0, -2);
    }
  }

  if (qty === null && tokens.length > 1) {
    // "במבה 3" – bare small integer at the end (not "קולה 1.5", not "שמנת 32")
    const last = tokens[tokens.length - 1];
    if (/^\d+$/.test(last) && +last > 0 && +last <= 30) {
      qty = +last; tokens = tokens.slice(0, -1);
    }
  }

  const name = tokens.join(' ').replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '').trim();
  if (!name) return null;

  if (qty === null) qty = 1;
  if (!unit) unit = 'unit';
  if (unit === 'g' && qty >= 1000) { qty = qty / 1000; unit = 'kg'; }
  const out = { name, qty: Math.round(qty * 1000) / 1000, unit };
  if (uncertain) out.note = 'אולי (?)';
  return out;
}

export function splitItems(text) {
  return String(text || '')
    .split(/[\n,;،]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseMany(text) {
  return splitItems(text).map(parseItem).filter(Boolean);
}

export function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/["״'׳`]/g, '')
    .replace(/[^\p{L}\p{N}%.\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatQty(qty, unit, lang = 'he') {
  const q = Number.isInteger(qty) ? String(qty) : String(Math.round(qty * 100) / 100);
  if (unit === 'unit') return q;
  return `${q} ${UNITS[unit] ? UNITS[unit][lang] : unit}`;
}
