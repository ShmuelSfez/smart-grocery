// Parses PromoFull XML feeds and keeps ONLY active promotions open to all customers:
// - ClubID empty or starting with "0" (e.g. "0" or "0 - כלל הלקוחות")
// - AdditionalIsCoupon != 1
// - Active on `now` (between PromotionStartDateTime and PromotionEndDateTime)
// - Unconditional (MinPurchaseAmount == 0, single Group)
// - Non-weighted items with fixed discounted price (single item or X-for-₪Y bundle)
import { getTag, normalizeStoreId } from './parse.mjs';

function parseFeedDate(dateStr, hourStr, isEnd = false) {
  const raw = String(dateStr || '').trim();
  if (!raw) return null;
  if (raw.includes('T') || raw.includes(' ')) {
    const d = new Date(raw.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const timePart = String(hourStr || '').trim() || (isEnd ? '23:59:59' : '00:00:00');
  const d = new Date(`${raw}T${timePart}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function effectiveUnitPrice(promo) {
  if (!promo) return Infinity;
  return promo.type === 'bundle' ? promo.price / promo.qty : promo.price;
}

export function parsePromosXml(xml, { now = new Date() } = {}) {
  const topHead = xml.slice(0, 600);
  const xmlStoreId = normalizeStoreId(getTag(topHead, ['StoreID', 'StoreId', 'STOREID']));
  const promosByItem = new Map();
  const stats = {
    total: 0,
    kept: 0,
    clubSkipped: 0,
    couponSkipped: 0,
    expiredSkipped: 0,
    conditionalSkipped: 0,
    unsupportedSkipped: 0,
  };

  const promoRe = /<Promotion(?:\s[^>]*)?>([\s\S]*?)<\/Promotion>/gi;
  let m;
  while ((m = promoRe.exec(xml)) !== null) {
    stats.total++;
    const block = m[1];

    // 1. Club filter: only all-customer deals (ClubID empty or starting with '0')
    const clubRaw = getTag(block, ['ClubID', 'ClubId', 'CLUBID']);
    if (clubRaw && !/^0(\b|\s|-|$)/.test(clubRaw)) {
      stats.clubSkipped++;
      continue;
    }

    // 2. Coupon filter
    const couponRaw = getTag(block, ['AdditionalIsCoupon', 'IsCoupon']);
    if (couponRaw === '1' || /^true$/i.test(couponRaw)) {
      stats.couponSkipped++;
      continue;
    }

    // 3. Active window check
    const start = parseFeedDate(
      getTag(block, ['PromotionStartDateTime', 'PromotionStartDate']),
      getTag(block, ['PromotionStartHour']),
      false,
    );
    const end = parseFeedDate(
      getTag(block, ['PromotionEndDateTime', 'PromotionEndDate']),
      getTag(block, ['PromotionEndHour']),
      true,
    );
    if ((start && now < start) || (end && now > end)) {
      stats.expiredSkipped++;
      continue;
    }

    // 4. Conditional basket / multi-group check
    const topMinPurchase = Number(getTag(block, ['MinPurchaseAmount'])) || 0;
    if (topMinPurchase > 0) {
      stats.conditionalSkipped++;
      continue;
    }

    const groups = [...block.matchAll(/<Group(?:\s[^>]*)?>([\s\S]*?)<\/Group>/gi)].map((gm) => gm[1]);
    if (groups.length > 1) {
      stats.conditionalSkipped++;
      continue;
    }
    const scope = groups.length === 1 ? groups[0] : block;
    const groupMinPurchase = Number(getTag(scope, ['MinPurchaseAmount'])) || 0;
    if (groupMinPurchase > 0) {
      stats.conditionalSkipped++;
      continue;
    }
    // If no <Groups> wrapper, still skip explicit IsGiftItem=1 promos
    if (groups.length === 0) {
      const giftRaw = getTag(block, ['IsGiftItem']);
      if (giftRaw === '1' || /^true$/i.test(giftRaw)) {
        stats.conditionalSkipped++;
        continue;
      }
    }

    // Promo-level fallback fields (some XML feeds put DiscountedPrice/MinQty at Promotion level)
    const promoLevelPrice = Number(getTag(block, ['DiscountedPrice'])) || 0;
    const promoLevelMinQty = Number(getTag(block, ['MinQty'])) || 0;

    const itemBlocks = [...scope.matchAll(/<PromotionItem(?:\s[^>]*)?>([\s\S]*?)<\/PromotionItem>/gi)].map((im) => im[1]);
    if (!itemBlocks.length) {
      stats.unsupportedSkipped++;
      continue;
    }

    let anyItemKept = false;
    for (const ib of itemBlocks) {
      const code = getTag(ib, ['ItemCode', 'ITEMCODE']).replace(/\s+/g, '');
      if (!code || /^0+$/.test(code)) continue;
      const weighted = getTag(ib, ['bIsWeighted', 'BisWeighted', 'IsWeighted']);
      if (weighted === '1' || /^true$/i.test(weighted)) continue;

      const discPrice = round2(Number(getTag(ib, ['DiscountedPrice'])) || promoLevelPrice);
      if (!(discPrice > 0)) continue;

      const rawMinQty = Number(getTag(ib, ['MinQty'])) || promoLevelMinQty || 1;
      let promo = null;
      if (rawMinQty <= 1) {
        promo = { type: 'price', price: discPrice };
      } else if (rawMinQty >= 2 && Math.abs(rawMinQty - Math.round(rawMinQty)) < 1e-6) {
        promo = { type: 'bundle', qty: Math.round(rawMinQty), price: discPrice };
      }
      if (!promo) continue;

      const prev = promosByItem.get(code);
      if (!prev || effectiveUnitPrice(promo) < effectiveUnitPrice(prev)) {
        promosByItem.set(code, promo);
      }
      anyItemKept = true;
    }

    if (anyItemKept) stats.kept++;
    else stats.unsupportedSkipped++;
  }

  return { xmlStoreId, promosByItem, stats };
}

function round2(n) {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
