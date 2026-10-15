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
/* [FIX-COMPAT] Service Worker unique — guard protocole pour macOS/Windows/iOS/Android */
if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('[BarOS PWA] SW enregistré :', reg.scope);
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[BarOS PWA] Nouvelle version disponible.');
            }
          });
        });
      })
      .catch(err => console.warn('[BarOS PWA] SW non enregistré :', err));
  });
}
