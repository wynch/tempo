// Offline support. The network comes first, so a fresh deploy shows at once; the cache answers when there is no network.
// The build stamps the cache name with a hash of the app, so each build gets its own cache and old ones are dropped.
const CACHE = 'tempo-__VERSION__';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'version.json', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    // "no-cache" makes the browser check with the server instead of trusting its own ten-minute copy
    fetch(e.request.url, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('index.html'))),
  );
});
