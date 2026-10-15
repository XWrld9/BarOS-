// ────────────────────────────────────────────────────────────────
// Anti-spam : cooldown 5 s par clé d'action unique
// ────────────────────────────────────────────────────────────────
const _mgrCommCooldown = {};

// ────────────────────────────────────────────────────────────────
// _mgrComm() — Fonction centrale de notification manager
// Guard : CU doit exister et ETAB doit être défini
// Audit : appel BarOSSec.logSecurityEvent sur chaque action
// ────────────────────────────────────────────────────────────────
async function _mgrComm({ type, scope, titre, corps = '', role_cible = null, employe_id_cible = null, action_key = '' }) {
  if (!CU || !ETAB) return;
  // Cooldown anti-spam
  if (action_key) {
    const now = Date.now();
    const last = _mgrCommCooldown[action_key] || 0;
    if (now - last < 5000) return;
    _mgrCommCooldown[action_key] = now;
  }
  try {
    await db.from('communications').insert({
      etab_id:           ETAB.id,
      type,
      scope,
      titre,
      corps,
      role_cible,
      employe_id_cible,
      employe_id_source: null,
      nom_source:        (CU.nom || 'Manager') + ' ✦ Manager',
    });
    // Audit log — réutilise BarOSSec existant
    try {
      await BarOSSec.logSecurityEvent(db, 'manager_comm', {
        actor:             CU.email,
        etab_id:           ETAB.id,
        type,
        scope,
        titre,
        employe_id_cible:  employe_id_cible || null,
      });
    } catch(_) {}
  } catch(e) {
    console.warn('[BarOS MgrComm] Erreur envoi notification:', e.message);
  }
}

// ────────────────────────────────────────────────────────────────
// Hook saveEmp — notifie à l'ajout ou à la modification d'un employé
// ────────────────────────────────────────────────────────────────
(function() {
  const _orig = window.saveEmp;
  if (typeof _orig !== 'function') return;
  window.saveEmp = async function() {
    // Capturer AVANT l'appel original (le form est réinitialisé en fin de saveEmp)
    const nomSaisi  = (document.getElementById('en')?.value || '').trim();
    const roleSaisi = document.getElementById('er')?.value || '';
    const editId    = document.getElementById('emp-edit-id')?.value || '';
    const isNew     = !editId;
    // Appel original — toute la logique existante s'exécute normalement
    await _orig.apply(this, arguments);
    if (!nomSaisi) return;
    if (isNew) {
      await _mgrComm({
        type:       'COMMUNICATION',
        scope:      'ALL',
        titre:      '👤 Nouveau membre d\'équipe : ' + nomSaisi,
        corps:      'Poste : ' + roleSaisi + '. Bienvenue dans l\'équipe !',
        action_key: 'new_emp_' + nomSaisi.slice(0, 20),
      });
    } else {
      await _mgrComm({
        type:             'COMMUNICATION',
        scope:            'ONE',
        titre:            '✏️ Votre fiche employé a été mise à jour',
        corps:            'Le manager a modifié votre profil. Contactez-le en cas de question.',
        employe_id_cible: editId,
        action_key:       'upd_emp_' + editId,
      });
    }
  };
})();

// ────────────────────────────────────────────────────────────────
// Hook toggleEmpActif — notifie suspension ou réactivation
// Stratégie de détection : diff EMPS avant/après appel original
// (EMPS ne contient que les actifs — rechargé dans la fonction originale)
// ────────────────────────────────────────────────────────────────
(function() {
  const _orig = window.toggleEmpActif;
  if (typeof _orig !== 'function') return;
  window.toggleEmpActif = async function(id, actif) {
    // Récupérer le nom avant l'appel (EMPS peut être modifié après)
    const empBefore = (typeof EMPS !== 'undefined' ? EMPS : []).find(e => e.id === id);
    const nom = empBefore ? empBefore.nom : 'Employé';
    // Appel original (peut retourner tôt si confirm() est annulé)
    await _orig.apply(this, arguments);
    // Lire l'état post-call pour détecter si l'action a eu lieu
    const empAfter = (typeof EMPS !== 'undefined' ? EMPS : []).find(e => e.id === id);
    if (actif) {
      // Tentative de désactivation — si elle a eu lieu : empAfter absent de EMPS (actifs seulement)
      if (!empAfter) {
        await _mgrComm({
          type:             'URGENT_MEETING',
          scope:            'ONE',
          titre:            '⚠️ Accès suspendu — ' + nom,
          corps:            'Votre accès à l\'application a été suspendu par le manager. Rapprochez-vous de lui.',
          employe_id_cible: id,
          action_key:       'suspend_' + id,
        });
      }
    } else {
      // Tentative de réactivation — si elle a eu lieu : empAfter présent dans EMPS
      if (empAfter) {
        await _mgrComm({
          type:             'COMMUNICATION',
          scope:            'ONE',
          titre:            '✅ Accès rétabli — ' + nom,
          corps:            'Votre accès à l\'application a été rétabli. Bonne reprise !',
          employe_id_cible: id,
          action_key:       'reactivate_' + id,
        });
      }
    }
  };
})();

// ────────────────────────────────────────────────────────────────
// Hook saveTable — notifie création ou modification d'une table/zone
// ────────────────────────────────────────────────────────────────
(function() {
  const _orig = window.saveTable;
  if (typeof _orig !== 'function') return;
  window.saveTable = async function() {
    // Capturer AVANT (modal se ferme sur succès via closeM)
    const nom    = (document.getElementById('tbl-nom')?.value || '').trim().toUpperCase();
    const zone   = (document.getElementById('tbl-zone')?.value || '').trim();
    const wasNew = !_tblEditId;
    await _orig.apply(this, arguments);
    if (!nom) return;
    // Détecter succès : la modal m-table est fermée (classList ne contient plus 'on')
    const modal = document.getElementById('m-table');
    if (modal && modal.classList.contains('on')) return; // modal encore ouverte = erreur
    if (wasNew) {
      await _mgrComm({
        type:       'GLOBAL_INSTRUCTION',
        scope:      'ALL',
        titre:      '🪑 Nouvelle table configurée : ' + nom + (zone ? ' — ' + zone : ''),
        corps:      'Une nouvelle table est disponible. Prenez-en note.',
        action_key: 'new_table_' + nom,
      });
    } else {
      await _mgrComm({
        type:       'COMMUNICATION',
        scope:      'ALL',
        titre:      '✏️ Table mise à jour : ' + nom + (zone ? ' (' + zone + ')' : ''),
        corps:      'La configuration de cette table a été modifiée par le manager.',
        action_key: 'upd_table_' + nom,
      });
    }
  };
})();

// ────────────────────────────────────────────────────────────────
// Hook deleteTableConfirm — notifie suppression d'une table
// Vérification post-call : SELECT pour confirmer la suppression effective
// ────────────────────────────────────────────────────────────────
(function() {
  const _orig = window.deleteTableConfirm;
  if (typeof _orig !== 'function') return;
  window.deleteTableConfirm = async function(id, nom) {
    await _orig.apply(this, arguments);
    // Vérifier si la table a bien été supprimée
    try {
      const { data } = await db.from('tables_config').select('id').eq('id', id).maybeSingle();
      if (!data) {
        // Table supprimée — notifier le personnel
        await _mgrComm({
          type:       'COMMUNICATION',
          scope:      'ALL',
          titre:      '🗑 Table supprimée : ' + nom,
          corps:      'Cette table a été retirée de la configuration. Mettez à jour vos repères.',
          action_key: 'del_table_' + id,
        });
      }
    } catch(_) {}
  };
})();

// ────────────────────────────────────────────────────────────────
// _mgrSendInstruction() — Envoi manuel d'une instruction depuis l'UI
// ────────────────────────────────────────────────────────────────
async function _mgrSendInstruction() {
  const titre = (document.getElementById('mgr-comm-titre')?.value || '').trim();
  const corps = (document.getElementById('mgr-comm-corps')?.value || '').trim();
  const scope = document.getElementById('mgr-comm-scope')?.value || 'ALL';
  const role_cible = scope === 'ROLE' ? (document.getElementById('mgr-comm-role')?.value || null) : null;
  const type  = document.getElementById('mgr-comm-type')?.value || 'GLOBAL_INSTRUCTION';
  if (!titre) { showN('⚠️ Titre requis pour envoyer une instruction', 'warn'); return; }
  const btn = document.querySelector('#mgr-comm-card button[onclick="_mgrSendInstruction()"]');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  await _mgrComm({ type, scope, titre, corps, role_cible, action_key: 'manual_' + Date.now() });
  if (btn) { btn.disabled = false; btn.textContent = '📤 Envoyer au personnel'; }
  document.getElementById('mgr-comm-titre').value = '';
  document.getElementById('mgr-comm-corps').value = '';
  showN('📨 Instruction envoyée au personnel', 'success');
}

// ────────────────────────────────────────────────────────────────
// _mgrCommScopeChange() — affiche/masque le sélecteur de rôle
// ────────────────────────────────────────────────────────────────
function _mgrCommScopeChange() {
  const scope = document.getElementById('mgr-comm-scope')?.value;
  const wrap  = document.getElementById('mgr-comm-role-wrap');
  if (wrap) wrap.style.display = scope === 'ROLE' ? 'block' : 'none';
}
