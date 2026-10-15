/* BarOS — anti-boucle : pas de rechargement automatique, et suppression d'un ancien
   service worker resté à la racine du site (premier hébergement). */
if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
  navigator.serviceWorker.getRegistrations().then(function (regs) {
    regs.forEach(function (r) {
      try {
        var sp = new URL(r.scope).pathname;
        if (sp === '/' && location.pathname !== '/') r.unregister();
      } catch (e) {}
    });
  }).catch(function () {});
}
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[BarOS PWA] Nouvelle version disponible.');
            }
          });
        });
      })
      .catch(err => console.warn('[BarOS PWA] SW non enregistré :', err));
  });
}
