(function() {
  'use strict';

  // ── 1. Étendre ALL_VIEW_IDS dès que défini ──────────────────────────
  function _patchViewIds() {
    if (typeof ALL_VIEW_IDS !== 'undefined' && Array.isArray(ALL_VIEW_IDS) && !ALL_VIEW_IDS.includes('messages')) {
      ALL_VIEW_IDS.push('messages');
    }
  }

  // ── 2. Wrapper showTab pour gérer 'messages' ────────────────────────
  function _patchShowTab() {
    const _orig = window.showTab;
    if (typeof _orig !== 'function' || _orig._msgFeedPatched) return;
    window.showTab = function(id) {
      _orig.apply(this, arguments);
      if (id === 'messages') { _loadMsgFeed(); _clearMsgBadge(); }
    };
    window.showTab._msgFeedPatched = true;
  }

  // ── 3. Injecter l'onglet dans la nav ────────────────────────────────
  function _injectMsgTab() {
    const nav = document.getElementById('nav');
    if (!nav || document.getElementById('tab-messages')) return;
    const tab = document.createElement('div');
    tab.className = 'nav-tab';
    tab.id = 'tab-messages';
    tab.style.position = 'relative';
    tab.innerHTML =
      '<span class="nav-ic">📩</span>' +
      '<span id="tab-msg-badge" style="position:absolute;top:4px;right:2px;' +
        'background:#ff5e5e;color:#fff;border-radius:10px;font-size:9px;' +
        'padding:1px 5px;display:none;font-weight:700;pointer-events:none">0</span>' +
      'Messages';
    tab.onclick = function() { if (typeof window.showTab === 'function') window.showTab('messages'); };
    nav.appendChild(tab);
    _patchViewIds();
    _patchShowTab();
  }

  // ── 4. Tracking des messages lus (localStorage) ─────────────────────
  function _readKey() {
    return 'baros_msg_read_' + ((typeof ETAB !== 'undefined' && ETAB && ETAB.id) ? ETAB.id : '');
  }
  function _getReadIds() {
    try { return JSON.parse(localStorage.getItem(_readKey()) || '[]'); } catch { return []; }
  }
  function _markRead(ids) {
    const merged = [...new Set([..._getReadIds(), ...ids])].slice(-200);
    try { localStorage.setItem(_readKey(), JSON.stringify(merged)); } catch {}
  }
  function _isRead(id) { return _getReadIds().includes(id); }

  // ── 5. Badge non-lus ────────────────────────────────────────────────
  window._msgUnreadCount = window._msgUnreadCount || 0;

  function _updateMsgBadge(n) {
    const b = document.getElementById('tab-msg-badge');
    if (!b) return;
    if (n > 0) { b.textContent = n > 9 ? '9+' : n; b.style.display = 'block'; }
    else b.style.display = 'none';
  }
  function _clearMsgBadge() { window._msgUnreadCount = 0; _updateMsgBadge(0); }

  // ── 6. Pertinence du message pour cet utilisateur ───────────────────
  function _msgConcerne(c) {
    const cu = typeof CU !== 'undefined' ? CU : null;
    if (!cu) return false;
    if (c.scope === 'ALL') return true;
    if (c.scope === 'ROLE' && c.role_cible === cu.role) return true;
    if (c.scope === 'ONE'  && c.employe_id_cible === cu.id) return true;
    return false;
  }

  // ── 7. Rendu d'une carte message ────────────────────────────────────
  function _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  const _TYPE_COLORS = {
    URGENT_MEETING:'#ff5e5e', GLOBAL_INSTRUCTION:'#7c6cff',
    ORDER:'#f59e0b', STOCK:'#ef4444', PERSONAL_CALL:'#5ab4ff', COMMUNICATION:'var(--ac)',
  };
  const _TYPE_ICONS = {
    URGENT_MEETING:'🚨', GLOBAL_INSTRUCTION:'📢',
    ORDER:'🍽️', STOCK:'📦', PERSONAL_CALL:'📞', COMMUNICATION:'💬',
  };

  function _renderCard(c, prepend) {
    const feed = document.getElementById('msg-feed');
    if (!feed) return;
    document.getElementById('msg-empty')?.style && (document.getElementById('msg-empty').style.display = 'none');
    if (document.getElementById('msg-' + c.id)) return;

    const col = _TYPE_COLORS[c.type] || 'var(--ac)';
    const ico = _TYPE_ICONS[c.type] || '💬';
    const isNew = !_isRead(c.id);
    const dt = c.created_at ? new Date(c.created_at) : null;
    const dtStr = dt
      ? dt.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}) + ' ' +
        dt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})
      : '';

    const card = document.createElement('div');
    card.id = 'msg-' + c.id;
    card.style.cssText =
      'background:var(--s2);border-radius:12px;padding:12px 14px;' +
      'border-left:3px solid ' + col + ';' +
      (isNew ? 'box-shadow:0 0 0 1px ' + col + '33;' : 'opacity:0.85;');
    card.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
        '<span style="font-size:16px">' + ico + '</span>' +
        '<div style="font-size:12px;font-weight:700;color:' + col + ';flex:1">' + _esc(c.titre) + '</div>' +
        (isNew ? '<span style="background:' + col + ';color:#fff;border-radius:10px;font-size:9px;padding:1px 6px">NEW</span>' : '') +
      '</div>' +
      (c.corps ? '<div style="font-size:12px;color:var(--tx);margin:4px 0;line-height:1.5">' + _esc(c.corps) + '</div>' : '') +
      '<div style="font-size:10px;color:var(--mt);margin-top:4px">' +
        (c.nom_source ? _esc(c.nom_source) + ' · ' : '') + dtStr +
      '</div>';

    if (prepend && feed.firstChild) feed.insertBefore(card, feed.firstChild);
    else feed.appendChild(card);
  }

  // ── 8. Charger le feed depuis Supabase ──────────────────────────────
  window._loadMsgFeed = async function() {
    const feed = document.getElementById('msg-feed');
    if (!feed) return;
    if (typeof db === 'undefined' || typeof ETAB === 'undefined' || !ETAB ||
        typeof CU === 'undefined' || !CU) {
      feed.innerHTML = '<div id="msg-empty" style="text-align:center;color:var(--mt);font-size:13px;padding:40px 0">Connexion requise…</div>';
      return;
    }
    feed.innerHTML = '<div id="msg-empty" style="text-align:center;color:var(--mt);font-size:13px;padding:40px 0">Chargement…</div>';
    try {
      const { data } = await db.from('communications')
        .select('*').eq('etab_id', ETAB.id)
        .order('created_at', { ascending: false }).limit(60);
      feed.innerHTML = '';
      const empty = document.createElement('div');
      empty.id = 'msg-empty';
      empty.style.cssText = 'text-align:center;color:var(--mt);font-size:13px;padding:40px 0';
      empty.textContent = 'Aucun message reçu';
      feed.appendChild(empty);
      const msgs = (data || []).filter(_msgConcerne).filter(c => c.employe_id_source !== CU.id);
      if (msgs.length > 0) {
        empty.style.display = 'none';
        msgs.forEach(c => _renderCard(c, false));
        _markRead(msgs.map(c => c.id));
        _clearMsgBadge();
      }
    } catch(e) {
      document.getElementById('msg-feed').innerHTML =
        '<div style="text-align:center;color:var(--mt);font-size:12px;padding:30px 0">Impossible de charger les messages</div>';
    }
  };

  // ── 9. Hooker _commAfficher : badge + injection temps réel ──────────
  function _patchCommAfficher() {
    const _orig = window._commAfficher;
    if (typeof _orig !== 'function' || _orig._msgFeedPatched) return;
    window._commAfficher = function(c) {
      _orig.apply(this, arguments);
      if (!c || !_msgConcerne(c)) return;
      const cu = typeof CU !== 'undefined' ? CU : null;
      if (cu && c.employe_id_source === cu.id) return;
      // Incrémenter badge si feed non visible
      const msgView = document.getElementById('view-messages');
      const feedVisible = msgView && !msgView.classList.contains('hide');
      if (!feedVisible && !_isRead(c.id)) {
        window._msgUnreadCount = (window._msgUnreadCount || 0) + 1;
        _updateMsgBadge(window._msgUnreadCount);
      }
      // Injecter dans le feed si ouvert
      if (feedVisible) { _renderCard(c, true); _markRead([c.id]); _clearMsgBadge(); }
    };
    window._commAfficher._msgFeedPatched = true;
  }

  // ── 10a. Badge init : compte les non-lus des 24 dernières heures ───
  async function _initMsgBadge() {
    if (typeof db === 'undefined' || typeof ETAB === 'undefined' || !ETAB ||
        typeof CU === 'undefined' || !CU) return;
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data } = await db.from('communications')
        .select('id,scope,role_cible,employe_id_cible,employe_id_source')
        .eq('etab_id', ETAB.id)
        .gt('created_at', since)
        .order('created_at', { ascending: false })
        .limit(60);
      const unread = (data || [])
        .filter(_msgConcerne)
        .filter(c => c.employe_id_source !== CU.id)
        .filter(c => !_isRead(c.id));
      if (unread.length > 0) {
        window._msgUnreadCount = unread.length;
        _updateMsgBadge(window._msgUnreadCount);
      }
    } catch(e) { /* silencieux */ }
  }

  // ── 10b. Bootstrap : observer sur #nav ─────────────────────────────
  (function() {
    let _done = false;
    function _tryInit() {
      if (_done) return;
      const nav = document.getElementById('nav');
      if (!nav || nav.children.length === 0) return;
      if (typeof window.showTab !== 'function') return;
      if (typeof CU === 'undefined' || !CU) return;
      _done = true;
      _injectMsgTab();
      _patchShowTab();
      _patchCommAfficher();
      setTimeout(_initMsgBadge, 900); // après que db soit prêt
    }
    const obs = new MutationObserver(_tryInit);
    const app = document.getElementById('app');
    if (app) obs.observe(app, { attributes: true, childList: true, subtree: false });
    let attempts = 0;
    const iv = setInterval(function() {
      if (++attempts > 120 || _done) { clearInterval(iv); return; }
      _tryInit();
    }, 500);
  })();

})();
