// Basket price comparison: pure functions, no DOM and no network.
// Rule: never invent a price. A missing price is "missing" and the chain's total is marked incomplete.

/**
 * A "match" describes how one list line is priced at one chain:
 *   { price, unitPrice?, weighted?, promo?, kind: 'exact' | 'substitute', productName?, code? }
 * price      shelf price per unit (or per kg when weighted)
 * promo      optional all-customers promotion: { type: 'price', price } or { type: 'bundle', qty, price }
 * kind       'exact' = same barcode as the user's pinned product, 'substitute' = closest name match
 */

/** Quantity to charge: units for regular items, kilograms for weighted items. */
export function chargeQty(line, match) {
  const qty = Number(line.qty) > 0 ? Number(line.qty) : 1;
  if (match && match.weighted) {
    if (line.unit === 'kg') return { qty, estimated: false };
    if (line.unit === 'g') return { qty: qty / 1000, estimated: false };
    // Counted ("3 tomatoes") but sold by weight: weight unknown, assume qty kg and say so.
    return { qty, estimated: true };
  }
  if (line.unit === 'kg' || line.unit === 'g') {
    // A weight was requested for an item sold per unit: buy one unit and say so.
    return { qty: 1, estimated: true };
  }
  return { qty: Math.max(1, Math.round(qty)), estimated: false };
}

/** Cost of `qty` units at shelf `price`, applying an all-customers promotion if it lowers the cost. */
export function applyPromo(price, qty, promo) {
  const shelf = round2(price * qty);
  if (!promo || !(price > 0) || !(qty > 0)) return { cost: shelf, savings: 0 };
  let cost = shelf;
  if (promo.type === 'price' && promo.price > 0 && promo.price < price) {
    cost = round2(promo.price * qty);
  } else if (promo.type === 'bundle' && promo.qty >= 2 && promo.price > 0) {
    const bundles = Math.floor(qty / promo.qty);
    const rest = qty - bundles * promo.qty;
    cost = round2(bundles * promo.price + rest * price);
  }
  if (cost >= shelf) return { cost: shelf, savings: 0 };
  return { cost, savings: round2(shelf - cost) };
}

/** Price one line at one chain. Returns null when there is no real price. */
export function lineCost(line, match) {
  if (!match || !(Number(match.price) > 0)) return null;
  const { qty, estimated } = chargeQty(line, match);
  const promo = match.weighted ? null : match.promo; // v1: no promotions on weighted items
  const { cost, savings } = applyPromo(Number(match.price), qty, promo);
  return { cost, savings, qty, estimated, kind: match.kind || 'exact' };
}

/**
 * Compare a basket across chains.
 * @param lines        [{ id, qty, unit, matches: { [chainId]: match | null } }]  (only checked lines)
 * @param chainIds     chains to compare, e.g. ['shufersal', 'ramilevy', 'carrefour']
 * @param delivery     { [chainId]: { fee: number|null, freeOver: number|null } }
 * @param opts         { includeDelivery = true }
 */
export function compareBasket(lines, chainIds, delivery = {}, opts = {}) {
  const includeDelivery = opts.includeDelivery !== false;
  const perChain = {};
  for (const chainId of chainIds) {
    let subtotal = 0;
    let promoSavings = 0;
    const missing = [];
    const substitutes = [];
    const estimated = [];
    for (const line of lines) {
      const res = lineCost(line, line.matches ? line.matches[chainId] : null);
      if (!res) { missing.push(line.id); continue; }
      subtotal += res.cost;
      promoSavings += res.savings;
      if (res.kind === 'substitute') substitutes.push(line.id);
      if (res.estimated) estimated.push(line.id);
    }
    subtotal = round2(subtotal);
    const d = delivery[chainId] || {};
    let deliveryFee = null; // null = unknown
    if (typeof d.fee === 'number') {
      deliveryFee = typeof d.freeOver === 'number' && subtotal >= d.freeOver ? 0 : d.fee;
    }
    const priced = lines.length - missing.length;
    perChain[chainId] = {
      subtotal,
      promoSavings: round2(promoSavings),
      deliveryFee,
      total: round2(subtotal + (includeDelivery && deliveryFee ? deliveryFee : 0)),
      priced,
      missing,
      substitutes,
      estimated,
      complete: lines.length > 0 && missing.length === 0,
      hasData: priced > 0,
    };
  }
  // Only complete baskets can honestly be called "cheapest".
  // If delivery is enabled and one complete chain publishes a fee while another complete chain's fee is unknown (null),
  // compare complete chains on apples-to-apples product `subtotal` instead of penalizing transparent chains.
  const complete = chainIds.filter((id) => perChain[id].complete);
  const comparedOnSubtotalOnly = Boolean(
    includeDelivery
    && complete.length > 1
    && complete.some((id) => perChain[id].deliveryFee === null)
    && complete.some((id) => typeof perChain[id].deliveryFee === 'number' && perChain[id].deliveryFee > 0),
  );
  const cmpMetric = (id) => (comparedOnSubtotalOnly ? perChain[id].subtotal : perChain[id].total);
  const cheapestId = complete.length
    ? complete.reduce((best, id) => (cmpMetric(id) < cmpMetric(best) ? id : best), complete[0])
    : null;
  const ranking = [...chainIds].sort((a, b) => {
    const A = perChain[a];
    const B = perChain[b];
    if (A.complete !== B.complete) return A.complete ? -1 : 1;
    if (A.missing.length !== B.missing.length) return A.missing.length - B.missing.length;
    return cmpMetric(a) - cmpMetric(b);
  });
  const maxComplete = complete.length ? Math.max(...complete.map(cmpMetric)) : 0;
  const savings = cheapestId ? round2(maxComplete - cmpMetric(cheapestId)) : 0;
  return { perChain, cheapestId, ranking, savings, comparedOnSubtotalOnly };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
