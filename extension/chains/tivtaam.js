// Tiv Taam Online adapter (טיב טעם בקליק — Guided Search-and-Add — https://www.tivtaam.co.il/*).
(function (root) {
  const reg = root.SmartCartChains;
  reg.register(reg.helpers.createGuidedChain({
    id: 'tivtaam',
    name: 'טיב טעם',
    hostnames: ['tivtaam.co.il'],
    homeUrl: 'https://www.tivtaam.co.il/',
    matchPattern: 'https://www.tivtaam.co.il/*',
    accent: '#be123c',
    searchButtonLabel: '🔍 חפש בטיב טעם',
    checkoutLabel: '💳 עבור לתשלום בטיב טעם',
    tipText: '💡 לחץ "🔍 חפש בטיב טעם" ליד כל מוצר, הוסף לסל באתר וסמן "✓ הוספתי".',
    domAssist: true,
    buildSearchUrl(query) {
      return `/search/${encodeURIComponent(query)}`;
    },
    getCurrentSearchQuery() {
      if (typeof location === 'undefined') return '';
      if (location.pathname.startsWith('/search/')) {
        try {
          return decodeURIComponent(location.pathname.slice('/search/'.length)).trim();
        } catch (e) { /* ignore */ }
      }
      return (new URLSearchParams(location.search).get('q') || '').trim();
    },
    goToCheckout() {
      reg.helpers.clickCheckoutOrDrawer('/?loginOrRegister=1');
    },
  }));
})(typeof globalThis !== 'undefined' ? globalThis : window);
