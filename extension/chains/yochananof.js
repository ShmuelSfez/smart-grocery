// Yochananof Online adapter (יוחננוף אונליין — Guided Search-and-Add — https://yochananof.co.il/*).
(function (root) {
  const reg = root.SmartCartChains;
  reg.register(reg.helpers.createGuidedChain({
    id: 'yochananof',
    name: 'יוחננוף',
    hostnames: ['yochananof.co.il'],
    homeUrl: 'https://yochananof.co.il/',
    matchPattern: 'https://yochananof.co.il/*',
    accent: '#1d4ed8',
    searchButtonLabel: '🔍 חפש ביוחננוף',
    checkoutLabel: '💳 עבור לתשלום ביוחננוף',
    tipText: '💡 לחץ "🔍 חפש ביוחננוף" (חיפוש ברקוד EAN מדויק), הוסף לסל וסמן "✓ הוספתי".',
    domAssist: true,
    buildSearchUrl(query) {
      return `/category?search=${encodeURIComponent(query)}`;
    },
    getCurrentSearchQuery() {
      if (typeof location === 'undefined') return '';
      if (!location.pathname.startsWith('/category') && !location.search.includes('search=')) return '';
      return (new URLSearchParams(location.search).get('search') || '').trim();
    },
    goToCheckout() {
      reg.helpers.clickCheckoutOrDrawer('https://yochananof.co.il/checkout');
    },
  }));
})(typeof globalThis !== 'undefined' ? globalThis : window);
