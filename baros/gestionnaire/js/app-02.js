(function(){
  // Si BarOSSec est déjà défini (baros-security.js chargé OK), on ne fait rien
  if (typeof window.BarOSSec === 'object' && window.BarOSSec) return;

  // ── Clé de session (doit correspondre à celle de baros-security.js) ──
  var SESS_KEY = 'baros_sec_sess';
  var SESS_TTL = 30 * 24 * 60 * 60 * 1000; // 30 jours (idem BarOSSec)

  console.warn('[BarOS] baros-security.js non chargé (file://?) — fallback offline actif');

  window.BarOSSec = {
    // BAROS LOGIN FIX — marqueur permettant à doLogin() de distinguer un vrai mot
    // de passe incorrect d'un échec dû au fallback (hachage différent du vrai
    // baros-security.js, donc vérification non fiable).
    __isFallback: true,
    /* ─ Session ─ */
    saveSecureSession: function(data) {
      if (!data) return;
      try {
        var d = Object.assign({}, data);
        delete d.pwd_hash; // ne jamais stocker le hash
        var record = { data: d, exp: Date.now() + SESS_TTL };
        sessionStorage.setItem(SESS_KEY, JSON.stringify(record));
        localStorage.setItem('baros_session', JSON.stringify(d));
      } catch(e) {}
    },
    getSecureSession: function() {
      // 1. Tenter sessionStorage
      try {
        var raw = sessionStorage.getItem(SESS_KEY);
        if (raw) {
          var rec = JSON.parse(raw);
          if (rec && Date.now() < rec.exp) return rec.data;
          sessionStorage.removeItem(SESS_KEY);
        }
      } catch(e) {}
      // 2. Fallback localStorage (session plus longue, IDB géré par offline module)
      try {
        var ls = localStorage.getItem('baros_session');
        if (ls) return JSON.parse(ls);
      } catch(e) {}
      return null;
    },
    clearSecureSession: function() {
      try { sessionStorage.removeItem(SESS_KEY); } catch(e) {}
      try { localStorage.removeItem('baros_session'); } catch(e) {}
    },
    /* ─ Sécurité (stubs — pas d'implémentation crypto en fallback) ─ */
    hashPassword: async function(pwd) {
      // SHA-256 natif
      try {
        var enc = new TextEncoder().encode(pwd);
        var buf = await crypto.subtle.digest('SHA-256', enc);
        var hex = Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
        return 'sha256:' + hex;
      } catch(e) {
        // Fallback btoa si SubtleCrypto indisponible
        return btoa(pwd);
      }
    },
    verifyPassword: async function(pwd, hash) {
      if (!hash) return false;
      if (hash.startsWith('sha256:')) {
        var computed = await this.hashPassword(pwd);
        return computed === hash;
      }
      // Legacy btoa
      try { return btoa(pwd) === hash; } catch(e) { return false; }
    },
    // [FIX I3] Rate limiting réel — remplace le stub qui autorisait toujours le login
    checkLoginRateLimit: function(email) {
      try {
        var key = 'baros_rl_' + (email||'');
        var raw = localStorage.getItem(key);
        var rec = raw ? JSON.parse(raw) : {count:0, until:0, windowStart:0};
        var now = Date.now();
        if (rec.until && now < rec.until) return { allowed: false, remaining: 0, waitMs: rec.until - now };
        var MAX = 5, WINDOW = 5 * 60 * 1000;
        if (now > (rec.windowStart||0) + WINDOW) return { allowed: true, remaining: MAX };
        return { allowed: rec.count < MAX, remaining: Math.max(0, MAX - rec.count) };
      } catch(e) { return { allowed: true, remaining: 5 }; }
    },
    recordLoginAttempt: function(email, success) {
      try {
        var key = 'baros_rl_' + (email||'');
        var now = Date.now(), WINDOW = 5*60*1000, MAX = 5, LOCK = 15*60*1000;
        if (success) { localStorage.removeItem(key); return; }
        var raw = localStorage.getItem(key);
        var rec = raw ? JSON.parse(raw) : {count:0, until:0, windowStart:now};
        if (now > (rec.windowStart||0) + WINDOW) rec = {count:0, until:0, windowStart:now};
        rec.count = (rec.count||0) + 1;
        if (rec.count >= MAX) rec.until = now + LOCK;
        localStorage.setItem(key, JSON.stringify(rec));
      } catch(e) {}
    },
    logSecurityEvent: async function() {},
    escapeHtml: function(s) {
      return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    },
  };
})();
