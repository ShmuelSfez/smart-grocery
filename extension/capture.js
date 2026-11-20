// Runs at document_start on all 7 supported Israeli supermarket storefronts:
// grabs "#smartlist=<code>" from the URL and stores it so panel.js can resolve items.
// Never adds to cart automatically – user must explicitly click in the panel.
(function () {
  const m = location.hash.match(/smartlist=([^&]+)/);
  if (!m) return;
  const host = location.hostname.toLowerCase();
  let chain = 'shufersal';
  if (host.includes('rami-levy.co.il')) chain = 'ramilevy';
  else if (host.includes('carrefour.co.il')) chain = 'carrefour';
  else if (host.includes('mck.co.il')) chain = 'mahsaneihashuk';
  else if (host.includes('victoryonline.co.il')) chain = 'victory';
  else if (host.includes('yochananof.co.il')) chain = 'yochananof';
  else if (host.includes('tivtaam.co.il')) chain = 'tivtaam';

  chrome.storage.local.set({
    pending: { code: m[1], chain, ts: Date.now(), items: null, autoAdd: false, v: 3 },
  });
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch (e) { /* ignore */ }
})();
