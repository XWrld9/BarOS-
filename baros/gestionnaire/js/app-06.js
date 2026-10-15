(function(){
  // Watermark console
  console.log('%c BarOS v3.0 ', 'background:#c8f55a;color:#0a0a0f;font-weight:900;font-size:16px;padding:4px 8px;border-radius:4px');
  console.log('%c© 2025 Christophe OLOCK BELANG — Tous droits réservés', 'color:#c8f55a;font-size:11px');
  console.log('%cToute copie ou redistribution non autorisée est interdite.', 'color:#ff5e5e;font-size:11px');

  function hideSplash(){
    var s = document.getElementById('splash');
    if(!s || s._gone) return;
    s._gone = true;
    s.style.transition = 'opacity 0.5s ease';
    s.style.opacity = '0';
    setTimeout(function(){ if(s && s.parentNode) s.parentNode.removeChild(s); }, 560);
  }

  // Splash disparaît au clic (fallback doigt)
  document.addEventListener('click', hideSplash, {once: true});
  document.addEventListener('touchstart', hideSplash, {once: true});

  // Timer : 2s après chargement complet
  if(document.readyState === 'complete'){
    setTimeout(hideSplash, 800);
  } else {
    window.addEventListener('load', function(){
      setTimeout(hideSplash, 800);
    });
  }
  // Filet de sécurité absolu : 4s quoi qu'il arrive
  setTimeout(hideSplash, 4000);
})();
