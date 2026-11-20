// Victory Online adapter (ויקטורי אונליין — Guided Search-and-Add + Auto-DOM Assist — https://www.victoryonline.co.il/*).
(function (root) {
  const reg = root.SmartCartChains;
  reg.register(reg.helpers.createGuidedChain({
    id: 'victory',
    name: 'ויקטורי',
    hostnames: ['victoryonline.co.il'],
    homeUrl: 'https://www.victoryonline.co.il/',
    matchPattern: 'https://www.victoryonline.co.il/*',
    accent: '#15803d',
    searchButtonLabel: '🔍 חפש והוסף',
    checkoutLabel: '💳 עבור לתשלום בויקטורי',
    tipText: '💡 לחץ "🔍 חפש והוסף" – ויקטורי מציג התאמת ברקוד מדויקת להוספה בלחיצה אחת.',
    domAssist: true,
    buildSearchUrl(query) {
      return `/search?q=${encodeURIComponent(query)}`;
    },
    getCurrentSearchQuery() {
      if (typeof location === 'undefined' || !location.pathname.startsWith('/search')) return '';
      return (new URLSearchParams(location.search).get('q') || '').trim();
    },
    goToCheckout() {
      location.href = 'https://www.victoryonline.co.il/checkout';
    },
  }));
})(typeof globalThis !== 'undefined' ? globalThis : window);
