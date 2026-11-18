// Network-first service worker for the static app shell only.
// Never caches /api/* or /data/* price feeds so prices are never served stale from SW cache.
const CACHE_NAME = 'smartcart-shell-v1';
const SHELL_URLS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isCacheableShellRequest(req, url) {
  if (req.method !== 'GET' || url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/data/')) return false;
  if (url.pathname.endsWith('.zip')) return false;
  return true;
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (!isCacheableShellRequest(e.request, url)) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
  );
});
