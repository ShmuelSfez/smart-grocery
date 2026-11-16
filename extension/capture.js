// Runs at document_start on shufersal.co.il: grabs "#smartlist=<code>" from the URL
// (put there by the web app) and stores it so the panel can pick it up – even across a login redirect.
(function () {
  const m = location.hash.match(/smartlist=([^&]+)/);
  if (!m) return;
  chrome.storage.local.set({ pending: { code: m[1], ts: Date.now(), items: null, autoAdd: true } });
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch (e) { /* ignore */ }
})();
