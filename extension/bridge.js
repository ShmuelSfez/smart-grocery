// Content script on SmartCart web origins (*.vercel.app, localhost, 127.0.0.1, shmuelsfez.github.io).
// Signals to the PWA that the SmartCart Chrome Extension (v3.1.0) is installed and active.
(function () {
  function announce() {
    if (!document.documentElement) return;
    document.documentElement.dataset.smartcartExt = '3.1.0';
    document.dispatchEvent(new CustomEvent('smartcart-ext-ready'));
  }
  announce();
  if (!document.documentElement) {
    document.addEventListener('readystatechange', announce, { once: true });
  }
})();
