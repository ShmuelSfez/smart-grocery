// Independent Reference Price Model (Oracle) for SmartCart DV Regression.
// IMPORTANT: Zero imports from pipeline/* or web/js/*. Reads the raw frozen .xml.gz snapshot
// with its own XML scanner and computes expected shelf + all-customer promotion totals independently.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SNAP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'snapshot');

function xmlVal(chunk, tag) {
  const m = chunk.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!m) return '';
  return m[1]
    .trim()
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function normCode(raw) {
  const s = String(raw || '').trim().replace(/^P_/i, '').replace(/\s+/g, '');
  return /^\d+$/.test(s) && s.length >= 7 ? (s.replace(/^0+/, '') || '0') : s;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function parseSnapshotPrices(xml) {
  const byNormCode = new Map();
  const re = /<Item(?:\s[^>]*)?>([\s\S]*?)<\/Item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const code = xmlVal(b, 'ItemCode').replace(/\s+/g, '');
    const price = round2(Number(xmlVal(b, 'ItemPrice')));
    if (!code || !(price > 0)) continue;
    const name = xmlVal(b, 'ItemName') || xmlVal(b, 'ManufactureItemDescription');
    if (!name) continue;
    const brand = xmlVal(b, 'ManufactureName') || xmlVal(b, 'ManufacturerName');
    const weighted = xmlVal(b, 'bIsWeighted') === '1' || xmlVal(b, 'BisWeighted') === '1';
    const rec = { code, normBarcode: normCode(code), name, brand, weighted, price };
    if (!byNormCode.has(rec.normBarcode)) byNormCode.set(rec.normBarcode, rec);
    byNormCode.set(code, rec);
  }
  return byNormCode;
}

function parseSnapshotPromos(xml, refDate) {
  const byCode = new Map();
  const re = /<Promotion(?:\s[^>]*)?>([\s\S]*?)<\/Promotion>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const club = xmlVal(b, 'ClubID') || xmlVal(b, 'ClubId');
    if (club && !/^0(\b|\s|-|$)/.test(club)) continue;
    if (xmlVal(b, 'AdditionalIsCoupon') === '1') continue;

    const sRaw = xmlVal(b, 'PromotionStartDateTime') || xmlVal(b, 'PromotionStartDate');
    const eRaw = xmlVal(b, 'PromotionEndDateTime') || xmlVal(b, 'PromotionEndDate');
    const start = sRaw ? new Date(sRaw.includes('T') ? sRaw : `${sRaw}T00:00:00`) : null;
    const end = eRaw ? new Date(eRaw.includes('T') ? eRaw : `${eRaw}T23:59:59`) : null;
    if ((start && refDate < start) || (end && refDate > end)) continue;

    if ((Number(xmlVal(b, 'MinPurchaseAmount')) || 0) > 0) continue;
    const groups = [...b.matchAll(/<Group(?:\s[^>]*)?>([\s\S]*?)<\/Group>/gi)].map((x) => x[1]);
    if (groups.length > 1) continue;
    const scope = groups.length === 1 ? groups[0] : b;
    if ((Number(xmlVal(scope, 'MinPurchaseAmount')) || 0) > 0) continue;
    if (groups.length === 0 && xmlVal(b, 'IsGiftItem') === '1') continue;

    const fallbackPrice = Number(xmlVal(b, 'DiscountedPrice')) || 0;
    const fallbackQty = Number(xmlVal(b, 'MinQty')) || 0;

    for (const im of scope.matchAll(/<PromotionItem(?:\s[^>]*)?>([\s\S]*?)<\/PromotionItem>/gi)) {
      const ib = im[1];
      const code = xmlVal(ib, 'ItemCode').replace(/\s+/g, '');
      if (!code || /^0+$/.test(code)) continue;
      if (xmlVal(ib, 'bIsWeighted') === '1') continue;
      const dp = round2(Number(xmlVal(ib, 'DiscountedPrice')) || fallbackPrice);
      if (!(dp > 0)) continue;
      const mq = Number(xmlVal(ib, 'MinQty')) || fallbackQty || 1;
      let promo = null;
      if (mq <= 1) promo = { type: 'price', price: dp };
      else if (mq >= 2 && Math.abs(mq - Math.round(mq)) < 1e-6) promo = { type: 'bundle', qty: Math.round(mq), price: dp };
      if (!promo) continue;

      const eff = promo.type === 'bundle' ? promo.price / promo.qty : promo.price;
      const prev = byCode.get(code);
      const prevEff = prev ? (prev.type === 'bundle' ? prev.price / prev.qty : prev.price) : Infinity;
      if (eff < prevEff) {
        byCode.set(code, promo);
        byCode.set(normCode(code), promo);
      }
    }
  }
  return byCode;
}

let cachedRefSnapshot = null;

export function loadReferenceSnapshot() {
  if (cachedRefSnapshot) return cachedRefSnapshot;
  const manifest = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, 'manifest.json'), 'utf8'));
  const refDate = new Date(manifest.capturedAt);
  const chains = {};

  for (const [chain, info] of Object.entries(manifest.stores)) {
    const pXml = zlib.gunzipSync(fs.readFileSync(path.join(SNAP_DIR, `${chain}-${info.storeId}-prices.xml.gz`))).toString('utf8');
    const promoFile = path.join(SNAP_DIR, `${chain}-${info.storeId}-promos.xml.gz`);
    const prXml = fs.existsSync(promoFile) ? zlib.gunzipSync(fs.readFileSync(promoFile)).toString('utf8') : '';
    chains[chain] = {
      storeId: info.storeId,
      itemsByCode: parseSnapshotPrices(pXml),
      promosByCode: prXml ? parseSnapshotPromos(prXml, refDate) : new Map(),
      rawPricesXml: pXml,
      rawPromosXml: prXml,
    };
  }
  cachedRefSnapshot = { capturedAt: manifest.capturedAt, refDate, chains };
  return cachedRefSnapshot;
}

/**
 * Independent reference calculation of basket totals for the matched barcodes per chain.
 * @param checkedLines  [{ id, qty, unit, ambiguous }]
 * @param dutMatches    Map<lineId, { [chainId]: { code } | null }>
 * @param deliveryCfg   { [chainId]: { fee: number|null, freeOver: number|null } }
 */
export function refEvaluateBasket(checkedLines, dutMatches, refSnap, deliveryCfg = {}, includeDelivery = true) {
  const chainIds = ['shufersal', 'ramilevy', 'carrefour'];
  const perChain = {};

  for (const cid of chainIds) {
    const store = refSnap.chains[cid];
    let subtotal = 0;
    let promoSavings = 0;
    const missing = [];

    for (const line of checkedLines) {
      if (line.ambiguous) {
        missing.push(line.id);
        continue;
      }
      const m = dutMatches.get(line.id)?.[cid];
      if (!m || !m.code) {
        missing.push(line.id);
        continue;
      }
      const item = store.itemsByCode.get(m.code) || store.itemsByCode.get(normCode(m.code));
      if (!item) {
        missing.push(line.id);
        continue;
      }

      const rawQ = Number(line.qty) > 0 ? Number(line.qty) : 1;
      let chgQty;
      if (item.weighted) {
        chgQty = line.unit === 'g' ? rawQ / 1000 : rawQ;
      } else {
        chgQty = (line.unit === 'kg' || line.unit === 'g') ? 1 : Math.max(1, Math.round(rawQ));
      }

      const shelf = round2(item.price * chgQty);
      let cost = shelf;
      const promo = item.weighted ? null : (store.promosByCode.get(item.code) || store.promosByCode.get(item.normBarcode));
      if (promo) {
        if (promo.type === 'price' && promo.price < item.price) {
          cost = round2(promo.price * chgQty);
        } else if (promo.type === 'bundle' && promo.qty >= 2) {
          const bundles = Math.floor(chgQty / promo.qty);
          const rem = chgQty - bundles * promo.qty;
          const cand = round2(bundles * promo.price + rem * item.price);
          if (cand < shelf) cost = cand;
        }
      }
      subtotal += cost;
      promoSavings += round2(shelf - cost);
    }

    subtotal = round2(subtotal);
    promoSavings = round2(promoSavings);
    const d = deliveryCfg[cid] || {};
    let deliveryFee = null;
    if (typeof d.fee === 'number') {
      deliveryFee = typeof d.freeOver === 'number' && subtotal >= d.freeOver ? 0 : d.fee;
    }
    const complete = checkedLines.length > 0 && missing.length === 0;
    perChain[cid] = {
      subtotal,
      promoSavings,
      deliveryFee,
      total: round2(subtotal + (includeDelivery && deliveryFee ? deliveryFee : 0)),
      missing,
      complete,
    };
  }

  const completeChains = chainIds.filter((c) => perChain[c].complete);
  const cheapestId = completeChains.length
    ? completeChains.reduce((best, c) => (perChain[c].total < perChain[best].total ? c : best), completeChains[0])
    : null;

  return { perChain, cheapestId };
}

/** Estimate typical price of a golden-dictionary item for budget-bucket stimulus sizing. */
export function buildPriceEstimator(dictionary, refSnap) {
  const allProducts = [];
  for (const ch of Object.values(refSnap.chains)) {
    const seen = new Set();
    for (const item of ch.itemsByCode.values()) {
      if (seen.has(item.code)) continue;
      seen.add(item.code);
      allProducts.push({ nameLow: item.name.toLowerCase(), price: item.price, weighted: item.weighted });
    }
  }

  const estById = new Map();
  for (const entry of [...dictionary.realItems, ...dictionary.rareItems]) {
    const inc = (entry.mustIncludeAny || []).map((s) => s.toLowerCase());
    const exc = (entry.mustExcludeAny || []).map((s) => s.toLowerCase());
    const hits = [];
    for (const p of allProducts) {
      if (inc.length && !inc.some((k) => p.nameLow.includes(k))) continue;
      if (exc.some((k) => p.nameLow.includes(k))) continue;
      hits.push(p.price);
      if (hits.length >= 25) break;
    }
    hits.sort((a, b) => a - b);
    const median = hits.length ? hits[Math.floor(hits.length / 2)] : 14;
    estById.set(entry.id, median);
  }
  return estById;
}
