// ── Config ────────────────────────────────────────────────────
const SB_URL = 'https://fijmxmaupjsdyqgynrem.supabase.co';
const SB_KEY = 'sb_publishable_B3NJtcctuVVbvE_S44oP9A_qiMHK1dd';
const { createClient } = supabase;
const db = createClient(SB_URL, SB_KEY);

// ── State ─────────────────────────────────────────────────────
let TABLE_DATA  = null;
let ETAB_DATA   = null;
let CURRENT_APPEL = null;  // appel en cours de cette session
let _appel_rt   = null;    // channel realtime
let _timerIntvl = null;

// ── Init ──────────────────────────────────────────────────────
async function init() {
  const params = new URLSearchParams(window.location.search);
  const tableId = params.get('t');

  if (!tableId) {
    showError('QR invalide', 'Ce lien ne contient pas d\'identifiant de table.', '🔗');
    hideSplash();
    return;
  }

  // Charger les données de la table
  let { data: tbl, error } = await db
    .from('tables_config')
    .select('*')
    .eq('id', tableId)
    .single();
  // Hors ligne : on réutilise la table déjà vue sur cet appareil
  if (error || !tbl) {
    try { const c = JSON.parse(localStorage.getItem('baros_tbl_' + tableId) || 'null'); if (c && !navigator.onLine) { tbl = c; error = null; } } catch (e) {}
  } else {
    try { localStorage.setItem('baros_tbl_' + tableId, JSON.stringify(tbl)); } catch (e) {}
  }

  if (error || !tbl) {
    showError('Table introuvable', 'Ce QR code ne correspond à aucune table enregistrée.', '❌');
    hideSplash();
    return;
  }

  if (!tbl.actif) {
    showError('Table inactive', 'Cette table n\'est pas disponible pour le moment.', '🚫');
    hideSplash();
    return;
  }

  TABLE_DATA = tbl;

  // Charger l'établissement
  const { data: etab } = await db.from('etabs').select('nom').eq('id', tbl.etab_id).single();
  ETAB_DATA = etab;

  renderTableInfo();
  checkPendingAppel();
  subscribeRealtime();
  hideSplash();
  document.getElementById('main-wrap').style.display = 'block';
  if (typeof payRefreshAction === 'function') payRefreshAction();
  if (typeof accueilStart === 'function') accueilStart();   // identification + accueil animé
}

// ── Rendu infos table ─────────────────────────────────────────
function renderTableInfo() {
  const t = TABLE_DATA;
  const nom  = document.getElementById('tbl-nom');
  const zone = document.getElementById('tbl-zone');
  const etab = document.getElementById('tbl-etab');
  const badge = document.getElementById('tbl-badge');

  nom.textContent   = t.nom;
  zone.textContent  = t.zone || '';
  etab.textContent  = ETAB_DATA?.nom || '';
  zone.style.display = t.zone ? '' : 'none';

  const statut = t.statut || 'libre';
  const badgeMap = {
    libre:    { cls:'libre',    txt:'● Libre'    },
    occupee:  { cls:'occupee',  txt:'● Occupée'  },
    reservee: { cls:'reservee', txt:'● Réservée' },
  };
  const b = badgeMap[statut] || badgeMap.libre;
  badge.className = 'table-badge ' + b.cls;
  badge.textContent = b.txt;

  document.title = 'BarOS — ' + t.nom + (t.zone ? ' · ' + t.zone : '');
}

// ── Vérifier appel en cours (session stockée localement) ──────
async function checkPendingAppel() {
  const savedId = sessionStorage.getItem('baros_appel_' + TABLE_DATA.id);
  if (!savedId) return;

  const { data: appel } = await db.from('appels').select('*').eq('id', savedId).single();
  if (appel && ['pending','accepted'].includes(appel.statut)) {
    CURRENT_APPEL = appel;
    showAppelStatus(appel);
  } else {
    sessionStorage.removeItem('baros_appel_' + TABLE_DATA.id);
  }
}

// ── Envoyer un appel simple (sans message) ────────────────────
async function sendAppel(type) {
  if (CURRENT_APPEL) {
    showToast('Un appel est déjà en cours pour cette table', 'var(--wn)');
    return;
  }
  await submitAppel(type, '');
}

// ── Bottom sheet message ──────────────────────────────────────
let _sheetType = 'commande';

function openMessageSheet(type) {
  if (CURRENT_APPEL) {
    showToast('Un appel est déjà en cours', 'var(--wn)');
    return;
  }
  _sheetType = type;
  const titles = { commande:'Passer une commande', message:'Envoyer un message' };
  const placeholders = {
    commande: 'Ex: 1 Heineken, 2 Fanta, 1 eau minérale…',
    message:  'Votre demande spéciale…',
  };
  document.getElementById('sheet-title').textContent = titles[type] || type;
  const inp = document.getElementById('msg-input');
  inp.placeholder = placeholders[type] || '';
  inp.value = '';
  document.getElementById('msg-overlay').classList.add('open');
  setTimeout(() => inp.focus(), 300);
}

function closeMsgSheet() {
  document.getElementById('msg-overlay').classList.remove('open');
}

async function sendMsgAppel() {
  const msg = (document.getElementById('msg-input').value || '').trim();
  if (!msg) {
    showToast('Merci de saisir votre ' + (_sheetType === 'commande' ? 'commande' : 'message'), 'var(--wn)');
    return;
  }
  const btn = document.getElementById('sheet-send-btn');
  btn.disabled = true; btn.textContent = '…';
  await submitAppel(_sheetType, msg);
  btn.disabled = false; btn.textContent = '✓ Envoyer';
  closeMsgSheet();
}

// ── Soumettre l'appel à Supabase ──────────────────────────────
async function submitAppel(type, message) {
  const { data: appel, error } = await db.from('appels').insert({
    etab_id:   TABLE_DATA.etab_id,
    table_id:  TABLE_DATA.id,
    table_nom: TABLE_DATA.nom,
    type,
    message: (typeof accPrefix === 'function' ? accPrefix(message) : message),
    statut: 'pending',
  }).select().single();

  if (error) {
    showToast('Erreur d\'envoi — vérifiez votre connexion', 'var(--dg)');
    return;
  }

  CURRENT_APPEL = appel;
  sessionStorage.setItem('baros_appel_' + TABLE_DATA.id, appel.id);
  showAppelStatus(appel);
  showToast('Appel envoyé ! 🔔', 'var(--gn)');
}

// ── Affichage statut appel ────────────────────────────────────
function showAppelStatus(appel) {
  const statusEl = document.getElementById('appel-status');
  statusEl.classList.add('show');

  const icons   = { serveuse:'🔔', addition:'💳', commande:'🛒', message:'💬' };
  const configs = {
    pending:   { title:'Appel envoyé',         sub:'Une serveuse arrive bientôt…',   bar:'35%', col:'var(--wn)', ic: icons[appel.type]||'🔔' },
    accepted:  { title:'Pris en charge ✓',     sub:'Une serveuse est en route !',     bar:'70%', col:'var(--inf)', ic:'🏃' },
    completed: { title:'Traité ✅',             sub:'Appel terminé. Merci !',          bar:'100%', col:'var(--gn)', ic:'✅' },
    cancelled: { title:'Annulé',               sub:'Cet appel a été annulé.',         bar:'100%', col:'var(--mt)', ic:'✕' },
  };
  const cfg = configs[appel.statut] || configs.pending;

  document.getElementById('as-ic').textContent    = cfg.ic;
  document.getElementById('as-title').textContent = cfg.title;
  document.getElementById('as-sub').textContent   = cfg.sub;
  document.getElementById('as-bar').style.width   = cfg.bar;
  document.getElementById('as-bar').style.background = cfg.col;

  // Démarrer le timer
  clearInterval(_timerIntvl);
  if (['pending','accepted'].includes(appel.statut)) {
    const start = new Date(appel.created_at).getTime();
    const updateTimer = () => {
      const age = Math.round((Date.now() - start) / 1000);
      const s   = age < 60 ? age + 's' : Math.floor(age/60) + 'min ' + (age%60) + 's';
      const el  = document.getElementById('as-timer');
      if (el) el.textContent = 'Attente : ' + s;
    };
    updateTimer();
    _timerIntvl = setInterval(updateTimer, 1000);
    setActionsBusy(true);
  } else {
    document.getElementById('as-timer').textContent = '';
    setActionsBusy(false);
    CURRENT_APPEL = null;
    sessionStorage.removeItem('baros_appel_' + TABLE_DATA.id);
    // Masquer après 4 secondes si terminé/annulé
    setTimeout(() => { statusEl.classList.remove('show'); }, 4000);
  }
}

function setActionsBusy(busy) {
  document.querySelectorAll('.action-btn').forEach(btn => {
    btn.classList.toggle('disabled', busy);
  });
}

// ── Realtime : écouter les mises à jour de l'appel en cours ──
function subscribeRealtime() {
  _appel_rt = db.channel('table-client-' + TABLE_DATA.id)
    .on('postgres_changes',
      { event:'UPDATE', schema:'public', table:'appels', filter:`table_id=eq.${TABLE_DATA.id}` },
      payload => {
        const updated = payload.new;
        if (CURRENT_APPEL && updated.id === CURRENT_APPEL.id) {
          CURRENT_APPEL = updated;
          showAppelStatus(updated);
          if (updated.statut === 'accepted') {
            showToast('✓ Votre appel a été pris en charge !', 'var(--gn)');
          }
          if (updated.statut === 'completed') {
            clearInterval(_timerIntvl);
            showToast('✅ Appel traité. Merci !', 'var(--gn)');
          }
        }
      })
    .on('postgres_changes',
      { event:'UPDATE', schema:'public', table:'tables_config', filter:`id=eq.${TABLE_DATA.id}` },
      payload => {
        TABLE_DATA = { ...TABLE_DATA, ...payload.new };
        renderTableInfo();
      })
    .subscribe(status => {
      const dot = document.getElementById('conn-dot');
      if (dot) dot.style.background = status === 'SUBSCRIBED' ? 'var(--gn)' : 'var(--wn)';
    });
}

// ── Helpers ───────────────────────────────────────────────────
function hideSplash() {
  const s = document.getElementById('splash');
  s.classList.add('hide');
  setTimeout(() => s.style.display = 'none', 450);
}

function showError(title, sub, ic) {
  document.getElementById('err-ic').textContent    = ic || '❌';
  document.getElementById('err-title').textContent = title;
  document.getElementById('err-sub').textContent   = sub;
  document.getElementById('err-wrap').style.display  = 'block';
  document.getElementById('main-wrap').style.display = 'none';
}

let _toastTimer = null;
function showToast(msg, col) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.borderColor = col || 'var(--bd2)';
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ── Start ─────────────────────────────────────────────────────
window.addEventListener('load', init);

// ── Connexion réseau ──────────────────────────────────────────
window.addEventListener('online',  () => { const d=document.getElementById('conn-dot'); if(d)d.style.background='var(--gn)'; });
window.addEventListener('offline', () => { const d=document.getElementById('conn-dot'); if(d)d.style.background='var(--dg)'; showToast('Hors-ligne — reconnexion…','var(--dg)'); });
