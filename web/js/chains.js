// Supermarket chains shown in the app.
// status: 'live' = real prices from the official Price Transparency files, 'soon' = not wired in yet.
// cartFill: what the optional desktop extension can do for this chain.
export const CHAINS = [
  { id: 'shufersal', name: 'שופרסל', emoji: '🔴', url: 'https://www.shufersal.co.il/online/he/', status: 'live', cartFill: 'auto' },
  { id: 'ramilevy', name: 'רמי לוי', emoji: '🛒', url: 'https://www.rami-levy.co.il/he/online/market', status: 'live', cartFill: 'guided' },
  { id: 'carrefour', name: 'קרפור', emoji: '🔵', url: 'https://www.carrefour.co.il/', status: 'live', cartFill: 'none' },
  { id: 'victory', name: 'ויקטורי', emoji: '🏪', url: 'https://www.victoryonline.co.il/', status: 'soon', cartFill: 'none' },
  { id: 'yochananof', name: 'יוחננוף', emoji: '🛍️', url: 'https://yochananof.co.il/', status: 'soon', cartFill: 'none' },
];

export const CHAIN_BY_ID = Object.fromEntries(CHAINS.map((c) => [c.id, c]));
export const LIVE_CHAIN_IDS = CHAINS.filter((c) => c.status === 'live').map((c) => c.id);
