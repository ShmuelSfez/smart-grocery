// Browser & Node-testable data layer for Real Price Data v1 (Israeli Price Transparency feeds).
// Loads meta.json, cities.json, per-chain catalog.json, and selected per-branch <storeId>.json,
// and implements Hebrew product search + Q15 hybrid cross-chain basket matching.

import { LIVE_CHAIN_IDS } from './chains.js';

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
    .replace(/[^\p{L}\p{N}%.\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Lightweight Hebrew singular/plural variants so "עגבניות" matches "עגבניה", "מלפפונים" matches "מלפפון", etc.
export function expandHebrewToken(tok) {
  const variants = new Set([tok]);
  if (tok.length > 3 && tok.startsWith('ה')) variants.add(tok.slice(1));
  if (tok.length >= 4 && tok.endsWith('יות')) {
    variants.add(tok.slice(0, -3) + 'יה');
    variants.add(tok.slice(0, -3) + 'ית');
  }
  if (tok.length >= 4 && tok.endsWith('ות')) {
    const stem = tok.slice(0, -2);
    variants.add(stem);
    variants.add(stem + 'ה');
  }
  if (tok.length >= 4 && tok.endsWith('ים')) {
    const stem = tok.slice(0, -2);
    variants.add(stem);
    variants.add(stem + 'ה');
  }
  if (tok.length >= 3 && tok.endsWith('ה')) {
    variants.add(tok.slice(0, -1) + 'ות');
  }
  return [...variants].filter((v) => v.length >= 2 || /^\d/.test(v));
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

function tokenMatchesEntry(variants, entry) {
  for (const v of variants) {
    for (let i = 0; i < entry.words.length; i++) {
      const w = entry.words[i];
      if (w === v) return { matched: true, exact: true, wordIndex: i };
      if (v.length >= 3 && (w.startsWith(v) || v.startsWith(w)) && Math.abs(w.length - v.length) <= 2) {
        return { matched: true, exact: false, wordIndex: i };
      }
    }
    if (entry.normBrand && (entry.normBrand === v || (v.length >= 3 && entry.normBrand.includes(v)))) {
      return { matched: true, exact: false, wordIndex: 2 };
    }
  }
  return { matched: false, exact: false, wordIndex: -1 };
}

export function scoreEntry(entry, queryNorm, tokenVariants) {
  if (!queryNorm || !tokenVariants.length) return 0;
  if (entry.normName === queryNorm) return 300;

  let matchedCount = 0;
  let score = 0;
  for (let t = 0; t < tokenVariants.length; t++) {
    const hit = tokenMatchesEntry(tokenVariants[t], entry);
    if (!hit.matched) continue;
    matchedCount++;
    score += hit.exact ? 40 : 24;
    if (t === 0 && hit.wordIndex === 0) score += 65; // head-noun match ("חלב טרי" > "שוקולד חלב")
    else if (hit.wordIndex === 0) score += 25;
  }

  if (matchedCount < tokenVariants.length) return 0;
  if (entry.normName.startsWith(queryNorm + ' ')) score += 45;
  // Penalize mini/personal cups when user asks for generic staples ("קוטג'" -> 250g, not "בקטנה" 100g)
  if (!/(?:^|\s)(בקטנה|אישי|מיני|לדרך|מוקטן)(?:$|\s)/.test(queryNorm)
      && /(?:^|\s)(בקטנה|אישי|מיני|לדרך|מוקטן)(?:$|\s)/.test(entry.normName)) {
    score -= 25;
  }
  // Slightly prefer concise core product names over long multi-pack accessories
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

function findBestInSingleChain(queryText, chainBundle, preferWeighted = null) {
  const queryNorm = normalizeSearchText(queryText);
  const rawTokens = queryNorm.split(' ').filter(Boolean);
  if (!rawTokens.length) return null;
  const tokenVariants = rawTokens.map(expandHebrewToken);

  const { catalog, storePrices } = chainBundle;
  let best = null;
  let bestScore = 0;

  for (const entry of catalog.entries) {
    if (preferWeighted !== null && entry.weighted !== preferWeighted) continue;
    const sp = storePrices[entry.code];
    if (!sp || !(sp[0] > 0)) continue;
    const sc = scoreEntry(entry, queryNorm, tokenVariants);
    if (sc <= 0) continue;
    if (sc > bestScore || (sc === bestScore && best && sp[0] < best.price)) {
      bestScore = sc;
      best = {
        price: sp[0],
        unitPrice: sp[1] || 0,
        weighted: entry.weighted,
        promo: sp[2] || null,
        code: entry.code,
        productName: entry.name,
        brand: entry.brand,
      };
    }
  }
  return best;
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
      // Generic item: best name match in each chain
      const best = findBestInSingleChain(line.searchQuery || line.name, bundle, preferWeighted)
        || (preferWeighted !== null ? findBestInSingleChain(line.searchQuery || line.name, bundle, null) : null);
      matches[cid] = best ? { ...best, kind: 'exact', genericMatch: true } : null;
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
