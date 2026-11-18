// Browser & Node-testable data layer for Real Price Data v1 (Israeli Price Transparency feeds).
// Loads meta.json, cities.json, per-chain catalog.json, and selected per-branch <storeId>.json,
// and implements Hebrew product search + Q15 hybrid cross-chain basket matching.

import { LIVE_CHAIN_IDS } from './chains.js';
import { getSearchQueriesForItem } from './synonyms.js';

export const PROD_DATA_BASE = 'https://shmuelsfez.github.io/smart-grocery/data/v1';
export const LOCAL_DATA_BASE = '/data/v1';

let activeBaseUrl = null;
let metaPromise = null;
let citiesPromise = null;
const catalogCache = new Map(); // chainId -> Promise<CatalogBundle> | CatalogBundle
const storeCache = new Map();   // `${chainId}:${storeId}` -> Promise<Object> | Object

export function normalizeBarcode(code) {
  const s = String(code || '').trim().replace(/^P_/i, '').replace(/\s+/g, '');
  if (/^\d+$/.test(s) && s.length >= 7) return s.replace(/^0+/, '') || '0';
  return s;
}

export function normalizeSearchText(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/["״'׳`]/g, '')
    .replace(/([\u0590-\u05FF])(\d)/g, '$1 $2')
    .replace(/(\d)([\u0590-\u05FF])/g, '$1 $2')
    .replace(/[^\p{L}\p{N}%.\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TO_FINAL_HEB = { 'מ': 'ם', 'נ': 'ן', 'צ': 'ץ', 'פ': 'ף', 'כ': 'ך' };
function toFinalHebLetter(w) {
  if (!w || w.length < 2) return w;
  const last = w[w.length - 1];
  return TO_FINAL_HEB[last] ? w.slice(0, -1) + TO_FINAL_HEB[last] : w;
}

// Lightweight Hebrew singular/plural variants so "עגבניות" matches "עגבניה", "מלפפונים" matches "מלפפון", "לימונים" matches "לימון", etc.
export function expandHebrewToken(tok) {
  const variants = new Set([tok, toFinalHebLetter(tok)]);
  // Orthographic double/single yod & vav variants ("אפייה"<->"אפיה", "חלווה"<->"חלבה", "אוויר"<->"אויר")
  if (tok.includes('יי')) variants.add(tok.replace(/יי/g, 'י'));
  if (tok.includes('וו')) variants.add(tok.replace(/וו/g, 'ו'));
  if (tok === 'קולרבי' || tok === 'קולורבי') { variants.add('קולרבי'); variants.add('קולורבי'); }
  if (tok === 'קרואסון' || tok === 'קוראסון') { variants.add('קרואסון'); variants.add('קוראסון'); }
  if (tok === 'מלאווח' || tok === 'מלוואח' || tok === 'מלאוח' || tok === 'מלואח') {
    variants.add('מלאווח'); variants.add('מלוואח'); variants.add('מלאוח'); variants.add('מלואח');
  }
  if (tok === 'טסטרס' || tok === 'טייסטרס') { variants.add('טסטרס'); variants.add('טייסטרס'); }
  if (tok === 'צויס' || tok === 'צוייס') { variants.add('צויס'); variants.add('צוייס'); }

  const seedList = [...variants];
  for (const base of seedList) {
    if (base.length > 3 && (base.startsWith('ה') || base.startsWith('ל') || base.startsWith('ב'))) {
      variants.add(base.slice(1));
    }
    if (base === 'כלים' || base === 'כביסה' || base === 'רצפה' || base === 'מדיח' || base === 'ידיים' || base === 'ידים') {
      variants.add('ל' + base);
    }
    // Construct feminine -ת <-> -ה / -ות ("גלידת" -> "גלידה", "מגבות" <-> "מגבת")
    if (base.length >= 4 && base.endsWith('ת') && !base.endsWith('ות') && !base.endsWith('ית')) {
      variants.add(base.slice(0, -1) + 'ה');
      variants.add(base.slice(0, -1) + 'ות');
    }
    if (base === 'פירות' || base === 'פרות') {
      variants.add('פירות');
      variants.add('פרות');
    }
    if (base.length >= 4 && base.endsWith('יות')) {
      variants.add(base.slice(0, -3) + 'יה');
      variants.add(base.slice(0, -3) + 'יית');
      variants.add(base.slice(0, -3) + 'ית');
    }
    if (base.length >= 4 && base.endsWith('ות')) {
      const stem = base.slice(0, -2);
      variants.add(stem + 'ה');
      // Require >=3-letter stem for -ת / bare stem so "מצות" (stem "מצ") never expands to "מצת" (lighter)!
      if (stem.length >= 3) {
        variants.add(toFinalHebLetter(stem));
        variants.add(stem + 'ת');
      }
    }
    if (base.length >= 5 && base.endsWith('יים')) {
      variants.add(base.slice(0, -3) + 'י');
    }
    if (base.length >= 4 && base.endsWith('ים')) {
      const stem = base.slice(0, -2);
      variants.add(toFinalHebLetter(stem));
      variants.add(stem + 'ה');
      variants.add(stem + 'י');
    }
    if (base.length >= 4 && base.endsWith('י')) {
      const stem = base.slice(0, -1);
      variants.add(toFinalHebLetter(stem));
      variants.add(stem + 'ים');
    }
    if (base.length >= 3 && base.endsWith('ה')) {
      variants.add(base.slice(0, -1) + 'ות');
    }
  }
  return [...variants].filter((v) => v.length >= 2 || /^\d/.test(v));
}

const collapseCache = new Map();
function collapseOrthWord(w) {
  if (!w || w.length < 3) return w;
  let c = collapseCache.get(w);
  if (c === undefined) {
    c = w.replace(/יי/g, 'י').replace(/וו/g, 'ו');
    collapseCache.set(w, c);
  }
  return c;
}

export function buildCatalogBundle(rawCatalog) {
  const byCode = rawCatalog || {};
  const byNormBarcode = new Map();
  const entries = [];

  for (const [code, tuple] of Object.entries(byCode)) {
    if (!Array.isArray(tuple)) continue;
    const [name, brand, qty, unit, weighted] = tuple;
    const normName = normalizeSearchText(name);
    const normBrand = normalizeSearchText(brand);
    const words = normName.split(' ').filter(Boolean);
    const collapsedWords = words.map(collapseOrthWord);
    const collapsedBrandWords = normBrand ? normBrand.split(' ').filter(Boolean).map(collapseOrthWord) : [];
    const entry = {
      code,
      normBarcode: normalizeBarcode(code),
      name: name || '',
      brand: brand || '',
      qty: Number(qty) || 0,
      unit: unit || '',
      weighted: Boolean(weighted),
      normName,
      normBrand,
      words,
      collapsedWords,
      collapsedBrandWords,
    };
    entries.push(entry);
    if (!byNormBarcode.has(entry.normBarcode)) {
      byNormBarcode.set(entry.normBarcode, entry);
    }
  }
  return { byCode, byNormBarcode, entries };
}

function formatUnitDesc(entry) {
  if (entry.weighted) return 'לפי משקל (ק"ג)';
  if (entry.qty > 0 && entry.unit) return `${entry.qty} ${entry.unit}`;
  if (entry.unit) return entry.unit;
  return 'יחידה';
}

function tokenMatchesEntry(variants, entry, tokenIdx = 0) {
  const isPossiblyTruncated = entry.name.trim().length >= 19;
  const lastWordIdx = entry.words.length - 1;

  for (const v of variants) {
    const vc = collapseOrthWord(v);
    for (let i = 0; i < entry.words.length; i++) {
      const w = entry.words[i];
      if (w === v) return { matched: true, exact: true, wordIndex: i };
      const wc = entry.collapsedWords[i];
      if (vc.length >= 3 && (wc === vc || wc === 'ל' + vc)) {
        return { matched: true, exact: wc === vc, wordIndex: i };
      }
      // Handle 20-char ERP XML truncation ONLY on trailing word >= 3 chars covering >= 70% of query token
      if (
        isPossiblyTruncated
        && i === lastWordIdx
        && wc.length >= 3
        && vc.length > wc.length
        && wc.length >= Math.ceil(vc.length * 0.7)
        && vc.startsWith(wc)
      ) {
        return { matched: true, exact: false, wordIndex: i };
      }
    }
    if (tokenIdx > 0 && entry.collapsedBrandWords.length) {
      if (entry.collapsedBrandWords.includes(vc)) {
        return { matched: true, exact: false, wordIndex: 2 };
      }
    }
  }
  return { matched: false, exact: false, wordIndex: -1 };
}

// Hard-disqualifying words: if present in product name and absent from query, reject completely
const HARD_DISQUALIFIERS = [
  ['מכונת', ['מכונת', 'מכונה']],
  ['מכונה', ['מכונת', 'מכונה']],
  ['שיפודי', ['שיפוד', 'שיפודי']],
  ['בורקס', ['בורקס']],
  ['בושם', ['בושם']],
  ['אדט', ['אדט', 'בושם']],
  ['אדפ', ['אדפ', 'בושם']],
  ['לחתולים', ['חתול', 'לחתול', 'לחתולים', 'פריסקיז']],
  ['לחתול', ['חתול', 'לחתול', 'לחתולים', 'פריסקיז']],
  ['לכלבים', ['כלב', 'לכלב', 'לכלבים', 'בונזו', 'דוגלי']],
  ['לכלב', ['כלב', 'לכלב', 'לכלבים', 'בונזו', 'דוגלי']],
  // Hard-disqualify dish soap when user asked for non-dish product, UNLESS query mentions כלים / מדיח / פיירי
  ['לכלים', ['כלים', 'לכלים', 'מדיח', 'פיירי', 'פירי']],
  ['נר', ['נר', 'נרות', 'נרונים']],
];

// Exact derivative words (matched by full word or plural, NOT prefix, so "נוזל" never penalizes "נוזלי")
const DERIVATIVE_WORDS = [
  'במלח', 'בחומץ', 'חמוץ', 'חמוצים', 'כבוש', 'כבושים', 'קלוי', 'קלויים', 'ממולא', 'מטוגן', 'שיפקה',
  'רסק', 'קטשופ', 'רוטב', 'מרק', 'אבקת', 'גבישי', 'תבלין', 'מרוסקות', 'מיובשות', 'סירופ', 'תרכיז',
  'לימונית', 'חומץ', 'סיידר', 'תירוש', 'מיץ', 'נקטר', 'משקה', 'תה', 'בירה', 'יין',
  'שוקולד', 'שוקולית', 'עוגיות', 'עוגת', 'עוגה', 'ביסקוויט', 'גלידה', 'גלידת', 'חטיף', 'ביסלי',
  'תפוציפס', 'ציטוס', 'קרקר', 'בורקס', 'מאפה', 'מאפין', 'קרואסון', 'פשטידה', 'רביולי', 'פיצה',
  'סוכריות', 'מסטיק', 'קינדר', 'מרציפן', 'ריבת', 'ריבה', 'פופקורן', 'פופקו', 'קרוטונים', 'טוסט',
  'סבון', 'שמפו', 'נוזל', 'מבריק', 'מגבונים', 'קרם', 'זאוול', 'אקונומיקה', 'ערק', 'אקליפטוס',
  'קרצוף', 'נירוסטה', 'לרצפה', 'רצפה', 'מעושן', 'הודו', 'כיפלי',
  'אדמה', 'בוטנים', 'סויה', 'שקדים', 'קוקוס', 'שיבולת', 'שרי', 'חמוצה', 'אטריות', 'סלט', 'ירושלמי',
  'טחון', 'גרוס', 'קפוא', 'קפואה', 'קפואים', 'שימורים', 'וניל', 'ונילין', 'לימון', 'מדיח', 'חום', 'חלבון',
];

function queryMentionsWord(queryWords, mod) {
  if (queryWords.includes(mod)) return true;
  const stem = mod.length >= 4 && (mod.endsWith('ים') || mod.endsWith('ות')) ? mod.slice(0, -2) : mod;
  return queryWords.some((qw) => qw === stem || (stem.length >= 3 && qw.startsWith(stem)));
}

export function scoreEntry(entry, queryNorm, tokenVariants) {
  if (!queryNorm || !tokenVariants.length) return 0;

  for (const [badWord, allowedTriggers] of HARD_DISQUALIFIERS) {
    if (entry.words.includes(badWord) && !allowedTriggers.some((tr) => queryNorm.includes(tr))) {
      return 0;
    }
  }

  if (entry.normName === queryNorm) return 300;

  let matchedCount = 0;
  let score = 0;
  for (let t = 0; t < tokenVariants.length; t++) {
    const hit = tokenMatchesEntry(tokenVariants[t], entry, t);
    if (!hit.matched) continue;
    matchedCount++;
    score += hit.exact ? 42 : 24;
    if (t === 0 && hit.wordIndex === 0) score += 65;
    else if (hit.wordIndex === 0) score += 25;
  }

  if (matchedCount < tokenVariants.length) return 0;
  if (entry.normName.startsWith(queryNorm + ' ')) score += 45;

  const queryWords = queryNorm.split(' ').filter(Boolean);
  for (const mod of DERIVATIVE_WORDS) {
    if (entry.words.includes(mod) && !queryMentionsWord(queryWords, mod)) {
      score -= 55;
    }
  }
  // Penalize black pepper when user asked for fresh bell pepper ("פלפל אדום"/"צהוב")
  if (entry.words.includes('שחור') && !queryWords.includes('שחור') && !queryWords.includes('טורקי') && !queryWords.includes('קפה')) {
    score -= 55;
  }

  if (!/(?:^|\s)(בקטנה|אישי|מיני|לדרך|מוקטן)(?:$|\s)/.test(queryNorm)
      && /(?:^|\s)(בקטנה|אישי|מיני|לדרך|מוקטן)(?:$|\s)/.test(entry.normName)) {
    score -= 25;
  }
  score -= Math.min(20, Math.max(0, entry.words.length - tokenVariants.length) * 3);
  return Math.max(1, score);
}

/**
 * Search products across the currently selected branches (`branchData`).
 * `branchData` is `{ [chainId]: { catalog: CatalogBundle, storePrices: Object, store: Object } }`.
 */
export function searchCatalogProducts(query, branchData, { limit = 12 } = {}) {
  const rawQ = String(query || '').trim();
  if (!rawQ || !branchData) return [];

  const activeChains = LIVE_CHAIN_IDS.filter((cid) => branchData[cid]?.catalog && branchData[cid]?.storePrices);
  if (!activeChains.length) return [];

  // Direct barcode search
  const maybeBarcode = rawQ.replace(/^P_/i, '').trim();
  if (/^\d{7,14}$/.test(maybeBarcode)) {
    const normB = normalizeBarcode(maybeBarcode);
    const merged = buildMergedCardForBarcode(normB, activeChains, branchData);
    return merged ? [merged] : [];
  }

  const queryNorm = normalizeSearchText(rawQ);
  const rawTokens = queryNorm.split(' ').filter(Boolean);
  if (!rawTokens.length) return [];
  const tokenVariants = rawTokens.map(expandHebrewToken);

  // Score candidate barcodes across all active branches
  const candidateScores = new Map(); // normBarcode -> bestScore
  const candidateRep = new Map();    // normBarcode -> entry

  for (const cid of activeChains) {
    const { catalog, storePrices } = branchData[cid];
    for (const entry of catalog.entries) {
      const sp = storePrices[entry.code];
      if (!sp || !(sp[0] > 0)) continue;
      const sc = scoreEntry(entry, queryNorm, tokenVariants);
      if (sc <= 0) continue;
      const prev = candidateScores.get(entry.normBarcode) || 0;
      if (sc > prev) {
        candidateScores.set(entry.normBarcode, sc);
        candidateRep.set(entry.normBarcode, entry);
      }
    }
  }

  // Sort by relevance score + how many chains carry this exact barcode (easier cross-chain comparison)
  const rankedBarcodes = [...candidateScores.keys()].sort((a, b) => {
    const chainsA = countChainsWithBarcode(a, activeChains, branchData);
    const chainsB = countChainsWithBarcode(b, activeChains, branchData);
    const scoreA = candidateScores.get(a) + chainsA * 8;
    const scoreB = candidateScores.get(b) + chainsB * 8;
    return scoreB - scoreA;
  });

  const results = [];
  for (const normB of rankedBarcodes.slice(0, limit)) {
    const card = buildMergedCardForBarcode(normB, activeChains, branchData, candidateRep.get(normB));
    if (card) results.push(card);
  }
  return results;
}

function countChainsWithBarcode(normBarcode, activeChains, branchData) {
  let n = 0;
  for (const cid of activeChains) {
    const entry = branchData[cid].catalog.byNormBarcode.get(normBarcode);
    if (entry && branchData[cid].storePrices[entry.code]?.[0] > 0) n++;
  }
  return n;
}

function buildMergedCardForBarcode(normBarcode, activeChains, branchData, fallbackEntry = null) {
  let rep = fallbackEntry;
  const chainPrices = {};
  const chainPromos = {};
  const chainCodes = {};

  for (const cid of activeChains) {
    const { catalog, storePrices } = branchData[cid];
    const entry = catalog.byNormBarcode.get(normBarcode);
    if (!entry) continue;
    const sp = storePrices[entry.code];
    if (!sp || !(sp[0] > 0)) continue;
    if (!rep || (!rep.brand && entry.brand)) rep = entry;
    chainPrices[cid] = sp[0];
    if (sp[2]) chainPromos[cid] = sp[2];
    chainCodes[cid] = cid === 'shufersal' ? `P_${entry.code}` : entry.code;
  }

  if (!rep || !Object.keys(chainPrices).length) return null;
  return {
    code: rep.code,
    barcode: normBarcode,
    name: rep.name,
    brand: rep.brand,
    img: '',
    unitDesc: formatUnitDesc(rep),
    weighted: rep.weighted,
    sellingMethod: rep.weighted ? 'BY_WEIGHT' : 'BY_UNIT',
    inStock: true,
    chainPrices,
    chainPromos,
    chainCodes,
  };
}

const catalogMemo = new WeakMap(); // catalog -> WeakMap<storePrices, Map<cacheKey, result>>

function expandSlashSubqueries(rawQuery) {
  const q = String(rawQuery || '').trim();
  if (!/\D\s*\/\s*\D/.test(q)) return [q];
  const [leftRaw, rightRaw] = q.split(/\s*\/\s*/, 2);
  const left = leftRaw.trim();
  const right = (rightRaw || '').trim();
  const leftWords = left.split(/\s+/).filter(Boolean);
  const rightWords = right.split(/\s+/).filter(Boolean);
  const out = [];
  const push = (s) => { const t = s.trim(); if (t && !out.includes(t)) out.push(t); };
  push(left);
  if (leftWords.length > 1 && right) push(`${leftWords[0]} ${right}`);
  // Only search bare `right` alone when `left` was also a single word ("מטרנה / סימילאק") or `right` has >= 2 words
  if (right && (leftWords.length <= 1 || rightWords.length >= 2)) push(right);
  if (leftWords.length >= 2) push(leftWords.slice(0, -1).join(' '));
  return out;
}

function toRetailPackBaseAmount(entry) {
  const q = Number(entry.qty) || 0;
  if (!(q > 0)) return 0;
  const u = String(entry.unit || '').toLowerCase();
  if (/ק["״']?ג|קג|kg|ליטר|ל['׳]?$|liter/.test(u)) return q * 1000;
  if (/מ["״']?ל|מל|ml|גר|gr|g\b/.test(u)) return q;
  return q;
}

function isStandardRetailPack(entry) {
  const amt = toRetailPackBaseAmount(entry);
  if (!(amt > 0)) return true;
  // Standard retail unit is typically 50g..3500g / 100ml..3500ml (avoids 10g sachets & 10kg wholesale sacks)
  return amt >= 50 && amt <= 3500;
}

function isBetterTieBreak(candEntry, prevEntry, tokenCount) {
  const candStd = isStandardRetailPack(candEntry);
  const prevStd = isStandardRetailPack(prevEntry);
  if (candStd !== prevStd) return candStd;
  const candDiff = Math.abs(candEntry.words.length - tokenCount);
  const prevDiff = Math.abs(prevEntry.words.length - tokenCount);
  if (candDiff !== prevDiff) return candDiff < prevDiff;
  return candEntry.normBarcode < prevEntry.normBarcode;
}

function scanSingleNormalizedQuery(queryNorm, chainBundle, preferWeighted) {
  const rawTokens = queryNorm.split(' ').filter(Boolean);
  if (!rawTokens.length) return { best: null, bestScore: 0 };
  const tokenVariants = rawTokens.map(expandHebrewToken);

  const { catalog, storePrices } = chainBundle;
  let best = null;
  let bestEntry = null;
  let bestScore = 0;

  for (const entry of catalog.entries) {
    const sp = storePrices[entry.code];
    if (!sp || !(sp[0] > 0)) continue;
    let sc = scoreEntry(entry, queryNorm, tokenVariants);
    if (sc <= 0) continue;
    // Prefer weighted items when user asked by kg/g (+22 bonus instead of hard-filtering out packaged fresh produce!)
    if (preferWeighted !== null && entry.weighted === preferWeighted) {
      sc += 22;
    }
    if (sc > bestScore || (sc === bestScore && bestEntry && isBetterTieBreak(entry, bestEntry, rawTokens.length))) {
      bestScore = sc;
      bestEntry = entry;
      best = {
        price: sp[0],
        unitPrice: sp[1] || 0,
        weighted: entry.weighted,
        promo: sp[2] || null,
        code: entry.code,
        productName: entry.name,
        brand: entry.brand,
        packBaseAmt: toRetailPackBaseAmount(entry),
      };
    }
  }
  return { best, bestScore };
}

function findBestInSingleChain(queryText, chainBundle, preferWeighted = null) {
  const { catalog, storePrices } = chainBundle;
  const cacheKey = `${preferWeighted}::${String(queryText || '').trim().toLowerCase()}`;

  let byStore = catalogMemo.get(catalog);
  if (!byStore) {
    byStore = new WeakMap();
    catalogMemo.set(catalog, byStore);
  }
  let memoMap = byStore.get(storePrices);
  if (!memoMap) {
    memoMap = new Map();
    byStore.set(storePrices, memoMap);
  }
  if (memoMap.has(cacheKey)) return memoMap.get(cacheKey);

  const candidatePhrases = [];
  for (const { query: synQ, isFallback } of getSearchQueriesForItem(queryText)) {
    const subs = expandSlashSubqueries(synQ);
    subs.forEach((subQ, subIdx) => {
      const nq = normalizeSearchText(subQ);
      if (nq && !candidatePhrases.some((c) => c.nq === nq)) {
        candidatePhrases.push({ nq, isFallback: isFallback || subIdx >= 2 });
      }
    });
  }

  let overallBest = null;
  let overallScore = 0;
  for (let i = 0; i < candidatePhrases.length; i++) {
    const { nq, isFallback } = candidatePhrases[i];
    const { best, bestScore } = scanSingleNormalizedQuery(nq, chainBundle, preferWeighted);
    const adjScore = i === 0 ? bestScore : Math.max(1, bestScore - 8);
    if (best && adjScore > overallScore) {
      overallScore = adjScore;
      overallBest = { ...best, viaFallback: isFallback };
    }
    if (overallBest && overallScore >= 80 && i >= 1) break;
  }

  memoMap.set(cacheKey, overallBest);
  return overallBest;
}

/**
 * Q15 Hybrid Matching for one shopping-list line across all active chains:
 * - Pinned product (`line.product`): match exact barcode first (`kind: 'exact'`).
 *   If a chain lacks that barcode, find the closest normalized name match in that chain (`kind: 'substitute'`).
 * - Unpinned generic line (`!line.product`): pick each chain's best name match (`kind: 'exact'`).
 */
export function matchLineAcrossChains(line, branchData) {
  const matches = {};
  if (!line || !branchData) return matches;

  const pinned = line.product && (line.product.barcode || line.product.code) ? line.product : null;
  const pinnedNormBarcode = pinned ? normalizeBarcode(pinned.barcode || pinned.code) : '';
  const preferWeighted = pinned
    ? (pinned.sellingMethod === 'BY_WEIGHT' || Boolean(pinned.weighted))
    : (line.unit === 'kg' || line.unit === 'g' ? true : null);

  for (const cid of LIVE_CHAIN_IDS) {
    const bundle = branchData[cid];
    if (!bundle?.catalog || !bundle?.storePrices) {
      matches[cid] = null;
      continue;
    }

    if (pinned) {
      // 1. Exact barcode match
      const exactEntry = bundle.catalog.byNormBarcode.get(pinnedNormBarcode);
      const exactPriceTuple = exactEntry ? bundle.storePrices[exactEntry.code] : null;
      if (exactEntry && exactPriceTuple && exactPriceTuple[0] > 0) {
        matches[cid] = {
          price: exactPriceTuple[0],
          unitPrice: exactPriceTuple[1] || 0,
          weighted: exactEntry.weighted,
          promo: exactPriceTuple[2] || null,
          kind: 'exact',
          code: exactEntry.code,
          productName: exactEntry.name,
          brand: exactEntry.brand,
        };
        continue;
      }

      // 2. Substitute: closest name match in this chain (try pinned product name, then generic item name)
      const subByProdName = findBestInSingleChain(pinned.name, bundle, preferWeighted);
      const sub = subByProdName || findBestInSingleChain(line.name, bundle, preferWeighted);
      matches[cid] = sub ? { ...sub, kind: 'substitute' } : null;
    } else {
      // Generic item: best name match in each chain (mark fallback synonym matches as 'substitute' per H3)
      const best = findBestInSingleChain(line.searchQuery || line.name, bundle, preferWeighted)
        || (preferWeighted !== null ? findBestInSingleChain(line.searchQuery || line.name, bundle, null) : null);
      matches[cid] = best ? { ...best, kind: best.viaFallback ? 'substitute' : 'exact', genericMatch: true } : null;
    }
  }

  // H9 Pack-Size Outlier Honesty: if an unpinned generic line matched drastically different pack sizes (>3.5x median),
  // flag the outlier chain match as `kind: 'substitute'` (`sizeOutlier: true`) so the UI surfaces it honestly.
  if (!pinned) {
    const sizes = LIVE_CHAIN_IDS
      .map((cid) => matches[cid])
      .filter((m) => m && !m.weighted && m.packBaseAmt >= 25)
      .map((m) => m.packBaseAmt)
      .sort((a, b) => a - b);
    if (sizes.length >= 2) {
      const median = sizes[Math.floor(sizes.length / 2)];
      for (const cid of LIVE_CHAIN_IDS) {
        const m = matches[cid];
        if (m && !m.weighted && m.packBaseAmt >= 25 && (m.packBaseAmt > median * 3.5 || m.packBaseAmt < median / 3.5)) {
          matches[cid] = { ...m, kind: 'substitute', sizeOutlier: true };
        }
      }
    }
  }

  return matches;
}

// ---------- Network loaders (never cache failures) ----------

async function resolveBaseUrl() {
  if (activeBaseUrl) return activeBaseUrl;
  const isLocal = typeof location !== 'undefined'
    && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  if (isLocal) {
    try {
      const r = await fetch(`${LOCAL_DATA_BASE}/meta.json`);
      if (r.ok) {
        activeBaseUrl = LOCAL_DATA_BASE;
        return activeBaseUrl;
      }
    } catch {}
  }
  activeBaseUrl = PROD_DATA_BASE;
  return activeBaseUrl;
}

async function fetchJsonNoErrorCache(pathSuffix) {
  const base = await resolveBaseUrl();
  const res = await fetch(`${base}/${pathSuffix}`);
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  return res.json();
}

export async function loadMeta() {
  if (!metaPromise) {
    metaPromise = fetchJsonNoErrorCache('meta.json').catch((err) => {
      metaPromise = null;
      throw err;
    });
  }
  return metaPromise;
}

export async function loadCities() {
  if (!citiesPromise) {
    citiesPromise = fetchJsonNoErrorCache('cities.json').catch((err) => {
      citiesPromise = null;
      throw err;
    });
  }
  return citiesPromise;
}

let onlinePromise = null;
/** Online (delivery) stores per chain: { [chainId]: [{ storeId, name, address, city, itemsCount, quick }] } */
export async function loadOnlineStores() {
  if (!onlinePromise) {
    onlinePromise = fetchJsonNoErrorCache('online.json').catch((err) => {
      onlinePromise = null;
      throw err;
    });
  }
  return onlinePromise;
}

/** Coverage status of a chain for a city: 'covered' | 'not-covered' | 'unknown'. */
export function deliveryCoverage(coverageCfg, chainId, cityName) {
  const c = coverageCfg?.chains?.[chainId];
  if (!c || !cityName) return 'unknown';
  const norm = (s) => normalizeSearchText(s).replace(/\s*-\s*/g, '-');
  const target = norm(cityName);
  if ((c.notCovered || []).some((x) => norm(x) === target)) return 'not-covered';
  if ((c.covered || []).some((x) => norm(x) === target)) return 'covered';
  return 'unknown';
}

export async function loadChainCatalog(chainId) {
  if (catalogCache.has(chainId)) return catalogCache.get(chainId);
  const p = fetchJsonNoErrorCache(`${chainId}/catalog.json`)
    .then((raw) => {
      const bundle = buildCatalogBundle(raw);
      catalogCache.set(chainId, bundle);
      return bundle;
    })
    .catch((err) => {
      catalogCache.delete(chainId);
      throw err;
    });
  catalogCache.set(chainId, p);
  return p;
}

export async function loadBranchPrices(chainId, storeId) {
  const cacheKey = `${chainId}:${storeId}`;
  if (storeCache.has(cacheKey)) return storeCache.get(cacheKey);
  const p = fetchJsonNoErrorCache(`${chainId}/stores/${encodeURIComponent(storeId)}.json`)
    .then((raw) => {
      storeCache.set(cacheKey, raw);
      return raw;
    })
    .catch((err) => {
      storeCache.delete(cacheKey);
      throw err;
    });
  storeCache.set(cacheKey, p);
  return p;
}

export function findMatchingCity(input, citiesObj) {
  if (!citiesObj) return '';
  const allCities = Object.keys(citiesObj);
  if (!allCities.length) return '';
  const q = normalizeSearchText(input).replace(/\s*-\s*/g, '-');
  if (!q) return '';

  for (const c of allCities) {
    if (normalizeSearchText(c).replace(/\s*-\s*/g, '-') === q) return c;
  }
  for (const c of allCities) {
    const nc = normalizeSearchText(c);
    if (nc.startsWith(q)) return c;
  }
  for (const c of allCities) {
    const nc = normalizeSearchText(c);
    if (nc.includes(q)) return c;
  }
  return '';
}

export function branchesInCity(cityName, citiesObj) {
  const byChain = Object.fromEntries(LIVE_CHAIN_IDS.map((id) => [id, []]));
  if (!cityName || !citiesObj?.[cityName]) return byChain;
  for (const b of citiesObj[cityName]) {
    if (byChain[b.chain]) byChain[b.chain].push(b);
  }
  return byChain;
}
