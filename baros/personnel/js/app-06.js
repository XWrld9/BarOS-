// ═══════════════════════════════════════════════════════════════
// BAROS CLIENT CALL SYSTEM — BarOS Personnel v5.0
// TABLE CALL MANAGEMENT · CLIENT MESSAGE SYSTEM
// ADDITION REQUEST · REALTIME CALLS · SERVEUSE ASSIGNMENT
// © 2025 Christophe OLOCK BELANG
//
// ── MIGRATION SQL SUPABASE REQUISE ──────────────────────────
// Exécuter une seule fois dans l'éditeur SQL Supabase :
//
//   ALTER TABLE appels
//     ADD COLUMN IF NOT EXISTS message_client    TEXT,
//     ADD COLUMN IF NOT EXISTS prise_en_charge_par TEXT,
//     ADD COLUMN IF NOT EXISTS prise_en_charge_at  TIMESTAMPTZ,
//     ADD COLUMN IF NOT EXISTS completed_at        TIMESTAMPTZ,
//     ADD COLUMN IF NOT EXISTS addition_detail     JSONB;
//
//   -- Statuts étendus (pending, accepted, completed, rejected)
//   -- Types étendus  (serveuse, addition, message, urgence, commande)
// ────────────────────────────────────────────────────────────

// ── Cache offline appels — Personnel s'ouvre même hors réseau ──
let _appelsCache   = [];       // Dernier jeu d'appels chargé
let _appelsTimer   = null;     // Timer de rafraîchissement
let _appelFilter   = 'all';    // Filtre actif
let _offlineMode   = false;    // Détection hors connexion

// ── Sons ──────────────────────────────────────────────────────
// Son appel normal (3 dings)
function playBeepAppel() {
  try {
    /* [FIX-COMPAT] Safari iOS suspend l'AudioContext sans geste utilisateur */
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const _play = () => {
      [[880,0],[1100,0.2],[880,0.4]].forEach(([freq, t]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = freq; o.type = 'sine';
        g.gain.setValueAtTime(0, ctx.currentTime + t);
        g.gain.linearRampToValueAtTime(0.4, ctx.currentTime + t + 0.04);
        g.gain.linearRampToValueAtTime(0, ctx.currentTime + t + 0.18);
        o.start(ctx.currentTime + t);
        o.stop(ctx.currentTime + t + 0.22);
      });
    };
    if (ctx.state === 'suspended') { ctx.resume().then(_play).catch(()=>{}); }
    else { _play(); }
  } catch(e) {}
}

// URGENCE — son triple aigu + rouge
function playBeepUrgence() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const _play = () => {
      [0, 0.3, 0.6, 0.9].forEach(t => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = 1400; o.type = 'square';
        g.gain.setValueAtTime(0, ctx.currentTime + t);
        g.gain.linearRampToValueAtTime(0.45, ctx.currentTime + t + 0.02);
        g.gain.linearRampToValueAtTime(0, ctx.currentTime + t + 0.22);
        o.start(ctx.currentTime + t);
        o.stop(ctx.currentTime + t + 0.25);
      });
    };
    if (ctx.state === 'suspended') { ctx.resume().then(_play).catch(()=>{}); }
    else { _play(); }
  } catch(e) {}
}

// ── Constantes types/labels/icônes ────────────────────────────
const APPEL_ICONS  = { serveuse:'🔔', addition:'💰', message:'💬', urgence:'🚨', commande:'🛒' };
const APPEL_LABELS = { serveuse:'Appel serveuse', addition:'Demande d\'addition', message:'Message client', urgence:'⚠️ URGENCE', commande:'Nouvelle commande' };
const APPEL_CHIPS  = { serveuse:'atc-serveuse', addition:'atc-addition', message:'atc-message', urgence:'atc-urgence', commande:'atc-commande' };
const APPEL_STATUT_LABELS = { pending:'En attente', accepted:'Pris en charge', completed:'Terminé', rejected:'Refusé' };

// ── Badge onglet Appels ───────────────────────────────────────
async function updateAppelsBadge() {
  if (!ETAB) return;
  let count = 0;
  try {
    const { count: c } = await db.from('appels')
      .select('id', { count:'exact' })
      .eq('etab_id', ETAB.id)
      .eq('statut', 'pending');
    count = c || 0;
  } catch(e) {
    // OFFLINE — utiliser cache local
    count = _appelsCache.filter(a => a.statut === 'pending').length;
  }
  const tab = document.getElementById('tab-appels');
  if (!tab) return;
  const old = tab.querySelector('.appels-badge');
  if (old) old.remove();
  if (count > 0) {
    const b = document.createElement('span');
    b.className = 'appels-badge';
    b.textContent = count;
    tab.appendChild(b);
  }
}

// ── Filtre appels ─────────────────────────────────────────────
function setAppelFilter(filter, el) {
  _appelFilter = filter;
  document.querySelectorAll('.appels-filter-btn').forEach(b => {
    b.classList.remove('on', 'on-acc');
  });
  if (el) {
    el.classList.add(filter === 'accepted' ? 'on-acc' : 'on');
  }
  renderAppelsList(_appelsCache);
}

// ── Calcul addition table — ADDITION REQUEST ──────────────────
async function calcAdditionTable(tableNom) {
  if (!ETAB || !tableNom) return null;
  try {
    const { data: cmds } = await db.from('commandes')
      .select('articles, montant, statut, employe_nom, heure, date_cmd, paiement')
      .eq('etab_id', ETAB.id)
      .eq('table_nom', tableNom)
      .eq('date_cmd', today())
      .neq('statut', 'Annulé')
      .order('created_at', { ascending: true });

    if (!cmds || !cmds.length) return { total: 0, lignes: [], cmds: [] };

    // ADDITION REQUEST — Calcul cumulé boissons + nourriture
    const totBoissons = cmds.reduce((acc, c) => {
      if (!c.articles) return acc;
      // Détecter les articles bar via mots-clés
      const arts = c.articles.split(',').map(a => a.trim());
      const barAmt = arts.filter(a => {
        const al = a.toLowerCase();
        return BAR_KEYWORDS.some(kw => al.includes(kw));
      });
      // Si articles_bar → utiliser montant bar (approx)
      if (c.articles_bar && c.articles_bar.trim()) {
        // Proportion : nb articles bar / total
        const ratioBar = barAmt.length / Math.max(arts.length, 1);
        return acc + Math.round(c.montant * ratioBar);
      }
      return acc;
    }, 0);

    const totCuisine = cmds.reduce((acc, c) => {
      if (!c.articles) return acc;
      const arts = c.articles.split(',').map(a => a.trim());
      const cuisAmt = arts.filter(a => {
        const al = a.toLowerCase();
        return CUISINE_KEYWORDS.some(kw => al.includes(kw));
      });
      if (c.articles_cuisine && c.articles_cuisine.trim()) {
        const ratioCuis = cuisAmt.length / Math.max(arts.length, 1);
        return acc + Math.round(c.montant * ratioCuis);
      }
      return acc;
    }, 0);

    const total = cmds.reduce((acc, c) => acc + (c.montant || 0), 0);

    // Lignes de détail
    const lignes = cmds.map(c => ({
      heure: c.heure || '',
      articles: c.articles || '',
      montant: c.montant || 0,
      employe: c.employe_nom || '?',
      paiement: c.paiement || ''
    }));

    return {
      total,
      totBoissons: totBoissons || Math.round(total * 0.6),
      totCuisine: totCuisine || (total - (totBoissons || Math.round(total * 0.6))),
      lignes,
      cmds,
      nbCommandes: cmds.length
    };
  } catch(e) {
    console.warn('[BarOS Appels] calcAdditionTable erreur:', e);
    return null;
  }
}

// ── Chargement des appels ─────────────────────────────────────
async function loadAppelsPers() {
  if (!ETAB) return;
  clearTimeout(_appelsTimer);

  let appels = [];
  try {
    const { data } = await db.from('appels')
      .select('*')
      .eq('etab_id', ETAB.id)
      .in('statut', ['pending', 'accepted'])
      .order('created_at', { ascending: true });
    appels = data || [];
    _appelsCache = appels; // HISTORIQUE APPELS — cache local
    _offlineMode = false;
  } catch(e) {
    // OFFLINE MODE — utiliser le cache
    appels = _appelsCache.filter(a => ['pending','accepted'].includes(a.statut));
    _offlineMode = true;
  }

  await updateAppelsBadge();

  // Afficher bande stats manager si rôle directeur/chef
  const rk = typeof getRoleKey === 'function' ? getRoleKey() : 'serveuse';
  const mgrStrip = document.getElementById('appels-mgr-strip');
  if (mgrStrip && (rk === 'directeur' || rk === 'chef' || rk === 'barman')) {
    mgrStrip.style.display = 'block';
    renderAppelsMgrStrip(appels);
  }

  renderAppelsList(appels);

  // Rafraîchir toutes les 12 secondes (timers)
  _appelsTimer = setTimeout(loadAppelsPers, 12000);
}

// ── Rendu liste appels ────────────────────────────────────────
function renderAppelsList(appels) {
  const list = document.getElementById('appels-list');
  if (!list) return;

  // Appliquer filtre
  let filtered = appels;
  if (_appelFilter === 'pending')  filtered = appels.filter(a => a.statut === 'pending');
  if (_appelFilter === 'accepted') filtered = appels.filter(a => a.statut === 'accepted');
  if (_appelFilter === 'addition') filtered = appels.filter(a => a.type === 'addition');
  if (_appelFilter === 'urgence')  filtered = appels.filter(a => a.type === 'urgence');

  if (!filtered.length) {
    const msg = _appelFilter === 'urgence' ? '✅ Aucune urgence'
               : _appelFilter === 'addition' ? '✅ Aucune demande d\'addition'
               : '✅ Aucun appel en attente';
    list.innerHTML = `<div class="appel-empty">${msg}${_offlineMode ? '<br><span style="font-size:10px;color:var(--wn)">Mode hors connexion</span>' : ''}</div>`;
    return;
  }

  const now = Date.now();
  list.innerHTML = filtered.map(a => buildAppelCard(a, now)).join('');
}

// ── Construire une carte appel ────────────────────────────────
function buildAppelCard(a, now) {
  const age    = Math.round((now - new Date(a.created_at).getTime()) / 1000);
  const mins   = Math.floor(age / 60);
  const secs   = age % 60;
  const ageStr = age < 60 ? age + 's' : mins + 'min' + (secs > 0 ? ' ' + secs + 's' : '');
  const isPend = a.statut === 'pending';
  const isAcc  = a.statut === 'accepted';
  const isUrgence = a.type === 'urgence';

  // Couleur timer selon urgence
  const timerCol = isUrgence ? 'var(--dg)' : isPend ? 'var(--dg)' : 'var(--wn)';
  const cardExtraClass = isUrgence && isPend ? 'urgence-pending' : a.statut;

  // Chip type
  const chipClass = APPEL_CHIPS[a.type] || 'atc-serveuse';
  const chipHtml = `<span class="appel-type-chip ${chipClass}">${APPEL_ICONS[a.type]||'🔔'} ${APPEL_LABELS[a.type]||a.type}</span>`;

  // Message client — CLIENT MESSAGE SYSTEM
  const msgHtml = a.message_client
    ? `<div class="appel-msg-box">💬 "${a.message_client}"</div>`
    : (a.message ? `<div class="appel-msg-box">💬 "${a.message}"</div>` : '');

  // Bannière prise en charge — SERVEUSE ASSIGNMENT
  let takenBanner = '';
  if (isAcc && a.prise_en_charge_par) {
    const isMine = CU && (a.employe_id === CU.id || a.prise_en_charge_par === CU.nom);
    takenBanner = `<div class="appel-taken-banner">
      👩‍💼 ${isMine ? '✓ Pris en charge par vous' : 'Déjà pris en charge par <strong>' + a.prise_en_charge_par + '</strong>'}
    </div>`;
  }

  // Section addition — ADDITION REQUEST
  let additionHtml = '';
  if (a.type === 'addition' && a.addition_detail) {
    try {
      const det = typeof a.addition_detail === 'string' ? JSON.parse(a.addition_detail) : a.addition_detail;
      additionHtml = `
        <div class="addition-card">
          <div style="font-size:11px;font-weight:700;color:var(--ac);margin-bottom:6px">💰 Détail addition — ${a.table_nom}</div>
          <div class="addition-line"><span>🍺 Boissons</span><span style="color:var(--inf)">${fmt(det.totBoissons||0)} F</span></div>
          <div class="addition-line"><span>🍽️ Cuisine</span><span style="color:var(--wn)">${fmt(det.totCuisine||0)} F</span></div>
          <div class="addition-line"><span style="color:var(--mt);font-size:10px">${det.nbCommandes||''} commande(s)</span></div>
          <div class="addition-total"><span>TOTAL</span><span style="color:var(--ac)">${fmt(det.total||0)} F</span></div>
        </div>`;
    } catch(e) {}
  }

  // Boutons selon statut et rôle
  const isMineToAccept = isPend;
  const isMineToComplete = isAcc && CU && (a.employe_id === CU.id || a.prise_en_charge_par === CU.nom);
  const isOtherTaken = isAcc && !isMineToComplete;

  let btnsHtml = '<div class="appel-btns">';
  if (isMineToAccept) {
    btnsHtml += `<button class="btn-appel-accept" onclick="acceptAppelPers('${a.id}')">✓ Prendre en charge</button>`;
    btnsHtml += `<button class="btn-appel-reject" onclick="rejectAppelPers('${a.id}')">✗ Refuser</button>`;
  }
  if (isMineToComplete) {
    btnsHtml += `<button class="btn-appel-done" onclick="completeAppelPers('${a.id}')">✅ Terminé</button>`;
  }
  if (isOtherTaken) {
    // Autre serveuse l'a pris — can still see invoice for addition
  }
  // Bouton facture si addition ou commande complète
  if (a.type === 'addition' || a.type === 'commande') {
    btnsHtml += `<button class="btn-appel-invoice" onclick="showInvoiceFromAppel('${a.id}','${(a.table_nom||'').replace(/'/g,"&#39;")}')">🧾 Voir facture</button>`;
  }
  if (a.type === 'addition' && !a.addition_detail) {
    btnsHtml += `<button class="btn-appel-invoice" style="background:rgba(200,245,90,.1);color:var(--ac);border-color:rgba(200,245,90,.3)" onclick="loadAndShowAddition('${a.id}','${(a.table_nom||'').replace(/'/g,"&#39;")}')">💰 Calculer addition</button>`;
  }
  btnsHtml += '</div>';

  return `
  <div class="appel-card ${cardExtraClass}" id="ac-${a.id}">
    <div class="appel-card-head">
      <div class="appel-icon" style="background:${isUrgence?'rgba(255,94,94,.15)':isPend?'rgba(255,94,94,.1)':'rgba(255,180,68,.1)'}">
        ${APPEL_ICONS[a.type]||'🔔'}
      </div>
      <div style="flex:1;min-width:0">
        ${chipHtml}
        <div style="font-size:14px;font-weight:800;margin-top:2px">🪑 ${a.table_nom}</div>
        <div style="font-size:10px;color:var(--mt);margin-top:1px">⏰ ${new Date(a.created_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div>
      </div>
      <div class="appel-timer" style="color:${timerCol};flex-shrink:0">⌛ ${ageStr}</div>
    </div>
    ${takenBanner}
    ${msgHtml}
    ${additionHtml}
    ${btnsHtml}
  </div>`;
}

// ── ACCEPTER un appel — SERVEUSE ASSIGNMENT ───────────────────
async function acceptAppelPers(id) {
  if (!CU) return;
  const nomServeuse = CU.nom;

  // SERVEUSE ASSIGNMENT — Marquer prise en charge avec nom + timestamp
  try {
    const { error } = await db.from('appels').update({
      statut: 'accepted',
      employe_id: CU.id,
      prise_en_charge_par: nomServeuse,
      prise_en_charge_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', id).eq('etab_id', ETAB.id); // [FIX] filtre etab_id

    if (error) { toast('❌ Erreur : ' + error.message, 'var(--dg)'); return; }
  } catch(e) {
    // OFFLINE — mettre à jour le cache
    const idx = _appelsCache.findIndex(a => a.id === id);
    if (idx >= 0) {
      _appelsCache[idx].statut = 'accepted';
      _appelsCache[idx].prise_en_charge_par = nomServeuse;
    }
  }

  toast('✓ Appel pris en charge', 'var(--gn)');

  // Si c'est une addition → calculer automatiquement
  const appel = _appelsCache.find(a => a.id === id);
  if (appel && appel.type === 'addition') {
    loadAndShowAddition(id, appel.table_nom);
    return;
  }

  loadAppelsPers();
}

// ── REFUSER un appel ─────────────────────────────────────────
async function rejectAppelPers(id) {
  // TABLE CALL MANAGEMENT — Le refus remet l'appel disponible pour d'autres
  try {
    await db.from('appels').update({
      statut: 'rejected',
      updated_at: new Date().toISOString()
    }).eq('id', id).eq('etab_id', ETAB.id); // [FIX] filtre etab_id
    // Remettre en pending après 5s pour que d'autres puissent le prendre
    setTimeout(async () => {
      await db.from('appels').update({ statut: 'pending' }).eq('id', id).eq('statut', 'rejected').eq('etab_id', ETAB.id);
    }, 5000);
  } catch(e) {
    const idx = _appelsCache.findIndex(a => a.id === id);
    if (idx >= 0) _appelsCache.splice(idx, 1);
  }
  toast('↩ Appel refusé — sera visible dans 5s', 'var(--wn)');
  loadAppelsPers();
}

// ── TERMINER un appel ─────────────────────────────────────────
async function completeAppelPers(id) {
  // HISTORIQUE APPELS — Sauvegarder completed avec timestamp
  try {
    await db.from('appels').update({
      statut: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', id).eq('etab_id', ETAB.id); // [FIX] filtre etab_id
  } catch(e) {
    const idx = _appelsCache.findIndex(a => a.id === id);
    if (idx >= 0) _appelsCache[idx].statut = 'completed';
  }
  toast('✅ Appel terminé !', 'var(--gn)');
  loadAppelsPers();
}

// ── CALCULER et afficher addition — ADDITION REQUEST ─────────
async function loadAndShowAddition(appelId, tableNom) {
  toast('⏳ Calcul de l\'addition...', 'var(--inf)');

  const det = await calcAdditionTable(tableNom);
  if (!det) { toast('❌ Impossible de calculer', 'var(--dg)'); return; }

  // Sauvegarder le détail dans l'appel — HISTORIQUE APPELS
  try {
    await db.from('appels').update({
      addition_detail: JSON.stringify(det),
      updated_at: new Date().toISOString()
    }).eq('id', appelId).eq('etab_id', ETAB.id); // [FIX] filtre etab_id
  } catch(e) {}

  // Mettre à jour cache local
  const idx = _appelsCache.findIndex(a => a.id === appelId);
  if (idx >= 0) _appelsCache[idx].addition_detail = JSON.stringify(det);

  // Afficher modal addition
  showAdditionModal(tableNom, det, appelId);
  loadAppelsPers();
}

// ── Modal addition — ADDITION REQUEST ────────────────────────
function showAdditionModal(tableNom, det, appelId) {
  const old = document.getElementById('addition-modal-overlay');
  if (old) old.remove();

  const ov = document.createElement('div');
  ov.id = 'addition-modal-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:8000;display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML = `
    <div style="background:#0f0f18;border:1px solid rgba(255,255,255,.1);border-radius:20px;width:100%;max-width:340px;overflow:hidden">
      <div style="background:linear-gradient(135deg,rgba(200,245,90,.1),rgba(0,0,0,0));padding:18px 18px 14px;border-bottom:1px solid rgba(255,255,255,.07)">
        <div style="font-size:11px;color:var(--mt);text-transform:uppercase;letter-spacing:.1em">Demande d'addition</div>
        <div style="font-size:22px;font-weight:800;margin-top:4px">🪑 ${tableNom}</div>
      </div>
      <div style="padding:14px 18px">
        <div style="font-size:11px;color:var(--mt);margin-bottom:10px">${det.nbCommandes || ''} commande(s) non payée(s)</div>
        <div class="addition-line" style="padding:6px 0"><span>🍺 Boissons</span><span style="color:var(--inf)">${fmt(det.totBoissons||0)} F</span></div>
        <div class="addition-line" style="padding:6px 0"><span>🍽️ Cuisine</span><span style="color:var(--wn)">${fmt(det.totCuisine||0)} F</span></div>
        <div class="addition-total" style="font-size:18px;margin-top:10px">
          <span>💰 TOTAL</span>
          <span style="color:var(--ac)">${fmt(det.total)} F</span>
        </div>
      </div>
      <div style="display:flex;border-top:1px solid rgba(255,255,255,.07)">
        <button onclick="showInvoiceFromAppel('${appelId}','${tableNom.replace(/'/g,"&#39;")}')" style="flex:2;padding:14px;background:rgba(200,245,90,.1);color:var(--ac);border:none;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">🧾 Voir & Imprimer facture</button>
        <button onclick="document.getElementById('addition-modal-overlay').remove()" style="flex:1;padding:14px;background:rgba(255,255,255,.04);color:var(--mt);border:none;font-size:12px;cursor:pointer;font-family:inherit;border-left:1px solid rgba(255,255,255,.07)">✕ Fermer</button>
      </div>
    </div>`;
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
}

// ── Voir facture depuis un appel — SERVEUSE VIEW ──────────────
async function showInvoiceFromAppel(appelId, tableNom) {
  // ADDITION REQUEST — Récupérer la dernière commande de la table
  try {
    const { data: cmds } = await db.from('commandes')
      .select('*')
      .eq('etab_id', ETAB.id)
      .eq('table_nom', tableNom)
      .eq('date_cmd', today())
      .neq('statut', 'Annulé')
      .order('created_at', { ascending: false })
      .limit(1);

    if (!cmds || !cmds.length) {
      toast('❌ Aucune commande trouvée pour ' + tableNom, 'var(--dg)');
      return;
    }

    // Utiliser le système de facture existant — ne pas casser impression
    showReceipt(cmds[0]);
    document.getElementById('addition-modal-overlay')?.remove();
  } catch(e) {
    toast('❌ Erreur chargement facture', 'var(--dg)');
  }
}

// ── Stats manager appels — MODULE MANAGER ─────────────────────
async function getAppelsMgrStats() {
  if (!ETAB) return null;
  try {
    const today_str = today();
    // Tous les appels du jour (y compris completed)
    const { data: all } = await db.from('appels')
      .select('*')
      .eq('etab_id', ETAB.id)
      .gte('created_at', today_str + 'T00:00:00');

    const appels = all || [];
    const enAttente  = appels.filter(a => a.statut === 'pending').length;
    const acceptes   = appels.filter(a => ['accepted','completed'].includes(a.statut));
    const ignored    = appels.filter(a => a.statut === 'rejected').length;
    const total      = appels.length;

    // Temps moyen de réponse (accepted → prise_en_charge_at - created_at)
    const resTimes = acceptes
      .filter(a => a.prise_en_charge_at && a.created_at)
      .map(a => (new Date(a.prise_en_charge_at) - new Date(a.created_at)) / 1000);
    const avgRes = resTimes.length
      ? Math.round(resTimes.reduce((a, b) => a + b, 0) / resTimes.length)
      : 0;

    // Meilleure serveuse (qui a pris le plus d'appels)
    const byServeuse = {};
    acceptes.forEach(a => {
      const n = a.prise_en_charge_par || '?';
      byServeuse[n] = (byServeuse[n] || 0) + 1;
    });
    const bestServeuse = Object.entries(byServeuse).sort((a, b) => b[1] - a[1])[0];

    return { enAttente, total, avgRes, ignored, bestServeuse, acceptesCount: acceptes.length };
  } catch(e) {
    return null;
  }
}

// ── Bande stats rapide dans la vue appels (manager) ───────────
async function renderAppelsMgrStrip(appels) {
  const strip = document.getElementById('appels-mgr-strip');
  if (!strip) return;
  const pending = appels.filter(a => a.statut === 'pending').length;
  const accepted = appels.filter(a => a.statut === 'accepted').length;
  strip.innerHTML = `
    <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:6px">
      <div class="appels-stat-card" style="min-width:100px">
        <div class="appels-stat-v" style="color:var(--dg)">${pending}</div>
        <div class="appels-stat-l">🔴 En attente</div>
      </div>
      <div class="appels-stat-card" style="min-width:100px">
        <div class="appels-stat-v" style="color:var(--wn)">${accepted}</div>
        <div class="appels-stat-l">🟡 En cours</div>
      </div>
      <div class="appels-stat-card" style="min-width:100px">
        <div class="appels-stat-v" style="color:var(--ac)">${appels.filter(a=>a.type==='addition').length}</div>
        <div class="appels-stat-l">💰 Additions</div>
      </div>
      <div class="appels-stat-card" style="min-width:100px">
        <div class="appels-stat-v" style="color:var(--dg)">${appels.filter(a=>a.type==='urgence').length}</div>
        <div class="appels-stat-l">🚨 Urgences</div>
      </div>
    </div>`;
}

// ── Injection stats appels dans vue Direction/Chef — MODULE MANAGER ──
async function injectAppelsMgrStats() {
  const stats = await getAppelsMgrStats();
  if (!stats) return;

  const mins = Math.floor(stats.avgRes / 60);
  const secs = stats.avgRes % 60;
  const avgResStr = stats.avgRes > 0 ? (mins > 0 ? mins + 'min' : secs + 's') : '—';

  const html = `
    <div id="appels-dir-section" style="margin-top:14px">
      <div class="sec-lbl" style="margin-bottom:8px">📞 Appels clients — Aujourd'hui</div>
      <div class="appels-stats-row">
        <div class="appels-stat-card"><div class="appels-stat-v" style="color:var(--dg)">${stats.enAttente}</div><div class="appels-stat-l">🔴 En attente</div></div>
        <div class="appels-stat-card"><div class="appels-stat-v" style="color:var(--ac)">${stats.total}</div><div class="appels-stat-l">📊 Total appels</div></div>
        <div class="appels-stat-card"><div class="appels-stat-v" style="color:var(--inf)">${avgResStr}</div><div class="appels-stat-l">⏱ Temps moyen</div></div>
        <div class="appels-stat-card"><div class="appels-stat-v" style="color:var(--wn)">${stats.ignored}</div><div class="appels-stat-l">↩ Refusés</div></div>
      </div>
      ${stats.bestServeuse ? `<div style="background:rgba(200,245,90,.07);border:1px solid rgba(200,245,90,.2);border-radius:var(--rs);padding:10px 12px;font-size:12px">
        🏆 Meilleure réponse : <strong style="color:var(--ac)">${stats.bestServeuse[0]}</strong>
        <span style="color:var(--mt)"> · ${stats.bestServeuse[1]} appel(s) traité(s)</span>
      </div>` : ''}
    </div>`;

  // Injecter dans view-direction
  const dirView = document.getElementById('view-direction');
  if (dirView) {
    const existing = dirView.querySelector('#appels-dir-section');
    if (existing) existing.remove();
    const scroll = dirView.querySelector('.scroll');
    if (scroll) scroll.insertAdjacentHTML('beforeend', html);
  }
  // Injecter dans view-equipe si chef
  const equipeView = document.getElementById('view-equipe');
  if (equipeView) {
    const existing2 = equipeView.querySelector('#appels-dir-section');
    if (existing2) existing2.remove();
    const scroll2 = equipeView.querySelector('.scroll');
    if (scroll2) scroll2.insertAdjacentHTML('beforeend', html.replace('id="appels-dir-section"', 'id="appels-dir-section"'));
  }
}
