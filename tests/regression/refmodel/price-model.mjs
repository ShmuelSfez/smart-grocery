// Independent Reference Price Model (Oracle) for SmartCart DV Regression.
// IMPORTANT: Zero imports from pipeline/* or web/js/*. Reads the raw frozen .xml.gz snapshot
// with its own independent XML scanner, runs strict testbench self-checks, and computes expected
// shelf + all-customer promotion totals and catalog availability independently.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SNAP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'snapshot');

function xmlVal(chunk, tag) {
  const openRe = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'i');
  const m = openRe.exec(chunk);
  if (!m) return '';
  const start = m.index + m[0].length;
  const closeIdx = chunk.toLowerCase().indexOf(`</${tag.toLowerCase()}>`, start);
  if (closeIdx < 0) return '';
  return chunk
    .slice(start, closeIdx)
    .trim()
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function xmlFirstVal(chunk, tags) {
  for (const t of tags) {
    const v = xmlVal(chunk, t);
    if (v) return v;
  }
  return '';
}

function extractBlocksLinear(xml, tagName) {
  const blocks = [];
  const low = xml.toLowerCase();
  const openPat = `<${tagName.toLowerCase()}`;
  const closePat = `</${tagName.toLowerCase()}>`;
  let cursor = 0;
  while (cursor < low.length) {
    const idx = low.indexOf(openPat, cursor);
    if (idx < 0) break;
    const afterName = low.charCodeAt(idx + openPat.length);
    // Ensure exact tag name (followed by '>', '/', or whitespace, not e.g. <PromotionItems> when looking for <PromotionItem>)
    if (afterName !== 62 && afterName !== 47 && afterName !== 32 && afterName !== 9 && afterName !== 10 && afterName !== 13) {
      cursor = idx + openPat.length;
      continue;
    }
    const gt = low.indexOf('>', idx + openPat.length);
    if (gt < 0) break;
    if (low.charCodeAt(gt - 1) === 47) {
      // Self-closing <Tag .../>
      cursor = gt + 1;
      continue;
    }
    const endIdx = low.indexOf(closePat, gt + 1);
    if (endIdx < 0) break;
    blocks.push(xml.slice(gt + 1, endIdx));
    cursor = endIdx + closePat.length;
  }
  return blocks;
}

function normCode(raw) {
  const s = String(raw || '').trim().replace(/^P_/i, '').replace(/\s+/g, '');
  return /^\d+$/.test(s) && s.length >= 7 ? (s.replace(/^0+/, '') || '0') : s;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Standalone reference table for the Israeli Weighted-Produce Specification in spec.md (Section 1.3).
// Zero imports from web/js/*: verified independently against DUT pricing.js / produce.js in S10.
const REF_PRODUCE_SPEC = [
  [['פלפל חריף', 'פלפלים חריפים', 'צילי', 'חלפיניו'], 0.03, 0.25],
  [['עגבניות שרי', 'עגבניית שרי', 'שרי תמר'], 0.02, 0.50],
  [['ארטישוק ירושלמי', 'קסביה'], 0.12, 0.50],
  [['תפוח אדמה', 'תפוחי אדמה', 'תפוא'], 0.18, 1.00],
  [['תפוח עץ', 'תפוחי עץ', 'תפוחים', 'תפוח'], 0.18, 1.00],
  [['שעועית ירוקה', 'שעועית צהובה'], 0.01, 0.50],
  [['שורש פטרוזיליה', 'שורש סלרי', 'חזרת'], 0.15, 0.30],
  [['שום'], 0.06, 0.25],
  [['גינגר', 'זנגביל'], 0.08, 0.25],
  [['פטריות', 'פטריה', 'שמפיניון', 'פורטובלו'], 0.03, 0.50],
  [['לימון', 'לימונים', 'ליים'], 0.11, 0.50],
  [['קלמנטינה', 'קלמנטינות', 'מנדרינה', 'מנדרינות'], 0.10, 1.00],
  [['משמש', 'משמשים'], 0.07, 0.50],
  [['שזיף', 'שזיפים'], 0.08, 0.50],
  [['קיווי'], 0.09, 0.50],
  [['גזר', 'גזרים'], 0.12, 1.00],
  [['מלפפון', 'מלפפונים'], 0.13, 1.00],
  [['עגבניה', 'עגבניות'], 0.15, 1.00],
  [['בננה', 'בננות'], 0.15, 1.00],
  [['אפרסק', 'אפרסקים', 'נקטרינה', 'נקטרינות'], 0.15, 1.00],
  [['בצל', 'בצלים'], 0.16, 1.00],
  [['קישוא', 'קישואים', 'זוקיני'], 0.16, 1.00],
  [['אגס', 'אגסים'], 0.18, 1.00],
  [['אפרסמון', 'אפרסמונים'], 0.18, 1.00],
  [['פלפל', 'פלפלים', 'גמבה', 'גמבות'], 0.19, 1.00],
  [['סלק', 'סלקים'], 0.20, 1.00],
  [['לפת', 'לפתות'], 0.20, 1.00],
  [['אבוקדו'], 0.22, 0.50],
  [['תפוז', 'תפוזים'], 0.22, 1.00],
  [['בטטה', 'בטטות'], 0.25, 1.00],
  [['קולרבי', 'קולורבי'], 0.25, 1.00],
  [['שומר'], 0.30, 1.00],
  [['רימון', 'רימונים'], 0.30, 1.00],
  [['חציל', 'חצילים'], 0.35, 1.00],
  [['מנגו'], 0.35, 1.00],
  [['אשכולית', 'אשכוליות'], 0.35, 1.00],
  [['פומלית', 'פומלה'], 0.45, 1.00],
  [['ענבים'], 0.50, 1.00],
  [['דלורית'], 0.90, 0.90],
  [['כרובית', 'כרוביות'], 1.00, 1.00],
  [['כרוב'], 1.20, 1.20],
  [['אננס'], 1.30, 1.30],
  [['מלון', 'מלונים'], 1.80, 1.80],
  [['אבטיח', 'אבטיחים'], 6.00, 6.00],
];

function normRefHeb(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/["״'׳`]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/מ(?=\s|$)/g, 'ם')
    .replace(/נ(?=\s|$)/g, 'ן')
    .replace(/צ(?=\s|$)/g, 'ץ')
    .replace(/פ(?=\s|$)/g, 'ף')
    .replace(/כ(?=\s|$)/g, 'ך');
}

function matchRefProduceSpec(text) {
  const n = normRefHeb(text);
  if (!n) return null;
  const pad = ` ${n} `;
  for (const [terms, pieceKg, bareKg] of REF_PRODUCE_SPEC) {
    for (const term of terms) {
      if (pad.includes(` ${term} `)) return { pieceKg, bareKg };
      if (!term.includes(' ') && (pad.includes(` ה${term} `) || pad.includes(` ל${term} `) || pad.includes(` ב${term} `))) {
        return { pieceKg, bareKg };
      }
    }
  }
  return null;
}

function refWeightedKg(line, catalogItemName) {
  const rawQ = Number(line.qty) > 0 ? Number(line.qty) : 1;
  const u = line.unit || 'unit';
  if (u === 'kg') return rawQ;
  if (u === 'g') return Math.round((rawQ / 1000) * 1000) / 1000;
  if (u === 'pack') return Math.max(1, Math.round(rawQ)) * 1.0;

  const explicitCount = Boolean(line.qtyExplicit) || rawQ !== 1;
  const specHit = matchRefProduceSpec(line.name) || matchRefProduceSpec(catalogItemName);
  if (explicitCount) {
    const pieceKg = specHit ? specHit.pieceKg : 0.20;
    return Math.max(0.05, round2(Math.max(1, rawQ) * pieceKg));
  }
  return specHit ? specHit.bareKg : 1.0;
}

function parseSnapshotPrices(xml) {
  const byNormCode = new Map();
  const uniqueItems = [];
  for (const b of extractBlocksLinear(xml, 'Item')) {
    const code = xmlFirstVal(b, ['ItemCode', 'ITEMCODE']).replace(/\s+/g, '');
    const price = round2(Number(xmlFirstVal(b, ['ItemPrice', 'ITEMPRICE'])));
    if (!code || !(price > 0)) continue;
    // Support Shufersal/Carrefour (<ItemName>) AND Rami Levy (<ItemNm>, <ManufacturerItemDescription>)
    const name = xmlFirstVal(b, ['ItemName', 'ItemNm', 'ManufacturerItemDescription', 'ManufactureItemDescription']);
    if (!name) continue;
    const brand = xmlFirstVal(b, ['ManufacturerName', 'ManufactureName']);
    const wTag = xmlFirstVal(b, ['bIsWeighted', 'BisWeighted', 'IsWeighted']);
    const weighted = wTag === '1' || /^true$/i.test(wTag);
    const rec = { code, normBarcode: normCode(code), name, brand, weighted, price };
    if (!byNormCode.has(rec.normBarcode)) {
      byNormCode.set(rec.normBarcode, rec);
      uniqueItems.push(rec);
    }
    byNormCode.set(code, rec);
  }
  return { byNormCode, uniqueItems };
}

function parseSnapshotPromos(xml, refDate) {
  const byCode = new Map();
  for (const b of extractBlocksLinear(xml, 'Promotion')) {
    const club = xmlFirstVal(b, ['ClubID', 'ClubId', 'CLUBID']);
    if (club && !/^0(\b|\s|-|$)/.test(club)) continue;
    const coupon = xmlFirstVal(b, ['AdditionalIsCoupon', 'IsCoupon']);
    if (coupon === '1' || /^true$/i.test(coupon)) continue;

    const sDate = xmlFirstVal(b, ['PromotionStartDateTime', 'PromotionStartDate']);
    const sHour = xmlVal(b, 'PromotionStartHour') || '00:00:00';
    const eDate = xmlFirstVal(b, ['PromotionEndDateTime', 'PromotionEndDate']);
    const eHour = xmlVal(b, 'PromotionEndHour') || '23:59:59';
    const start = sDate ? new Date(sDate.includes('T') || sDate.includes(' ') ? sDate.replace(' ', 'T') : `${sDate}T${sHour}`) : null;
    const end = eDate ? new Date(eDate.includes('T') || eDate.includes(' ') ? eDate.replace(' ', 'T') : `${eDate}T${eHour}`) : null;
    if ((start && refDate < start) || (end && refDate > end)) continue;

    if ((Number(xmlVal(b, 'MinPurchaseAmount')) || 0) > 0) continue;
    const groups = extractBlocksLinear(b, 'Group');
    if (groups.length > 1) continue;
    const scope = groups.length === 1 ? groups[0] : b;
    if ((Number(xmlVal(scope, 'MinPurchaseAmount')) || 0) > 0) continue;
    if (groups.length === 0) {
      const topGift = xmlVal(b, 'IsGiftItem');
      if (topGift === '1' || /^true$/i.test(topGift)) continue;
    }

    const fallbackPrice = Number(xmlVal(b, 'DiscountedPrice')) || 0;
    const fallbackQty = Number(xmlVal(b, 'MinQty')) || 0;

    // Independent support for both <PromotionItem> and <PromotionItems><Item>
    let itemChunks = extractBlocksLinear(scope, 'PromotionItem');
    if (!itemChunks.length) {
      for (const container of extractBlocksLinear(scope, 'PromotionItems')) {
        itemChunks.push(...extractBlocksLinear(container, 'Item'));
      }
    }

    for (const ib of itemChunks) {
      const code = xmlFirstVal(ib, ['ItemCode', 'ITEMCODE']).replace(/\s+/g, '');
      if (!code || /^0+$/.test(code)) continue;
      const itemGift = xmlVal(ib, 'IsGiftItem');
      if (itemGift === '1' || /^true$/i.test(itemGift)) continue;
      const wTag = xmlFirstVal(ib, ['bIsWeighted', 'BisWeighted', 'IsWeighted']);
      if (wTag === '1' || /^true$/i.test(wTag)) continue;

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
    const { byNormCode, uniqueItems } = parseSnapshotPrices(pXml);
    const promosByCode = prXml ? parseSnapshotPromos(prXml, refDate) : new Map();

    // Testbench Self-Checks (H1 & H2): catch broken oracle parsers immediately instead of misreporting DUT errors!
    if (uniqueItems.length < 1000) {
      throw new Error(`TB_SELF_CHECK_ERROR: Oracle parsed only ${uniqueItems.length} items for ${chain} (expected >= 1000)`);
    }
    if (prXml.includes('<Promotion') && promosByCode.size === 0) {
      throw new Error(`TB_SELF_CHECK_ERROR: PromoFull for ${chain} has <Promotion> blocks but oracle parsed 0 active promos`);
    }

    chains[chain] = {
      storeId: info.storeId,
      itemsByCode: byNormCode,
      uniqueItems,
      promosByCode,
      rawPricesXml: pXml,
      rawPromosXml: prXml,
    };
  }
  cachedRefSnapshot = { capturedAt: manifest.capturedAt, refDate, chains };
  return cachedRefSnapshot;
}

/**
 * Independent reference calculation of basket totals for the matched barcodes per chain.
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
        chgQty = refWeightedKg(line, item.name);
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
  const asymmetricDelivery = Boolean(
    includeDelivery
    && completeChains.length > 1
    && completeChains.some((c) => perChain[c].deliveryFee === null)
    && completeChains.some((c) => typeof perChain[c].deliveryFee === 'number' && perChain[c].deliveryFee > 0),
  );
  const cmpVal = (c) => (asymmetricDelivery ? perChain[c].subtotal : perChain[c].total);
  const cheapestId = completeChains.length
    ? completeChains.reduce((best, c) => (cmpVal(c) < cmpVal(best) ? c : best), completeChains[0])
    : null;

  return { perChain, cheapestId, comparedOnSubtotalOnly: asymmetricDelivery };
}

function normSem(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/["״'׳`]/g, '')
    .replace(/([\u0590-\u05FF])(\d)/g, '$1 $2')
    .replace(/(\d)([\u0590-\u05FF])/g, '$1 $2')
    .replace(/[^\p{L}\p{N}%.\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasTokenPhrase(normText, phrase, rawLen = 0) {
  if (!phrase) return false;
  const padded = ` ${normText} `;
  if (padded.includes(` ${phrase} `)) return true;

  const pWords = phrase.split(' ');
  const lastP = pWords[pWords.length - 1];
  const prefixWords = pWords.length > 1 ? ` ${pWords.slice(0, -1).join(' ')} ` : ' ';

  // Allow start-of-word stem prefixes >= 3 chars (e.g. "עגבני" -> "עגבניות", "בננ" -> "בננה", "חתול" -> "לחתולים")
  // while blocking mid-word substrings ("ארטישוק", "צמחית", "3400") and known non-inflectional collisions ("מאסטר", "מולטי", "סופגניה").
  if (lastP.length >= 3 && lastP !== 'מאסט' && lastP !== 'מולט' && lastP !== 'סופג') {
    let idx = padded.indexOf(prefixWords);
    while (idx >= 0) {
      const rest = padded.slice(idx + prefixWords.length);
      const nextSpace = rest.indexOf(' ');
      const word = nextSpace >= 0 ? rest.slice(0, nextSpace) : rest;
      if (word.startsWith(lastP) && word.length - lastP.length <= 3) return true;
      if (word.length >= lastP.length + 1 && (word[0] === 'ל' || word[0] === 'ה' || word[0] === 'ב')) {
        const stripped = word.slice(1);
        if (stripped.startsWith(lastP) && stripped.length - lastP.length <= 3) return true;
      }
      idx = padded.indexOf(prefixWords, idx + 1);
    }
  }

  // Support 20-char ERP XML trailing-word truncation (e.g. "צלחות מתכלות מקנה סו", "כוסות חד פעמ")
  if (rawLen >= 19) {
    const tWords = normText.split(' ');
    const lastT = tWords[tWords.length - 1] || '';
    if (lastT.length >= 3 && lastP.length > lastT.length && lastP.startsWith(lastT)) {
      const prefixPhrase = [...pWords.slice(0, -1), lastT].join(' ');
      if (padded.endsWith(` ${prefixPhrase} `)) return true;
    }
  }
  return false;
}

/**
 * Independent reference catalog availability map (H10):
 * For each dictionary item `id` and chain `cid`, determines whether at least one product in the snapshot
 * satisfies token-bounded `(mustIncludeAny, mustExcludeAny)`.
 */
export function refComputeAvailability(dictionary, refSnap) {
  const avail = new Map(); // dictId -> { shufersal: boolean, ramilevy: boolean, carrefour: boolean }
  const chainNormItems = {};
  for (const [cid, ch] of Object.entries(refSnap.chains)) {
    chainNormItems[cid] = ch.uniqueItems.map((it) => ({ low: normSem(it.name), len: it.name.trim().length }));
  }

  for (const entry of [...dictionary.realItems, ...dictionary.rareItems]) {
    const inc = (entry.mustIncludeAny || []).map(normSem).filter(Boolean);
    const exc = (entry.mustExcludeAny || []).map(normSem).filter(Boolean);
    const perChain = {};
    for (const [cid, items] of Object.entries(chainNormItems)) {
      perChain[cid] = items.some(({ low, len }) => {
        if (inc.length && !inc.some((k) => hasTokenPhrase(low, k, len))) return false;
        for (const bad of exc) if (bad && hasTokenPhrase(low, bad, len)) return false;
        return true;
      });
    }
    avail.set(entry.id, perChain);
  }
  return avail;
}

/** Estimate typical price of a golden-dictionary item for budget-bucket stimulus sizing. */
export function buildPriceEstimator(dictionary, refSnap) {
  const allProducts = [];
  for (const ch of Object.values(refSnap.chains)) {
    for (const item of ch.uniqueItems) {
      allProducts.push({ nameLow: normSem(item.name), price: item.price, weighted: item.weighted });
    }
  }

  const estById = new Map();
  for (const entry of [...dictionary.realItems, ...dictionary.rareItems]) {
    const inc = (entry.mustIncludeAny || []).map(normSem).filter(Boolean);
    const exc = (entry.mustExcludeAny || []).map(normSem).filter(Boolean);
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
