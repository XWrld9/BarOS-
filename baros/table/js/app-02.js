/* BarOS Table — pas de service worker sur la page client (évite toute boucle).
   Nettoie les anciens service workers / caches restés sur le téléphone. */
if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
  navigator.serviceWorker.getRegistrations().then(function (regs) {
    regs.forEach(function (r) { try { r.unregister(); } catch (e) {} });
  }).catch(function () {});
  if (window.caches) {
    caches.keys().then(function (ks) { ks.forEach(function (k) { if (/^baros-/.test(k)) caches.delete(k); }); }).catch(function () {});
  }
}
