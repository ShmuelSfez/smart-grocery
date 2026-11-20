// Mahsanei HaShuk Online adapter (מחסני השוק אונליין — Self-Point — https://www.mck.co.il/*).
(function (root) {
  const reg = root.SmartCartChains;
  reg.register(reg.helpers.createSelfPointChain({
    id: 'mahsaneihashuk',
    name: 'מחסני השוק',
    retailerId: 1107,
    defaultBranchId: '836',
    hostnames: ['mck.co.il'],
    homeUrl: 'https://www.mck.co.il/',
    matchPattern: 'https://www.mck.co.il/*',
    accent: '#c2410c',
    checkoutLabel: '💳 עבור לתשלום במחסני השוק',
  }));
})(typeof globalThis !== 'undefined' ? globalThis : window);
