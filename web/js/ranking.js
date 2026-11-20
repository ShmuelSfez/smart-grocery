// Pure deterministic chain ranking helper for the vertical comparison list.
// Zero DOM, zero network, and zero regex lookbehind (Safari/WebKit safe).

const NO_ONLINE_STORE_SUBTITLE = 'אין משלוח אונליין — זמין במצב סניף פיזי';
const SOON_SUBTITLE = 'בקרוב מקובצי השקיפות';

function round2(n) {
  return Math.round(n * 100) / 100;
}

function inferCheckedCount(calc, perChain) {
  if (typeof calc?.checkedCount === 'number' && calc.checkedCount >= 0) {
    return calc.checkedCount;
  }
  for (const info of Object.values(perChain)) {
    if (info && (typeof info.priced === 'number' || Array.isArray(info.missing))) {
      return (Number(info.priced) || 0) + (Array.isArray(info.missing) ? info.missing.length : 0);
    }
  }
  return 0;
}

/**
 * Deterministically order all chains top-to-bottom into 4 buckets:
 *   1. `live` chains with complete baskets (`complete === true`), ascending by `subtotal` (if `comparedOnSubtotalOnly`) else `total`.
 *   2. `live` chains with partial baskets (`hasData && !complete`), fewest `missing.length`, then ascending comparison metric.
 *   3. `live` chains with no data or unavailable (`pricingMode === 'delivery' && chain.hasOnlineStore === false`, `notCovered`, `noBranchInCity`, or `!hasData`).
 *   4. `soon` chains (`status !== 'live'`) at the bottom.
 *
 * Honesty invariants:
 *   - Partial baskets and unavailable/unpriced/`soon` chains NEVER win `isCheapest`.
 *   - In `delivery` mode, chains with `hasOnlineStore === false` are treated as unpriced (`rank: null`, `isCheapest: false`)
 *     and display `NO_ONLINE_STORE_SUBTITLE`.
 */
export function buildRankedChainRows(chains, calc = {}, activeBranchData = {}, pricingMode = 'delivery') {
  const safeChains = Array.isArray(chains) ? chains : [];
  const mode = pricingMode === 'store' ? 'store' : 'delivery';
  const perChain = calc?.perChain || {};
  const comparedOnSubtotalOnly = Boolean(calc?.comparedOnSubtotalOnly);
  const ambiguousCount = Number(calc?.ambiguousCount) || 0;
  const checkedCount = inferCheckedCount(calc, perChain);

  const entries = safeChains.map((c, origIdx) => {
    const isLive = c.status === 'live';
    const noOnlineStore = isLive && mode === 'delivery' && c.hasOnlineStore === false;
    const notCovered = isLive && mode === 'delivery' && calc?.coverage?.[c.id] === 'not-covered';
    const noBranchInCity = isLive && mode === 'store' && Boolean(calc?.noBranchInCity?.[c.id]);
    const unavailable = !isLive || noOnlineStore || notCovered || noBranchInCity;

    const rawInfo = isLive ? (perChain[c.id] || null) : null;
    const rawMissing = Array.isArray(rawInfo?.missing) ? rawInfo.missing : [];
    const rawSubstitutes = Array.isArray(rawInfo?.substitutes) ? rawInfo.substitutes : [];
    const rawEstimated = Array.isArray(rawInfo?.estimated) ? rawInfo.estimated : [];
    const rawPricedCount = typeof rawInfo?.priced === 'number'
      ? rawInfo.priced
      : Math.max(0, checkedCount - rawMissing.length);
    const rawComplete = Boolean(rawInfo?.complete) && rawMissing.length === 0 && ambiguousCount === 0;
    const rawHasData = Boolean(rawInfo && (rawInfo.hasData || rawComplete || rawPricedCount > 0));

    let tier = 4;
    let bucket = 'soon';
    let complete = false;
    let hasData = false;

    if (!isLive) {
      tier = 4;
      bucket = 'soon';
    } else if (unavailable || !rawHasData) {
      tier = 3;
      bucket = 'unpriced';
    } else if (rawComplete) {
      tier = 1;
      bucket = 'complete';
      complete = true;
      hasData = true;
    } else {
      tier = 2;
      bucket = 'partial';
      complete = false;
      hasData = true;
    }

    const subtotal = hasData ? round2(Number(rawInfo.subtotal) || 0) : null;
    const total = hasData ? round2(Number(rawInfo.total ?? rawInfo.subtotal) || 0) : null;
    const comparisonMetric = hasData ? (comparedOnSubtotalOnly ? subtotal : total) : null;
    const deliveryFee = hasData && typeof rawInfo.deliveryFee === 'number' ? rawInfo.deliveryFee : null;
    const promoSavings = hasData ? round2(Number(rawInfo.promoSavings) || 0) : 0;

    const storeObj = (!noOnlineStore && isLive && activeBranchData?.[c.id]?.store)
      ? activeBranchData[c.id].store
      : null;

    let storeSubtitle = '';
    if (noOnlineStore) {
      storeSubtitle = NO_ONLINE_STORE_SUBTITLE;
    } else if (!isLive) {
      storeSubtitle = SOON_SUBTITLE;
    } else if (storeObj?.name) {
      storeSubtitle = String(storeObj.name).replace(/\s+/g, ' ').trim();
    }

    return {
      origIdx,
      chain: c,
      id: c.id,
      name: c.name,
      emoji: c.emoji || '',
      status: c.status,
      tier,
      bucket,
      priced: hasData,
      complete,
      hasData,
      unavailable,
      noOnlineStore,
      notCovered,
      noBranchInCity,
      comparedOnSubtotalOnly,
      comparisonMetric,
      subtotal,
      total,
      deliveryFee,
      promoSavings,
      pricedCount: hasData ? rawPricedCount : 0,
      checkedCount,
      missing: hasData ? rawMissing : [],
      substitutes: hasData ? rawSubstitutes : [],
      estimated: hasData ? rawEstimated : [],
      store: storeObj,
      storeSubtitle,
    };
  });

  entries.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.tier === 1) {
      if (a.comparisonMetric !== b.comparisonMetric) return a.comparisonMetric - b.comparisonMetric;
      if (!comparedOnSubtotalOnly && a.subtotal !== b.subtotal) return a.subtotal - b.subtotal;
      return a.origIdx - b.origIdx;
    }
    if (a.tier === 2) {
      if (a.missing.length !== b.missing.length) return a.missing.length - b.missing.length;
      if (a.comparisonMetric !== b.comparisonMetric) return a.comparisonMetric - b.comparisonMetric;
      if (!comparedOnSubtotalOnly && a.subtotal !== b.subtotal) return a.subtotal - b.subtotal;
      return a.origIdx - b.origIdx;
    }
    if (a.tier === 3) {
      if (a.unavailable !== b.unavailable) return a.unavailable ? 1 : -1;
      return a.origIdx - b.origIdx;
    }
    return a.origIdx - b.origIdx;
  });

  const tier1 = entries.filter((e) => e.tier === 1);
  let effectiveCheapestId = null;
  let winnerMetric = null;
  if (tier1.length > 0 && ambiguousCount === 0) {
    winnerMetric = tier1[0].comparisonMetric;
    if (
      calc?.cheapestId
      && tier1.some((e) => e.id === calc.cheapestId && e.comparisonMetric === winnerMetric)
    ) {
      effectiveCheapestId = calc.cheapestId;
    } else {
      effectiveCheapestId = tier1[0].id;
    }
  }

  let nextRank = 1;
  return entries.map(({ origIdx: _origIdx, ...row }) => {
    const rank = row.priced ? nextRank++ : null;
    const rankLabel = rank !== null ? `#${rank}` : '—';
    const isCheapest = Boolean(effectiveCheapestId && row.tier === 1 && row.id === effectiveCheapestId);
    const deltaFromCheapest = (row.tier === 1 && effectiveCheapestId && !isCheapest && winnerMetric !== null)
      ? round2(Math.max(0, row.comparisonMetric - winnerMetric))
      : null;

    return {
      ...row,
      rank,
      rankLabel,
      isCheapest,
      deltaFromCheapest,
    };
  });
}
