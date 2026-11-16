// "Smart" suggestions based on purchase history.
const DAY = 24 * 60 * 60 * 1000;

export const STARTER_ITEMS = [
  'חלב', 'לחם', 'ביצים', 'גבינה לבנה', 'קוטג\'', 'עגבניות', 'מלפפונים', 'בננות',
  'תפוחים', 'חזה עוף', 'אורז', 'פסטה', 'נייר טואלט', 'שמן זית', 'קפה',
];

function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Record a shopping trip: every item gets today's date (once per day). */
export function recordPurchase(history, items, key, now = new Date()) {
  const today = dayKey(now);
  const h = { ...history };
  for (const it of items) {
    const k = key(it.name);
    const entry = h[k] ? { ...h[k], purchases: [...h[k].purchases] } : { purchases: [] };
    entry.name = it.name;
    entry.category = it.category;
    entry.qty = it.qty;
    entry.unit = it.unit;
    if (entry.purchases[entry.purchases.length - 1] !== today) entry.purchases.push(today);
    entry.purchases = entry.purchases.slice(-30);
    h[k] = entry;
  }
  return h;
}

function avgIntervalDays(purchases) {
  if (purchases.length < 2) return null;
  const times = purchases.map((p) => new Date(p).getTime()).sort((a, b) => a - b);
  let sum = 0;
  for (let i = 1; i < times.length; i++) sum += times[i] - times[i - 1];
  return sum / (times.length - 1) / DAY;
}

/**
 * Items you're probably running out of: bought at least twice, and the time since the
 * last purchase is close to (or past) your usual interval.
 */
export function runningOut(history, excludeKeys, now = new Date()) {
  const out = [];
  for (const [k, e] of Object.entries(history)) {
    if (excludeKeys.has(k)) continue;
    const avg = avgIntervalDays(e.purchases);
    if (!avg || avg < 1) continue;
    const last = new Date(e.purchases[e.purchases.length - 1]).getTime();
    const since = (now.getTime() - last) / DAY;
    const ratio = since / avg;
    if (ratio >= 0.8) out.push({ key: k, ...e, ratio, avg, since });
  }
  return out.sort((a, b) => b.ratio - a.ratio).slice(0, 12);
}

/** Your most frequently bought items (for quick-add chips). */
export function frequent(history, excludeKeys, limit = 12) {
  return Object.entries(history)
    .filter(([k]) => !excludeKeys.has(k))
    .map(([k, e]) => ({ key: k, ...e, count: e.purchases.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
