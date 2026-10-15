/* BarOS — Service Worker v2 (mode sans internet : l'application s'ouvre même sans réseau) */
const CACHE = 'baros-personnel-v2';
const PRECACHE = [
 "./",
 "./index.html",
 "./css/offline.css",
 "./css/style.css",
 "./js/app-04.js",
 "./js/app-05.js",
 "./js/app-06.js",
 "./js/app-07.js",
 "./js/app-08.js",
 "./js/app-09.js",
 "./js/app-10.js",
 "./js/app-11.js",
 "./js/lib-jspdf.js",
 "./js/lib-qrcode.js",
 "./js/lib-supabase.js",
 "./js/offline-queue.js",
 "./icons/icon-serveuse.svg",
 "./manifest-serveuse.json"
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(PRECACHE.map(u => c.add(u).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(
    ks.filter(k => k.startsWith('baros-personnel-') && k !== CACHE).map(k => caches.delete(k)))));
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
