// ══════════════════════════════════════════════════════
// sendNotification() — Fonction centrale unique
// scope : 'ONE' | 'ROLE' | 'ALL'
// type  : 'ORDER'|'STOCK'|'COMMUNICATION'|'URGENT_MEETING'|'PERSONAL_CALL'|'GLOBAL_INSTRUCTION'
// ══════════════════════════════════════════════════════
async function sendNotification({ type, scope, titre, corps='', role_cible=null, employe_id_cible=null }) {
  if (!ETAB || !CU) return;
  try {
    await db.from('communications').insert({
      etab_id:           ETAB.id,
      type,
      scope,
      titre,
      corps,
      role_cible,
      employe_id_cible,
      employe_id_source: CU.id,
      nom_source:        CU.nom,
    });
  } catch(e) {
    console.warn('[BarOS Comm] sendNotification error:', e.message);
  }
}

// ══════════════════════════════════════════════════════
// Affichage local selon le type de communication reçue
// ══════════════════════════════════════════════════════
function _commAfficher(c) {
  console.log('[BarOS Comm] Message reçu:', c?.type, c?.titre, 'scope:', c?.scope);
  // Vérifier si ce message nous concerne
  const concerne = c.scope === 'ALL'
    || (c.scope === 'ROLE' && c.role_cible === CU?.role)
    || (c.scope === 'ONE'  && c.employe_id_cible === CU?.id);
  if (!concerne) { console.log('[BarOS Comm] Message ignoré (pas pour ce profil)'); return; }
  // Ne pas afficher ses propres messages
  if (c.employe_id_source === CU?.id) return;

  // Popup bloquant pour réunion urgente
  if (c.type === 'URGENT_MEETING') {
    _commPopupUrgent(c);
    return;
  }
  // Bannière pour instructions globales
  if (c.type === 'GLOBAL_INSTRUCTION') {
    _commBanniere(c);
    return;
  }
  // Toast pour tout le reste
  const col = c.type === 'ORDER' ? 'var(--wn)'
    : c.type === 'PERSONAL_CALL' ? 'var(--inf)'
    : c.type === 'STOCK' ? 'var(--dg)'
    : 'var(--ac)';

  if (typeof barosShowPushToast === 'function') {
    barosShowPushToast(c.titre, c.corps || '', 'message', { emoji: '💬', color: '#5ab4ff' });
  } else {
    toast(c.titre + (c.corps ? ' — ' + c.corps : ''), col);
  }
  if (navigator.vibrate) navigator.vibrate([150, 80, 150]);
}

function _commPopupUrgent(c) {
  const existing = document.getElementById('comm-urgent-popup');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'comm-urgent-popup';
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:999999;display:flex;align-items:center;justify-content:center;padding:24px';
  el.innerHTML = `
    <div style="background:#12121a;border:2px solid #ff5e5e;border-radius:20px;padding:28px 24px;max-width:340px;width:100%;text-align:center">
      <div style="font-size:48px;margin-bottom:12px">🚨</div>
      <div style="font-size:17px;font-weight:800;color:#ff5e5e;margin-bottom:8px">${_esc(c.titre)}</div>
      ${c.corps ? `<div style="font-size:13px;color:rgba(240,239,245,.6);margin-bottom:16px">${_esc(c.corps)}</div>` : ''}
      <div style="font-size:11px;color:rgba(240,239,245,.35);margin-bottom:20px">De : ${_esc(c.nom_source || 'Manager')}</div>
      <button onclick="document.getElementById('comm-urgent-popup').remove()"
        style="width:100%;padding:14px;background:#ff5e5e;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">
        ✓ J'ai compris
      </button>
    </div>`;
  document.body.appendChild(el);
  if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);
}

function _commBanniere(c) {
  const existing = document.getElementById('comm-banniere');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'comm-banniere';
  el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99998;background:linear-gradient(135deg,#7c6cff,#5ab4ff);padding:10px 16px;display:flex;align-items:center;gap:10px;box-shadow:0 4px 16px rgba(0,0,0,0.4)';
  el.innerHTML = `
    <span style="font-size:18px">📢</span>
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;font-weight:700;color:#fff">${_esc(c.titre)}</div>
      ${c.corps ? `<div style="font-size:11px;color:rgba(255,255,255,.8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(c.corps)}</div>` : ''}
    </div>
    <button onclick="document.getElementById('comm-banniere').remove()"
      style="background:rgba(255,255,255,.2);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:14px;flex-shrink:0">✕</button>`;
  document.body.appendChild(el);
  setTimeout(() => { if (document.getElementById('comm-banniere')) document.getElementById('comm-banniere').remove(); }, 12000);
}

function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ══════════════════════════════════════════════════════
// Canal Realtime communications — strictement additif
// ══════════════════════════════════════════════════════
let _commRealtimeChannel = null;
let _commLastSeenId = null;  // Pour le fallback polling

function _startCommRealtime() {
  if (!ETAB || !db) return;
  // Idempotent : ne pas créer plusieurs channels
  if (_commRealtimeChannel) return;

  _commRealtimeChannel = db.channel('comm-pers-' + ETAB.id)
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'communications',
      filter: `etab_id=eq.${ETAB.id}`
    }, payload => {
      if (payload.new) {
        _commLastSeenId = payload.new.id;
        _commAfficher(payload.new);
      }
    })
    .subscribe((status) => {
      console.log('[BarOS Comm] Realtime status:', status);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[BarOS Comm] Realtime KO — démarrage fallback polling');
        _startCommPolling();
      }
    });

  // Fallback polling : toutes les 8s, chercher les nouvelles communications
  // au cas où le Realtime Supabase ne soit pas activé sur cette table
  _startCommPolling();
}

let _commPollingTimer = null;
let _commPollingLastAt = null;

function _startCommPolling() {
  if (_commPollingTimer) return; // déjà actif
  _commPollingLastAt = new Date().toISOString();
  _commPollingTimer = setInterval(async () => {
    if (!ETAB || !CU || !db) return;
    try {
      let q = db.from('communications')
        .select('*')
        .eq('etab_id', ETAB.id)
        .gt('created_at', _commPollingLastAt)
        .order('created_at', { ascending: true });
      const { data } = await q;
      if (data && data.length > 0) {
        _commPollingLastAt = data[data.length - 1].created_at;
        data.forEach(c => _commAfficher(c));
      }
    } catch(e) {
      // Silencieux — le polling réessaiera
    }
  }, 8000);
}

// ══════════════════════════════════════════════════════
// Hook sur validerCmd — notification ORDER au barman
// ══════════════════════════════════════════════════════
(function() {
  const _orig = window.validerCmd;
  if (typeof _orig !== 'function') return;
  window.validerCmd = async function() {
    // Récupérer la table sélectionnée AVANT l'appel original
    const table = typeof selTable !== 'undefined' ? selTable : '?';
    const itemsBar = Object.entries(typeof panier !== 'undefined' ? panier : {})
      .filter(([id]) => {
        const p = (typeof ARTICLES !== 'undefined' ? ARTICLES : []).find(x => x.id === id);
        return p && (typeof getProdTypeService === 'function') && getProdTypeService(p) === 'bar';
      });
    await _orig.apply(this, arguments);
    // Envoyer notification au barman si commande contient des articles bar
    if (itemsBar.length > 0) {
      await sendNotification({
        type:  'ORDER',
        scope: 'ROLE',
        titre: '🍽️ Nouvelle commande — ' + table,
        corps: itemsBar.length + ' article(s) bar',
        role_cible: 'Barman',
      });
    }
  };
})();

// ══════════════════════════════════════════════════════
// Hook sur updCmd — notification ORDER à la serveuse (commande prête)
// ══════════════════════════════════════════════════════
(function() {
  const _orig = window.updCmd;
  if (typeof _orig !== 'function') return;
  window.updCmd = async function(id, statut) {
    await _orig.apply(this, arguments);
    if (statut === 'Livré') {
      // Récupérer la table depuis la commande
      try {
        const { data: cmd } = await db.from('commandes').select('table_nom,employe_id').eq('id', id).maybeSingle();
        if (cmd) {
          await sendNotification({
            type:             'ORDER',
            scope:            'ONE',
            titre:            '🔥 Commande prête : ' + (cmd.table_nom || ''),
            corps:            'Votre commande est prête à être livrée.',
            employe_id_cible: cmd.employe_id,
          });
        }
      } catch(e) {}
    }
  };
})();

// ══════════════════════════════════════════════════════
// Hook sur updCuisine — notification ORDER à la serveuse (plat prêt)
// ══════════════════════════════════════════════════════
(function() {
  const _orig = window.updCuisine;
  if (typeof _orig !== 'function') return;
  window.updCuisine = async function(id, statut) {
    await _orig.apply(this, arguments);
    if (statut === 'Livré') {
      try {
        const { data: cmd } = await db.from('commandes').select('table_nom,employe_id').eq('id', id).maybeSingle();
        if (cmd) {
          await sendNotification({
            type:             'ORDER',
            scope:            'ONE',
            titre:            '🔥 Plat prêt : ' + (cmd.table_nom || ''),
            corps:            'Votre plat est prêt à être servi.',
            employe_id_cible: cmd.employe_id,
          });
        }
      } catch(e) {}
    }
  };
})();

// ══════════════════════════════════════════════════════
// Démarrer le realtime communications après connexion
// Méthode : MutationObserver sur #app (devient visible
// exactement quand startApp() s'exécute, sans hooker
// la fonction directe inaccessible depuis ici)
// ══════════════════════════════════════════════════════
(function() {
  let _commStarted = false;

  function _tryStart() {
    if (_commStarted) return;
    if (typeof ETAB === 'undefined' || !ETAB || typeof db === 'undefined') return;
    _commStarted = true;
    _startCommRealtime();
  }

  // Observer #app : quand il perd la classe "hide", l'employé est connecté
  const appEl = document.getElementById('app');
  if (appEl) {
    const obs = new MutationObserver(() => {
      if (!appEl.classList.contains('hide')) {
        setTimeout(_tryStart, 400);
      }
    });
    obs.observe(appEl, { attributes: true, attributeFilter: ['class'] });
  }

  // Fallback : polling au cas où l'observer rate
  const iv = setInterval(() => {
    const app = document.getElementById('app');
    if (app && !app.classList.contains('hide') && typeof ETAB !== 'undefined' && ETAB) {
      clearInterval(iv);
      _tryStart();
    }
  }, 800);
})();
