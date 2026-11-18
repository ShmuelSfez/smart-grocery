// Runs at document_start on shufersal.co.il, rami-levy.co.il, and carrefour.co.il:
// grabs "#smartlist=<code>" from the URL and stores it so panel.js can resolve items.
// Never adds to cart automatically – user must explicitly click the add button in the panel.
(function () {
  const m = location.hash.match(/smartlist=([^&]+)/);
  if (!m) return;
  const host = location.hostname;
  const chain = host.includes('rami-levy.co.il')
    ? 'ramilevy'
    : host.includes('carrefour.co.il')
      ? 'carrefour'
      : 'shufersal';
  chrome.storage.local.set({
    pending: { code: m[1], chain, ts: Date.now(), items: null, autoAdd: false, v: 3 },
  });
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch (e) { /* ignore */ }
})();
