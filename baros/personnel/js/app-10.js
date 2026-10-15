(function() {
  // ── Peupler le select de tables depuis tables_config (via NIVEAUX) ──────────
  function _fillApplMgrSelect() {
    const sel = document.getElementById('appel-mgr-table');
    if (!sel || sel.options.length > 1) return; // déjà rempli
    const tables = (typeof NIVEAUX !== 'undefined' && NIVEAUX.length)
      ? NIVEAUX.flatMap(function(niv){ return niv.tables || []; })
      : [];
    tables.forEach(function(nom) {
      const opt = document.createElement('option');
      opt.value = nom; opt.textContent = nom;
      sel.appendChild(opt);
    });
    // Pré-sélectionner la table courante si selTable est défini
    if (typeof selTable !== 'undefined' && selTable) sel.value = selTable;
  }

  // ── Pré-remplir quand selTable change ──────────────────────────
  const _origSetTable = window.setTable;
  if (typeof _origSetTable === 'function' && !_origSetTable._appMgrPatched) {
    window.setTable = function() {
      _origSetTable.apply(this, arguments);
      const sel = document.getElementById('appel-mgr-table');
      if (sel && typeof selTable !== 'undefined' && selTable) sel.value = selTable;
    };
    window.setTable._appMgrPatched = true;
  }

  // ── INSERT appel vers manager ───────────────────────────────────
  window._appellerManager = async function(type) {
    if (typeof db === 'undefined' || typeof ETAB === 'undefined' || !ETAB ||
        typeof CU === 'undefined' || !CU) {
      if (typeof toast === 'function') toast('❌ Non connecté', 'var(--dg)');
      return;
    }
    const selEl  = document.getElementById('appel-mgr-table');
    const msgEl  = document.getElementById('appel-mgr-msg');
    const table  = (selEl && selEl.value) ? selEl.value
                   : (typeof selTable !== 'undefined' && selTable ? selTable : '');
    if (!table) {
      if (typeof toast === 'function') toast('⚠️ Sélectionnez une table', 'var(--wn)');
      return;
    }
    const msg = msgEl ? msgEl.value.trim() : '';

    // Désactiver le bouton
    const btnId = 'appel-mgr-btn-' + type;
    const btn   = document.getElementById(btnId);
    const orig  = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '…'; }

    try {
      // ── ROUTAGE BAR/COMPARTIMENT ──
      // Résoudre bar_id et compartiment_id depuis le nom de la table
      // via tables_config. Silencieux si la table n'est pas encore assignée.
      let barId = null;
      let compartimentId = null;
      try {
        const { data: tbl } = await db.from('tables_config')
          .select('bar_id, compartiment_id')
          .eq('etab_id', ETAB.id)
          .eq('nom', table)
          .maybeSingle();
        if (tbl) {
          barId = tbl.bar_id || null;
          compartimentId = tbl.compartiment_id || null;
        }
      } catch(_) {}
      // ── FIN ROUTAGE ──

      const { error } = await db.from('appels').insert({
        etab_id       : ETAB.id,
        type          : type,
        table_nom     : table,
        statut        : 'pending',
        employe_id    : CU.id,
        message_client: msg || null,
        bar_id        : barId,
        // compartiment_id retiré : colonne absente du schéma appels
        created_at    : new Date().toISOString(),
        updated_at    : new Date().toISOString()
      });
      if (error) throw error;
      if (typeof toast === 'function') toast('✅ Manager prévenu', 'var(--gn)');
      if (msgEl) msgEl.value = '';
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    } catch(e) {
      if (typeof toast === 'function') toast('❌ ' + (e.message || 'Erreur envoi'), 'var(--dg)');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = orig; }
    }
  };

  // ── Init : peupler le select quand l'onglet Appels s'ouvre ─────
  const _origShowTab = window.showTab;
  function _hookShowTabAppels() {
    const cur = window.showTab;
    if (typeof cur !== 'function' || cur._appMgrTabPatched) return;
    window.showTab = function(id) {
      cur.apply(this, arguments);
      if (id === 'appels') setTimeout(_fillApplMgrSelect, 200);
    };
    window.showTab._appMgrTabPatched = true;
  }

  // Bootstrap : attendre CU + ETAB
  let _attempts = 0;
  const _iv = setInterval(function() {
    if (++_attempts > 120) { clearInterval(_iv); return; }
    if (typeof CU === 'undefined' || !CU) return;
    if (typeof ETAB === 'undefined' || !ETAB) return;
    clearInterval(_iv);
    _fillApplMgrSelect();
    _hookShowTabAppels();
  }, 500);
})();
