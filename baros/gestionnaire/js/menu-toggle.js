// ── BarOS Gestionnaire — menu masqué par défaut ───────────────
// Le bouton "☰ Menu" ouvre le menu ; choisir une option le referme
// pour afficher l'interface choisie en plein écran.
function openMenu() {
  var sb = document.getElementById('sb'), ov = document.getElementById('sb-overlay');
  if (!sb) return;
  sb.classList.add('open'); if (ov) ov.classList.add('open');
  document.body.classList.add('menu-open');
}
function closeMenu() {
  var sb = document.getElementById('sb'), ov = document.getElementById('sb-overlay');
  if (sb) sb.classList.remove('open'); if (ov) ov.classList.remove('open');
  document.body.classList.remove('menu-open');
}
function toggleMenu() {
  var sb = document.getElementById('sb');
  if (sb && sb.classList.contains('open')) closeMenu(); else openMenu();
}
document.addEventListener('click', function (e) {
  var item = e.target.closest && e.target.closest('#sb .ni');
  if (item) setTimeout(closeMenu, 60);   // laisse go() s'exécuter d'abord
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
