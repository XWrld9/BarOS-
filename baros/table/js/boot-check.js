// ── BarOS Table — écran de secours ────────────────────────────
// Si la page n'a rien affiché après 8 secondes, montre ce qui bloque
// (au lieu d'une page blanche) et propose un nettoyage sans boucle.
(function () {
  var errs = [];
  window.addEventListener('error', function (e) { errs.push((e.message || 'Erreur') + (e.filename ? ' [' + e.filename.split('/').pop() + ':' + e.lineno + ']' : '')); });
  window.addEventListener('unhandledrejection', function (e) { errs.push('Promesse : ' + ((e.reason && e.reason.message) || e.reason)); });

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function visible(id) { var el = document.getElementById(id); return el && el.style.display !== 'none' && el.offsetParent !== null; }

  window.baosCleanReload = async function () {
    try { var regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(function (r) { return r.unregister(); })); } catch (e) {}
    try { var ks = await caches.keys(); await Promise.all(ks.map(function (k) { return caches.delete(k); })); } catch (e) {}
    location.reload();   // un seul rechargement, déclenché par le bouton
  };

  setTimeout(function () {
    if (visible('main-wrap') || visible('err-wrap')) return;
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#0a0a0f;color:#f0f0f5;font-family:Arial,sans-serif;padding:24px;display:flex;flex-direction:column;justify-content:center;gap:12px;text-align:center';
    box.innerHTML =
      '<div style="font-size:22px;font-weight:800;color:#c8f55a">BarOS</div>' +
      '<div style="font-size:15px">Le chargement prend trop de temps.</div>' +
      '<div style="font-size:12px;color:#7a7a8c">' + (navigator.onLine ? 'Vérifiez votre connexion puis réessayez.' : 'Vous êtes hors ligne.') + '</div>' +
      (errs.length ? '<div style="font-size:11px;color:#ffb444;word-break:break-word;background:#12121a;border-radius:10px;padding:10px;text-align:left">' + errs.slice(0, 4).map(esc).join('<br>') + '</div>' : '') +
      '<div style="font-size:10px;color:#7a7a8c;word-break:break-all">' + esc(location.href) + '</div>' +
      '<button onclick="baosCleanReload()" style="padding:12px;border-radius:12px;border:0;background:#c8f55a;color:#0a0a0f;font-weight:700;font-size:14px">Nettoyer et réessayer</button>';
    document.body.appendChild(box);
  }, 8000);
})();
