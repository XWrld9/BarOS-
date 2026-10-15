/* BarOS — Service Worker v2 (mode sans internet : l'application s'ouvre même sans réseau) */
const CACHE = 'baros-pointage-v2';
const PRECACHE = [
 "./",
 "./index.html",
 "./css/style.css",
 "./js/app-01.js",
 "./js/app-02.js",
 "./js/app-03.js",
 "./js/lib-supabase.js",
 "./icons/icon-pointage.svg",
 "./manifest-pointage.json",
 "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js"
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(PRECACHE.map(u => c.add(u).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(
    ks.filter(k => k.startsWith('baros-pointage-') && k !== CACHE).map(k => caches.delete(k)))));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET') return;
  if (u.hostname.endsWith('supabase.co')) return;           // données : toujours le réseau
  if (r.mode === 'navigate') {                               // pages : réseau d'abord, cache en secours
    e.respondWith(fetch(r).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)).catch(() => {}); return res;
    }).catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match('./index.html'))));
    return;
  }
  e.respondWith(caches.match(r).then(hit => {                // fichiers : cache d'abord, mise à jour en fond
    const net = fetch(r).then(res => {
      if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)).catch(() => {}); }
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
