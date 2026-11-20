// Carrefour Israel Online adapter (Self-Point — https://www.carrefour.co.il/*).
(function (root) {
  const reg = root.SmartCartChains;
  reg.register(reg.helpers.createSelfPointChain({
    id: 'carrefour',
    name: 'קרפור',
    retailerId: 1540,
    defaultBranchId: '3003',
    hostnames: ['carrefour.co.il'],
    homeUrl: 'https://www.carrefour.co.il/',
    matchPattern: 'https://www.carrefour.co.il/*',
    accent: '#004e9e',
    checkoutLabel: '💳 עבור לתשלום בקרפור',
  }));
})(typeof globalThis !== 'undefined' ? globalThis : window);
