// Saathi service worker — network-first so EVERY update shows instantly,
// with offline fallback to the cached app shell.
const CACHE = 'saathi-v13';
// relative paths so the PWA also works from a sub-path (GitHub Pages)
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/firebase-config.js',
  './manifest.webmanifest',
  './icons/icon-192.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const host = new URL(e.request.url).hostname;

  // Firebase SDK scripts (gstatic) — cache-first for speed, they are versioned URLs
  if (host === 'www.gstatic.com') {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      }))
    );
    return;
  }

  // all Google/Firebase APIs — network only, never cache
  if (/googleapis\.com$|firebase|firestore|identitytoolkit|securetoken/.test(host)) return;

  // app shell — network-first, cache fallback when offline
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
  );
});
