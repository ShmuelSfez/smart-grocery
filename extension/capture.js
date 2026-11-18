// Runs at document_start on shufersal.co.il and rami-levy.co.il: grabs "#smartlist=<code>" from the URL
// and stores it so the panel can display it. Never adds to cart automatically – user must click in the panel.
(function () {
  const m = location.hash.match(/smartlist=([^&]+)/);
  if (!m) return;
  chrome.storage.local.set({ pending: { code: m[1], ts: Date.now(), items: null, autoAdd: false, v: 2 } });
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch (e) { /* ignore */ }
})();
