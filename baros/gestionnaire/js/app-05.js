const SB_URL = 'https://fijmxmaupjsdyqgynrem.supabase.co';
const SB_KEY = 'sb_publishable_B3NJtcctuVVbvE_S44oP9A_qiMHK1dd';
const { createClient } = supabase;
const db = createClient(SB_URL, SB_KEY);
window.db = db; // requis par le module hors ligne (js/app-11.js)

// ===== ADMIN =====
const ADMIN_EMAILS = ['olockbelang@gmail.com', 'resineartpartners@gmail.com'];
const isAdmin = () => CU && ADMIN_EMAILS.includes(CU.email?.toLowerCase().trim());

let CU = null, ETAB = null, EMPS = [], ARTICLES = [], LOGO = null;
let articleSearch = '', menuCatFilterMgr = 'Tous';
// Normalise une ligne "stock" en objet "article" compatible avec l'ancien format "produit"
// (prix <- prix_vente, icone/type_service/favori/mots_cles/actif avec valeurs par défaut)
function normArticle(s) {
  return {
    ...s,
    prix: s.prix_vente || 0,
    icone: s.icone || '🍶',
    type_service: s.type_service || _catToTypeService(s.categorie),
    favori: !!s.favori,
    mots_cles: s.mots_cles || '',
    actif: s.actif !== false, // activation/désactivation manuelle, indépendante de la quantité
  };
}
const ARTICLE_CATS = ['Boissons gazeuses','Bières','Vins','Whiskys','Liqueurs','Cocktails','Jus','Eau','Café','Thé','Petit-déjeuner','Entrées','Plats','Grillades','Poissons','Accompagnements','Desserts','Glaces','Chichas','Divers'];
// Regroupe les rafales d'événements Realtime (ex: import en masse de dizaines d'articles)
// en un seul rechargement, pour limiter le nombre de requêtes Supabase.
const _debounceTimers = {};
function _debounce(key, fn, delay) {
  clearTimeout(_debounceTimers[key]);
  _debounceTimers[key] = setTimeout(fn, delay);
}
let selP = new Set(), cmdTot = 0;
let PERIODE = 'tout'; // 'tout' | 'jour' | 'nuit'

// Plages horaires des services (modifiables)
const H_JOUR = { debut: '06:00', fin: '17:59' };
// Journée = 06:00→17:59 · Soir/Nuit = 18:00→05:59

function filterPeriode(cmds) {
  if (PERIODE === 'tout') return cmds;
  return cmds.filter(c => {
    const h = (c.heure || '00:00').slice(0, 5);
    if (PERIODE === 'jour') return h >= H_JOUR.debut && h <= H_JOUR.fin;
    if (PERIODE === 'nuit') return h < H_JOUR.debut || h > H_JOUR.fin;
    return true;
  });
}

function setPeriode(p) {
  PERIODE = p;
  ['tout','jour','nuit'].forEach(id => {
    const b = document.getElementById('pt-'+id);
    if (b) b.classList.toggle('active', id === p);
  });
  const labels = { tout:"📅 Aujourd'hui", jour:'🌤 Journée (06h–18h)', nuit:'🌙 Soir / Nuit (18h→)' };
  ['lv-ca-lbl','kca-lbl','kcmd-lbl'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = labels[p];
  });
  renderDash();
}

const fmt = n => Math.round(n||0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const ini = n => (n||'?').split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
const today = () => new Date().toISOString().slice(0,10);
/* [FIX-COMPAT] toTimeString() varie sur Safari macOS — format HH:MM explicite */
const nowT = () => { const d=new Date(); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); };
const daysSince = d => Math.floor((new Date()-new Date(d))/86400000);

// Formate à la saisie : insère les "/" automatiquement → JJ/MM/AAAA
function fmtDateInput(el) {
  let v = el.value.replace(/\D/g, '');
  if (v.length > 2) v = v.slice(0,2) + '/' + v.slice(2);
  if (v.length > 5) v = v.slice(0,5) + '/' + v.slice(5,9);
  el.value = v;
}
// JJ/MM/AAAA → AAAA-MM-JJ (pour Supabase). Accepte aussi AAAA-MM-JJ déjà propre.
function parseDate(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
// AAAA-MM-JJ → JJ/MM/AAAA (affichage dans le formulaire)
function displayDate(s) {
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

const COLORS_EMP = ['#7c6cff','#c8f55a','#5ab4ff','#ff5e5e','#ffb444','#4ade80','#f97316','#ec4899'];

function showN(msg, tp='success') {
  const n=document.getElementById('notif');
  const cols={success:'var(--gn)',warn:'var(--wn)',error:'var(--dg)',info:'var(--inf)'};
  n.style.borderColor=cols[tp]||cols.success;
  document.getElementById('notif-msg').textContent=msg;
  n.classList.add('show');setTimeout(()=>n.classList.remove('show'),3500);
}

function setSyncStatus(ok, msg) {
  document.getElementById('sync-dot').style.background = ok?'var(--gn)':'var(--wn)';
  document.getElementById('sync-lbl').textContent = msg || (ok?'Supabase connecté':'Hors-ligne');
}

function chartBars(el, vals, lbls, h=75) {
  if(!el)return; el.innerHTML='';
  const mx=Math.max(...vals,1);
  vals.forEach((v,i)=>{
    const ht=Math.max(3,Math.round((v/mx)*(h-6)));
    const last=i===vals.length-1;
    const d=document.createElement('div'); d.className='bc';
    d.innerHTML=`<div class="bar${last?' tod':v<mx*.35?' low':''}" style="height:${ht}px" title="${fmt(v)} FCFA"></div><div class="blbl">${lbls[i]}</div>`;
    el.appendChild(d);
  });
}

// ===== AUTH =====
function switchTab(t) {
  document.querySelectorAll('.auth-tab').forEach((el,i)=>el.classList.toggle('on',i===(t==='login'?0:1)));
  document.getElementById('tab-login').classList.toggle('hide', t!=='login');
  document.getElementById('tab-register').classList.toggle('hide', t!=='register');
}

async function doLogin() {
  // [SEC C2] Login sécurisé — rate limiting + hash sha256 + log audit
  const email = document.getElementById('l-email').value.trim().toLowerCase();
  const pwd   = document.getElementById('l-pwd').value;
  if (!email || !pwd) { showErr('l', 'Remplis tous les champs'); return; }

  // Rate limiting côté client
  const rateCheck = BarOSSec.checkLoginRateLimit(email);
  if (!rateCheck.allowed) {
    const minutes = Math.ceil((rateCheck.lockedUntil - Date.now()) / 60000);
    showErr('l', `Trop de tentatives. Réessayez dans ${minutes} min.`);
    return;
  }

  setLoading('l-btn', true);
  const {data, error} = await db.from('sessions')
    .select('id,email,nom,role,etab_id,couleur,is_active,pwd_hash')
    .eq('email', email).single();

  if (error || !data) {
    BarOSSec.recordLoginAttempt(email, false);
    await BarOSSec.logSecurityEvent(db, 'login_fail', { email, reason: 'email_not_found' });
    showErr('l', 'Email non trouvé');
    setLoading('l-btn', false); return;
  }

  // [SEC C2] Vérification mot de passe — compatible btoa (legacy) + sha256 (nouveau)
  const passwordOk = await BarOSSec.verifyPassword(pwd, data.pwd_hash);
  if (!passwordOk) {
    // BAROS LOGIN FIX — si baros-security.js n'a pas chargé, le fallback vérifie
    // avec un hachage différent de celui utilisé à la création du compte : le mot
    // de passe correct serait rejeté à tort. On ne pénalise pas l'utilisateur dans
    // ce cas et on l'informe de la vraie cause.
    if (BarOSSec.__isFallback) {
      showErr('l', '⚠️ Module de sécurité non chargé — vérification impossible. Rechargez la page avec une connexion Internet active.');
      setLoading('l-btn', false); return;
    }
    BarOSSec.recordLoginAttempt(email, false);
    await BarOSSec.logSecurityEvent(db, 'login_fail', { email, reason: 'wrong_password' });
    const remaining = BarOSSec.checkLoginRateLimit(email).remaining;
    showErr('l', `Mot de passe incorrect. ${remaining} tentative(s) restante(s).`);
    setLoading('l-btn', false); return;
  }

  // Vérification activation (sauf admin)
  if (data.is_active === false && !ADMIN_EMAILS.includes(email)) {
    showErr('l', '⛔ Compte non activé — contactez l\'administrateur.');
    setLoading('l-btn', false); return;
  }

  // Migration progressive btoa → sha256
  if (data.pwd_hash && !data.pwd_hash.startsWith('sha256:')) {
    const newHash = await BarOSSec.hashPassword(pwd);
    await db.from('sessions').update({ pwd_hash: newHash }).eq('id', data.id);
  }

  BarOSSec.recordLoginAttempt(email, true);
  await db.from('sessions').update({ last_login_at: new Date().toISOString() }).eq('id', data.id);
  await BarOSSec.logSecurityEvent(db, 'login_success', { email, etab_id: data.etab_id, role: data.role });

  // [SEC H3] Session sans pwd_hash, avec expiration
  BarOSSec.saveSecureSession(data);
  // BAROS LOGIN FIX — startApp() peut lever une exception (Realtime, cache local,
  // etc., variable selon navigateur/contexte file://). Sans ce filet, une erreur ici
  // laissait le bouton bloqué sur "Chargement..." sans aucun message, alors que le
  // mot de passe était pourtant correct.
  try {
    await startApp(data);
  } catch (e) {
    console.error('[BarOS] startApp erreur après connexion réussie:', e);
    showErr('l', '⚠️ Connexion réussie mais erreur de chargement — réessayez ou rechargez la page.');
  }
  setLoading('l-btn', false);
}

async function doRegister() {
  // Diagnostic inscription : jamais de blocage silencieux, erreur lisible et durable
  try {
    await _doRegisterInner();
  } catch (e) {
    console.error('[BarOS] doRegister exception:', e);
    const msg = String((e && e.message) || e);
    const reseau = /fetch|network|failed|load/i.test(msg);
    showErr('r', reseau
      ? '⚠️ Connexion à la base impossible (' + msg + '). Vérifiez Internet et que le projet Supabase est actif (non mis en pause).'
      : '⚠️ Erreur inattendue : ' + msg, 20000);
    setLoading('r-btn', false);
  }
}

function _registerDbError(prefix, err) {
  const m = (err && (err.message || err.details || err.hint)) || 'inconnue';
  const rls = /row-level security|permission denied|42501|policy/i.test(m + ' ' + (err && err.code));
  const col = /column|schema cache|PGRST204|42703/i.test(m + ' ' + (err && err.code));
  let msg = prefix + m + (err && err.code ? ' [' + err.code + ']' : '');
  if (rls) msg += ' → Supabase refuse l\'écriture (droits RLS) : il faut autoriser l\'insertion sur cette table.';
  else if (col) msg += ' → Une colonne attendue n\'existe pas dans la table Supabase.';
  return msg;
}

async function _doRegisterInner() {
  const etab=document.getElementById('r-etab').value.trim();
  const nom=document.getElementById('r-nom').value.trim();
  const email=document.getElementById('r-email').value.trim().toLowerCase();
  const pwd=document.getElementById('r-pwd').value;
  const type=document.getElementById('r-type').value;
  if(!etab||!nom||!email||!pwd){showErr('r','Remplis tous les champs');return;}
  if(pwd.length<6){showErr('r','Mot de passe: min. 6 caractères');return;}
  setLoading('r-btn',true);
  const {data:existing} = await db.from('sessions').select('id').eq('email',email).single();
  if(existing){showErr('r','Email déjà utilisé');setLoading('r-btn',false);return;}
  const {data:etabData,error:etabErr} = await db.from('etabs').insert({nom:etab,ville:'Douala',type,owner_email:email,tables_cfg:'Table 1,Table 2,Table 3,Table 4,Comptoir,VIP,Terrasse'}).select().single();
  if(etabErr){showErr('r',_registerDbError('Erreur création établissement : ',etabErr),20000);setLoading('r-btn',false);return;}
  const {data:sessData,error:sessErr} = await db.from('sessions').insert({email,nom,pwd_hash:await BarOSSec.hashPassword(pwd),etab_id:etabData.id,role:'Manager',couleur:COLORS_EMP[0],is_active:false}).select().single();
  if(sessErr){showErr('r',_registerDbError('Erreur création compte : ',sessErr),20000);setLoading('r-btn',false);return;}
  // Si admin → accès direct ; sinon attendre activation
  if(ADMIN_EMAILS.includes(email.toLowerCase().trim())){
    // Activer automatiquement les comptes admin
    await db.from('sessions').update({is_active:true}).eq('id',sessData.id);
    sessData.is_active=true;
    BarOSSec.saveSecureSession(sessData);
    await startApp(sessData);
  } else {
    showErr('r','✅ Compte créé ! En attente d\'activation par l\'administrateur.');
    document.getElementById('r-btn').textContent='Compte créé';
  }
  setLoading('r-btn',false);
}

async function demoLogin() {
  const demoEmail='demo@baros.app';
  let {data} = await db.from('sessions').select('*').eq('email',demoEmail).single();
  if(!data) {
    const {data:etabD} = await db.from('etabs').insert({nom:'Le Complexe Étoile (Démo)',ville:'Douala',type:'Boîte de nuit',owner_email:demoEmail,tables_cfg:'Table 1,Table 2,Table 3,Table 4,VIP,Terrasse,Comptoir'}).select().single();
    if(!etabD){showN('Erreur démo','error');return;}
    const {data:sessD} = await db.from('sessions').insert({email:demoEmail,nom:'Manager Démo',pwd_hash:await BarOSSec.hashPassword('demo123'),etab_id:etabD.id,role:'Manager',couleur:COLORS_EMP[0]}).select().single();
    data=sessD;
  }
  if(!data){showN('Erreur démo','error');return;}
  BarOSSec.saveSecureSession(data);
  await startApp(data);
}

function showErr(prefix, msg, dur) {
  const el=document.getElementById(prefix+'-err');
  if(el){el.textContent=msg;clearTimeout(el._t);el._t=setTimeout(()=>el.textContent='',dur||4000);}
}
function setLoading(btnId, loading) {
  const btn=document.getElementById(btnId);
  if(btn){btn.disabled=loading;btn.innerHTML=loading?'<span class="spin">⟳</span> Chargement...':(btnId==='l-btn'?'Se connecter':'Créer mon compte');}
}

async function doLogout() {
  BarOSSec.clearSecureSession();
  await BarOSSec.logSecurityEvent(db, 'logout', { email: CU?.email, etab_id: ETAB?.id });
  CU=null;ETAB=null;EMPS=[];ARTICLES=[];
  document.getElementById('shell').classList.add('hide');
  document.getElementById('auth-wrap').classList.remove('hide');
}

async function startApp(session) {
  CU = session;
  // [OFFLINE PATCH] Utiliser le cache etab si Supabase inaccessible
  const isOffline = !navigator.onLine || location.protocol === 'file:';
  const etabCacheKey = 'baros_etab_' + session.etab_id;
  let etab = null;

  if (!isOffline) {
    try {
      const {data} = await db.from('etabs').select('*').eq('id',session.etab_id).single();
      etab = data;
      if (etab) localStorage.setItem(etabCacheKey, JSON.stringify(etab)); // mettre en cache
    } catch(e) {
      console.warn('[BarOS] startApp: Supabase injoignable, tentative cache local');
    }
  }

  // Fallback cache local si offline ou si Supabase a échoué
  if (!etab) {
    try { etab = JSON.parse(localStorage.getItem(etabCacheKey) || 'null'); } catch(e) {}
  }

  if(!etab){showN('Établissement introuvable — connexion requise pour le premier démarrage','error');return;}
  ETAB = etab;
  LOGO = localStorage.getItem('baros_logo_'+etab.id) || null;
  document.getElementById('auth-wrap').classList.add('hide');
  document.getElementById('shell').classList.remove('hide');
  document.getElementById('sb-etab').textContent=etab.nom;
  document.getElementById('av-el').textContent=ini(session.nom);
  document.getElementById('av-el').style.background=session.couleur+'33';
  document.getElementById('av-el').style.color=session.couleur;
  document.getElementById('av-name').textContent=session.nom;
  document.getElementById('av-role').textContent=session.role;
  // Affichage menu Admin
  const adminNav = document.getElementById('nav-admin');
  if(adminNav) adminNav.classList.toggle('hide', !ADMIN_EMAILS.includes(session.email?.toLowerCase().trim()));
  setSyncStatus(true, 'Supabase connecté');
  await Promise.all([loadEmps(), loadArticles(), loadBarsData()]);
  populateSelects();
  updateTime();
  renderDash();
  startRealtime();
  // [BUS FIX] Init bus ici — toutes les fn applicatives sont definies a ce stade
  if (typeof BarOSEventBus !== 'undefined' && !BarOSEventBus.isInitialized()) {
    BarOSEventBus.init({ db, etabId: ETAB.id, sourceApp: 'gestionnaire' });
    BarOSEventBus.installHooks();
    console.log('[BarOS] Event Bus actif (via startApp) — gestionnaire');
  }
}

function startRealtime() {
  db.channel('commandes-changes')
    .on('postgres_changes',{event:'*',schema:'public',table:'commandes',filter:`etab_id=eq.${ETAB.id}`},
      () => { const page=document.querySelector('.page.on')?.id; if(page==='pg-caisse')loadCommandes(); renderDash(); updateBadges(); })
    .subscribe();
  db.channel('alertes-changes')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'alertes',filter:`etab_id=eq.${ETAB.id}`},
      payload => { updateBadges(); showN('🚨 Nouvelle alerte: '+payload.new.titre,'warn'); })
    .subscribe();
  db.channel('employes-changes')
    .on('postgres_changes',{event:'*',schema:'public',table:'employes',filter:`etab_id=eq.${ETAB.id}`},
      () => { loadEmps(); const page=document.querySelector('.page.on')?.id; if(page==='pg-personnel')loadPersonnel(); })
    .subscribe();
  // ── Stock/Articles en temps réel — source unique de vérité ──
  // Un seul canal pour INSERT/UPDATE/DELETE : recharge le cache ARTICLES et
  // reconstruit immédiatement commande rapide, menu et tableau de stock.
  db.channel('stock-changes-mgr')
    .on('postgres_changes',{event:'*',schema:'public',table:'stock',filter:`etab_id=eq.${ETAB.id}`},
      () => { _debounce('stock-mgr', () => { loadArticles(); updateBadges(); }, 350); })
    .subscribe();


  // ── Appels tables temps réel ──
  db.channel('appels-changes')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'appels',filter:`etab_id=eq.${ETAB.id}`},
      payload => {
        const a = payload.new;
        const icons = {serveuse:'🔔',addition:'💳',commande:'🛒',message:'💬'};
        showN(`${icons[a.type]||'🔔'} Appel ${a.type} — ${a.table_nom}`,'warn');
        playAppelSound();
        loadAppelsMgr();
        updateBadges();
      })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'appels',filter:`etab_id=eq.${ETAB.id}`},
      () => { loadAppelsMgr(); updateBadges(); })
    .subscribe();
  // ── Pointages en temps réel ──
  db.channel('pointages-changes')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'pointages',filter:`etab_id=eq.${ETAB.id}`},
      payload => onPointageRealtime(payload.new, 'arrivee'))
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'pointages',filter:`etab_id=eq.${ETAB.id}`},
      payload => { if (payload.new.heure_sortie && !payload.old.heure_sortie) onPointageRealtime(payload.new, 'sortie'); })
    .subscribe();
}

// Notification temps réel de pointage
async function onPointageRealtime(row, action) {
  // Récupérer le nom de l'employé
  const emp = EMPS.find(e => e.id === row.employe_id);
  const nom  = emp ? emp.nom : 'Employé';
  const heure = action === 'arrivee' ? row.heure_arrivee : row.heure_sortie;
  const icon  = action === 'arrivee' ? '🟢' : '🔴';
  const msg   = action === 'arrivee'
    ? `${icon} ${nom} vient d'arriver — ${heure}`
    : `${icon} ${nom} vient de partir — ${heure}`;
  showN(msg, action === 'arrivee' ? 'success' : 'warn');
  // Rafraîchir la page personnel si ouverte
  const page = document.querySelector('.page.on')?.id;
  if (page === 'pg-personnel') loadPersonnel();
  renderDash();
}

async function loadEmps() {
  const {data} = await db.from('employes').select('*').eq('etab_id',ETAB.id).eq('actif',true);
  EMPS = data||[];
  document.getElementById('b-emp').textContent = EMPS.length;
  populateSelects();
}

// Source unique de vérité : table "stock". Charge tous les articles de l'établissement
// (y compris ceux à quantité 0, pour permettre leur réapparition automatique via Realtime),
// les normalise, et rafraîchit les vues qui en dépendent (commande rapide, menu, stock).
async function loadArticles() {
  const {data} = await db.from('stock').select('*').eq('etab_id',ETAB.id);
  ARTICLES = (data||[]).map(normArticle);
  renderQCmd();
  const page = document.querySelector('.page.on')?.id;
  if (page === 'pg-config') renderMenuList();
  if (page === 'pg-stock') renderStockTable();
}

async function updateBadges() {
  const [cmdRes,stkRes,alRes] = await Promise.all([
    db.from('commandes').select('id',{count:'exact'}).eq('etab_id',ETAB.id).in('statut',['Nouveau','En prépa']),
    db.from('stock').select('id',{count:'exact'}).eq('etab_id',ETAB.id).lte('quantite',0),
    db.from('alertes').select('id',{count:'exact'}).eq('etab_id',ETAB.id).eq('resolue',false),
  ]);
  document.getElementById('b-cmd').textContent=cmdRes.count||0;
  document.getElementById('b-stk').textContent=stkRes.count||0;
  document.getElementById('b-al').textContent=alRes.count||0;
  // Badge appels
  const {count:appCnt} = await db.from('appels').select('id',{count:'exact'}).eq('etab_id',ETAB.id).eq('statut','pending');
  const bAppels = document.getElementById('b-appels');
  if(bAppels){ bAppels.textContent=appCnt||''; bAppels.style.display=appCnt?'':'none'; }
  const al=alRes.count||0;
  const chip=document.getElementById('live-chip');
  if(al>0){chip.textContent='🚨 '+al+' alertes';chip.style.background='rgba(255,94,94,.1)';chip.style.color='var(--dg)';chip.style.borderColor='rgba(255,94,94,.25)';}
  else{chip.textContent='✓ Tout OK';chip.style.background='rgba(74,222,128,.1)';chip.style.color='var(--gn)';chip.style.borderColor='rgba(74,222,128,.25)';}
}

function populateSelects() {
  const tables=(ETAB?.tables_cfg||'Table 1,Table 2,Table 3').split(',').map(t=>t.trim());
  ['mc-tbl','sel-tbl'].forEach(id=>{const s=document.getElementById(id);if(!s)return;s.innerHTML=tables.map(t=>`<option>${t}</option>`).join('');});
  ['mc-srv'].forEach(id=>{const s=document.getElementById(id);if(!s)return;s.innerHTML=EMPS.map(e=>`<option value="${e.id}">${e.nom}</option>`).join('');});
}

// ===== DASHBOARD =====
async function renderDash() {
  if(!ETAB)return;
  const todayStr=today();
  const [cmdRes,cliRes,stkRes] = await Promise.all([
    db.from('commandes').select('montant,statut,created_at,articles,table_nom,employe_nom,heure').eq('etab_id',ETAB.id).eq('date_cmd',todayStr),
    db.from('clients').select('points',{count:'exact'}).eq('etab_id',ETAB.id),
    db.from('stock').select('quantite,seuil_alerte,nom').eq('etab_id',ETAB.id),
  ]);
  const allCmds = cmdRes.data||[];
  const livreesAll = allCmds.filter(c=>c.statut==='Livré');

  // ── Calcul des 3 périodes ────────────────────────────
  const byPeriode = (p) => {
    const rows = livreesAll.filter(c => {
      const h = (c.heure||'00:00').slice(0,5);
      if (p==='jour') return h >= H_JOUR.debut && h <= H_JOUR.fin;
      if (p==='nuit') return h < H_JOUR.debut || h > H_JOUR.fin;
      return true;
    });
    const ca  = rows.reduce((a,c)=>a+c.montant,0);
    const nb  = rows.length;
    const avg = nb ? Math.round(ca/nb) : 0;
    return {ca, nb, avg};
  };
  const pTout = byPeriode('tout');
  const pJour = byPeriode('jour');
  const pNuit = byPeriode('nuit');

  // ── Recap 3 périodes ────────────────────────────────
  document.getElementById('pr-ca-tout').textContent = fmt(pTout.ca)+' F';
  document.getElementById('pr-sub-tout').textContent = pTout.nb+' commande'+(pTout.nb>1?'s':'');
  document.getElementById('pr-ca-jour').textContent = fmt(pJour.ca)+' F';
  document.getElementById('pr-sub-jour').textContent = pJour.nb+' cmd · moy. '+fmt(pJour.avg)+' F';
  document.getElementById('pr-ca-nuit').textContent = fmt(pNuit.ca)+' F';
  document.getElementById('pr-sub-nuit').textContent = pNuit.nb+' cmd · moy. '+fmt(pNuit.avg)+' F';

  // ── KPIs filtrés par période active ─────────────────
  const pActive = byPeriode(PERIODE);
  const cmds = filterPeriode(allCmds);
  const actives = allCmds.filter(c=>c.statut==='Nouveau'||c.statut==='En prépa').length;
  const clients = cliRes.count||0;
  const vip=(cliRes.data||[]).filter(c=>c.points>=500&&c.points<1000).length;
  const diamond=(cliRes.data||[]).filter(c=>c.points>=1000).length;

  document.getElementById('lv-ca').textContent = fmt(pActive.ca)+' F';
  document.getElementById('kca').textContent   = fmt(pActive.ca);
  document.getElementById('kcmd').textContent  = pActive.nb;
  document.getElementById('lv-act').textContent= actives;
  document.getElementById('lv-cli').textContent= clients;
  document.getElementById('lv-emp').textContent= EMPS.length;
  document.getElementById('kvip').textContent  = vip+(diamond>0?' +'+diamond+'💎':'');

  const {count:alCount} = await db.from('alertes').select('id',{count:'exact'}).eq('etab_id',ETAB.id).eq('resolue',false);
  document.getElementById('kal').textContent=alCount||0;

  const days=['D','L','M','M','J','V','S'];
  const vals7=[];const lbls7=[];
  for(let i=6;i>=0;i--){
    const dd=new Date();dd.setDate(dd.getDate()-i);
    const ds=dd.toISOString().slice(0,10);
    const {data:dCmds}=await db.from('commandes').select('montant,heure').eq('etab_id',ETAB.id).eq('date_cmd',ds).eq('statut','Livré');
    const filtered = (dCmds||[]).filter(c=>{
      const h=(c.heure||'00:00').slice(0,5);
      if(PERIODE==='jour') return h>=H_JOUR.debut&&h<=H_JOUR.fin;
      if(PERIODE==='nuit') return h<H_JOUR.debut||h>H_JOUR.fin;
      return true;
    });
    vals7.push(filtered.reduce((a,c)=>a+c.montant,0));
    lbls7.push(days[dd.getDay()]);
  }
  chartBars(document.getElementById('db-chart'),vals7,lbls7);

  const empStats={};
  filterPeriode(livreesAll).forEach(c=>{
    if(!c.employe_nom)return;
    empStats[c.employe_nom]=(empStats[c.employe_nom]||0)+c.montant;
  });
  const topEmps=Object.entries(empStats).sort((a,b)=>b[1]-a[1]).slice(0,3);
  document.getElementById('db-top').innerHTML=topEmps.length?topEmps.map(([nom,v],i)=>`<div style="display:flex;align-items:center;gap:9px;padding:8px 0;border-bottom:1px solid var(--bd)"><span style="font-size:14px">${['🥇','🥈','🥉'][i]}</span><div style="flex:1;font-size:12px">${nom.split(' ')[0]}</div><div style="font-family:Syne,sans-serif;font-size:12px;font-weight:700;color:var(--ac)">${fmt(v)} F</div></div>`).join(''):'<div style="font-size:12px;color:var(--mt);padding:10px 0">Aucune vente encore</div>';
  document.getElementById('db-orders').innerHTML=allCmds.filter(c=>c.statut!=='Annulé').slice(0,4).map(c=>`<div style="display:flex;align-items:center;gap:7px;padding:7px 0;border-bottom:1px solid var(--bd)"><div style="font-size:10px;padding:1px 5px;background:var(--s2);border-radius:4px">${c.table_nom||'?'}</div><div style="flex:1;font-size:11px">${(c.articles||'').slice(0,22)}</div><span class="pill ${c.statut==='Livré'?'p-d':c.statut==='Nouveau'?'p-n':'p-p'}">${c.statut}</span></div>`).join('')||'<div style="font-size:12px;color:var(--mt);padding:8px 0">Aucune commande</div>';
  const stkData=stkRes.data||[];
  document.getElementById('db-stock').innerHTML=stkData.filter(s=>s.quantite<=s.seuil_alerte).slice(0,4).map(s=>`<div style="display:flex;gap:7px;padding:7px 0;border-bottom:1px solid var(--bd)"><span>${s.quantite<=0?'🚨':'⚠️'}</span><div style="flex:1;font-size:11px;font-weight:600">${s.nom}</div><div style="font-size:11px;color:var(--mt)">Reste: ${s.quantite}</div></div>`).join('')||'<div style="color:var(--gn);font-size:12px;padding:8px 0">✓ Stock OK</div>';
  const {data:alData}=await db.from('alertes').select('*').eq('etab_id',ETAB.id).eq('resolue',false).order('created_at',{ascending:false}).limit(3);
  document.getElementById('db-alerts').innerHTML=(alData||[]).map(a=>`<div class="ar ${a.type}" style="margin-bottom:5px"><div style="font-size:14px">${a.icone}</div><div><div style="font-size:11px;font-weight:500">${a.titre}</div><div style="font-size:10px;color:var(--mt)">${(a.message||'').slice(0,50)}</div></div></div>`).join('')||'<div style="color:var(--gn);font-size:12px;padding:8px 0">✓ Aucune alerte</div>';
  updateBadges();
}

// ===== CAISSE =====
async function renderCaisse() {
  const {data:cmds}=await db.from('commandes').select('*').eq('etab_id',ETAB.id).eq('date_cmd',today()).eq('statut','Livré');
  const cash=(cmds||[]).filter(c=>c.paiement==='Cash').reduce((a,c)=>a+c.montant,0);
  const momo=(cmds||[]).filter(c=>c.paiement==='MTN MoMo'||c.paiement==='Orange Money').reduce((a,c)=>a+c.montant,0);
  const card=(cmds||[]).filter(c=>c.paiement==='Carte bancaire'||c.paiement==='Carte').reduce((a,c)=>a+c.montant,0);
  const reel=cash; const ecart=0;  /* [FIX-ECART] Suppression décote 2% — cash remis = cash théorique */
  document.getElementById('caisse-res').innerHTML=`
    <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--bd)"><span style="font-size:12px;color:var(--mt)">💵 Cash théorique</span><strong>${fmt(cash)} F</strong></div>
    <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--bd)"><span style="font-size:12px;color:var(--mt)">💵 Cash remis</span><strong style="color:var(--gn)">${fmt(reel)} F</strong></div>
    <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--bd)"><span style="font-size:12px;color:var(--mt)">📱 Mobile Money</span><strong>${fmt(momo)} F</strong></div>
    <div style="display:flex;justify-content:space-between;padding:7px 0"><span style="font-size:12px;color:var(--mt)">💳 Carte</span><strong>${fmt(card)} F</strong></div>`;
  const box=document.getElementById('ecart-box'); const msg=document.getElementById('ecart-msg');
  box.style.cssText='margin-top:11px;padding:10px;border-radius:var(--rs);background:rgba(74,222,128,.06);border:1px solid rgba(74,222,128,.2)';
  msg.style.color='var(--gn)'; msg.textContent='✓ Caisse équilibrée';
  document.getElementById('ecart-v').textContent='0 F';
  document.getElementById('ecart-v').style.color='var(--gn)';
}
async function cloturerCaisse() {
  if(!confirm('Clôturer la caisse du ' + new Date().toLocaleDateString('fr-FR') + ' ?\nCette action génère un rapport PDF horodaté.')) return;
  if(!window.jspdf){showN('⚠️ Librairie PDF en chargement, réessaie','warn');return;}

  // Snapshot des données au moment de la clôture
  const dateStr = today();
  const heureStr = nowT();
  const {data:cmds} = await db.from('commandes').select('*').eq('etab_id',ETAB.id).eq('date_cmd',dateStr).order('heure',{ascending:true});
  const {data:stk}  = await db.from('stock').select('nom,quantite,quantite_initiale,vendu_systeme,prix_vente').eq('etab_id',ETAB.id);

  const livrees   = (cmds||[]).filter(c=>c.statut==='Livré');
  const annulees  = (cmds||[]).filter(c=>c.statut==='Annulé');
  const ca        = livrees.reduce((a,c)=>a+c.montant,0);
  const nbCmd     = livrees.length;
  const cash      = livrees.filter(c=>c.paiement==='Cash').reduce((a,c)=>a+c.montant,0);
  const momo      = livrees.filter(c=>c.paiement==='MTN MoMo'||c.paiement==='Orange Money').reduce((a,c)=>a+c.montant,0);
  const card      = livrees.filter(c=>c.paiement==='Carte bancaire'||c.paiement==='Carte').reduce((a,c)=>a+c.montant,0);
  const cashRemis = cash;   /* [FIX-ECART] Suppression décote 2% */
  const ecart     = 0;

  const {jsPDF} = window.jspdf;
  const doc = new jsPDF({unit:'mm',format:'a4'});
  const PW=210,ML=18,MR=18,MT=22,CW=PW-ML-MR;
  const ink=[30,35,45],sub=[105,110,125],muted=[160,163,175],acc=[55,88,148],rule=[210,213,222],bgH=[242,244,248];
  const hRule=(y,lw=0.25)=>{doc.setDrawColor(...rule);doc.setLineWidth(lw);doc.line(ML,y,PW-MR,y);};
  const secT=(lbl,y)=>{doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(...acc);doc.text(lbl.toUpperCase(),ML,y);hRule(y+2,0.35);};

  // En-tête
  doc.setFont('helvetica','bold');doc.setFontSize(14);doc.setTextColor(...ink);
  doc.text('BarOS — Clôture de caisse',ML,MT);
  doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(...sub);
  doc.text((ETAB?.nom||'').toUpperCase(),ML,MT+6);
  doc.setTextColor(...muted);
  doc.text('Générée le '+new Date().toLocaleDateString('fr-FR')+' à '+heureStr+' par '+CU?.nom,ML,MT+11);
  hRule(MT+15,0.5);
  let y=MT+21;

  // KPIs caisse
  secT('Résumé caisse',y);y+=7;
  const kpis=[
    ['Chiffre d\'affaires (jour)',fmt(ca)+' F'],
    ['Commandes livrées',String(nbCmd)],
    ['Annulations',String(annulees.length)],
    ['Cash théorique',fmt(cash)+' F'],
    ['Cash remis',fmt(cashRemis)+' F'],
    ['Écart caisse','0 F'],
    ['Mobile Money',fmt(momo)+' F'],
    ['Carte bancaire',fmt(card)+' F'],
  ];
  kpis.forEach(([l,v])=>{
    doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(...ink);
    doc.text(l,ML,y);
    doc.setFont('helvetica','bold');doc.text(v,PW-MR,y,{align:'right'});
    y+=6;
  });
  hRule(y);y+=8;

  // Tableau commandes
  if(livrees.length){
    secT('Commandes livrées ('+livrees.length+')',y);y+=5;
    doc.autoTable({
      startY:y,margin:{left:ML,right:MR},
      head:[['#','Table','Employé','Articles','Montant','Paiement','Heure']],
      body:livrees.map(c=>[c.id,''+c.table_nom,c.employe_nom||'—',(c.articles||'').slice(0,30),fmt(c.montant)+' F',c.paiement,c.heure||'']),
      styles:{fontSize:7,cellPadding:2},
      headStyles:{fillColor:bgH,textColor:acc,fontStyle:'bold'},
      alternateRowStyles:{fillColor:[250,251,254]},
    });
    y=doc.lastAutoTable.finalY+8;
  }

  // Annulations
  if(annulees.length){
    if(y>240){doc.addPage();y=20;}
    secT('Annulations ('+annulees.length+')',y);y+=5;
    doc.autoTable({
      startY:y,margin:{left:ML,right:MR},
      head:[['#','Table','Employé','Montant','Raison']],
      body:annulees.map(c=>[c.id,''+c.table_nom,c.employe_nom||'—',fmt(c.montant)+' F',c.raison_annulation||'—']),
      styles:{fontSize:7,cellPadding:2},
      headStyles:{fillColor:[255,240,240],textColor:[180,60,60],fontStyle:'bold'},
    });
    y=doc.lastAutoTable.finalY+8;
  }

  // Stocks bas
  const stkBas=(stk||[]).filter(s=>s.quantite<=(s.seuil_alerte||0)||s.quantite<=0);
  if(stkBas.length){
    if(y>240){doc.addPage();y=20;}
    secT('Alertes stock au moment de la clôture',y);y+=5;
    doc.autoTable({
      startY:y,margin:{left:ML,right:MR},
      head:[['Produit','Restant','Vendu (sys.)']],
      body:stkBas.map(s=>[s.nom,String(s.quantite),String(s.vendu_systeme||0)]),
      styles:{fontSize:7,cellPadding:2},
      headStyles:{fillColor:[255,248,235],textColor:[160,100,0],fontStyle:'bold'},
    });
  }

  // Pied de page
  const pgCount=doc.internal.getNumberOfPages();
  for(let i=1;i<=pgCount;i++){
    doc.setPage(i);
    doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(...muted);
    doc.text('BarOS · Clôture automatique · Page '+i+'/'+pgCount,PW/2,287,{align:'center'});
  }

  doc.save('cloture_'+dateStr+'_'+heureStr.replace(':','-')+'.pdf');
  showN('📄 Clôture générée et téléchargée', 'success');
}

// ===== COMMANDES =====
async function loadCommandes() {
  const fs=document.getElementById('f-st')?.value||'';
  let q=db.from('commandes').select('*').eq('etab_id',ETAB.id).eq('date_cmd',today()).order('created_at',{ascending:false});
  if(fs)q=q.eq('statut',fs);
  const {data:cmds}=await q;
  document.getElementById('ord-tb').innerHTML=(cmds||[]).map(c=>`<tr${c.statut==='Annulé'?' style="background:rgba(255,94,94,.04)"':''}>
    <td><strong>#${c.id}</strong></td><td>${c.table_nom||'?'}</td>
    <td style="max-width:120px;font-size:11px">${c.articles||''}</td>
    <td style="font-size:11px">${c.employe_nom||'—'}</td>
    <td><strong>${fmt(c.montant)}</strong>${c.remise>0?`<div style="font-size:10px;color:var(--wn)">-${c.remise}%</div>`:''}</td>
    <td style="font-size:11px;color:var(--mt)">${c.paiement}</td>
    <td style="font-size:11px;color:var(--mt)">${c.heure||''}</td>
    <td><span class="pill ${c.statut==='Livré'?'p-d':c.statut==='Nouveau'?'p-n':c.statut==='En prépa'?'p-p':'p-c'}">${c.statut}</span></td>
    <td style="white-space:nowrap">
      ${c.statut==='Nouveau'?`<button class="btn btn-sm" onclick="updOrd(${c.id},'En prépa')">→</button>`:''}
      ${c.statut==='En prépa'?`<button class="btn btn-sm btn-gn" onclick="updOrd(${c.id},'Livré')">✓</button>`:''}
      ${(c.statut==='Nouveau'||c.statut==='En prépa')?`<button class="btn btn-sm btn-dg" onclick="cancelOrd(${c.id})">✕</button>`:''}
    </td></tr>`).join('')||`<tr><td colspan="9" style="text-align:center;color:var(--mt);padding:20px">Aucune commande aujourd'hui</td></tr>`;
}

async function updOrd(id, ns) {
  // [FIX C2] Ajout filtre etab_id — interdit la modification de commandes étrangères
  await db.from('commandes').update({statut:ns}).eq('id',id).eq('etab_id',ETAB.id);
  loadCommandes(); renderCaisse(); renderDash();
}

async function cancelOrd(id) {
  const r=prompt('Raison de l\'annulation ?','Erreur saisie');if(r===null)return;
  // [FIX C2] Sélection et annulation filtrées par etab_id
  const {data:cmd}=await db.from('commandes').select('employe_id,employe_nom,montant').eq('id',id).eq('etab_id',ETAB.id).single();
  if(!cmd){showN('Commande introuvable','error');return;}
  await db.from('commandes').update({statut:'Annulé',raison_annulation:r||'Non spécifiée'}).eq('id',id).eq('etab_id',ETAB.id);
  if(cmd?.employe_id){
    const {count}=await db.from('commandes').select('id',{count:'exact'}).eq('etab_id',ETAB.id).eq('employe_id',cmd.employe_id).eq('statut','Annulé').eq('date_cmd',today());
    if((count||0)>3)await db.from('alertes').insert({etab_id:ETAB.id,type:'critical',icone:'🚨',titre:'Annulations suspectes — '+cmd.employe_nom,message:(count)+" annulations aujourd'hui. Dernier montant: "+fmt(cmd.montant)+' FCFA.',employe_id:cmd.employe_id,heure:nowT(),date_alerte:today()});
  }
  loadCommandes();updateBadges();showN('Commande #'+id+' annulée','warn');
}

async function addOrd() {
  const itm=document.getElementById('mc-itm').value.trim();
  const amt=parseInt(document.getElementById('mc-amt').value)||0;
  if(!itm||!amt){showN('⚠️ Articles et montant requis','warn');return;}
  const disc=parseInt(document.getElementById('mc-disc').value)||0;
  const sid=document.getElementById('mc-srv').value;
  const snom=EMPS.find(e=>e.id===sid)?.nom||CU?.nom||'Manager';
  const {error}=await db.from('commandes').insert({etab_id:ETAB.id,table_nom:document.getElementById('mc-tbl').value,articles:itm,employe_id:sid||null,employe_nom:snom,montant:Math.floor(amt*(1-disc/100)),remise:disc,paiement:document.getElementById('mc-pay').value,statut:'Nouveau',heure:nowT(),date_cmd:today()});
  if(error){showN('Erreur: '+error.message,'error');return;}
  // Décrément stock : on parse les articles (ex: "Heineken x3, Castel x1")
  const lignes = itm.split(',').map(l=>l.trim()).filter(Boolean);
  for(const ligne of lignes){
    const matchQty = ligne.match(/[xX×](\d+)$/);
    const qty = matchQty ? parseInt(matchQty[1]) : 1;
    const nomBrut = ligne.replace(/[xX×]\d+$/, '').trim();
    // Chercher l'article dans ARTICLES (source unique : table stock) — correspondance exacte ou partielle
    const art = ARTICLES.find(p => p.nom.toLowerCase() === nomBrut.toLowerCase())
             || ARTICLES.find(p => p.nom.toLowerCase().includes(nomBrut.toLowerCase()));
    if(art){ await decrementStock(art, qty); }
    else {
      // Article hors menu : décrémenter directement par nom brut
      await decrementStock({nom: nomBrut, prix: 0}, qty);
    }
  }
  if(disc>5){
    const {count}=await db.from('commandes').select('id',{count:'exact'}).eq('etab_id',ETAB.id).eq('employe_id',sid).eq('date_cmd',today()).gt('remise',5);
    if((count||0)>=3)await db.from('alertes').insert({etab_id:ETAB.id,type:'warning',icone:'⚠️',titre:'Remises élevées — '+snom,message:(count)+' remises >5% aujourd\'hui.',employe_id:sid||null,heure:nowT(),date_alerte:today()});
  }
  closeM('m-cmd');['mc-itm','mc-amt','mc-disc'].forEach(id=>document.getElementById(id).value='');
  showN('✅ Commande enregistrée — stock mis à jour','success');
  loadCommandes();renderCaisse();renderDash();
}

// ===== COMMANDE RAPIDE =====
// Filtre : masque les articles en rupture (quantite<=0) ou désactivés, recherche instantanée
// sur nom/catégorie/mots-clés, favoris en tête, puis tri alphabétique par catégorie.
function qcmdSearch(v) { articleSearch = (v||'').trim().toLowerCase(); renderQCmd(); }

function renderQCmd() {
  const grid=document.getElementById('pgrid');if(!grid)return;
  const q = articleSearch;
  let list = ARTICLES.filter(p => (p.quantite||0) > 0 && p.actif !== false);
  if (q) list = list.filter(p =>
    p.nom.toLowerCase().includes(q) ||
    (p.categorie||'').toLowerCase().includes(q) ||
    (p.mots_cles||'').toLowerCase().includes(q)
  );
  list = list.slice().sort((a,b) => (b.favori-a.favori) || a.nom.localeCompare(b.nom));
  grid.innerHTML='';
  list.forEach((p)=>{
    const i = ARTICLES.indexOf(p);
    const b=document.createElement('div');b.className='pbtn'+(selP.has(i)?' sel':'');
    b.innerHTML=`<span class="pic">${p.favori?'⭐':''}${p.icone}</span><div class="pnm">${p.nom}</div><div class="ppr">${fmt(p.prix)}</div>`;
    b.onclick=()=>{b.classList.toggle('sel');if(selP.has(i)){selP.delete(i);cmdTot-=p.prix;}else{selP.add(i);cmdTot+=p.prix;}document.getElementById('cmd-tot').textContent=fmt(cmdTot)+' F';renderQCmd();};
    grid.appendChild(b);
  });
  if(!list.length)grid.innerHTML='<div style="font-size:12px;color:var(--mt);grid-column:1/-1;padding:12px;text-align:center">'+(ARTICLES.length?'Aucun article trouvé':'Chargez le menu par défaut dans Paramètres 🇨🇲')+'</div>';
}

// Décrémente le stock d'un article.
// La table "stock" étant l'unique source de vérité, on met à jour directement par id
// quand l'article provient de ARTICLES ; sinon (article hors-menu) on recherche/crée par nom.
// Insère une alerte quand la quantité atteint le seuil.
async function decrementStock(produit, qty=1) {
  const nomRecherche = produit.nom;
  let s = null;
  if (produit.id) {
    const {data} = await db.from('stock').select('*').eq('id', produit.id).eq('etab_id', ETAB.id).maybeSingle();
    s = data;
  }
  if (!s) {
    const {data} = await db.from('stock').select('*')
      .eq('etab_id', ETAB.id).eq('nom', nomRecherche).maybeSingle();
    s = data;
  }

  if (!s) {
    // Pas de ligne stock → en créer une automatiquement à partir du produit
    const {data:nouv} = await db.from('stock').insert({
      etab_id: ETAB.id, nom: nomRecherche,
      quantite: 99, quantite_initiale: 99,
      seuil_alerte: 10, vendu_systeme: 0, prix_vente: produit.prix
    }).select().single();
    s = nouv;
  }

  if (!s || s.quantite <= 0) return; // déjà épuisé

  const nouvelleQte = Math.max(0, s.quantite - qty);
  const {data: decData, error: decErr} = await db.from('stock').update({
    quantite: nouvelleQte,
    vendu_systeme: (s.vendu_systeme || 0) + qty,
    updated_at: 'now()'
  }).eq('id', s.id).eq('etab_id', ETAB.id).select('id');
  // [GARDE-FOU] Si la décrémentation vente ne touche aucune ligne, le stock affiché
  // resterait faux après commande sans que personne ne le sache — on log au minimum.
  if (decErr || !decData || decData.length === 0) {
    console.error('[BarOS] decrementStock: échec silencieux', nomRecherche, decErr);
  }

  // Alerte seuil atteint
  if (nouvelleQte <= s.seuil_alerte && s.quantite > s.seuil_alerte) {
    await db.from('alertes').insert({
      etab_id: ETAB.id, type: 'warning', icone: '⚠️',
      titre: 'Stock bas — ' + nomRecherche,
      message: 'Reste ' + nouvelleQte + ' unité(s). Seuil: ' + s.seuil_alerte + '.',
      heure: nowT(), date_alerte: today()
    });
  }
  // Alerte rupture
  if (nouvelleQte === 0) {
    await db.from('alertes').insert({
      etab_id: ETAB.id, type: 'critical', icone: '🚨',
      titre: 'Rupture stock — ' + nomRecherche,
      message: 'Stock épuisé.',
      heure: nowT(), date_alerte: today()
    });
  }
}

async function valCmd() {
  if(!selP.size){showN('⚠️ Sélectionne un produit','warn');return;}
  const tbl=document.getElementById('sel-tbl')?.value||'Table 1';
  const pay=document.getElementById('sel-pay')?.value||'Cash';
  const itm=Array.from(selP).map(i=>ARTICLES[i].nom).join(', ');
  // Décrément stock pour chaque produit sélectionné
  for(const i of selP){
    await decrementStock(ARTICLES[i], 1);
  }
  const {error}=await db.from('commandes').insert({etab_id:ETAB.id,table_nom:tbl,articles:itm,employe_id:EMPS[0]?.id||null,employe_nom:EMPS[0]?.nom||CU?.nom,montant:cmdTot,remise:0,paiement:pay,statut:'Livré',heure:nowT(),date_cmd:today()});
  if(error){showN('Erreur: '+error.message,'error');return;}
  showN('✅ Commande enregistrée — stock mis à jour','success');
  selP.clear();cmdTot=0;renderQCmd();document.getElementById('cmd-tot').textContent='0 F';
  loadCommandes();renderCaisse();renderDash();updateBadges();
}

// ===== STOCK (source unique de vérité — table "stock") =====
// Compat : loadStock() reste appelable (filtre catégorie, boutons existants) mais ne
// refait plus de requête réseau — elle rend simplement le cache ARTICLES déjà en mémoire
// et tenu à jour par Realtime, pour un minimum de requêtes Supabase.
async function loadStock() {
  if (!ARTICLES.length) await loadArticles();
  else renderStockTable();
}

function renderStockTable() {
  const cat = document.getElementById('f-cat')?.value || '';
  const q = (document.getElementById('stk-search')?.value || '').trim().toLowerCase();
  let rows = cat ? ARTICLES.filter(s => s.categorie === cat) : ARTICLES.slice();
  if (q) rows = rows.filter(s =>
    s.nom.toLowerCase().includes(q) ||
    (s.categorie||'').toLowerCase().includes(q) ||
    (s.mots_cles||'').toLowerCase().includes(q)
  );
  rows.sort((a,b) => a.nom.localeCompare(b.nom));

  // Agrégats globaux
  let totalCout = 0, totalCA = 0, totalEcart = 0, alertes = 0;
  let sumInit = 0, sumRest = 0;

  document.getElementById('stk-tb').innerHTML = rows.map(s => {
    const init   = s.quantite_initiale || 0;
    const rest   = s.quantite || 0;
    const pa     = s.prix_achat || 0;         // prix d'achat unitaire
    const pv     = s.prix_vente || 0;         // prix de vente unitaire
    const vendu  = s.vendu_systeme || 0;
    const cout   = pa * init;                 // coût stock initial
    const caVte  = vendu * pv;                // CA ventes système
    const sortie = init - rest;               // unités sorties (stock)
    const ecart  = Math.max(0, sortie - vendu); // sorties non enregistrées

    totalCout  += cout;
    totalCA    += caVte;
    totalEcart += ecart;
    sumInit    += init;
    sumRest    += rest;
    if (rest <= s.seuil_alerte || rest <= 0) alertes++;

    const pct = init > 0 ? Math.round((rest / init) * 100) : 0;
    const col = rest <= 0 ? 'var(--dg)' : rest <= s.seuil_alerte ? 'var(--wn)' : 'var(--gn)';
    const niv = rest <= 0 ? '🔴 Épuisé' : rest <= s.seuil_alerte ? '🟡 Bas' : '🟢 OK';

    return `<tr${s.actif===false?' style="opacity:.5"':''}>
      <td>
        <strong>${s.favori?'⭐ ':''}${s.icone||'🍶'} ${s.nom}${s.actif===false?' <span style="font-size:9px;background:var(--bd2);color:var(--mt);border-radius:4px;padding:1px 5px;font-weight:600">DÉSACTIVÉ</span>':''}</strong>
        <div style="font-size:10px;color:var(--mt)">${pa > 0 ? `Achat : ${fmt(pa)} F/u` : '<span style="color:var(--wn)">Prix achat non défini</span>'} · Vente : ${fmt(pv)} F/u</div>
      </td>
      <td style="font-size:11px;color:var(--mt)">${s.categorie || '—'}</td>
      <td style="font-weight:600;color:var(--tx);text-align:center">${init}</td>
      <td style="font-weight:700;color:${col};text-align:center;font-size:15px">${rest}</td>
      <td style="font-size:12px;color:${pa > 0 ? 'var(--ac)' : 'var(--mt)'};font-weight:600;text-align:right">
        ${pa > 0 ? fmt(cout)+' F' : '<span style="font-size:10px;opacity:.5">—</span>'}
      </td>
      <td style="font-size:12px;text-align:right">
        <span style="font-weight:700;color:var(--gn)">${vendu > 0 && pv > 0 ? fmt(caVte)+' F' : ''}</span>
        <div style="font-size:10px;color:var(--mt)">${vendu} vendu${vendu > 1 ? 's' : ''}</div>
      </td>
      <td style="text-align:center;color:${ecart > 0 ? 'var(--dg)' : 'var(--mt)'}">
        ${ecart > 0 ? `<span style="background:rgba(255,94,94,.12);border-radius:6px;padding:2px 7px;font-size:11px;font-weight:700">⚠️ ${ecart}</span>` : '<span style="color:var(--gn);font-size:11px">✓</span>'}
      </td>
      <td style="min-width:90px">
        <div style="font-size:10px;color:var(--mt);margin-bottom:2px">${niv} · ${pct}%</div>
        <div class="rb"><div class="rf" style="width:${pct}%;background:${col}"></div></div>
      </td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn btn-sm" onclick="editStk('${s.id}')" title="Modifier">✏️</button>
          <button class="btn btn-sm btn-gn" onclick="openRestockModal('${s.id}','${s.nom.replace(/'/g,"\\'")}',${pa})" title="Réapprovisionner">+</button>
          <button class="btn btn-sm" onclick="toggleArticleActif('${s.id}')" title="${s.actif===false?'Réactiver':'Désactiver'}">${s.actif===false?'▶️':'⏸️'}</button>
          <button class="btn btn-sm btn-dg" onclick="delStk('${s.id}')" title="Supprimer">✕</button>
        </div>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" style="text-align:center;color:var(--mt);padding:24px">Aucun article en stock</td></tr>`;

  // KPIs page
  document.getElementById('s-tot').textContent  = rows.length;
  document.getElementById('s-cout').textContent = fmt(totalCout) + ' F';
  document.getElementById('s-ca').textContent   = fmt(totalCA)   + ' F';
  document.getElementById('s-lo').textContent   = alertes;

  // Ligne totaux tableau
  if (rows.length > 0) {
    document.getElementById('stk-foot').style.display = '';
    document.getElementById('sf-init').textContent = sumInit + ' u';
    document.getElementById('sf-rest').textContent = sumRest + ' u';
    document.getElementById('sf-cout').textContent = fmt(totalCout) + ' F';
    document.getElementById('sf-ca').textContent   = fmt(totalCA)   + ' F';
    document.getElementById('sf-ec').textContent   = totalEcart > 0 ? '⚠️ ' + totalEcart : '✓';
  } else {
    document.getElementById('stk-foot').style.display = 'none';
  }
}

// Colonnes additives optionnelles (peuvent ne pas exister selon l'état de la migration SQL) :
// icone, favori, mots_cles, type_service, actif. On tente l'écriture complète puis on retire
// progressivement les colonnes manquantes en cas d'erreur de schéma — même filet de sécurité
// que celui déjà utilisé pour prix_achat.
async function _insertOrUpdateStock(id, payloadFull) {
  let payload = {...payloadFull};
  const optionalCols = ['prix_achat','icone','favori','mots_cles','type_service','actif','photo','nom_en','description_fr','description_en','allergenes'];
  for (let attempt = 0; attempt < optionalCols.length + 1; attempt++) {
    const q = id
      ? db.from('stock').update(payload).eq('id', id).eq('etab_id', ETAB.id).select('id')
      : db.from('stock').insert(payload).select('id');
    const {data, error} = await q;
    if (!error) {
      // [GARDE-FOU] Un UPDATE peut réussir côté réseau (error:null) tout en n'ayant
      // touché AUCUNE ligne (mauvais etab_id, politique RLS, id inexistant…). Sans
      // cette vérification, l'app affichait "succès" alors que rien n'était écrit.
      if (id && (!data || data.length === 0)) {
        return {error: {message: "Aucune ligne mise à jour (vérifiez que l'article appartient bien à cet établissement)."}};
      }
      return {error: null, degraded: attempt > 0, data};
    }
    const missingCol = optionalCols.find(c => payload.hasOwnProperty(c) && error.message && error.message.includes(c));
    if (!missingCol) return {error};
    delete payload[missingCol];
  }
  return {error: {message: 'Écriture stock impossible'}};
}

function editStk(id) {
  const s = ARTICLES.find(a => a.id === id);
  if (!s) return;
  document.getElementById('stk-edit-id').value = id;
  document.getElementById('stk-modal-title').textContent = 'Modifier un article';
  document.getElementById('sn').value = s.nom || '';
  document.getElementById('sc').value = s.categorie || ARTICLE_CATS[0];
  document.getElementById('sq').value = s.quantite ?? 0;
  document.getElementById('ss').value = s.seuil_alerte ?? 10;
  document.getElementById('sa').value = s.prix_achat ?? '';
  document.getElementById('sp').value = s.prix_vente ?? '';
  const icEl = document.getElementById('si'); if (icEl) icEl.value = s.icone || '';
  const kwEl = document.getElementById('sk'); if (kwEl) kwEl.value = s.mots_cles || '';
  const favEl = document.getElementById('sf'); if (favEl) favEl.checked = !!s.favori;
  if (typeof stkExtraFill === 'function') stkExtraFill(s);
  openM('m-stk');
}

async function saveStk() {
  const nm = document.getElementById('sn').value.trim();
  if (!nm) { showN('⚠️ Nom requis', 'warn'); return; }
  const id  = document.getElementById('stk-edit-id').value || null;
  const qty = parseInt(document.getElementById('sq').value) || 0;
  const pa  = parseInt(document.getElementById('sa').value) || 0;
  const pv  = parseInt(document.getElementById('sp').value) || 0;
  const cat = document.getElementById('sc').value;
  const payload = {
    etab_id: ETAB.id, nom: nm,
    categorie: cat,
    seuil_alerte: parseInt(document.getElementById('ss').value) || 10,
    prix_vente: pv,
    prix_achat: pa,
    icone: document.getElementById('si')?.value?.trim() || '🍶',
    favori: !!document.getElementById('sf')?.checked,
    mots_cles: document.getElementById('sk')?.value?.trim() || '',
    type_service: _catToTypeService(cat),
    ...(typeof stkExtraPayload === 'function' ? stkExtraPayload() : {}),
  };
  if (id) {
    // [FIX] Auparavant, cette branche ne touchait JAMAIS quantite/quantite_initiale :
    // modifier la quantité dans le formulaire "Modifier" ne servait donc à rien
    // (le toast affichait "succès" mais le chiffre restait figé — visible surtout
    // quand le stock initial était à 0). "Réapprovisionner" (+) reste la voie normale
    // pour AJOUTER du stock (elle gère aussi le reset de vendu_systeme). Mais si
    // l'utilisateur modifie sq ici (ex: correction d'une erreur de saisie, ou
    // rattrapage d'un stock resté à 0), on répercute maintenant le delta sur
    // quantite ET quantite_initiale, pour rester cohérent avec la logique de
    // doRestock() et ne pas fausser le calcul des écarts.
    const s = ARTICLES.find(a => a.id === id);
    const oldQty  = s ? (s.quantite || 0) : null;
    const oldInit = s ? (s.quantite_initiale || 0) : 0;
    if (oldQty !== null && qty !== oldQty) {
      const delta = qty - oldQty;
      payload.quantite = qty;
      payload.quantite_initiale = Math.max(qty, oldInit + delta);
    }
  } else {
    payload.quantite = qty;
    payload.quantite_initiale = qty;
    payload.vendu_systeme = 0;
    payload.actif = true;
  }
  const {error} = await _insertOrUpdateStock(id, payload);
  if (error) { showN('Erreur : ' + error.message, 'error'); return; }
  ['sn','sq','ss','sa','sp','si','sk'].forEach(fid => { const el=document.getElementById(fid); if(el) el.value=''; });
  const favReset = document.getElementById('sf'); if (favReset) favReset.checked = false;
  if (typeof stkExtraFill === 'function') stkExtraFill(null);
  document.getElementById('stk-edit-id').value = '';
  document.getElementById('stk-modal-title').textContent = 'Ajouter un article';
  closeM('m-stk'); await loadArticles();
  showN('✅ ' + nm + (id ? ' modifié' : ' ajouté au stock'), 'success');
}

function openRestockModal(id, nom, paCurrent) {
  document.getElementById('rs-id').value  = id;
  document.getElementById('rs-nom').textContent = nom;
  document.getElementById('rs-qty').value = '';
  document.getElementById('rs-pa').value  = '';
  document.getElementById('rs-pa').placeholder = paCurrent > 0 ? 'Actuel : '+fmt(paCurrent)+' F' : 'Laisser vide = inchangé';
  openM('m-restock');
}

async function doRestock() {
  const id  = document.getElementById('rs-id').value;
  const qty = parseInt(document.getElementById('rs-qty').value) || 0;
  if (qty <= 0) { showN('⚠️ Quantité invalide', 'warn'); return; }
  // [FIX C2+M6] Sélection filtrée par etab_id + reset vendu_systeme pour recalcul écarts correct
  const {data: cur} = await db.from('stock').select('quantite,quantite_initiale,prix_achat,vendu_systeme').eq('id', id).eq('etab_id', ETAB.id).single();
  if (!cur) { showN('Article introuvable', 'error'); return; }
  const newQty  = (cur.quantite || 0) + qty;
  const newInit = (cur.quantite_initiale || 0) + qty;
  const paRaw   = document.getElementById('rs-pa').value;
  const newPA   = paRaw !== '' ? parseInt(paRaw) : (cur.prix_achat || 0);
  // vendu_systeme remis à zéro au réapprovisionnement : la période de calcul repart de zéro
  // Tentative avec prix_achat
  let {data, error} = await db.from('stock').update({quantite: newQty, quantite_initiale: newInit, prix_achat: newPA, vendu_systeme: 0}).eq('id', id).eq('etab_id', ETAB.id).select('id');
  if (error && error.message && error.message.includes('prix_achat')) {
    const r2 = await db.from('stock').update({quantite: newQty, quantite_initiale: newInit, vendu_systeme: 0}).eq('id', id).eq('etab_id', ETAB.id).select('id');
    error = r2.error; data = r2.data;
  }
  if (error) { showN('Erreur : ' + error.message, 'error'); return; }
  // [GARDE-FOU] Même logique que _insertOrUpdateStock : un succès réseau sans ligne
  // affectée doit être traité comme une erreur, pas comme un succès silencieux.
  if (!data || data.length === 0) { showN("Erreur : aucune ligne mise à jour (établissement incohérent ?)", 'error'); return; }
  closeM('m-restock'); await loadArticles();
  showN('📦 +' + qty + ' unités ajoutées', 'success');
}

async function delStk(id) {
  if (!confirm('Supprimer cet article du stock ?')) return;
  // [FIX M1] Filtre etab_id — interdit la suppression de stock étranger
  const {data, error} = await db.from('stock').delete().eq('id', id).eq('etab_id', ETAB.id).select('id');
  if (error) { showN('Erreur : ' + error.message, 'error'); return; }
  if (!data || data.length === 0) { showN("Erreur : rien n'a été supprimé (établissement incohérent ?)", 'error'); return; }
  await loadArticles(); showN('Article supprimé', 'warn');
}

// Active/désactive un article manuellement (indépendant de la quantité en stock) —
// ex : retirer temporairement un article du menu sans toucher à son inventaire.
async function toggleArticleActif(id) {
  const a = ARTICLES.find(x => x.id === id);
  if (!a) return;
  const nextActif = !a.actif;
  const {error} = await _insertOrUpdateStock(id, {actif: nextActif});
  if (error) { showN('Erreur : ' + error.message, 'error'); return; }
  await loadArticles();
  showN(nextActif ? '✅ ' + a.nom + ' réactivé' : '⏸️ ' + a.nom + ' désactivé', nextActif ? 'success' : 'warn');
}

function openNewStk() {
  document.getElementById('stk-edit-id').value = '';
  document.getElementById('stk-modal-title').textContent = 'Ajouter un article';
  ['sn','sq','ss','sa','sp','si','sk'].forEach(fid => { const el=document.getElementById(fid); if(el) el.value=''; });
  const favEl = document.getElementById('sf'); if (favEl) favEl.checked = false;
  if (typeof stkExtraFill === 'function') stkExtraFill(null);
  openM('m-stk');
}

// ===== PERSONNEL =====
async function loadPersonnel() {
  const roleFilter = document.getElementById('f-role')?.value || '';
  const statutFilter = document.getElementById('f-statut-emp')?.value;
  
  let q = db.from('employes').select('*').eq('etab_id', ETAB.id).order('nom', {ascending: true});
  if (roleFilter) q = q.eq('role', roleFilter);
  if (statutFilter !== '' && statutFilter !== undefined && statutFilter !== null) {
    q = q.eq('actif', statutFilter === 'true');
  }
  
  const [{ data: emps }, { data: ptgs }] = await Promise.all([
    q,
    db.from('pointages').select('employe_id,heure_arrivee,heure_sortie,statut').eq('etab_id', ETAB.id).eq('date_pointage', today())
  ]);
  const allEmps = emps || [];
  const ptgMap = Object.fromEntries((ptgs || []).map(p => [p.employe_id, p]));
  
  // KPIs
  const actifs = allEmps.filter(e => e.actif).length;
  const maries = allEmps.filter(e => e.situation_matrimoniale === 'Marié(e)').length;
  const enfants = allEmps.reduce((a, e) => a + (parseInt(e.nb_enfants) || 0), 0);
  document.getElementById('p-total').textContent = allEmps.length;
  document.getElementById('p-actif').textContent = actifs;
  document.getElementById('p-maries').textContent = maries;
  document.getElementById('p-enfants').textContent = enfants;
  
  if (!allEmps.length) {
    document.getElementById('personnel-list').innerHTML = `<div style="text-align:center;padding:30px;color:var(--mt)">Aucun employé trouvé. <span style="color:var(--ac);cursor:pointer" onclick="openM('m-emp')">+ Ajouter le premier employé</span></div>`;
    return;
  }
  
  document.getElementById('personnel-list').innerHTML = allEmps.map((e, i) => {
    const col = COLORS_EMP[i % COLORS_EMP.length];
    const age = e.date_naissance ? Math.floor((new Date() - new Date(e.date_naissance)) / 31557600000) : null;
    const _p = ptgMap[e.id];
    let _ptgBadge;
    if (!_p) {
      _ptgBadge = '<span style="font-size:10px;padding:3px 7px;border-radius:999px;background:rgba(150,150,150,.12);color:var(--mt)">⚪ Pas encore pointé</span>';
    } else if (_p.heure_sortie) {
      _ptgBadge = '<span style="font-size:10px;padding:3px 7px;border-radius:999px;background:rgba(255,180,68,.12);color:var(--wn)">🔴 Sorti ' + _p.heure_sortie + '</span>';
    } else {
      _ptgBadge = '<span style="font-size:10px;padding:3px 7px;border-radius:999px;background:rgba(74,222,128,.12);color:var(--gn)">🟢 Arrivé ' + _p.heure_arrivee + '</span>';
    }
    return `<div class="emp-card">
      <div class="emp-top">
        <div class="emp-av" style="background:${col}22;color:${col}">${ini(e.nom)}</div>
        <div style="flex:1">
          <div class="emp-nm">${e.nom}</div>
          <div class="emp-role">${e.role} ${!e.actif?'<span class="pill p-c">Inactif</span>':''}</div>
        </div>
        <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
          ${_ptgBadge}
          <button class="btn btn-sm" onclick="viewEmp('${e.id}')">👁 Fiche</button>
          <button class="btn btn-sm btn-wn" onclick="editEmp('${e.id}')">✏️</button>
          <button class="btn btn-sm ${e.actif?'btn-dg':'btn-gn'}" onclick="toggleEmpActif('${e.id}',${e.actif})">${e.actif?'Retirer':'Réactiver'}</button>
        </div>
      </div>
      <div class="emp-info-grid">
        <div class="emp-info-item"><div class="emp-info-lbl">📞 Téléphone</div><div class="emp-info-val">${e.telephone||'—'}</div></div>
        <div class="emp-info-item"><div class="emp-info-lbl">🪪 N° CNI</div><div class="emp-info-val">${e.numero_cni||'—'}</div></div>
        <div class="emp-info-item"><div class="emp-info-lbl">🎂 Âge</div><div class="emp-info-val">${age?age+' ans':'—'}</div></div>
        <div class="emp-info-item"><div class="emp-info-lbl">💍 Situation</div><div class="emp-info-val">${e.situation_matrimoniale||'—'}</div></div>
        <div class="emp-info-item"><div class="emp-info-lbl">👶 Enfants à charge</div><div class="emp-info-val">${e.nb_enfants||0}</div></div>
        <div class="emp-info-item"><div class="emp-info-lbl">🩸 Groupe sanguin</div><div class="emp-info-val">${e.groupe_sanguin||'—'}</div></div>
      </div>
      ${e.allergies||e.maladies_chroniques?`<div class="emp-section"><div class="emp-section-title">🏥 Santé</div><div style="font-size:11px;color:var(--mt)">${e.allergies?'Allergies: '+e.allergies+' · ':''} ${e.maladies_chroniques?'Maladies: '+e.maladies_chroniques:''}</div></div>`:''}
    </div>`;
  }).join('');
}

async function viewEmp(id) {
  const {data:e} = await db.from('employes').select('*').eq('id', id).single();
  if (!e) return;
  const {data:cmds} = await db.from('commandes').select('montant,statut').eq('employe_id', id).eq('date_cmd', today()).eq('statut', 'Livré');
  const ca = (cmds||[]).reduce((a,c)=>a+c.montant,0);
  const age = e.date_naissance ? Math.floor((new Date() - new Date(e.date_naissance)) / 31557600000) : null;
  const i = EMPS.findIndex(x=>x.id===id);
  const col = COLORS_EMP[Math.max(i,0) % COLORS_EMP.length];
  
  document.getElementById('emp-view-content').innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--bd)">
      <div class="emp-av" style="width:64px;height:64px;font-size:18px;background:${col}22;color:${col};overflow:hidden;border-radius:50%">
        ${e.photo ? `<img src="${e.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : ini(e.nom)}
      </div>
      <div>
        <div style="font-size:16px;font-weight:700">${e.nom}</div>
        <div style="font-size:12px;color:var(--mt)">${e.role} ${e.actif?'<span class="pill p-d">Actif</span>':'<span class="pill p-c">Inactif</span>'}</div>
        <div style="font-size:11px;color:var(--ac);margin-top:4px">CA aujourd'hui: ${fmt(ca)} FCFA</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div class="form-section" style="margin-bottom:0">
        <div class="form-section-title">👤 Identité</div>
        <div style="font-size:12px;line-height:2">
          <div><span style="color:var(--mt)">CNI:</span> ${e.numero_cni||'Non renseigné'}</div>
          <div><span style="color:var(--mt)">Âge:</span> ${age?age+' ans (né le '+new Date(e.date_naissance).toLocaleDateString('fr-FR')+')':'—'}</div>
          <div><span style="color:var(--mt)">Tél:</span> ${e.telephone||'—'}</div>
          <div><span style="color:var(--mt)">Quartier:</span> ${e.ville||'—'}</div>
          <div><span style="color:var(--mt)">Contact urgence:</span> ${e.contact_urgence||'—'}</div>
        </div>
      </div>
      <div class="form-section" style="margin-bottom:0">
        <div class="form-section-title">💼 Emploi</div>
        <div style="font-size:12px;line-height:2">
          <div><span style="color:var(--mt)">PIN app:</span> ••••</div>
          <div><span style="color:var(--mt)">Embauche:</span> ${e.date_embauche?new Date(e.date_embauche).toLocaleDateString('fr-FR'):'—'}</div>
          <div><span style="color:var(--mt)">Salaire:</span> ${e.salaire?fmt(e.salaire)+' FCFA/mois':'—'}</div>
        </div>
      </div>
    </div>
    <div class="form-section" style="margin-bottom:10px">
      <div class="form-section-title">👨‍👩‍👧 Famille</div>
      <div style="font-size:12px;line-height:2">
        <div><span style="color:var(--mt)">Situation matrimoniale:</span> ${e.situation_matrimoniale||'—'}</div>
        <div><span style="color:var(--mt)">Enfants à charge:</span> ${e.nb_enfants||0}</div>
      </div>
    </div>
    <div class="form-section">
      <div class="form-section-title">🏥 Santé</div>
      <div style="font-size:12px;line-height:2">
        <div><span style="color:var(--mt)">Groupe sanguin:</span> ${e.groupe_sanguin||'Non renseigné'}</div>
        <div><span style="color:var(--mt)">Allergies:</span> ${e.allergies||'Aucune connue'}</div>
        <div><span style="color:var(--mt)">Maladies chroniques:</span> ${e.maladies_chroniques||'Aucune connue'}</div>
        ${e.notes_medicales?`<div><span style="color:var(--mt)">Notes:</span> ${e.notes_medicales}</div>`:''}
      </div>
    </div>
    ${(()=>{
      const jours  = tryParse(e.jours_travail,  ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi']);
      const plages = tryParse(e.plages_horaires, []);
      const repos  = TOUS_JOURS.filter(j => !jours.includes(j));
      return `
      <div class="form-section" style="margin-bottom:10px">
        <div class="form-section-title">🗓 Planning de travail</div>
        <div class="planning-view">
          <div class="day-chips-view">
            ${TOUS_JOURS.map((j,i) => `<div class="dcv ${jours.includes(j)?'on':'off'}" title="${j}">${JOUR_SHORT[i]}</div>`).join('')}
          </div>
          ${plages.length ? plages.map(p => `
            <div class="plage-view">
              <span style="font-size:14px">🕐</span>
              <span class="plage-view-time">${p.debut}</span>
              <span style="color:var(--mt)">→</span>
              <span class="plage-view-time">${p.fin}</span>
            </div>`).join('') : '<div style="font-size:11px;color:var(--mt)">Aucune plage définie</div>'}
          ${repos.length ? `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">${repos.map(j=>`<span class="repos-tag">🔴 ${j}</span>`).join('')}</div>` : '<div style="font-size:11px;color:var(--gn);margin-top:6px">✓ Travaille tous les jours</div>'}
        </div>
      </div>`;
    })()}
    ${e.qr_code ? `
    <div class="form-section" style="margin-bottom:10px;text-align:center">
      <div class="form-section-title">🏷 Badge QR de pointage</div>
            <img src="${e.qr_code}" title="Appuyez pour voir le badge en plein écran"
        onclick="viewEmpQR(this)"
        data-nom="${e.nom}" data-role="${e.role||''}" data-id="${e.id}"
        style="width:200px;height:200px;border-radius:8px;border:2px solid var(--ac);cursor:pointer;image-rendering:pixelated;transition:transform .15s"
        onmouseover="this.style.transform='scale(1.04)'" onmouseout="this.style.transform='scale(1)'">
      <!-- BAROS QR FIX — afficher ID UUID tronqué -->
      <div style="font-size:10px;color:var(--mt);margin-top:5px;font-family:monospace">ID : ${e.id.slice(0,8)}…</div>
      <div style="display:flex;gap:6px;margin-top:8px;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-sm btn-ac" onclick="viewEmpQR(this.closest('.form-section').querySelector('img'))">📥 Télécharger QR</button>
        <button class="btn btn-sm" style="background:rgba(124,108,255,.12);color:#a78bfa;border-color:rgba(124,108,255,.3)" onclick="viewEmpQR(this.closest('.form-section').querySelector('img'));setTimeout(exportQRpdfBadge,400)">🖨️ Imprimer badge</button>
        <button class="btn btn-sm" onclick="regenererQREmp('${e.id}')">🔄 Régénérer le QR</button>
      </div>
    </div>` : `
    <div class="form-section" style="margin-bottom:10px;text-align:center">
      <div class="form-section-title">🏷 Badge QR de pointage</div>
      <div style="color:var(--mt);font-size:12px;margin-bottom:8px">QR code non encore généré</div>
      <button class="btn btn-ac btn-sm" onclick="regenererQREmp('${e.id}')">✨ Générer le QR badge</button>
    </div>`}
    <div style="display:flex;gap:7px;margin-top:14px">
      <button class="btn" style="flex:1;justify-content:center" onclick="closeM('m-emp-view')">Fermer</button>
      <button class="btn btn-wn" style="flex:1;justify-content:center" onclick="closeM('m-emp-view');editEmp('${e.id}')">✏️ Modifier</button>
    </div>`;
  openM('m-emp-view');
}

async function editEmp(id) {
  const {data:e} = await db.from('employes').select('*').eq('id', id).single();
  if (!e) return;
  document.getElementById('emp-modal-title').textContent = 'Modifier: ' + e.nom;
  document.getElementById('emp-edit-id').value = e.id;
  document.getElementById('en').value = e.nom || '';
  document.getElementById('e-dob').value = displayDate(e.date_naissance);
  document.getElementById('e-cni').value = e.numero_cni || '';
  document.getElementById('e-tel').value = e.telephone || '';
  document.getElementById('e-ville').value = e.ville || '';
  document.getElementById('er').value = e.role || 'Serveur/Serveuse';
  document.getElementById('ep').value = e.pin || '';
  document.getElementById('e-embauche').value = displayDate(e.date_embauche);
  document.getElementById('e-salaire').value = e.salaire || '';
  document.getElementById('e-matrimonial').value = e.situation_matrimoniale || 'Célibataire';
  document.getElementById('e-enfants').value = e.nb_enfants || 0;
  document.getElementById('e-urgence').value = e.contact_urgence || '';
  document.getElementById('e-allergies').value = e.allergies || '';
  document.getElementById('e-maladies').value = e.maladies_chroniques || '';
  document.getElementById('e-sanguin').value = e.groupe_sanguin || '';
  document.getElementById('e-notes-med').value = e.notes_medicales || '';
  // Planning
  const jours = tryParse(e.jours_travail, ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi']);
  const plages = tryParse(e.plages_horaires, [{debut:'08:00',fin:'17:00'}]);
  loadPlanning(jours, plages);
  document.getElementById('emp-save-btn').textContent = '✓ Mettre à jour';
  // ── BAR DE RATTACHEMENT ──
  _populateEmpBarSelect(e.bar_id || '');
  // ── FIN BAR ──
  // Charger la photo existante
  _empPhoto = e.photo || null;
  const prev = document.getElementById('emp-photo-preview');
  if (_empPhoto) {
    prev.innerHTML = `<img src="${_empPhoto}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">
      <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.55);text-align:center;font-size:9px;color:#fff;padding:3px 0;font-weight:600;letter-spacing:.03em;">MODIFIER</div>`;
    document.getElementById('emp-photo-clear-btn').style.display = 'block';
  } else {
    prev.innerHTML = `👤<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.55);text-align:center;font-size:9px;color:#fff;padding:3px 0;font-weight:600;letter-spacing:.03em;">MODIFIER</div>`;
    document.getElementById('emp-photo-clear-btn').style.display = 'none';
  }
  openM('m-emp');
}

// ===== PLANNING HELPERS =====
const TOUS_JOURS = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
const JOUR_SHORT  = ['Lu','Ma','Me','Je','Ve','Sa','Di'];
let _plageIdx = 1;

function tryParse(val, fallback) {
  try { return JSON.parse(val) || fallback; } catch { return fallback; }
}

function toggleDay(btn) {
  btn.classList.toggle('on');
  updateReposDisplay();
}

function updateReposDisplay() {
  const repos = TOUS_JOURS.filter(j => {
    const chip = document.querySelector(`#e-jours [data-day="${j}"]`);
    return chip && !chip.classList.contains('on');
  });
  const el = document.getElementById('e-repos-display');
  if (!el) return;
  el.innerHTML = repos.length
    ? repos.map(j => `<span class="repos-tag">🔴 ${j}</span>`).join('')
    : '<span style="font-size:11px;color:var(--gn)">✓ Aucun jour de repos défini</span>';
}

function getJoursTravail() {
  return TOUS_JOURS.filter(j => {
    const chip = document.querySelector(`#e-jours [data-day="${j}"]`);
    return chip && chip.classList.contains('on');
  });
}

function getJoursRepos() {
  return TOUS_JOURS.filter(j => {
    const chip = document.querySelector(`#e-jours [data-day="${j}"]`);
    return chip && !chip.classList.contains('on');
  });
}

function getPlages() {
  return Array.from(document.querySelectorAll('#e-plages .plage-row')).map(row => {
    const inputs = row.querySelectorAll('input[type="time"]');
    return { debut: inputs[0]?.value||'', fin: inputs[1]?.value||'' };
  }).filter(p => p.debut && p.fin);
}

function addPlage() {
  const idx = _plageIdx++;
  const container = document.getElementById('e-plages');
  const div = document.createElement('div');
  div.className = 'plage-row'; div.id = 'plage-row-' + idx;
  div.innerHTML = `
    <span class="plage-lbl">De</span>
    <input type="time" id="e-plage-${idx}-d">
    <span class="plage-lbl">à</span>
    <input type="time" id="e-plage-${idx}-f">
    <button class="btn btn-sm btn-dg" type="button" onclick="this.closest('.plage-row').remove()" style="width:28px;justify-content:center;flex-shrink:0">✕</button>`;
  container.appendChild(div);
}

function loadPlanning(jours, plages) {
  // Jours
  TOUS_JOURS.forEach(j => {
    const chip = document.querySelector(`#e-jours [data-day="${j}"]`);
    if (chip) chip.classList.toggle('on', jours.includes(j));
  });
  updateReposDisplay();
  // Plages
  const container = document.getElementById('e-plages');
  container.innerHTML = '';
  _plageIdx = 0;
  (plages.length ? plages : [{debut:'08:00',fin:'17:00'}]).forEach((p, i) => {
    const idx = _plageIdx++;
    const isFirst = i === 0;
    const div = document.createElement('div');
    div.className = 'plage-row'; div.id = 'plage-row-' + idx;
    div.innerHTML = `
      <span class="plage-lbl">De</span>
      <input type="time" id="e-plage-${idx}-d" value="${p.debut}">
      <span class="plage-lbl">à</span>
      <input type="time" id="e-plage-${idx}-f" value="${p.fin}">
      ${isFirst ? '<div style="width:28px"></div>' : '<button class="btn btn-sm btn-dg" type="button" onclick="this.closest(\'.plage-row\').remove()" style="width:28px;justify-content:center;flex-shrink:0">✕</button>'}`;
    container.appendChild(div);
  });
}

function resetPlanning() {
  loadPlanning(['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'], [{debut:'08:00',fin:'17:00'}]);
}

// ══════════════════════════════════════════════════
//  PHOTO EMPLOYÉ
// ══════════════════════════════════════════════════
let _empPhoto = null;
let _empCamStream = null;
let _empCamFacing = 'user'; // frontale par défaut pour portrait

function openEmpCamera() {
  const ov = document.getElementById('emp-cam-overlay');
  ov.style.display = 'flex';
  ov.classList.add('open');
  _startEmpCam();
}

function _startEmpCam() {
  if (_empCamStream) { _empCamStream.getTracks().forEach(t => t.stop()); _empCamStream = null; }

  // Tentatives de contraintes par ordre décroissant de qualité
  const attempts = [
    // 1. Max qualité
    { facingMode: { ideal: _empCamFacing }, width: { ideal: 4096 }, height: { ideal: 4096 }, frameRate: { ideal: 30 } },
    // 2. Full HD
    { facingMode: { ideal: _empCamFacing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    // 3. HD
    { facingMode: { ideal: _empCamFacing }, width: { ideal: 1280 }, height: { ideal: 720 } },
    // 4. Minimaliste — accepte tout ce que le navigateur propose
    { facingMode: { ideal: _empCamFacing } },
    // 5. Dernier recours sans contrainte de caméra
    true
  ];

  function tryNext(i) {
    if (i >= attempts.length) {
      closeEmpCamera();
      showN('❌ Caméra inaccessible sur cet appareil', 'error');
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: attempts[i] })
    .then(stream => {
      _empCamStream = stream;
      const video = document.getElementById('emp-cam-video');
      video.srcObject = stream;
      video.style.transform = _empCamFacing === 'user' ? 'scaleX(-1)' : 'scaleX(1)';
      // S'assurer que la vidéo joue
      video.play().catch(() => {});
      const s = stream.getVideoTracks()[0].getSettings();
      console.log('[BarOS Cam] Tentative', i, '→', s.width + 'x' + s.height);
    })
    .catch(err => {
      console.warn('[BarOS Cam] Tentative', i, 'échouée :', err.name, err.message);
      tryNext(i + 1);
    });
  }

  tryNext(0);
}

function switchEmpCam() {
  _stopEmpStream();
  _empCamFacing = _empCamFacing === 'user' ? 'environment' : 'user';
  _startEmpCam();
}

// ── Pipeline traitement image qualité maximale ──
function _processImageData(ctx, w, h) {
  const id  = ctx.getImageData(0, 0, w, h);
  const d   = id.data;
  const len = d.length;

  // LUT correction gamma 0.92 (compense surexposition capteurs mobiles)
  const gammaLUT = new Uint8Array(256);
  for (let i = 0; i < 256; i++)
    gammaLUT[i] = Math.round(255 * Math.pow(i / 255, 0.92));

  // LUT courbe S — contraste adaptatif sans écrêtage
  const contrastLUT = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const s = t < 0.5
      ? 2 * t * t * (1.08 - 0.16 * t)
      : 1 - 2 * (1 - t) * (1 - t) * (1.08 - 0.16 * (1 - t));
    contrastLUT[i] = Math.min(255, Math.round(s * 255));
  }

  // Passe 1 : gamma + contraste + saturation (tons chair +12%)
  for (let i = 0; i < len; i += 4) {
    let r = d[i], g = d[i+1], b = d[i+2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = Math.min(255, Math.max(0, gray + 1.12 * (r - gray)));
    g = Math.min(255, Math.max(0, gray + 1.12 * (g - gray)));
    b = Math.min(255, Math.max(0, gray + 1.12 * (b - gray)));
    d[i]   = contrastLUT[gammaLUT[Math.round(r)]];
    d[i+1] = contrastLUT[gammaLUT[Math.round(g)]];
    d[i+2] = contrastLUT[gammaLUT[Math.round(b)]];
  }
  ctx.putImageData(id, 0, 0);

  // Passe 2 : Unsharp mask (netteté) — noyau laplacien 3×3
  const sharp = ctx.getImageData(0, 0, w, h);
  const src   = new Uint8ClampedArray(sharp.data);
  const dst   = sharp.data;
  const amount = 0.5;
  const k = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let ky = -1; ky <= 1; ky++)
          for (let kx = -1; kx <= 1; kx++)
            sum += src[((y + ky) * w + (x + kx)) * 4 + c] * k[(ky+1)*3+(kx+1)];
        dst[idx + c] = Math.min(255, Math.max(0,
          src[idx + c] * (1 - amount) + sum * amount
        ));
      }
    }
  }
  ctx.putImageData(sharp, 0, 0);
}

function _applyPhotoPreview(src) {
  const prev = document.getElementById('emp-photo-preview');
  prev.innerHTML = `<img src="${src}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">
    <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.55);text-align:center;font-size:9px;color:#fff;padding:3px 0;font-weight:600;letter-spacing:.03em;">MODIFIER</div>`;
  document.getElementById('emp-photo-clear-btn').style.display = 'block';
}

function captureEmpPhoto() {
  const video  = document.getElementById('emp-cam-video');
  const canvas = document.getElementById('emp-cam-canvas');

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const s  = Math.min(vw, vh);
  const sx = (vw - s) / 2;
  const sy = (vh - s) / 2;
  // Résolution native plafonnée à 2400 pour éviter base64 trop lourde pour Supabase
  const size = Math.min(s, 2400);

  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (_empCamFacing === 'user') {
    ctx.save(); ctx.translate(size, 0); ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, s, s, 0, 0, size, size);
    ctx.restore();
  } else {
    ctx.drawImage(video, sx, sy, s, s, 0, 0, size, size);
  }

  _processImageData(ctx, size, size);
  // PNG sans perte pour conservation maximale des détails
  _empPhoto = canvas.toDataURL('image/png');
  _applyPhotoPreview(_empPhoto);
  closeEmpCamera();
}

function _stopEmpStream() {
  if (_empCamStream) { _empCamStream.getTracks().forEach(t => t.stop()); _empCamStream = null; }
}

function closeEmpCamera() {
  _stopEmpStream();
  const ov = document.getElementById('emp-cam-overlay');
  ov.classList.remove('open');
  ov.style.display = 'none';
}

function handleEmpPhotoFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      // Résolution native de l'image importée, plafonnée à 2400px
      const s    = Math.min(img.width, img.height);
      const size = Math.min(s, 2400);
      const sx   = (img.width  - s) / 2;
      const sy   = (img.height - s) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
      // Même pipeline qualité que la capture caméra
      _processImageData(ctx, size, size);
      _empPhoto = canvas.toDataURL('image/png');
      _applyPhotoPreview(_empPhoto);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function clearEmpPhoto() {
  _empPhoto = null;
  document.getElementById('emp-photo-preview').innerHTML = `👤
    <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.55);text-align:center;font-size:9px;color:#fff;padding:3px 0;font-weight:600;letter-spacing:.03em;">MODIFIER</div>`;
  document.getElementById('emp-photo-clear-btn').style.display = 'none';
  document.getElementById('emp-photo-file').value = '';
}

// BAROS QR FIX — EMPLOYEE QR GENERATION
// Génère un QR code PNG (dataURL) à partir d'un objet employé complet.
// empObj peut être : { id, nom, role, etab_id, pin } ou un simple ID (string/number).
function generateEmpQR(empObj) {
  return new Promise(resolve => {
    try {
      // ── MOBILE QR SUPPORT : validation stricte de l'entrée ──
      let qrPayload;
      if (empObj && typeof empObj === 'object' && empObj.id) {
        // Objet employé complet — FORMAT QR ATTENDU (spec)
        // EMPLOYEE QR GENERATION
        qrPayload = JSON.stringify({
          employee_id : empObj.id,
          nom         : empObj.nom         || '',
          role        : empObj.role        || '',
          etab_id     : empObj.etab_id     || (ETAB ? ETAB.id : ''),
          pin         : empObj.pin         || ''
        });
      } else if (empObj) {
        // Fallback compat : ID seul (legacy — ne devrait plus arriver)
        const fallbackId = String(empObj);
        qrPayload = JSON.stringify({ employee_id: fallbackId, nom: '', role: '', etab_id: ETAB ? ETAB.id : '', pin: '' });
      } else {
        console.error('[BarOS] generateEmpQR : empObj invalide', empObj);
        resolve(null); return;
      }

      // ── QR ERROR HANDLING : tester si qrcode-generator est disponible ──
      if (typeof qrcode === 'undefined') {
        console.error('[BarOS] generateEmpQR : librairie qrcode-generator absente');
        resolve(null); return;
      }

      const size = 400;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) { console.error('[BarOS] generateEmpQR : canvas 2d non disponible'); resolve(null); return; }

      // Niveau Q (quartile) pour garder la compatibilité Android/PWA/Chrome mobile
      // avec les données JSON plus longues — niveau H peut échouer sur gros payload
      const level = qrPayload.length > 80 ? 'Q' : 'H';
      const qr = qrcode(0, level);
      qr.addData(qrPayload, 'Byte'); // mode Byte = compatible UTF-8 + JSON
      qr.make();

      const count = qr.getModuleCount();
      const cell  = size / count;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#000000';

      for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
          if (qr.isDark(row, col)) {
            ctx.fillRect(
              Math.floor(col * cell),
              Math.floor(row * cell),
              Math.ceil(cell) + 1, // +1 évite les pixels blancs parasites mobile
              Math.ceil(cell) + 1
            );
          }
        }
      }

      resolve(canvas.toDataURL('image/png'));
    } catch(e) {
      // QR ERROR HANDLING
      console.error('[BarOS] generateEmpQR erreur:', e);
      resolve(null);
    }
  });
}

// BAROS QR FIX — EMPLOYEE QR GENERATION
// Régénère le QR d'un employé existant en récupérant ses données complètes depuis Supabase.
// QR ERROR HANDLING : toutes les étapes sont vérifiées et remontées à l'UI.
async function regenererQREmp(empId) {
  if (!empId) { showN('❌ ID employé manquant', 'error'); return; }

  showN('⏳ Récupération des données employé...', 'info');

  // 1 — Récupérer les données complètes depuis Supabase (online) ou localStorage (offline)
  let empData = null;
  try {
    const { data, error } = await db.from('employes')
      .select('id,nom,role,etab_id,pin')
      .eq('id', empId)
      .single();
    if (error) throw error;
    empData = data;
  } catch(fetchErr) {
    // MOBILE QR SUPPORT : fallback hors connexion — chercher dans le cache local
    const cached = (EMPS_DATA || []).find(e => String(e.id) === String(empId));
    if (cached) {
      empData = { id: cached.id, nom: cached.nom, role: cached.role, etab_id: cached.etab_id, pin: cached.pin };
      showN('⚠️ Mode hors connexion — données issues du cache', 'warn');
    } else {
      showN('❌ Impossible de récupérer les données : ' + (fetchErr.message || fetchErr), 'error');
      return;
    }
  }

  if (!empData || !empData.id) {
    showN('❌ Employé introuvable (ID: ' + empId + ')', 'error');
    return;
  }

  showN('⏳ Génération du QR badge...', 'info');

  // 2 — Générer le QR avec les données complètes
  const qrData = await generateEmpQR(empData);
  if (!qrData) {
    showN('❌ Échec génération QR — vérifiez la connexion et réessayez', 'error');
    return;
  }

  // 3 — Sauvegarder dans Supabase
  try {
    const { error: qrErr } = await db.from('employes').update({ qr_code: qrData }).eq('id', empId);
    if (qrErr) throw qrErr;
  } catch(saveErr) {
    // QR ERROR HANDLING : QR généré mais non persisté
    showN('⚠️ QR généré mais non sauvegardé : ' + (saveErr.message || saveErr), 'warn');
  }

  showN('✅ QR généré et sauvegardé !', 'success');

  // 4 — Afficher le QR immédiatement
  openQRFullscreen(empData.nom, empData.role || 'Badge de pointage', qrData, empId);

  // 5 — Rafraîchir la fiche
  closeM('m-emp-view');
  await _sleep(300);
  viewEmp(empId);
}

// Utilitaire — petit délai non-bloquant
function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function saveEmp() {
  const nom = document.getElementById('en').value.trim();
  const pin = document.getElementById('ep').value;
  const editId = document.getElementById('emp-edit-id').value;
  
  if (!nom) { showN('⚠️ Nom requis', 'warn'); return; }
  if (!editId && !pin) { showN('⚠️ PIN requis pour un nouvel employé', 'warn'); return; }
  
  const payload = {
    nom,
    role: document.getElementById('er').value,
    // ── BAR DE RATTACHEMENT ──
    bar_id: document.getElementById('emp-bar-id')?.value || null,
    // ── FIN BAR ──
    date_naissance: parseDate(document.getElementById('e-dob').value),
    numero_cni: document.getElementById('e-cni').value || null,
    telephone: document.getElementById('e-tel').value || null,
    ville: document.getElementById('e-ville').value || null,
    date_embauche: parseDate(document.getElementById('e-embauche').value),
    salaire: parseInt(document.getElementById('e-salaire').value) || null,
    situation_matrimoniale: document.getElementById('e-matrimonial').value,
    nb_enfants: parseInt(document.getElementById('e-enfants').value) || 0,
    contact_urgence: document.getElementById('e-urgence').value || null,
    allergies: document.getElementById('e-allergies').value || null,
    maladies_chroniques: document.getElementById('e-maladies').value || null,
    groupe_sanguin: document.getElementById('e-sanguin').value || null,
    notes_medicales: document.getElementById('e-notes-med').value || null,
    jours_travail: JSON.stringify(getJoursTravail()),
    plages_horaires: JSON.stringify(getPlages()),
  };
  if (pin) payload.pin = pin;
  if (_empPhoto) payload.photo = _empPhoto;

  let error, savedId = editId;
  if (editId) {
    ({error} = await db.from('employes').update(payload).eq('id', editId));
  } else {
    payload.etab_id = ETAB.id;
    payload.actif = true;
    const { data: inserted, error: insErr } = await db.from('employes').insert(payload).select('id').single();
    error = insErr;
    if (inserted) savedId = inserted.id;
  }

  if (error) { showN('Erreur: ' + error.message, 'error'); return; }

  // BAROS QR FIX — EMPLOYEE QR GENERATION
  // Générer le QR UNIQUEMENT APRÈS insertion Supabase réussie, avec l'ID réel.
  // Vérification stricte : ID employé requis + données complètes avant génération.
  if (savedId) {
    // 1 — Vérifier que l'ID existe (hors édition pure : récupérer les données complètes)
    let empForQR;
    if (!editId) {
      // Nouvel employé — construire l'objet depuis le payload + ID retourné
      empForQR = {
        id      : savedId,
        nom     : payload.nom,
        role    : payload.role,
        etab_id : payload.etab_id || ETAB.id,
        pin     : payload.pin || pin
      };
    } else {
      // Modification — récupérer depuis Supabase pour avoir toutes les données à jour
      try {
        const { data: updatedEmp } = await db.from('employes')
          .select('id,nom,role,etab_id,pin').eq('id', savedId).single();
        empForQR = updatedEmp || { id: savedId, nom: payload.nom, role: payload.role, etab_id: ETAB.id, pin: payload.pin || '' };
      } catch(_) {
        empForQR = { id: savedId, nom: payload.nom, role: payload.role, etab_id: ETAB.id, pin: payload.pin || '' };
      }
    }

    // 2 — Validation des champs requis avant génération
    if (!empForQR.nom || !empForQR.role || !empForQR.etab_id) {
      showN('⚠️ Données incomplètes — QR non généré (nom/rôle/étab manquant)', 'warn');
    } else {
      showN('⏳ Génération du QR badge...', 'info');

      // 3 — Générer le QR avec le format complet attendu
      // MOBILE QR SUPPORT : compatible Android / PWA / Chrome mobile
      const qrData = await generateEmpQR(empForQR);

      if (qrData) {
        // 4 — Sauvegarder dans Supabase
        const { error: qrErr } = await db.from('employes').update({ qr_code: qrData }).eq('id', savedId);
        if (qrErr) {
          // QR ERROR HANDLING : QR généré mais non persisté
          showN('⚠️ QR généré mais non sauvegardé : ' + qrErr.message, 'warn');
        } else {
          showN('✅ QR généré et sauvegardé !', 'success');
        }

        // 5 — Afficher le QR immédiatement après enregistrement
        // Fermer la modale d'abord pour que le fullscreen soit visible
        closeM('m-emp');
        await _sleep(200);
        openQRFullscreen(empForQR.nom, empForQR.role || 'Badge de pointage', qrData, savedId);
      } else {
        // QR ERROR HANDLING : échec de génération
        showN('❌ Échec génération QR badge — réessayez via la fiche employé', 'error');
      }
    }
  } else {
    showN('⚠️ ID employé introuvable — QR non généré', 'warn');
  }
  
  // Réinitialiser le formulaire
  document.getElementById('emp-edit-id').value = '';
  document.getElementById('emp-modal-title').textContent = 'Ajouter un employé';
  document.getElementById('emp-save-btn').textContent = '✓ Enregistrer l\'employé';
  ['en','e-dob','e-cni','e-tel','e-ville','ep','e-embauche','e-salaire','e-enfants','e-urgence','e-allergies','e-maladies','e-notes-med'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  clearEmpPhoto();
  document.getElementById('e-sanguin').value='';
  document.getElementById('e-matrimonial').value='Célibataire';
  // ── BAR DE RATTACHEMENT — reset ──
  _populateEmpBarSelect('');
  // ── FIN BAR ──
  resetPlanning();
  
  closeM('m-emp');
  await loadEmps();
  await loadPersonnel();
  showN(editId ? '✅ Employé mis à jour' : '✅ Employé ajouté', 'success');
}

async function toggleEmpActif(id, actif) {
  const msg = actif ? 'Confirmer le retrait de cet employé ?' : 'Réactiver cet employé ?';
  if (!confirm(msg)) return;
  await db.from('employes').update({actif: !actif}).eq('id', id);
  const fs = document.getElementById('f-statut-emp'); if(fs) fs.value = actif ? 'false' : 'true';
  await loadEmps();
  await loadPersonnel();
  showN(actif ? '⚠️ Employé retiré' : '✅ Employé réactivé', actif ? 'warn' : 'success');
}

// ===== SERVEURS =====
async function loadServeurs() {
  const todayStr=today();
  const {data:cmds}=await db.from('commandes').select('employe_nom,employe_id,montant,statut,remise,created_at').eq('etab_id',ETAB.id).eq('date_cmd',todayStr);
  const stats={};
  (cmds||[]).forEach(c=>{
    if(!c.employe_nom)return;
    if(!stats[c.employe_nom])stats[c.employe_nom]={nom:c.employe_nom,v:0,cmd:0,ann:0,rem:0};
    if(c.statut==='Livré'){stats[c.employe_nom].v+=c.montant;stats[c.employe_nom].cmd++;}
    if(c.statut==='Annulé')stats[c.employe_nom].ann++;
    if(c.remise>5)stats[c.employe_nom].rem++;
  });
  const sorted=Object.values(stats).sort((a,b)=>b.v-a.v);
  const maxV=Math.max(...sorted.map(e=>e.v),1);
  const risk=e=>{let s=0;const avg=sorted.reduce((a,x)=>a+x.ann,0)/Math.max(sorted.length,1);if(e.ann>avg*2)s+=40;if(e.rem>3)s+=20;return Math.min(100,s);};
  document.getElementById('srv-rank').innerHTML=sorted.length?sorted.map((e,i)=>{const rs=risk(e);const col=rs>60?'var(--dg)':rs>30?'var(--wn)':'var(--gn)';return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--bd)"><span style="font-size:14px">${['🥇','🥈','🥉'][i]||'  '}</span><div style="flex:1"><div style="font-size:12px;font-weight:500">${e.nom}</div><div class="pb" style="margin-top:4px"><div class="pf" style="width:${Math.round(e.v/maxV*100)}%;background:var(--ac)"></div></div></div><div style="text-align:right"><div style="font-family:Syne,sans-serif;font-size:12px;font-weight:700;color:var(--ac)">${fmt(e.v)} F</div><div style="font-size:10px;color:${col}">${rs}% risque</div></div></div>`;}).join(''):'<div style="font-size:12px;color:var(--mt);padding:15px 0">Aucune donnée ce soir</div>';
  document.getElementById('srv-cards').innerHTML=sorted.map((e,i)=>`<div class="srv-c"><div style="display:flex;align-items:center;gap:10px"><div class="av" style="background:${COLORS_EMP[i%COLORS_EMP.length]}22;color:${COLORS_EMP[i%COLORS_EMP.length]}">${ini(e.nom)}</div><div style="font-size:13px;font-weight:500;flex:1">${e.nom}</div></div><div class="srv-stats"><div><div class="ss-v" style="color:var(--ac)">${fmt(e.v)}</div><div class="ss-l">CA</div></div><div><div class="ss-v">${e.cmd}</div><div class="ss-l">Cmds</div></div><div><div class="ss-v" style="color:${e.ann>2?'var(--dg)':'var(--tx)'}">${e.ann}</div><div class="ss-l">Annulées</div></div><div><div class="ss-v" style="color:${e.rem>3?'var(--wn)':'var(--tx)'}">${e.rem}</div><div class="ss-l">Remises</div></div></div></div>`).join('');
}

// ===== ALERTES =====
async function loadAlertes() {
  const {data:als}=await db.from('alertes').select('*').eq('etab_id',ETAB.id).order('created_at',{ascending:false});
  document.getElementById('al-cr').textContent=(als||[]).filter(a=>a.type==='critical'&&!a.resolue).length;
  document.getElementById('al-wn').textContent=(als||[]).filter(a=>a.type==='warning'&&!a.resolue).length;
  document.getElementById('al-ok').textContent=(als||[]).filter(a=>a.resolue).length;
  document.getElementById('al-list').innerHTML=(als||[]).map(a=>`<div class="ar ${a.type}" style="align-items:center"><div style="font-size:18px">${a.icone}</div><div style="flex:1"><div style="font-size:11px;font-weight:500">${a.titre}</div><div style="font-size:10px;color:var(--mt)">${a.message||''} · ${a.heure||''}</div></div>${!a.resolue?`<button class="btn btn-sm btn-gn" onclick="resolveAlerte(${a.id})">✓ Résoudre</button>`:''}</div>`).join('')||'<div style="color:var(--gn);font-size:12px;padding:15px 0;text-align:center">✅ Aucune alerte</div>';
}
async function resolveAlerte(id) {
  await db.from('alertes').update({resolue:true}).eq('id',id);
  loadAlertes();updateBadges();showN('✓ Alerte résolue','success');
}

// ===== CLIENTS & FIDÉLITÉ =====
function getClientTier(pts){
  if(pts>=1000)return{label:'Platine',ic:'💎',color:'#a78bfa',remise:20,avantages:['Remise 20%','Table réservée','Boisson offerte','Accès zone Platine']};
  if(pts>=500)return{label:'Or',ic:'🥇',color:'var(--wn)',remise:10,avantages:['Remise 10%','Accès zone VIP','Priorité service']};
  if(pts>=200)return{label:'Argent',ic:'🥈',color:'var(--inf)',remise:5,avantages:['Remise 5%']};
  return{label:'Bronze',ic:'🥉',color:'var(--mt)',remise:0,avantages:['Accumulation de points']};
}

let allClients=[];
async function loadClients() {
  const {data:clis}=await db.from('clients').select('*').eq('etab_id',ETAB.id).order('points',{ascending:false});
  allClients=clis||[];
  renderClientsTable(allClients);
  document.getElementById('c-tot').textContent=allClients.length;
  document.getElementById('c-vip').textContent=allClients.filter(c=>c.points>=500&&c.points<1000).length;
  document.getElementById('c-diamond').textContent=allClients.filter(c=>c.points>=1000).length;
  document.getElementById('c-in').textContent=allClients.filter(c=>daysSince(c.dernier_passage)>=14).length;
}
function filterClients(){
  const q=document.getElementById('cli-search').value.toLowerCase();
  renderClientsTable(allClients.filter(c=>c.nom.toLowerCase().includes(q)||(c.telephone||'').includes(q)));
}
function renderClientsTable(clis){
  document.getElementById('cli-tb').innerHTML=clis.map(c=>{
    const pts=c.points||0;const tier=getClientTier(pts);
    const nextPts=pts<200?200:pts<500?500:pts<1000?1000:null;
    const prevPts=pts<200?0:pts<500?200:pts<1000?500:1000;
    const pct=nextPts?Math.round((pts-prevPts)/(nextPts-prevPts)*100):100;
    return`<tr>
    <td><strong>${c.nom}</strong>${c.credit_du>0?`<div style="font-size:10px;color:var(--dg)">Crédit: ${fmt(c.credit_du)} F</div>`:''}</td>
    <td><span style="font-size:11px;font-weight:600;color:${tier.color}">${tier.ic} ${tier.label}</span><div style="height:3px;background:var(--s2);border-radius:2px;width:55px;margin-top:3px"><div style="height:100%;width:${pct}%;background:${tier.color};border-radius:2px"></div></div></td>
    <td style="font-size:11px">${c.telephone||'—'}</td>
    <td>${c.visites||0}</td>
    <td><span style="color:var(--ac);font-weight:600">${pts} pts</span></td>
    <td style="font-size:11px">${tier.avantages.slice(0,2).map(a=>`<span style="display:inline-block;background:rgba(255,255,255,.05);border-radius:4px;padding:1px 5px;margin:1px;color:${tier.color};font-size:10px">${a}</span>`).join('')}</td>
    <td style="font-size:11px;color:var(--mt)">${c.dernier_passage?new Date(c.dernier_passage).toLocaleDateString('fr-FR'):'—'}</td>
    <td style="white-space:nowrap">
      <button class="btn btn-sm btn-gn" onclick="addPts('${c.id}',${pts},${c.visites||0})">+10</button>
      <button class="btn btn-sm btn-ac" onclick="openProfilClient('${c.id}')">👤</button>
      ${c.telephone?`<button class="btn btn-sm" onclick="waClient('${c.nom}','${c.telephone}')">💬</button>`:''}
    </td></tr>`;
  }).join('')||`<tr><td colspan="8" style="text-align:center;color:var(--mt);padding:20px">Aucun client enregistré</td></tr>`;
}
function openProfilClient(id){
  const c=allClients.find(x=>x.id===id);if(!c)return;
  const pts=c.points||0;const tier=getClientTier(pts);
  const nextPts=pts<200?200:pts<500?500:pts<1000?1000:null;
  const prevPts=pts<200?0:pts<500?200:pts<1000?500:1000;
  const pct=nextPts?Math.round((pts-prevPts)/(nextPts-prevPts)*100):100;
  const nextLabel=pts<200?'Argent':pts<500?'Or':pts<1000?'Platine':null;
  document.getElementById('profil-title').textContent='👤 '+c.nom;
  document.getElementById('profil-body').innerHTML=`
    <div style="background:${tier.color}22;border:1px solid ${tier.color}44;border-radius:var(--rs);padding:14px;margin-bottom:14px;text-align:center">
      <div style="font-size:32px;margin-bottom:4px">${tier.ic}</div>
      <div style="font-family:Syne,sans-serif;font-size:18px;font-weight:700;color:${tier.color}">${tier.label}</div>
      <div style="font-size:13px;color:var(--mt);margin-top:2px">${pts} points · ${c.visites||0} visites</div>
      ${nextPts?`<div style="font-size:11px;color:var(--mt);margin-top:8px">Encore ${nextPts-pts} pts pour ${nextLabel}</div><div style="height:5px;background:var(--s2);border-radius:3px;margin-top:5px"><div style="height:100%;width:${pct}%;background:${tier.color};border-radius:3px"></div></div>`:'<div style="font-size:11px;color:#a78bfa;margin-top:6px">✨ Niveau maximum !</div>'}
    </div>
    <div style="margin-bottom:12px"><div style="font-size:11px;color:var(--mt);margin-bottom:7px;text-transform:uppercase;letter-spacing:.07em">🎁 Avantages actifs</div>
    ${tier.avantages.map(a=>`<div style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--s2);border-radius:var(--rs);margin-bottom:5px;font-size:12px"><span style="color:${tier.color}">✓</span> ${a}</div>`).join('')}
    ${tier.remise>0?`<div style="margin-top:8px;padding:9px;background:rgba(200,245,90,.07);border:1px solid rgba(200,245,90,.2);border-radius:var(--rs);font-size:12px;color:var(--ac)">💡 Remise automatique <strong>${tier.remise}%</strong> sur chaque commande</div>`:''}
    </div>
    <div style="display:flex;gap:7px">
      ${c.telephone?`<button class="btn btn-gn" style="flex:1;justify-content:center" onclick="waClient('${c.nom}','${c.telephone}')">💬 WhatsApp</button>`:''}
      <button class="btn btn-ac" style="flex:1;justify-content:center" onclick="addPts('${c.id}',${pts},${c.visites||0});closeM('m-cli-profil')">⭐ +10 pts</button>
    </div>`;
  openM('m-cli-profil');
}
async function addPts(id, pts, vis) {
  await db.from('clients').update({points:pts+10,visites:vis+1,dernier_passage:today()}).eq('id',id);
  loadClients();showN('⭐ +10 points ajoutés','success');
}
function waClient(nom, tel) {
  const tier=getClientTier((allClients.find(c=>c.nom===nom)||{}).points||0);
  const vip=tier.label!=='Bronze';
  const msg=vip?`${tier.ic} Bonjour ${nom.split(' ')[0]}, notre client ${tier.label} ! Votre ${tier.label==='Platine'?'table est réservée':'remise de '+tier.remise+'% vous attend'} ce vendredi au ${ETAB.nom}. À bientôt !`:`🍹 Bonjour ${nom.split(' ')[0]} ! Votre verre vous attend ce vendredi au ${ETAB.nom}. À bientôt !`;
  window.open('https://wa.me/'+tel.replace(/[^0-9]/g,'')+'?text='+encodeURIComponent(msg),'_blank');
}
async function addCli() {
  const nom=document.getElementById('cn').value.trim();if(!nom){showN('⚠️ Nom requis','warn');return;}
  const {error}=await db.from('clients').insert({etab_id:ETAB.id,nom,telephone:document.getElementById('ct').value.trim(),visites:1,points:10,credit_autorise:parseInt(document.getElementById('cc').value)||0,credit_du:0,dernier_passage:today()});
  if(error){showN('Erreur: '+error.message,'error');return;}
  closeM('m-cli');loadClients();showN('✅ '+nom+' enregistré','success');
  ['cn','ct','cc'].forEach(id=>document.getElementById(id).value='');
}

// ===== MARKETING — onglets =====
function switchMktTab(tab) {
  ['sms','evt'].forEach(t => {
    document.getElementById('mkt-pnl-'+t).style.display = t===tab ? '' : 'none';
    const btn = document.getElementById('mkt-tab-'+t);
    if (btn) { btn.classList.toggle('on', t===tab); btn.style.background = t===tab ? 'var(--ac)' : ''; btn.style.color = t===tab ? '#0a0a0f' : ''; }
  });
  if (tab === 'sms') { updSms(); checkNotchpayKey(); }
  if (tab === 'evt') { loadMarketing(); }
}

// ─── Helpers segment ───
function getSegment(val) {
  const clis = allClients || [];
  if (val === 'inactive') return clis.filter(c => daysSince(c.dernier_passage) >= 14);
  if (val === 'silver')   return clis.filter(c => (c.points||0) >= 200 && (c.points||0) < 500);
  if (val === 'gold')     return clis.filter(c => (c.points||0) >= 500 && (c.points||0) < 1000);
  if (val === 'diamond')  return clis.filter(c => (c.points||0) >= 1000);
  return clis;
}

function buildMsg(template, client) {
  return template
    .replace(/{prenom}/g, (client.nom||'').split(' ')[0] || client.nom || '')
    .replace(/{etablissement}/g, ETAB?.nom || '')
    .replace(/{tier}/g, getClientTier(client.points||0).label)
    .replace(/{points}/g, client.points||0);
}

function insertSmsVar(v) {
  const ta = document.getElementById('sms-msg');
  if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + v + ta.value.slice(e);
  ta.selectionStart = ta.selectionEnd = s + v.length;
  ta.focus(); updSms();
}

// ─── SMS NOTCHPAY ───
function checkNotchpayKey() {
  const key = localStorage.getItem('baros_notchpay_key_' + (ETAB?.id||''));
  const el = document.getElementById('sms-api-status');
  if (!el) return;
  if (key) {
    el.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(74,222,128,.08);border:1px solid rgba(74,222,128,.2);border-radius:var(--rs);font-size:11px;color:var(--gn)"><span>✅</span> Clé Notchpay configurée — envoi SMS actif</div>`;
  } else {
    el.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(255,180,68,.08);border:1px solid rgba(255,180,68,.25);border-radius:var(--rs);font-size:11px;color:var(--wn)"><span>⚠️</span> Clé API manquante — <span onclick="switchTab('config');setTimeout(()=>document.getElementById('cfg-notchpay-key')?.focus(),300)" style="color:var(--ac);cursor:pointer;text-decoration:underline">Configurer dans Config → Intégrations</span></div>`;
  }
}

function updSms() {
  const msg = document.getElementById('sms-msg')?.value || '';
  const seg = getSegment(document.getElementById('sms-tgt')?.value || 'all');
  const avecTel = seg.filter(c => c.telephone);
  document.getElementById('sms-cnt').textContent = msg.length;
  document.getElementById('sms-nb').textContent = avecTel.length;
  document.getElementById('sms-cost').textContent = fmt(avecTel.length * 5);
  const sample = seg[0] || { nom: 'Marie', points: 150 };
  document.getElementById('sms-prv').textContent = msg ? buildMsg(msg, sample) : 'Votre message...';
}

async function sendSmsNotchpay() {
  const key = localStorage.getItem('baros_notchpay_key_' + (ETAB?.id||''));
  if (!key) { showN('⚠️ Clé Notchpay manquante — configurez-la dans Config', 'warn'); return; }
  const msg = (document.getElementById('sms-msg')?.value || '').trim();
  if (!msg) { showN('⚠️ Message vide', 'warn'); return; }
  if (msg.length > 160) { showN('⚠️ Message trop long (max 160 car.)', 'warn'); return; }
  const seg = getSegment(document.getElementById('sms-tgt')?.value || 'all');
  const dest = seg.filter(c => c.telephone);
  if (!dest.length) { showN('⚠️ Aucun destinataire avec numéro', 'warn'); return; }

  const sender = localStorage.getItem('baros_sms_sender_' + (ETAB?.id||'')) || (ETAB?.nom||'BarOS').slice(0, 11).replace(/\s/g,'');
  const btn = document.getElementById('sms-send-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Envoi en cours...'; }

  let ok = 0, err = 0;
  const BATCH = 5; // envoi par lots pour ne pas surcharger
  for (let i = 0; i < dest.length; i += BATCH) {
    const lot = dest.slice(i, i + BATCH);
    await Promise.all(lot.map(async cli => {
      const msgFinal = buildMsg(msg, cli);
      const tel = (cli.telephone||'').replace(/\s/g,'');
      try {
        const resp = await fetch('https://api.notchpay.co/sms', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ phone: tel, message: msgFinal, sender_id: sender })
        });
        const data = await resp.json();
        if (resp.ok && (data.status === 'success' || data.code === 200)) ok++;
        else { err++; console.warn('Notchpay SMS err:', data); }
      } catch(e) { err++; }
    }));
    if (btn) btn.textContent = `⏳ ${ok}/${dest.length} envoyés...`;
    await new Promise(r => setTimeout(r, 300));
  }

  if (btn) { btn.disabled = false; btn.textContent = '📱 Envoyer via Notchpay'; }

  // Enregistrer la campagne
  await db.from('campagnes').insert({
    etab_id: ETAB.id,
    cible: document.getElementById('sms-tgt').options[document.getElementById('sms-tgt').selectedIndex].text,
    message: msg,
    nb_destinataires: dest.length,
    resultat: ok + ' SMS envoyés' + (err ? ', ' + err + ' échecs' : ''),
    date_camp: today(),
    canal: 'sms'
  });

  document.getElementById('sms-msg').value = ''; updSms();
  loadMarketing();
  showN(ok + ' SMS envoyés ✅' + (err ? ' · ' + err + ' échecs' : ''), ok > 0 ? 'success' : 'error');
}

async function loadMarketing() {
  const {data:camps} = await db.from('campagnes').select('*').eq('etab_id', ETAB.id).order('created_at', {ascending:false}).limit(15);
  const html = (camps||[]).map(c => {
    const canal = c.canal || 'sms';
    const ic = canal === 'whatsapp' ? '💬' : '📱';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd)">
      <div>
        <div style="font-size:12px;font-weight:500">${ic} ${c.cible}</div>
        <div style="font-size:10px;color:var(--mt)">${c.date_camp} · ${c.nb_destinataires} dest.</div>
        <div style="font-size:10px;color:var(--mt);margin-top:2px;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.message||''}</div>
      </div>
      <div style="font-size:12px;color:var(--gn);font-weight:600;min-width:80px;text-align:right">${c.resultat}</div>
    </div>`;
  }).join('') || '<div style="font-size:12px;color:var(--mt);padding:10px 0">Aucune campagne</div>';
  ['camp-h-sms'].forEach(id => { const el = document.getElementById(id); if(el) el.innerHTML = html; });
  const {data:evts} = await db.from('evenements').select('*').eq('etab_id', ETAB.id).order('date_evt', {ascending:true});
  document.getElementById('evts').innerHTML = (evts||[]).map(e => {
    const pct = Math.round((e.vendus/Math.max(e.places,1))*100);
    return `<div style="display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--bd)">
      <div style="flex:1"><div style="font-weight:500;font-size:12px">${e.nom}</div><div style="font-size:10px;color:var(--mt)">${e.date_evt} · ${fmt(e.prix_entree)} FCFA</div></div>
      <div style="min-width:100px"><div style="font-size:10px;text-align:right;margin-bottom:2px">${e.vendus}/${e.places}</div><div class="pb"><div class="pf" style="width:${pct}%;background:var(--ac)"></div></div></div>
      <div style="font-family:Syne,sans-serif;font-size:13px;font-weight:700;color:var(--ac);min-width:70px;text-align:right">${fmt(e.vendus*e.prix_entree)} F</div>
    </div>`;
  }).join('') || '<div style="font-size:12px;color:var(--mt);padding:10px 0">Aucun événement</div>';
}

// Ancienne sendSms() maintenue pour compatibilité interne (redirige vers updSms)
function sendSms() { sendSmsNotchpay(); }

async function addEvt() {
  const nom=document.getElementById('ev-n').value.trim();const d=parseDate(document.getElementById('ev-d').value);
  if(!nom||!d){showN('⚠️ Nom et date requis','warn');return;}
  const {error}=await db.from('evenements').insert({etab_id:ETAB.id,nom,date_evt:d,prix_entree:parseInt(document.getElementById('ev-p').value)||0,places:parseInt(document.getElementById('ev-pl').value)||100,vendus:0});
  if(error){showN('Erreur: '+error.message,'error');return;}
  closeM('m-evt');loadMarketing();showN('✅ Événement créé','success');
}

// ===== RAPPORTS =====
let RPT_PERIOD = 'day';
let RPT_FROM = null, RPT_TO = null;

function setRptPeriod(p) {
  RPT_PERIOD = p;
  ['day','week','month','year'].forEach(k => {
    const btn = document.getElementById('rpt-btn-'+k);
    if (btn) { btn.style.borderColor = k===p ? 'var(--ac)' : ''; btn.style.color = k===p ? 'var(--ac)' : ''; }
  });
  if (p === 'custom') {
    RPT_FROM = parseDate(document.getElementById('rpt-date-from').value);
    RPT_TO = parseDate(document.getElementById('rpt-date-to').value);
    if (!RPT_FROM || !RPT_TO) { showN('⚠️ Sélectionne une plage de dates','warn'); return; }
  }
  loadRapports();
}

function getRptDates() {
  const now = new Date(); const todayStr = today();
  if (RPT_PERIOD === 'day') return { from: todayStr, to: todayStr, lbl: 'aujourd\'hui', chartDays: 7 };
  if (RPT_PERIOD === 'week') {
    const d = new Date(); d.setDate(d.getDate()-6);
    return { from: d.toISOString().slice(0,10), to: todayStr, lbl: '7 derniers jours', chartDays: 7 };
  }
  if (RPT_PERIOD === 'month') {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: d.toISOString().slice(0,10), to: todayStr, lbl: 'ce mois', chartDays: 30 };
  }
  if (RPT_PERIOD === 'year') {
    return { from: now.getFullYear()+'-01-01', to: todayStr, lbl: 'cette année', chartDays: 12 };
  }
  return { from: RPT_FROM, to: RPT_TO, lbl: RPT_FROM+' → '+RPT_TO, chartDays: 7 };
}

async function loadRapports() {
  const { from, to, lbl, chartDays } = getRptDates();
  document.getElementById('r-period-lbl').textContent = lbl;
  const {data:cmds} = await db.from('commandes')
    .select('montant,paiement,statut,articles,employe_nom,date_cmd,created_at')
    .eq('etab_id',ETAB.id).eq('statut','Livré')
    .gte('date_cmd',from).lte('date_cmd',to);
  const rows = cmds||[];
  const ca = rows.reduce((a,c)=>a+c.montant,0);
  const nb = rows.length;
  const avg = nb ? Math.round(ca/nb) : 0;
  document.getElementById('r-ca').textContent = fmt(ca);
  document.getElementById('r-cmd').textContent = nb;
  document.getElementById('r-avg').textContent = fmt(avg);
  const {data:stk} = await db.from('stock').select('quantite_initiale,quantite,vendu_systeme,prix_vente,nom').eq('etab_id',ETAB.id);
  const pertes = (stk||[]).reduce((a,s)=>a+Math.max(0,(s.quantite_initiale-s.quantite)-s.vendu_systeme)*s.prix_vente,0);
  document.getElementById('r-perte').textContent = fmt(pertes)+' F';
  const cash = rows.filter(c=>c.paiement==='Cash').reduce((a,c)=>a+c.montant,0);
  const momo = rows.filter(c=>c.paiement==='MTN MoMo'||c.paiement==='Orange Money').reduce((a,c)=>a+c.montant,0);
  const card = rows.filter(c=>c.paiement==='Carte bancaire'||c.paiement==='Carte').reduce((a,c)=>a+c.montant,0);
  const tot = ca||1;
  document.getElementById('rpt-pay').innerHTML=[
    {l:'💵 Cash',v:cash,c:'var(--ac)'},{l:'📱 MoMo/OM',v:momo,c:'var(--ac2)'},{l:'💳 Carte',v:card,c:'var(--inf)'}
  ].map(p=>`<div style="padding:7px 0;border-bottom:1px solid var(--bd)"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>${p.l}</span><strong style="color:${p.c}">${fmt(p.v)} F (${Math.round((p.v/tot)*100)}%)</strong></div><div class="pb"><div class="pf" style="width:${Math.round((p.v/tot)*100)}%;background:${p.c}"></div></div></div>`).join('');
  const vals=[],lbls=[];
  if (RPT_PERIOD==='year') {
    document.getElementById('rpt-chart-title').textContent='CA par mois';
    const months=['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
    for(let m=0;m<12;m++){vals.push(rows.filter(c=>new Date(c.date_cmd).getMonth()===m).reduce((a,c)=>a+c.montant,0));lbls.push(months[m]);}
  } else if (RPT_PERIOD==='month') {
    document.getElementById('rpt-chart-title').textContent='CA par semaine';
    for(let w=0;w<5;w++){vals.push(rows.filter(c=>Math.floor((new Date(c.date_cmd).getDate()-1)/7)===w).reduce((a,c)=>a+c.montant,0));lbls.push('S'+(w+1));}
  } else {
    document.getElementById('rpt-chart-title').textContent='CA par jour';
    const days=['D','L','M','M','J','V','S'];
    for(let i=chartDays-1;i>=0;i--){const dd=new Date();dd.setDate(dd.getDate()-i);const ds=dd.toISOString().slice(0,10);vals.push(rows.filter(c=>c.date_cmd===ds).reduce((a,c)=>a+c.montant,0));lbls.push(days[dd.getDay()]);}
  }
  chartBars(document.getElementById('rpt-chart'),vals,lbls,80);
  const srvStats={};
  rows.forEach(c=>{if(!c.employe_nom)return;if(!srvStats[c.employe_nom])srvStats[c.employe_nom]={n:c.employe_nom,v:0,nb:0};srvStats[c.employe_nom].v+=c.montant;srvStats[c.employe_nom].nb++;});
  const sorted=Object.values(srvStats).sort((a,b)=>b.v-a.v);
  const maxV=Math.max(...sorted.map(e=>e.v),1);
  document.getElementById('rpt-serveurs').innerHTML=sorted.length?sorted.map((e,i)=>`<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--bd)"><span style="font-size:14px">${['🥇','🥈','🥉'][i]||'  '}</span><div style="flex:1"><div style="font-size:12px;font-weight:500">${e.n}</div><div class="pb" style="margin-top:3px"><div class="pf" style="width:${Math.round(e.v/maxV*100)}%;background:var(--ac)"></div></div></div><div style="text-align:right"><div style="font-family:Syne,sans-serif;font-size:12px;font-weight:700;color:var(--ac)">${fmt(e.v)} F</div><div style="font-size:10px;color:var(--mt)">${e.nb} cmds</div></div></div>`).join(''):'<div style="font-size:12px;color:var(--mt);padding:12px 0">Aucune donnée pour cette période</div>';
  const lowStk=(stk||[]).filter(s=>s.quantite<=5).slice(0,6);
  document.getElementById('rpt-stock-critique').innerHTML=lowStk.length?lowStk.map(s=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--bd)"><span style="font-size:12px">${s.nom||'—'}</span><span style="font-size:12px;font-weight:600;color:${s.quantite<=2?'var(--dg)':'var(--wn)'}">${s.quantite} restants</span></div>`).join(''):'<div style="font-size:12px;color:var(--gn);padding:12px 0">✅ Tous les stocks OK</div>';

  // ── Charger les pointages de la période ──
  const {data: ptgRows} = await db.from('pointages')
    .select('employe_id,date_pointage,heure_arrivee,heure_sortie,statut')
    .eq('etab_id', ETAB.id)
    .gte('date_pointage', from)
    .lte('date_pointage', to)
    .order('date_pointage', {ascending: true});
  window._rptPtgRows = ptgRows || [];
  window._rptFrom    = from;
  window._rptTo      = to;

  // Peupler le filtre employé
  const sel = document.getElementById('rpt-ptg-emp');
  const oldVal = sel.value;
  sel.innerHTML = '<option value="">Tous les employés</option>' +
    EMPS.map(e => `<option value="${e.id}">${e.nom}</option>`).join('');
  sel.value = oldVal;

  renderRptPointage();
}

// ── Helpers durée ──
function _hhmm2min(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function _min2h(min) {
  if (min == null || min < 0) return '—';
  return Math.floor(min / 60) + 'h' + String(min % 60).padStart(2, '0');
}

let _ptgDetailOpen = false;
function toggleRptPtgDetail() {
  _ptgDetailOpen = !_ptgDetailOpen;
  renderRptPointage();
}

function renderRptPointage() {
  const rows   = window._rptPtgRows || [];
  const from   = window._rptFrom;
  const to     = window._rptTo;
  const empFilter = document.getElementById('rpt-ptg-emp')?.value || '';

  // Regrouper par employé
  const byEmp = {};
  rows.forEach(r => {
    if (empFilter && r.employe_id !== empFilter) return;
    if (!byEmp[r.employe_id]) byEmp[r.employe_id] = [];
    byEmp[r.employe_id].push(r);
  });

  // Calcul jours de la période
  const d1 = new Date(from), d2 = new Date(to);
  const nbJoursPeriode = Math.round((d2 - d1) / 86400000) + 1;

  // KPIs globaux
  const allPresences = rows.filter(r => !empFilter || r.employe_id === empFilter);
  const totalJours   = allPresences.length;
  const totalRetards = allPresences.filter(r => r.statut === 'retard').length;
  let   totalMinutes = 0;
  allPresences.forEach(r => {
    const debut = _hhmm2min(r.heure_arrivee);
    const fin   = _hhmm2min(r.heure_sortie);
    if (debut != null && fin != null && fin > debut) totalMinutes += (fin - debut);
  });
  const nbEmps = Object.keys(byEmp).length;

  document.getElementById('rpt-ptg-kpis').innerHTML = [
    {l:'👥 Employés actifs', v: nbEmps,              s:'sur la période'},
    {l:'📅 Jours travaillés', v: totalJours,          s:'présences totales'},
    {l:'⏱ Heures totales',   v: _min2h(totalMinutes), s:'cumulées'},
    {l:'⚠️ Retards',         v: totalRetards,          s:'enregistrés'},
  ].map(k => `<div class="kpi"><div class="kpi-l">${k.l}</div><div class="kpi-v">${k.v}</div><div class="dt nt">${k.s}</div></div>`).join('');

  // Tableau récap par employé
  if (!Object.keys(byEmp).length) {
    document.getElementById('rpt-ptg-table').innerHTML = '<div style="color:var(--mt);font-size:12px;padding:16px 0">Aucun pointage sur cette période</div>';
    document.getElementById('rpt-ptg-detail').innerHTML = '';
    return;
  }

  const TH = s => `<th style="text-align:left;padding:6px 8px;font-size:10px;color:var(--mt);font-weight:600;border-bottom:1px solid var(--bd);white-space:nowrap">${s}</th>`;
  const TD = (s, bold, col) => `<td style="padding:6px 8px;font-size:11px;${bold?'font-weight:700;':''}${col?'color:'+col+';':''}">${s}</td>`;

  let tableHtml = `<table style="width:100%;border-collapse:collapse">
    <thead><tr>${TH('Employé')}${TH('Présences')}${TH('H. travaillées')}${TH('Moy/jour')}${TH('Retards')}${TH('Arrivée moy.')}${TH('Sortie moy.')}</tr></thead><tbody>`;

  Object.entries(byEmp).forEach(([empId, ptgs]) => {
    const emp = EMPS.find(e => e.id === empId);
    const nom = emp ? emp.nom : empId.slice(0, 8) + '…';
    const presents  = ptgs.length;
    const retards   = ptgs.filter(p => p.statut === 'retard').length;
    let   mins = 0, arrivees = [], sorties = [];
    ptgs.forEach(p => {
      const d = _hhmm2min(p.heure_arrivee), f = _hhmm2min(p.heure_sortie);
      if (d != null) arrivees.push(d);
      if (f != null) sorties.push(f);
      if (d != null && f != null && f > d) mins += (f - d);
    });
    const moy    = presents ? Math.round(mins / presents) : 0;
    const arrMoy = arrivees.length ? Math.round(arrivees.reduce((a,b)=>a+b,0)/arrivees.length) : null;
    const sorMoy = sorties.length  ? Math.round(sorties.reduce((a,b)=>a+b,0)/sorties.length)   : null;
    tableHtml += `<tr style="border-bottom:1px solid var(--bd)">
      ${TD(nom, true)}
      ${TD(presents + 'j')}
      ${TD(_min2h(mins), true, 'var(--ac)')}
      ${TD(_min2h(moy))}
      ${TD(retards > 0 ? retards : '—', false, retards > 0 ? 'var(--dg)' : '')}
      ${TD(arrMoy != null ? _min2h(arrMoy) : '—')}
      ${TD(sorMoy != null ? _min2h(sorMoy) : '—')}
    </tr>`;
  });
  tableHtml += '</tbody></table>';
  document.getElementById('rpt-ptg-table').innerHTML = tableHtml;

  // Détail jour par jour
  if (_ptgDetailOpen) {
    let detailHtml = '';
    Object.entries(byEmp).forEach(([empId, ptgs]) => {
      const emp = EMPS.find(e => e.id === empId);
      const nom = emp ? emp.nom : '—';
      detailHtml += `<div style="margin-bottom:14px">
        <div style="font-size:12px;font-weight:700;color:var(--ac);margin-bottom:6px">👤 ${nom}</div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>${TH('Date')}${TH('Arrivée')}${TH('Sortie')}${TH('Durée')}${TH('Statut')}</tr></thead><tbody>`;
      ptgs.forEach(p => {
        const d   = _hhmm2min(p.heure_arrivee), f = _hhmm2min(p.heure_sortie);
        const dur = (d != null && f != null && f > d) ? _min2h(f - d) : '—';
        const dateStr = new Date(p.date_pointage).toLocaleDateString('fr-FR', {day:'2-digit', month:'short', weekday:'short'});
        const statutColor = {retard:'var(--dg)', avance:'var(--inf)', ok:'var(--gn)'}[p.statut] || 'var(--mt)';
        detailHtml += `<tr style="border-bottom:1px solid var(--bd)">
          ${TD(dateStr)}
          ${TD(p.heure_arrivee || '—')}
          ${TD(p.heure_sortie  || '—')}
          ${TD(dur, true)}
          ${TD(p.statut || '—', false, statutColor)}
        </tr>`;
      });
      detailHtml += '</tbody></table></div>';
    });
    document.getElementById('rpt-ptg-detail').style.display = 'block';
    document.getElementById('rpt-ptg-detail').innerHTML = detailHtml;
  } else {
    document.getElementById('rpt-ptg-detail').style.display = 'none';
  }
}

// ===== EXPORT PDF RAPPORT — Style LaTeX =====
async function exportRapportPDF() {
  if(!window.jspdf){showN('\u26a0\ufe0f Librairie PDF en chargement, r\u00e9essaie','warn');return;}

  // ── Normalisation UTF-8 → Latin-1 pour jsPDF helvetica ───────────────────
  // helvetica dans jsPDF utilise l'encodage WinAnsi (Latin-1 + extensions)
  // Les caractères accentués doivent être convertis via leur équivalent Latin-1
  const _pdfTxt = (str) => {
    if (!str && str !== 0) return '';
    return String(str)
      .replace(/\u00e0/g,'a').replace(/\u00e2/g,'a').replace(/\u00e4/g,'a')
      .replace(/\u00e9/g,'e').replace(/\u00e8/g,'e').replace(/\u00ea/g,'e').replace(/\u00eb/g,'e')
      .replace(/\u00ee/g,'i').replace(/\u00ef/g,'i')
      .replace(/\u00f4/g,'o').replace(/\u00f6/g,'o').replace(/\u00f9/g,'u')
      .replace(/\u00fb/g,'u').replace(/\u00fc/g,'u')
      .replace(/\u00e7/g,'c').replace(/\u00f1/g,'n')
      .replace(/\u00c0/g,'A').replace(/\u00c2/g,'A').replace(/\u00c4/g,'A')
      .replace(/\u00c9/g,'E').replace(/\u00c8/g,'E').replace(/\u00ca/g,'E').replace(/\u00cb/g,'E')
      .replace(/\u00ce/g,'I').replace(/\u00cf/g,'I')
      .replace(/\u00d4/g,'O').replace(/\u00d6/g,'O').replace(/\u00d9/g,'U')
      .replace(/\u00db/g,'U').replace(/\u00dc/g,'U')
      .replace(/\u00c7/g,'C').replace(/\u00d1/g,'N')
      .replace(/\u0153/g,'oe').replace(/\u0152/g,'OE')
      .replace(/\u00e6/g,'ae').replace(/\u00c6/g,'AE')
      .replace(/\u2019/g,"'").replace(/\u2018/g,"'")
      .replace(/\u201c/g,'"').replace(/\u201d/g,'"')
      .replace(/\u2014/g,'--').replace(/\u2013/g,'-')
      .replace(/\u2026/g,'...').replace(/\u2022/g,'*')
      .replace(/[^\x00-\xFF]/g,'');
  };

  const {from,to,lbl}=getRptDates();

  // ── Chargement des données ─────────────────────────────────────────────
  const [
    {data:cmds},
    {data:stkAll},
    {data:alertesAll},
  ] = await Promise.all([
    db.from('commandes').select('montant,paiement,statut,articles,employe_nom,date_cmd,heure')
      .eq('etab_id',ETAB.id).eq('statut','Livr\u00e9')
      .gte('date_cmd',from).lte('date_cmd',to).order('date_cmd',{ascending:false}),
    db.from('stock').select('nom,quantite,quantite_initiale,vendu_systeme,prix_vente,prix_achat,seuil_alerte,updated_at')
      .eq('etab_id',ETAB.id).order('nom',{ascending:true}),
    db.from('alertes').select('titre,type,statut,created_at,resolue_at')
      .eq('etab_id',ETAB.id)
      .gte('created_at', from+'T00:00:00').lte('created_at', to+'T23:59:59')
      .order('created_at',{ascending:false}),
  ]);

  const rows=cmds||[];
  const ca=rows.reduce((a,c)=>a+c.montant,0);
  const nb=rows.length;
  const avg=nb?Math.round(ca/nb):0;
  const cash=rows.filter(c=>c.paiement==='Cash').reduce((a,c)=>a+c.montant,0);
  const momo=rows.filter(c=>c.paiement==='MTN MoMo'||c.paiement==='Orange Money').reduce((a,c)=>a+c.montant,0);
  const card=rows.filter(c=>c.paiement==='Carte bancaire'||c.paiement==='Carte').reduce((a,c)=>a+c.montant,0);
  const srvStats={};rows.forEach(c=>{if(!c.employe_nom)return;if(!srvStats[c.employe_nom])srvStats[c.employe_nom]={v:0,nb:0};srvStats[c.employe_nom].v+=c.montant;srvStats[c.employe_nom].nb++;});
  const topSrvs=Object.entries(srvStats).sort((a,b)=>b[1].v-a[1].v).slice(0,5);

  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({unit:'mm',format:'a4'});
  const PW=210,PH=297,ML=20,MR=20,MT=24,CW=PW-ML-MR;

  const ink=[30,35,45];
  const sub=[105,110,125];
  const muted=[160,163,175];
  const acc=[55,88,148];
  const accL=[100,130,185];
  const rule=[210,213,222];
  const bgH=[242,244,248];
  const bgA=[250,251,254];
  const red=[200,60,60];
  const grn=[60,160,80];
  const orn=[200,130,30];

  const hRule=(y,lw=0.25,col=rule)=>{doc.setDrawColor(...col);doc.setLineWidth(lw);doc.line(ML,y,PW-MR,y);};
  const secTitle=(label,y)=>{
    doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(...acc);
    doc.text(_pdfTxt(label.toUpperCase()),ML,y);
    hRule(y+2,0.35,rule);
  };

  // ── EN-TÊTE ───────────────────────────────────────────────────────────
  let lx=ML;
  if(LOGO){try{doc.addImage(LOGO,'',ML,MT-8,16,13);lx=ML+20;}catch(e){}}
  doc.setFont('helvetica','bold');doc.setFontSize(13);doc.setTextColor(...ink);
  doc.text('BarOS',lx,MT);
  doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(...sub);
  doc.text(_pdfTxt((ETAB.nom||'').toUpperCase()),lx,MT+6);
  const etabInfo=[ETAB.ville,ETAB.tel?'Tel : '+ETAB.tel:null].filter(Boolean).join('  \xb7  ');
  if(etabInfo)doc.text(_pdfTxt(etabInfo),lx,MT+11);

  doc.setFont('helvetica','bold');doc.setFontSize(17);doc.setTextColor(...ink);
  doc.text('Rapport de gestion',PW-MR,MT,{align:'right'});
  doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(...sub);
  doc.text(_pdfTxt(lbl.charAt(0).toUpperCase()+lbl.slice(1)),PW-MR,MT+7,{align:'right'});
  doc.setFontSize(7.5);doc.setTextColor(...muted);
  doc.text('Genere le '+new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'}),PW-MR,MT+13,{align:'right'});

  let y=MT+19;
  hRule(y,0.5,[acc[0]+50,acc[1]+40,acc[2]+30]);
  y+=8;

  // ── INDICATEURS CLES ─────────────────────────────────────────────────
  secTitle('Indicateurs cles',y);y+=6;
  const kpis=[
    {l:'Chiffre d\'affaires',v:fmt(ca)+' F',s:'periode selectionnee'},
    {l:'Commandes livrees',v:String(nb),s:'validees barman'},
    {l:'Ticket moyen',v:fmt(avg)+' F',s:'par commande'},
    {l:'Reglements cash',v:Math.round((cash/(ca||1))*100)+'%',s:'part du total'},
  ];
  const kW=(CW-3)/4;
  kpis.forEach((k,i)=>{
    const kx=ML+i*(kW+1);
    doc.setFillColor(...bgH);doc.rect(kx,y,kW,21,'F');
    doc.setDrawColor(...rule);doc.setLineWidth(0.2);doc.rect(kx,y,kW,21,'S');
    doc.setFillColor(...acc);doc.rect(kx,y,1.5,21,'F');
    doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.setTextColor(...muted);
    doc.text(_pdfTxt(k.l),kx+4.5,y+6.5);
    doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor(...acc);
    doc.text(_pdfTxt(k.v),kx+4.5,y+14.5);
    doc.setFont('helvetica','normal');doc.setFontSize(6);doc.setTextColor(...muted);
    doc.text(_pdfTxt(k.s),kx+4.5,y+19.5);
  });
  y+=29;

  // ── VUE PAR PERIODE DE SERVICE ─────────────────────────────────────────
  const byP=(p)=>{
    const r=rows.filter(c=>{const h=(c.heure||'00:00').slice(0,5);if(p==='jour')return h>=H_JOUR.debut&&h<=H_JOUR.fin;if(p==='nuit')return h<H_JOUR.debut||h>H_JOUR.fin;return true;});
    const caP=r.reduce((a,c)=>a+c.montant,0);const nb=r.length;return{ca:caP,nb,avg:nb?Math.round(caP/nb):0};
  };
  const pJ=byP('jour'),pN=byP('nuit'),pT=byP('tout');
  secTitle('Vue par periode de service',y);y+=6;
  const p3W=(CW-4)/3;
  [{l:'Journee  06h \u2192 18h',d:pJ,col:[210,130,30]},{l:'Soir / Nuit  18h \u2192 06h',d:pN,col:[100,85,200]},{l:'Total du jour',d:pT,col:acc}].forEach((p,i)=>{
    const px=ML+i*(p3W+2);
    doc.setFillColor(...bgH);doc.rect(px,y,p3W,28,'F');
    doc.setDrawColor(...rule);doc.setLineWidth(0.2);doc.rect(px,y,p3W,28,'S');
    doc.setFillColor(...p.col);doc.rect(px,y,p3W,1.8,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(7);doc.setTextColor(...p.col);doc.text(_pdfTxt(p.l),px+4,y+7);
    doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor(...ink);doc.text(fmt(p.d.ca)+' F',px+4,y+16);
    doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(...sub);
    doc.text(_pdfTxt(p.d.nb+' cmd  |  moy. '+fmt(p.d.avg)+' F'),px+4,y+22.5);
    const bw=p3W-8;const pct=pT.ca>0?Math.round(p.d.ca/pT.ca*100):0;
    doc.setFillColor(...rule);doc.rect(px+4,y+25,bw,1.5,'F');
    if(pct>0){doc.setFillColor(...p.col);doc.rect(px+4,y+25,Math.round(bw*pct/100),1.5,'F');}
    doc.setFont('helvetica','bold');doc.setFontSize(7);doc.setTextColor(...p.col);doc.text(pct+'%',px+p3W-4,y+23,{align:'right'});
  });
  y+=36;

  // ── REPARTITION DES REGLEMENTS ─────────────────────────────────────────
  secTitle('Repartition des reglements',y);y+=6;
  const pays=[
    {l:'Especes (Cash)',v:cash},
    {l:'Mobile Money (MTN / Orange)',v:momo},
    {l:'Carte bancaire',v:card},
  ];
  const pW2=(CW-4)/3;
  pays.forEach((p,i)=>{
    const px=ML+i*(pW2+2);
    const pct=Math.round((p.v/(ca||1))*100);
    doc.setFillColor(...bgH);doc.rect(px,y,pW2,16,'F');
    doc.setDrawColor(...rule);doc.setLineWidth(0.15);doc.rect(px,y,pW2,16,'S');
    doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(...sub);doc.text(_pdfTxt(p.l),px+4,y+6);
    doc.setFont('helvetica','bold');doc.setFontSize(9.5);doc.setTextColor(...ink);doc.text(fmt(p.v)+' F',px+4,y+13);
    doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(...accL);doc.text(pct+'%',px+pW2-4,y+6,{align:'right'});
    const bw=pW2-8;
    doc.setFillColor(...rule);doc.rect(px+4,y+14,bw,1.2,'F');
    if(pct>0){doc.setFillColor(...accL);doc.rect(px+4,y+14,Math.round(bw*pct/100),1.2,'F');}
  });
  y+=24;

  // ── TOP SERVEURS ────────────────────────────────────────────────────────
  if(topSrvs.length){
    secTitle('Classement des serveurs',y);y+=3;
    doc.autoTable({
      startY:y,
      head:[['Rang','Serveur','Commandes','CA realise','Part']],
      body:topSrvs.map(([nom,s],i)=>[(i===0?'1er':i===1?'2e':i===2?'3e':(i+1)+'e'),_pdfTxt(nom),s.nb+' cmd',fmt(s.v)+' F',Math.round(s.v/(ca||1)*100)+'%']),
      styles:{fontSize:8.5,cellPadding:3,textColor:ink,fillColor:[255,255,255],lineColor:rule,lineWidth:0.18,font:'helvetica'},
      headStyles:{fillColor:bgH,textColor:sub,fontStyle:'bold',fontSize:8,lineWidth:0.2},
      alternateRowStyles:{fillColor:bgA},
      columnStyles:{
        0:{cellWidth:16,halign:'center',fontStyle:'bold',textColor:accL},
        1:{cellWidth:56},2:{cellWidth:32,halign:'center'},
        3:{cellWidth:42,halign:'right',fontStyle:'bold',textColor:acc},
        4:{cellWidth:24,halign:'center',textColor:sub},
      },
      margin:{left:ML,right:MR},
    });
    y=doc.lastAutoTable.finalY+10;
  }else{y+=8;}

  // ── DETAIL DES COMMANDES ────────────────────────────────────────────────
  if(y>PH-60){doc.addPage();y=MT;}
  secTitle('Detail des commandes',y);y+=3;
  doc.autoTable({
    startY:y,
    head:[['Date','Heure','Serveur','Articles','Montant','Reglement']],
    body:rows.map(c=>[
      c.date_cmd||'--',
      (c.heure||'--').slice(0,5),
      _pdfTxt((c.employe_nom||'--').split(' ')[0]),
      _pdfTxt((c.articles||'--').substring(0,40)),
      fmt(c.montant)+' F',
      _pdfTxt(c.paiement||'--'),
    ]),
    foot:[['','','','Total',fmt(ca)+' F','']],
    styles:{fontSize:7.5,cellPadding:2.5,textColor:ink,fillColor:[255,255,255],lineColor:rule,lineWidth:0.15},
    headStyles:{fillColor:bgH,textColor:sub,fontStyle:'bold',fontSize:8,lineWidth:0.2},
    alternateRowStyles:{fillColor:bgA},
    footStyles:{fillColor:bgH,textColor:acc,fontStyle:'bold',fontSize:9,lineWidth:0.2},
    columnStyles:{
      0:{cellWidth:22},1:{cellWidth:14,halign:'center'},
      2:{cellWidth:24},3:{cellWidth:66},
      4:{cellWidth:28,halign:'right',fontStyle:'bold',textColor:acc},
      5:{cellWidth:16},
    },
    margin:{left:ML,right:MR},
  });

  // ── ETAT DU STOCK ───────────────────────────────────────────────────────
  doc.addPage(); y=MT;
  secTitle('Etat du stock',y);y+=3;

  const stk = stkAll || [];
  const stkCritique = stk.filter(s => s.quantite <= (s.seuil_alerte||5));
  const stkOk       = stk.filter(s => s.quantite > (s.seuil_alerte||5));

  // Résumé stock
  const valeurStock   = stk.reduce((a,s) => a + (s.quantite||0)*(s.prix_achat||0), 0);
  const valeurVentes  = stk.reduce((a,s) => a + (s.vendu_systeme||0)*(s.prix_vente||0), 0);
  const pertesEst     = stk.reduce((a,s) => a + Math.max(0,((s.quantite_initiale||0)-(s.quantite||0))-(s.vendu_systeme||0))*(s.prix_vente||0), 0);

  const stkKpis=[
    {l:'Articles en stock',v:String(stk.length),s:'references actives'},
    {l:'Articles critiques',v:String(stkCritique.length),s:'en dessous du seuil'},
    {l:'Valeur stock estimee',v:fmt(valeurStock)+' F',s:'prix achat'},
    {l:'Pertes estimees',v:fmt(pertesEst)+' F',s:'ecart systeme vs reel'},
  ];
  const skW=(CW-3)/4;
  stkKpis.forEach((k,i)=>{
    const kx=ML+i*(skW+1);
    const isAlert = i===1 && stkCritique.length > 0;
    const kAcc = isAlert ? red : acc;
    doc.setFillColor(...bgH);doc.rect(kx,y,skW,21,'F');
    doc.setDrawColor(...rule);doc.setLineWidth(0.2);doc.rect(kx,y,skW,21,'S');
    doc.setFillColor(...kAcc);doc.rect(kx,y,1.5,21,'F');
    doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.setTextColor(...muted);
    doc.text(_pdfTxt(k.l),kx+4.5,y+6.5);
    doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor(...kAcc);
    doc.text(_pdfTxt(k.v),kx+4.5,y+14.5);
    doc.setFont('helvetica','normal');doc.setFontSize(6);doc.setTextColor(...muted);
    doc.text(_pdfTxt(k.s),kx+4.5,y+19.5);
  });
  y+=29;

  // Tableau stock complet
  secTitle('Detail des articles',y);y+=3;
  doc.autoTable({
    startY:y,
    head:[['Article','Qte actuelle','Qte initiale','Vendu sys.','Ecart','Seuil','Val. stock','Statut']],
    body:stk.map(s=>{
      const ecart = (s.quantite_initiale||0) - (s.quantite||0) - (s.vendu_systeme||0);
      const statut = s.quantite <= 0 ? 'Epuise' : s.quantite <= (s.seuil_alerte||5) ? 'Critique' : 'OK';
      return [
        _pdfTxt(s.nom||'--'),
        String(s.quantite||0),
        String(s.quantite_initiale||0),
        String(s.vendu_systeme||0),
        ecart > 0 ? '-'+ecart : (ecart < 0 ? '+'+Math.abs(ecart) : '0'),
        String(s.seuil_alerte||5),
        fmt((s.quantite||0)*(s.prix_achat||0))+' F',
        _pdfTxt(statut),
      ];
    }),
    styles:{fontSize:7,cellPadding:2,textColor:ink,fillColor:[255,255,255],lineColor:rule,lineWidth:0.15},
    headStyles:{fillColor:bgH,textColor:sub,fontStyle:'bold',fontSize:7,lineWidth:0.2},
    alternateRowStyles:{fillColor:bgA},
    columnStyles:{
      0:{cellWidth:44},
      1:{cellWidth:20,halign:'center'},2:{cellWidth:20,halign:'center'},
      3:{cellWidth:20,halign:'center'},4:{cellWidth:16,halign:'center'},
      5:{cellWidth:14,halign:'center'},6:{cellWidth:26,halign:'right'},
      7:{cellWidth:16,halign:'center'},
    },
    didParseCell:(d)=>{
      if(d.column.index===7){
        const v=d.cell.text[0];
        if(v==='Epuise'){d.cell.styles.textColor=red;d.cell.styles.fontStyle='bold';}
        else if(v==='Critique'){d.cell.styles.textColor=orn;d.cell.styles.fontStyle='bold';}
        else{d.cell.styles.textColor=grn;}
      }
      if(d.column.index===4 && d.row.index>=0){
        const v=parseInt(d.cell.text[0])||0;
        if(v<-2){d.cell.styles.textColor=orn;}
        else if(v<0){d.cell.styles.textColor=[160,130,50];}
      }
    },
    margin:{left:ML,right:MR},
  });

  // ── ALERTES ─────────────────────────────────────────────────────────────
  const alertes = alertesAll || [];
  if(alertes.length){
    y=doc.lastAutoTable.finalY+12;
    if(y>PH-80){doc.addPage();y=MT;}
    secTitle('Alertes de la periode',y);y+=3;

    const alertesKpis=[
      {l:'Alertes declenchees',v:String(alertes.length),s:'sur la periode'},
      {l:'Alertes resolues',v:String(alertes.filter(a=>a.resolue_at).length),s:'traitees'},
      {l:'En attente',v:String(alertes.filter(a=>!a.resolue_at).length),s:'non resolues'},
    ];
    const aKW=(CW-2)/3;
    alertesKpis.forEach((k,i)=>{
      const kx=ML+i*(aKW+1);
      const isWarn = i===2 && parseInt(k.v)>0;
      const kAcc2 = isWarn ? red : acc;
      doc.setFillColor(...bgH);doc.rect(kx,y,aKW,16,'F');
      doc.setDrawColor(...rule);doc.setLineWidth(0.15);doc.rect(kx,y,aKW,16,'S');
      doc.setFillColor(...kAcc2);doc.rect(kx,y,1.5,16,'F');
      doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.setTextColor(...muted);doc.text(_pdfTxt(k.l),kx+4.5,y+5.5);
      doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(...kAcc2);doc.text(_pdfTxt(k.v),kx+4.5,y+12);
      doc.setFont('helvetica','normal');doc.setFontSize(6);doc.setTextColor(...muted);doc.text(_pdfTxt(k.s),kx+4.5,y+15);
    });
    y+=22;

    doc.autoTable({
      startY:y,
      head:[['Date','Titre','Type','Statut']],
      body:alertes.slice(0,60).map(a=>[
        a.created_at?new Date(a.created_at).toLocaleDateString('fr-FR'):'--',
        _pdfTxt((a.titre||'--').substring(0,50)),
        _pdfTxt(a.type||'--'),
        _pdfTxt(a.resolue_at?'Resolue':'En attente'),
      ]),
      styles:{fontSize:7.5,cellPadding:2.5,textColor:ink,fillColor:[255,255,255],lineColor:rule,lineWidth:0.15},
      headStyles:{fillColor:bgH,textColor:sub,fontStyle:'bold',fontSize:8,lineWidth:0.2},
      alternateRowStyles:{fillColor:bgA},
      columnStyles:{
        0:{cellWidth:22},1:{cellWidth:90},2:{cellWidth:30},3:{cellWidth:28,halign:'center'},
      },
      didParseCell:(d)=>{
        if(d.column.index===3){
          const v=d.cell.text[0];
          d.cell.styles.textColor = v==='Resolue' ? grn : red;
          d.cell.styles.fontStyle = 'bold';
        }
      },
      margin:{left:ML,right:MR},
    });
  }

  // ── POINTAGE ────────────────────────────────────────────────────────────
  const ptgData = window._rptPtgRows || [];
  if(ptgData.length){
    doc.addPage(); y=MT;
    secTitle('Rapport de pointage du personnel',y);y+=8;
    const ptgByEmp={};
    ptgData.forEach(r=>{
      if(!ptgByEmp[r.employe_id])ptgByEmp[r.employe_id]=[];
      ptgByEmp[r.employe_id].push(r);
    });
    const hhmm2min=s=>{if(!s)return null;const[h,m]=s.split(':').map(Number);return h*60+m;};
    const min2h=m=>{if(m==null||m<0)return '--';return Math.floor(m/60)+'h'+String(m%60).padStart(2,'0');};
    const cols={emp:55,pres:20,htot:22,moy:20,retards:18,arr:22,sor:22};
    const rowH=7;
    doc.setFillColor(...bgH);doc.rect(ML,y,CW,rowH,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(7);doc.setTextColor(...sub);
    let cx=ML+2;
    ['Employe','Presences','H. travaillees','Moy/jour','Retards','Arr. moy.','Depart moy.'].forEach((h,i)=>{
      const w=Object.values(cols)[i];
      doc.text(_pdfTxt(h),cx,y+4.5);cx+=w;
    });
    y+=rowH;
    Object.entries(ptgByEmp).forEach(([empId,ptgs],idx)=>{
      if(y>PH-40){doc.addPage();y=MT;}
      const emp=EMPS.find(e=>e.id===empId);
      const nom=emp?emp.nom:empId.slice(0,8);
      const presents=ptgs.length;
      const retards=ptgs.filter(p=>p.statut==='retard').length;
      let mins=0,arrivees=[],sorties=[];
      ptgs.forEach(p=>{
        const d=hhmm2min(p.heure_arrivee),f=hhmm2min(p.heure_sortie);
        if(d!=null)arrivees.push(d);
        if(f!=null)sorties.push(f);
        if(d!=null&&f!=null&&f>d)mins+=(f-d);
      });
      const moy=presents?Math.round(mins/presents):0;
      const arrMoy=arrivees.length?Math.round(arrivees.reduce((a,b)=>a+b,0)/arrivees.length):null;
      const sorMoy=sorties.length?Math.round(sorties.reduce((a,b)=>a+b,0)/sorties.length):null;
      if(idx%2===0){doc.setFillColor(...bgA);doc.rect(ML,y,CW,rowH,'F');}
      doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor(...ink);
      cx=ML+2;
      [_pdfTxt(nom),presents+'j',min2h(mins),min2h(moy),retards||'--',arrMoy!=null?min2h(arrMoy):'--',sorMoy!=null?min2h(sorMoy):'--'].forEach((val,i)=>{
        const w=Object.values(cols)[i];
        if(i===2){doc.setTextColor(...acc);doc.setFont('helvetica','bold');}
        else if(i===4&&retards>0){doc.setTextColor(...red);doc.setFont('helvetica','bold');}
        else{doc.setTextColor(...ink);doc.setFont('helvetica','normal');}
        doc.text(String(val),cx,y+4.5);cx+=w;
      });
      y+=rowH;
      y+=2;
      ptgs.forEach(p=>{
        if(y>PH-30){doc.addPage();y=MT;}
        const dateStr=new Date(p.date_pointage).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',weekday:'short'});
        const d=hhmm2min(p.heure_arrivee),f=hhmm2min(p.heure_sortie);
        const dur=(d!=null&&f!=null&&f>d)?min2h(f-d):'--';
        const statColor=p.statut==='retard'?red:p.statut==='avance'?[60,120,220]:[60,160,80];
        doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.setTextColor(...sub);
        doc.text(_pdfTxt('  '+dateStr),ML+4,y+3.5);
        doc.text(p.heure_arrivee||'--',ML+58,y+3.5);
        doc.text(p.heure_sortie||'--',ML+76,y+3.5);
        doc.setFont('helvetica','bold');doc.setTextColor(...acc);
        doc.text(dur,ML+96,y+3.5);
        doc.setFont('helvetica','normal');doc.setTextColor(...statColor);
        doc.text(_pdfTxt(p.statut||''),ML+115,y+3.5);
        y+=5;
      });
      y+=4;hRule(y,0.2,rule);y+=4;
    });
  }

  // ── PAGINATION ──────────────────────────────────────────────────────────
  const totalPages2=doc.getNumberOfPages();
  for(let pg=1;pg<=totalPages2;pg++){
    doc.setPage(pg);
    hRule(PH-13,0.3,rule);
    doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(...muted);
    doc.text(_pdfTxt('BarOS  \xb7  Rapport confidentiel  \xb7  '+(ETAB.nom||'')),ML,PH-8);
    doc.text('\xa9 2025 Christophe OLOCK BELANG',PW/2,PH-8,{align:'center'});
    doc.text('Page '+pg+' / '+totalPages2,PW-MR,PH-8,{align:'right'});
  }

  doc.save('rapport_'+RPT_PERIOD+'_'+from+(to!==from?'_au_'+to:'')+'.pdf');
  showN('\ud83d\udcc4 Rapport PDF exporte !','success');
}

// ===== BLUETOOTH THERMIQUE — Manager =====
let _mgr_btDevice=null,_mgr_btChar=null,_mgr_btProfile='80mm';
const _MGR_BT={
  '58mm':{charWidth:32,services:['000018f0-0000-1000-8000-00805f9b34fb','0000ff00-0000-1000-8000-00805f9b34fb','49535343-fe7d-4ae5-8fa9-9fafd205e455']},
  '80mm':{charWidth:42,services:['000018f0-0000-1000-8000-00805f9b34fb','0000ff00-0000-1000-8000-00805f9b34fb']},
};
function _mgrBtBytes(...parts){const a=[];for(const p of parts){if(Array.isArray(p))a.push(...p);else if(typeof p==='number')a.push(p);else if(typeof p==='string'){for(let i=0;i<p.length;i++)a.push(p.charCodeAt(i)&0xFF);}}return new Uint8Array(a);}
function _mgrBtLR(l,r,w){const sp=Math.max(1,w-l.length-r.length);return l+' '.repeat(sp)+r;}
const _MESCPOS=(()=>{const E=0x1B,G=0x1D;return{INIT:[E,0x40],CTR:[E,0x61,0x01],LFT:[E,0x61,0x00],BON:[E,0x45,0x01],BOF:[E,0x45,0x00],DBL:[G,0x21,0x11],DBLO:[G,0x21,0x00],CUT:[G,0x56,0x42,0x00],FEED:(n)=>[E,0x64,n]};})();

async function _mgrBtSend(data){
  const C=20;
  for(let i=0;i<data.length;i+=C){await _mgr_btChar.writeValue(data.slice(i,i+C));await new Promise(r=>setTimeout(r,20));}
}

function showBTPanelManager(){
  const ex=document.getElementById('mgr-bt-panel');if(ex)ex.remove();
  const div=document.createElement('div');div.id='mgr-bt-panel';
  div.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:9000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px)';
  div.innerHTML=`
<div style="background:#12121a;border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:22px;width:min(380px,92vw);font-family:'DM Sans',sans-serif">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
    <div><div style="font-size:16px;font-weight:700;color:#f0eff5">🖨️ Imprimante Bluetooth</div>
    <div style="font-size:11px;color:rgba(240,239,245,.45);margin-top:2px">Mini-imprimante thermique portative</div></div>
    <span onclick="document.getElementById('mgr-bt-panel').remove()" style="cursor:pointer;font-size:18px;color:rgba(240,239,245,.4)">✕</span>
  </div>
  <div id="mgr-bt-statusbar" style="display:flex;align-items:center;gap:8px;padding:10px 13px;background:#1a1a26;border-radius:10px;margin-bottom:14px;font-size:12px;color:rgba(240,239,245,.6)">
    <div style="width:8px;height:8px;border-radius:50%;background:${_mgr_btDevice&&_mgr_btDevice.gatt.connected?'#4ade80':'rgba(255,255,255,.2)'};flex-shrink:0" id="mgr-bt-dot"></div>
    <span id="mgr-bt-stxt">${_mgr_btDevice&&_mgr_btDevice.gatt.connected?'✅ Connectée : '+(_mgr_btDevice.name||'Imprimante'):'Non connectée'}</span>
  </div>
  <div style="font-size:10px;color:rgba(240,239,245,.35);text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px">Format de papier</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:16px">
    ${['58mm','80mm'].map(p=>`<div onclick="mgrSelBT('${p}',this)" data-p="${p}" class="mgr-btprof" style="background:#1a1a26;border:1.5px solid ${_mgr_btProfile===p?'#c8f55a':'rgba(255,255,255,.08)'};border-radius:12px;padding:11px;cursor:pointer;text-align:center">
      <div style="font-size:22px">${p==='58mm'?'📃':'🗒️'}</div>
      <div style="font-size:12px;font-weight:600;color:#f0eff5;margin-top:4px">${p}</div>
      <div style="font-size:10px;color:rgba(240,239,245,.4)">${p==='58mm'?'Peripage · Phomemo':'EPSON · Star · Sewoo'}</div>
      ${_mgr_btProfile===p?'<div style="color:#c8f55a;font-size:10px;margin-top:3px">✓ Sélectionné</div>':''}
    </div>`).join('')}
  </div>
  ${!navigator.bluetooth?'<div style="background:rgba(255,180,68,.08);border:1px solid rgba(255,180,68,.2);border-radius:9px;padding:9px 12px;font-size:11px;color:rgba(255,180,68,.9);margin-bottom:12px">⚠️ Web Bluetooth requis. Utilisez <strong>Chrome</strong>.</div>':''}
  <button onclick="doMgrBTConnect()" id="mgr-bt-conn" style="width:100%;padding:12px;background:#c8f55a;color:#0a0a0f;border:none;border-radius:11px;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:8px;font-family:'DM Sans',sans-serif">🔗 Connecter l'imprimante</button>
  ${_mgr_btDevice&&_mgr_btDevice.gatt.connected?`<button onclick="mgrBTDisconnect()" style="width:100%;padding:11px;background:rgba(255,94,94,.12);color:#ff5e5e;border:1px solid rgba(255,94,94,.2);border-radius:11px;font-size:13px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif">🔌 Déconnecter</button>`:''}
  <div style="text-align:center;font-size:10px;color:rgba(240,239,245,.28);margin-top:14px;line-height:1.7">Compatible ESC/POS · Peripage · Phomemo · EPSON TM-T20 · Star TSP</div>
</div>`;
  document.body.appendChild(div);
}

function mgrSelBT(p,el){
  _mgr_btProfile=p;
  document.querySelectorAll('.mgr-btprof').forEach(x=>{
    const sel=x.dataset.p===p;
    x.style.borderColor=sel?'#c8f55a':'rgba(255,255,255,.08)';
    const t=x.querySelector('[style*="Sélectionné"]');
    if(sel&&!t){const d=document.createElement('div');d.style.cssText='color:#c8f55a;font-size:10px;margin-top:3px';d.textContent='✓ Sélectionné';x.appendChild(d);}
    else if(!sel&&t)t.remove();
  });
}

async function doMgrBTConnect(){
  if(!navigator.bluetooth){showN('Web Bluetooth non supporté. Utilisez Chrome.','error');return;}
  const btn=document.getElementById('mgr-bt-conn');
  if(btn){btn.disabled=true;btn.textContent='🔍 Recherche...';}
  try{
    const prof=_MGR_BT[_mgr_btProfile];
  const PRINTER_SERVICE_UUIDS=[
    '000018f0-0000-1000-8000-00805f9b34fb',
    '0000ff00-0000-1000-8000-00805f9b34fb',
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    '0000ffe0-0000-1000-8000-00805f9b34fb',
    '00001101-0000-1000-8000-00805f9b34fb',
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    '00008000-0000-1000-8000-00805f9b34fb',
  ];
  const NAME_PREFIXES=['MTP','PTP','Printer','PRINTER','Peripage','peripage','Phomemo','phomemo','Paperang','paperang','EPSON','Epson','Star','STAR','Sewoo','SEWOO','RPP','DP-','PT-','MP-','BTP','Goojprt','GOOJPRT','Rongta','RONGTA','iDPRT','IDPRT','Xprinter','XPRINTER','POS','BlueTooth Printer'];
  const filters=[
    ...PRINTER_SERVICE_UUIDS.map(s=>({services:[s]})),
    ...NAME_PREFIXES.map(p=>({namePrefix:p})),
  ];
  let device;
  try{
    device=await navigator.bluetooth.requestDevice({filters,optionalServices:PRINTER_SERVICE_UUIDS});
  }catch(e){
    if(e.name==='NotFoundError'){
      const fb=confirm('Aucune imprimante détectée automatiquement.\n\nAfficher tous les appareils Bluetooth pour choisir manuellement ?');
      if(!fb)throw new Error('Recherche annulée.');
      device=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:PRINTER_SERVICE_UUIDS});
    }else{throw e;}
  }
    const server=await device.gatt.connect();
    device.addEventListener('gattserverdisconnected',()=>{_mgr_btDevice=null;_mgr_btChar=null;showN('🔌 Imprimante déconnectée','warn');});
    let ch=null;
    const svcs=await server.getPrimaryServices();
    outer:for(const svc of svcs){let cs;try{cs=await svc.getCharacteristics();}catch(e){continue;}for(const c of cs){if(c.properties.write||c.properties.writeWithoutResponse){ch=c;break outer;}}}
    if(!ch)throw new Error('Caractéristique introuvable');
    _mgr_btDevice=device;_mgr_btChar=ch;
    const dot=document.getElementById('mgr-bt-dot');const stxt=document.getElementById('mgr-bt-stxt');
    if(dot){dot.style.background='#4ade80';dot.style.boxShadow='0 0 6px #4ade80';}
    if(stxt)stxt.textContent='✅ Connectée : '+(device.name||'Imprimante');
    if(btn){btn.disabled=false;btn.textContent='🔗 Reconnecter';}
    showN('✅ '+(device.name||'Imprimante')+' connectée !','success');
  }catch(e){
    if(btn){btn.disabled=false;btn.textContent='🔗 Connecter l\'imprimante';}
    showN('❌ '+(e.message||'Connexion échouée'),'error');
  }
}

function mgrBTDisconnect(){
  if(_mgr_btDevice&&_mgr_btDevice.gatt.connected)_mgr_btDevice.gatt.disconnect();
  _mgr_btDevice=null;_mgr_btChar=null;
  document.getElementById('mgr-bt-panel')?.remove();
  showN('🔌 Imprimante déconnectée','warn');
}

// ===== EXPORT FACTURE CLIENT — Style LaTeX =====
async function exportFactureClient(clientId, clientNom) {
  if(!window.jspdf){showN('⚠️ Librairie PDF en chargement, réessaie','warn');return;}
  const {data:cli}=await db.from('clients').select('*').eq('id',clientId).single();
  const {data:cmds}=await db.from('commandes').select('montant,articles,paiement,date_cmd,heure,statut').eq('etab_id',ETAB.id).eq('statut','Livré').order('date_cmd',{ascending:false}).limit(60);
  const lignes=cmds||[];
  const total=lignes.reduce((a,c)=>a+c.montant,0);
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({unit:'mm',format:'a4'});
  const PW=210,PH=297,ML=20,MR=20,MT=24,CW=PW-ML-MR;
  const numFact='FAC-'+Date.now().toString().slice(-6);

  // Tier — couleurs douces, non saturées
  const tierMap={
    Diamond:{l:'Platine',c:[115,95,175]},
    Gold:   {l:'Or',   c:[185,145,55]},
    Silver: {l:'Argent', c:[115,125,145]},
    Bronze: {l:'Bronze', c:[155,120,85]},
  };
  const tierKey=cli?(cli.points>=1000?'Diamond':cli.points>=500?'Gold':cli.points>=200?'Silver':'Bronze'):'Bronze';
  const tier=tierMap[tierKey];

  // Palette douce
  const ink=[30,35,45];
  const sub=[105,110,125];
  const muted=[160,163,175];
  const rule=[210,213,222];
  const bgH=[242,244,248];
  const bgA=[250,251,254];
  const acc=[55,88,148];

  const hRule=(y,lw=0.25,col=rule)=>{doc.setDrawColor(...col);doc.setLineWidth(lw);doc.line(ML,y,PW-MR,y);};
  const secTitle=(label,y)=>{
    doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(...acc);
    doc.text(label.toUpperCase(),ML,y);
    hRule(y+2,0.35,rule);
  };

  // ── EN-TÊTE ──────────────────────────────────────────
  let lx=ML;
  if(LOGO){try{doc.addImage(LOGO,'',ML,MT-8,16,13);lx=ML+20;}catch(e){}}
  doc.setFont('helvetica','bold');doc.setFontSize(13);doc.setTextColor(...ink);doc.text('BarOS',lx,MT);
  doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(...sub);doc.text((ETAB.nom||'').toUpperCase(),lx,MT+6);
  const ei=[ETAB.ville,ETAB.tel?'Tel : '+ETAB.tel:null].filter(Boolean).join('  \xb7  ');
  if(ei)doc.text(ei,lx,MT+11);

  // Bloc facture (droite)
  doc.setFont('helvetica','bold');doc.setFontSize(22);doc.setTextColor(...ink);
  doc.text('FACTURE',PW-MR,MT,{align:'right'});
  doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(...sub);
  doc.text('N\xb0 '+numFact,PW-MR,MT+8,{align:'right'});
  doc.setFontSize(7.5);doc.setTextColor(...muted);
  doc.text('Emise le '+new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'}),PW-MR,MT+14,{align:'right'});

  let y=MT+20;
  hRule(y,0.5,[acc[0]+50,acc[1]+40,acc[2]+30]);
  y+=9;

  // ── BLOC CLIENT ──────────────────────────────────────
  secTitle('Informations client',y);y+=5;
  // Fond gris très clair, filet gauche couleur tier
  doc.setFillColor(...bgH);doc.rect(ML,y,CW,26,'F');
  doc.setDrawColor(...rule);doc.setLineWidth(0.2);doc.rect(ML,y,CW,26,'S');
  doc.setFillColor(...tier.c);doc.rect(ML,y,2.5,26,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor(...ink);
  doc.text(cli?.nom||clientNom,ML+7,y+9);
  doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(...sub);
  if(cli?.telephone)doc.text('Tel : '+cli.telephone,ML+7,y+16);
  doc.setFont('helvetica','bold');doc.setFontSize(8.5);doc.setTextColor(...tier.c);
  doc.text('Niveau '+tier.l+'   \xb7   '+(cli?.points||0)+' points fidelite',ML+7,y+23);

  // Credit dû (si applicable)
  if((cli?.credit_du||0)>0){
    doc.setFillColor(245,242,242);doc.rect(PW-MR-50,y+4,47,18,'F');
    doc.setDrawColor(210,195,195);doc.setLineWidth(0.2);doc.rect(PW-MR-50,y+4,47,18,'S');
    doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor(160,100,100);doc.text('Credit en cours',PW-MR-4,y+10,{align:'right'});
    doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(185,65,65);doc.text(fmt(cli.credit_du)+' F',PW-MR-4,y+19,{align:'right'});
  }
  y+=34;

  // ── HISTORIQUE DES CONSOMMATIONS ─────────────────────
  secTitle('Historique des consommations',y);y+=3;
  doc.autoTable({
    startY:y,
    head:[['Date','Heure','Articles','Reglement','Montant']],
    body:lignes.slice(0,50).map(c=>[
      c.date_cmd||'--',c.heure||'--',
      (c.articles||'--').substring(0,42),
      c.paiement||'--',fmt(c.montant)+' F'
    ]),
    foot:[['','','','Total',fmt(total)+' F']],
    styles:{fontSize:8,cellPadding:2.5,textColor:ink,fillColor:[255,255,255],lineColor:rule,lineWidth:0.15},
    headStyles:{fillColor:bgH,textColor:sub,fontStyle:'bold',fontSize:8,lineWidth:0.2},
    alternateRowStyles:{fillColor:bgA},
    footStyles:{fillColor:bgH,textColor:acc,fontStyle:'bold',fontSize:9.5,lineWidth:0.2},
    columnStyles:{
      0:{cellWidth:22},1:{cellWidth:16,halign:'center'},
      2:{cellWidth:84},3:{cellWidth:28,halign:'center'},
      4:{cellWidth:20,halign:'right',fontStyle:'bold',textColor:acc},
    },
    margin:{left:ML,right:MR},
  });

  // ── RECAP REGLEMENTS ─────────────────────────────────
  const at=doc.lastAutoTable.finalY+8;
  if(at<PH-50){
    const cash2=lignes.filter(c=>c.paiement==='Cash').reduce((a,c)=>a+c.montant,0);
    const momo2=lignes.filter(c=>c.paiement==='MTN MoMo'||c.paiement==='Orange Money').reduce((a,c)=>a+c.montant,0);
    const card2=lignes.filter(c=>c.paiement==='Carte bancaire'||c.paiement==='Carte').reduce((a,c)=>a+c.montant,0);
    secTitle('Recapitulatif des reglements',at);
    const py=at+5;
    const bW=(CW-4)/3;
    [{l:'Especes',v:cash2},{l:'Mobile Money',v:momo2},{l:'Carte bancaire',v:card2}].forEach((p,i)=>{
      const px=ML+i*(bW+2);
      doc.setFillColor(...bgH);doc.rect(px,py,bW,16,'F');
      doc.setDrawColor(...rule);doc.setLineWidth(0.15);doc.rect(px,py,bW,16,'S');
      doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(...sub);doc.text(p.l,px+4,py+6);
      doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(...ink);doc.text(fmt(p.v)+' F',px+4,py+13);
      const pct=Math.round((p.v/(total||1))*100);
      doc.setFont('helvetica','bold');doc.setFontSize(7.5);doc.setTextColor(...muted);doc.text(pct+'%',px+bW-4,py+6,{align:'right'});
    });
  }

  // ── PIED DE PAGE ─────────────────────────────────────
  const totalPages=doc.internal.getNumberOfPages();
  for(let pg=1;pg<=totalPages;pg++){
    doc.setPage(pg);
    hRule(PH-13,0.3,rule);
    doc.setFont('helvetica','italic');doc.setFontSize(7.5);doc.setTextColor(...tier.c);
    doc.text('Merci de votre fidelite, '+(cli?.nom||clientNom).split(' ')[0]+' !',ML,PH-8);
    doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(...muted);
    doc.text('BarOS  \xb7  '+ETAB.nom+'    Page '+pg+' / '+totalPages,PW-MR,PH-8,{align:'right'});
  }

  doc.save(`facture_${(cli?.nom||clientNom).replace(/\s+/g,'_')}_${today()}.pdf`);
  showN('🧾 Facture PDF générée !','success');
}


// ===== CONFIG =====
async function loadConfig() {
  document.getElementById('cfg-nom').value=ETAB.nom||'';
  document.getElementById('cfg-ville').value=ETAB.ville||'';
  document.getElementById('cfg-tel').value=ETAB.tel||'';
  document.getElementById('cfg-obj').value=ETAB.obj||200000;

  loadLogoPreview();
  renderMenuList();
}

// Liste des articles (menu) — source unique : cache ARTICLES (table "stock"), aucune requête
// réseau supplémentaire. Recherche instantanée + favoris en tête + tri alphabétique par catégorie.
let menuListSearch = '';
function menuSearch(v) { menuListSearch = (v||'').trim().toLowerCase(); renderMenuList(); }

function renderMenuList() {
  const list = document.getElementById('menu-list');
  if (!list) return; // page pas active
  const q = menuListSearch;
  let items = ARTICLES.slice();
  if (q) items = items.filter(p =>
    p.nom.toLowerCase().includes(q) ||
    (p.categorie||'').toLowerCase().includes(q) ||
    (p.mots_cles||'').toLowerCase().includes(q)
  );

  // Grouper par catégorie (ordre de référence ARTICLE_CATS, puis catégories libres, puis "Autres")
  const byCat = {};
  items.forEach(p => {
    const cat = p.categorie || 'Autres';
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(p);
  });
  const catOrder = [...ARTICLE_CATS.filter(c => byCat[c]), ...Object.keys(byCat).filter(c => !ARTICLE_CATS.includes(c))];

  if (catOrder.length) {
    list.innerHTML = catOrder.map(cat => {
      const rows = byCat[cat].slice().sort((a,b) => (b.favori-a.favori) || a.nom.localeCompare(b.nom));
      return `<div class="menu-cat-label">${cat} <span style="opacity:.5;font-weight:400">(${rows.length})</span></div>` +
        rows.map(p => `<div style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--s2);border-radius:var(--rs);margin-bottom:5px${p.actif===false?';opacity:.5':''}">
          <span style="font-size:16px">${p.favori?'⭐':''}${p.icone}</span>
          <div style="flex:1;cursor:pointer" onclick="editStk('${p.id}')">
            <div style="font-size:13px">${p.nom}${(p.quantite||0)<=0?' <span style="color:var(--dg);font-size:10px">· rupture</span>':''}${p.actif===false?' <span style="font-size:9px;background:var(--bd2);color:var(--mt);border-radius:4px;padding:1px 5px;font-weight:600">DÉSACTIVÉ</span>':''}</div>
            <div style="font-size:11px;color:var(--mt)">${fmt(p.prix)} F · stock: ${p.quantite||0}</div>
          </div>
          <button class="btn btn-sm" onclick="editStk('${p.id}')" title="Modifier">✏️</button>
          <button class="btn btn-sm" onclick="toggleArticleActif('${p.id}')" title="${p.actif===false?'Réactiver':'Désactiver'}">${p.actif===false?'▶️':'⏸️'}</button>
          <button class="btn btn-sm btn-dg" onclick="delStk('${p.id}')" title="Supprimer">✕</button>
        </div>`).join('');
    }).join('');
  } else {
    list.innerHTML = `<div style="font-size:12px;color:var(--mt)">${ARTICLES.length ? 'Aucun article trouvé' : 'Aucun article — ajoutez votre menu ou chargez le menu camerounais 🇨🇲'}</div>`;
  }
}

async function saveConfig() {
  const {error}=await db.from('etabs').update({nom:document.getElementById('cfg-nom').value,ville:document.getElementById('cfg-ville').value,tel:document.getElementById('cfg-tel').value,obj:parseInt(document.getElementById('cfg-obj').value)||200000}).eq('id',ETAB.id);
  if(error){showN('Erreur: '+error.message,'error');return;}
  ETAB.nom=document.getElementById('cfg-nom').value;

  ETAB.tel=document.getElementById('cfg-tel').value;
  document.getElementById('sb-etab').textContent=ETAB.nom;
  populateSelects();showN('✅ Configuration sauvegardée','success');
}

function loadIntegrations() {
  const key = localStorage.getItem('baros_notchpay_key_' + (ETAB?.id||''));
  const sender = localStorage.getItem('baros_sms_sender_' + (ETAB?.id||''));
  const ki = document.getElementById('cfg-notchpay-key');
  const si = document.getElementById('cfg-sms-sender');
  if (ki && key) ki.value = key;
  if (si && sender) si.value = sender;
}

function saveIntegrations() {
  const key = document.getElementById('cfg-notchpay-key')?.value?.trim();
  const sender = document.getElementById('cfg-sms-sender')?.value?.trim();
  if (key) localStorage.setItem('baros_notchpay_key_' + (ETAB?.id||''), key);
  else localStorage.removeItem('baros_notchpay_key_' + (ETAB?.id||''));
  if (sender) localStorage.setItem('baros_sms_sender_' + (ETAB?.id||''), sender);
  showN('✅ Intégrations sauvegardées', 'success');
}

// ── QR Code de configuration tablette ──
function genererQRConfig() {
  if (!ETAB?.id) return;
  const canvas = document.getElementById('cfg-qr-canvas');
  const uuidEl = document.getElementById('cfg-etab-uuid');
  if (!canvas || !uuidEl) return;

  uuidEl.textContent = ETAB.id;

  const payload = JSON.stringify({
    t: 'baros-cfg',
    u: SB_URL,
    k: SB_KEY,
    e: ETAB.id,
    n: ETAB.nom || ''
  });

  try {
    // qrcode-generator : dessin natif sur canvas, sans img intermédiaire
    const qr = qrcode(0, 'M');
    qr.addData(payload);
    qr.make();

    const size   = 140;
    const count  = qr.getModuleCount();
    const cell   = size / count;

    canvas.width  = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Fond blanc
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    // Modules noirs
    ctx.fillStyle = '#000000';
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) {
          ctx.fillRect(
            Math.floor(col * cell),
            Math.floor(row * cell),
            Math.ceil(cell),
            Math.ceil(cell)
          );
        }
      }
    }
  } catch(e) {
    console.error('[BarOS] QR config erreur:', e);
  }
}

function regenererQR() { genererQRConfig(); showN('🔄 QR régénéré', 'success'); }

function openCfgQRFullscreen() {
  const canvas = document.getElementById('cfg-qr-canvas');
  if (!canvas) return;
  const src = canvas.toDataURL('image/png');
  const nom = (ETAB?.nom || 'Tablette de pointage');
  openQRFullscreen(nom, 'Configuration pointage', src, '');
}

function copyUUID() {
  const uuid = document.getElementById('cfg-etab-uuid')?.textContent;
  if (!uuid || uuid === '—') return;
  navigator.clipboard.writeText(uuid).then(() => showN('📋 UUID copié !', 'success'));
}

async function testNotchpay() {
  const key = document.getElementById('cfg-notchpay-key')?.value?.trim();
  const res = document.getElementById('notchpay-test-result');
  if (!key) { if(res) res.innerHTML = '<span style="color:var(--dg)">⚠️ Entrez d\'abord votre clé API</span>'; return; }
  if (res) res.innerHTML = '<span style="color:var(--mt)">⏳ Test en cours...</span>';
  try {
    const resp = await fetch('https://api.notchpay.co/me', {
      headers: { 'Authorization': 'Bearer ' + key, 'Accept': 'application/json' }
    });
    const data = await resp.json();
    if (resp.ok && data.business) {
      if(res) res.innerHTML = `<span style="color:var(--gn)">✅ Connexion réussie — Compte : <strong>${data.business.name||data.business.email||'OK'}</strong></span>`;
    } else {
      if(res) res.innerHTML = `<span style="color:var(--dg)">❌ Clé invalide : ${data.message||'Erreur inconnue'}</span>`;
    }
  } catch(e) {
    if(res) res.innerHTML = `<span style="color:var(--dg)">❌ Erreur réseau : ${e.message}</span>`;
  }
}

function toggleKeyVis(id, btn) {
  const inp = document.getElementById(id);
  if (!inp) return;
  if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '🙈'; }
  else { inp.type = 'password'; btn.textContent = '👁'; }
}

function loadLogoPreview() {
  const stored = localStorage.getItem('baros_logo_'+(ETAB?.id||''));
  const preview = document.getElementById('logo-preview');
  const delBtn = document.getElementById('logo-del-btn');
  if (!preview) return;
  if (stored) {
    LOGO = stored;
    preview.innerHTML = `<img src="${stored}" style="width:100%;height:100%;object-fit:contain;border-radius:5px">`;
    if (delBtn) delBtn.style.display = '';
  } else {
    LOGO = null;
    preview.innerHTML = 'Aucun';
    if (delBtn) delBtn.style.display = 'none';
  }
}

function handleLogoUpload(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5242880) { showN('⚠️ Logo trop lourd — max 5 Mo', 'warn'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    localStorage.setItem('baros_logo_'+(ETAB?.id||''), e.target.result);
    LOGO = e.target.result;
    loadLogoPreview();
    showN('✅ Logo enregistré', 'success');
  };
  reader.readAsDataURL(file);
}

function deleteLogo() {
  localStorage.removeItem('baros_logo_'+(ETAB?.id||''));
  LOGO = null;
  const inp = document.getElementById('logo-input');
  if (inp) inp.value = '';
  loadLogoPreview();
  showN('Logo supprimé', 'warn');
}

/**
 * _catToTypeService — Déduit type_service depuis la catégorie d'un article.
 * Utilisé par saveStk() et importMenuCam() pour sauvegarder type_service en base (table stock).
 * Doit rester synchronisé avec getProdTypeService() dans personnel.html.
 */
function _catToTypeService(cat) {
  const c = (cat || '').toLowerCase();
  // Catégories → cuisine
  if (c.includes('nourriture') || c.includes('snack') || c.includes('cuisine') ||
      c.includes('plat') || c.includes('food') || c.includes('repas') ||
      c.includes('viande') || c.includes('poisson') || c.includes('grillad') ||
      c.includes('brochette') || c.includes('entrée') || c.includes('dessert') ||
      c.includes('petit-déjeuner') || c.includes('accompagnement') || c.includes('glace')) {
    return 'cuisine';
  }
  // Catégories → bar (tout le reste : boissons, chicha, etc.)
  return 'bar';
}


// ===== MENU CAMEROUNAIS PAR DÉFAUT =====
const MENU_CAM = [
  // Bières locales & importées
  {icone:'🍺', nom:'33 Export (Petite)', prix:500, cat:'Bières'},
  {icone:'🍺', nom:'33 Export (Grande)', prix:800, cat:'Bières'},
  {icone:'🍺', nom:'Castel (Petite)', prix:500, cat:'Bières'},
  {icone:'🍺', nom:'Castel (Grande)', prix:800, cat:'Bières'},
  {icone:'🍺', nom:'Beaufort (Petite)', prix:500, cat:'Bières'},
  {icone:'🍺', nom:'Heineken (33cl)', prix:1000, cat:'Bières'},
  {icone:'🍺', nom:'Guinness (60cl)', prix:1200, cat:'Bières'},
  {icone:'🍺', nom:'Mutzig (Petite)', prix:600, cat:'Bières'},
  // Softs & eaux
  {icone:'🥤', nom:'Coca-Cola (50cl)', prix:400, cat:'Softs'},
  {icone:'🥤', nom:'Fanta Orange (50cl)', prix:400, cat:'Softs'},
  {icone:'🥤', nom:'Maltina (33cl)', prix:500, cat:'Softs'},
  {icone:'🫗', nom:'Eau Tangui (50cl)', prix:300, cat:'Softs'},
  {icone:'🫗', nom:'Eau Supermont (1.5L)', prix:500, cat:'Softs'},
  // Spiritueux
  {icone:'🥃', nom:'Whisky Johnny Walker (verre)', prix:2000, cat:'Spiritueux'},
  {icone:'🥃', nom:'Whisky Black Label (verre)', prix:3000, cat:'Spiritueux'},
  {icone:'🍷', nom:'Vin rouge (verre)', prix:1500, cat:'Vins'},
  {icone:'🍷', nom:'Vin rosé (verre)', prix:1500, cat:'Vins'},
  {icone:'🍾', nom:'Moët & Chandon (bouteille)', prix:40000, cat:'Vins'},
  {icone:'🥂', nom:'Cîroc (bouteille)', prix:35000, cat:'Spiritueux'},
  // Cocktails
  {icone:'🍹', nom:'Cocktail maison', prix:2500, cat:'Cocktails'},
  {icone:'🍹', nom:'Punch tropical', prix:2000, cat:'Cocktails'},
  // Nourriture
  {icone:'🍗', nom:'Poulet braisé (quart)', prix:1500, cat:'Nourriture'},
  {icone:'🍗', nom:'Poulet braisé (demi)', prix:2500, cat:'Nourriture'},
  {icone:'🐟', nom:'Poisson braisé', prix:2000, cat:'Nourriture'},
  {icone:'🍢', nom:'Soya (brochettes)', prix:500, cat:'Nourriture'},
  {icone:'🍟', nom:'Plantain frit (portion)', prix:500, cat:'Nourriture'},
  {icone:'🥚', nom:'Omelette', prix:500, cat:'Nourriture'},
  {icone:'🍚', nom:'Riz & sauces', prix:1000, cat:'Nourriture'},
  // Snacks
  {icone:'🥜', nom:'Arachides grillées', prix:200, cat:'Snacks'},
  {icone:'🍿', nom:'Pop-corn', prix:300, cat:'Snacks'},
];

// ===== MENU CAMEROUNAIS — Modale d'édition des prix =====
let camSel = {}; // { index: true/false }
let camCatFilter = 'Tous';

function loadMenuDefautCam() {
  // Initialiser toutes les sélections à true
  camSel = {};
  MENU_CAM.forEach((_, i) => camSel[i] = true);
  camCatFilter = 'Tous';
  renderCamModal();
  openM('m-menu-cam');
}

function renderCamModal() {
  // Filtres catégorie
  const cats = ['Tous', ...[...new Set(MENU_CAM.map(p => p.cat))]];
  document.getElementById('cam-cat-filters').innerHTML = cats.map(c =>
    `<div onclick="setCamCat('${c}')" style="padding:4px 11px;border-radius:20px;font-size:11px;cursor:pointer;border:1px solid;transition:all .15s;${camCatFilter===c?'background:var(--ac);color:#0a0a0f;border-color:var(--ac)':'background:var(--s2);color:var(--mt);border-color:var(--bd)'}">${c}</div>`
  ).join('');

  // Liste des articles
  const filtered = MENU_CAM.map((p, i) => ({...p, _i: i})).filter(p => camCatFilter === 'Tous' || p.cat === camCatFilter);
  
  // Grouper par catégorie si "Tous"
  let html = '';
  if (camCatFilter === 'Tous') {
    const groups = {};
    filtered.forEach(p => { if (!groups[p.cat]) groups[p.cat] = []; groups[p.cat].push(p); });
    for (const [cat, items] of Object.entries(groups)) {
      html += `<div style="font-size:10px;color:var(--ht);text-transform:uppercase;letter-spacing:.08em;padding:8px 0 4px;border-bottom:1px solid var(--bd);margin-bottom:4px">${cat}</div>`;
      html += items.map(p => camProdRow(p)).join('');
    }
  } else {
    html = filtered.map(p => camProdRow(p)).join('');
  }

  document.getElementById('cam-prod-list').innerHTML = html || '<div style="color:var(--mt);font-size:12px;padding:12px">Aucun produit</div>';
  updateCamCount();
}

function camProdRow(p) {
  const checked = camSel[p._i];
  return `<div style="display:flex;align-items:center;gap:10px;padding:7px 6px;border-radius:var(--rs);margin-bottom:3px;background:${checked?'rgba(200,245,90,.04)':'transparent'};border:1px solid ${checked?'rgba(200,245,90,.15)':'transparent'};transition:all .15s">
    <input type="checkbox" id="cam-chk-${p._i}" ${checked?'checked':''} onchange="toggleCamProd(${p._i})" style="accent-color:var(--ac);width:15px;height:15px;cursor:pointer;flex-shrink:0">
    <span style="font-size:18px;flex-shrink:0">${p.icone}</span>
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.nom}</div>
      <div style="font-size:10px;color:var(--mt)">${p.cat}</div>
    </div>
    <input type="number" id="cam-prix-${p._i}" value="${p.prix}" min="0" step="100"
      style="width:90px;background:var(--s2);border:1px solid var(--bd2);border-radius:var(--rs);padding:5px 8px;color:var(--tx);font-size:12px;font-family:'DM Sans',sans-serif;outline:none;text-align:right"
      onfocus="this.style.borderColor='var(--ac)'" onblur="this.style.borderColor='var(--bd2)'"
      ${!checked?'disabled style="opacity:.35;width:90px;background:var(--s2);border:1px solid var(--bd2);border-radius:var(--rs);padding:5px 8px;color:var(--tx);font-size:12px;font-family:DM Sans,sans-serif;outline:none;text-align:right"':''}>
    <span style="font-size:11px;color:var(--mt);flex-shrink:0">F</span>
  </div>`;
}

function setCamCat(cat) {
  camCatFilter = cat;
  renderCamModal();
}

function toggleCamProd(i) {
  camSel[i] = !camSel[i];
  const row = document.getElementById('cam-chk-'+i)?.closest('div[style]');
  const priceInput = document.getElementById('cam-prix-'+i);
  if (priceInput) priceInput.disabled = !camSel[i];
  updateCamCount();
  // Rafraîchir le style de la ligne sans re-render complet
  renderCamModal();
}

function updateCamCount() {
  const n = Object.values(camSel).filter(Boolean).length;
  document.getElementById('cam-count').textContent = n;
}

async function importMenuCam() {
  const btn = document.querySelector('#m-menu-cam .btn-ac');
  btn.disabled = true; btn.textContent = '⏳ Import en cours...';

  const qtyInit = parseInt(document.getElementById('cam-qty-init').value) || 0;
  const existingNoms = new Set(ARTICLES.map(a => a.nom.toLowerCase()));
  let added = 0, skipped = 0, doublons = 0;
  for (let i = 0; i < MENU_CAM.length; i++) {
    if (!camSel[i]) { skipped++; continue; }
    const p = MENU_CAM[i];
    if (existingNoms.has(p.nom.toLowerCase())) { doublons++; continue; } // évite les doublons dans "stock"
    const priceEl = document.getElementById('cam-prix-'+i);
    const prix = priceEl ? (parseInt(priceEl.value) || p.prix) : p.prix;
    // Calcul automatique du type_service depuis la catégorie du produit
    const ts = _catToTypeService(p.cat);
    const {error} = await _insertOrUpdateStock(null, {
      etab_id: ETAB.id, icone: p.icone, nom: p.nom,
      prix_vente: prix, categorie: p.cat, type_service: ts,
      quantite: qtyInit, quantite_initiale: qtyInit, seuil_alerte: 10, vendu_systeme: 0,
      favori: false, mots_cles: '', actif: true
    });
    if (!error) { added++; existingNoms.add(p.nom.toLowerCase()); } else skipped++;
  }

  btn.disabled = false; btn.textContent = '✓ Importer la sélection';
  closeM('m-menu-cam');
  await loadArticles();
  showN(`✅ ${added} article(s) importé(s) dans le stock${doublons?' · '+doublons+' déjà existants ignorés':''}${skipped?' · '+skipped+' échecs':''}`, 'success');
}

// ===== WHATSAPP =====
async function sendRapportWA() {
  if(!ETAB?.tel){showN('⚠️ Ajoutez le tél manager dans Paramètres','warn');return;}
  const {from,to,lbl}=getRptDates();
  const {data:cmds}=await db.from('commandes').select('montant,statut').eq('etab_id',ETAB.id).eq('statut','Livré').gte('date_cmd',from).lte('date_cmd',to);
  const ca=(cmds||[]).reduce((a,c)=>a+c.montant,0);
  const nb=(cmds||[]).length;
  const msg=`📊 *RAPPORT BAROS*\n_${ETAB.nom}_\n_Période : ${lbl}_\n\n💵 CA : *${fmt(ca)} FCFA*\n🧾 Commandes : *${nb}*\n📈 Ticket moyen : *${nb?fmt(Math.round(ca/nb)):0} FCFA*\n\n_Généré le ${new Date().toLocaleString('fr-FR')}_`;
  window.open('https://wa.me/'+ETAB.tel.replace(/[^0-9]/g,'')+'?text='+encodeURIComponent(msg),'_blank');
}

// ===== ADMINISTRATION =====
async function loadAdmin() {
  if(!isAdmin()) return;
  const filter = document.getElementById('adm-filter')?.value || '';

  // [RLS FIX] Tenter la requête globale (tous les etabs) puis fallback etab local
  let sessions = null;
  const SESS_FIELDS = 'id,email,nom,role,etab_id,couleur,is_active,created_at,locked_until,failed_attempts';
  const {data: sessAll, error: errAll} = await db.from('sessions')
    .select(SESS_FIELDS).order('created_at', {ascending: false});

  if (errAll || !sessAll || sessAll.length === 0) {
    // RLS bloque la vue globale → requête restreinte à l'etab courant
    if (ETAB?.id) {
      const {data: sessEtab, error: errEtab} = await db.from('sessions')
        .select(SESS_FIELDS).eq('etab_id', ETAB.id).order('created_at', {ascending: false});
      if (!errEtab && sessEtab?.length) {
        sessions = sessEtab;
        // Avertir que la vue est limitée à l'etab courant (RLS actif)
        showN('⚠️ Vue limitée à votre établissement (RLS Supabase actif)', 'warn');
      } else {
        sessions = [];
        if (errAll) console.warn('[BarOS] loadAdmin sessions error:', errAll.message);
        if (errEtab) console.warn('[BarOS] loadAdmin sessions etab error:', errEtab.message);
      }
    } else {
      sessions = [];
    }
  } else {
    sessions = sessAll;
  }
  const all = sessions || [];
  const now = new Date();

  // ── Comptes bloqués (locked_until dans le futur) ─────────────────
  const locked = all.filter(s => s.locked_until && new Date(s.locked_until) > now);

  // Stats
  const actifs  = all.filter(s => s.is_active !== false).length;
  const pending  = all.filter(s => s.is_active === false).length;
  document.getElementById('adm-total').textContent   = all.length;
  document.getElementById('adm-actifs').textContent  = actifs;
  document.getElementById('adm-pending').textContent = pending;
  document.getElementById('adm-locked').textContent  = locked.length;

  // ── Panneau comptes bloqués ───────────────────────────────────────
  const lockedPanel = document.getElementById('adm-locked-panel');
  const lockedTb    = document.getElementById('adm-locked-tb');
  if (locked.length > 0) {
    lockedPanel.style.display = '';
    lockedTb.innerHTML = locked.map(s => {
      const until = new Date(s.locked_until).toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'});
      const date  = new Date(s.locked_until).toLocaleDateString('fr-FR');
      return `<tr>
        <td><strong>${BarOSSec.escapeHtml(s.nom||'—')}</strong></td>
        <td style="font-size:11px">${BarOSSec.escapeHtml(s.email||'—')}</td>
        <td style="font-size:11px;color:#ff5050">${date} à ${until}</td>
        <td style="text-align:center">${s.failed_attempts||'?'} tentatives</td>
        <td><button class="btn btn-sm btn-gn" onclick="unlockAccount('${s.id}','${BarOSSec.escapeHtml(s.email||'')}')">🔓 Débloquer</button></td>
      </tr>`;
    }).join('');

    // Alerte visuelle si nouveaux bloqués depuis la dernière visite
    const lastCheck = parseInt(localStorage.getItem('baros_last_locked_check')||'0');
    const hasNew = locked.some(s => new Date(s.locked_until).getTime() - 30*60*1000 > lastCheck);
    if (hasNew) showN(`🔒 ${locked.length} compte(s) bloqué(s) — trop de tentatives`, 'warn');
  } else {
    lockedPanel.style.display = 'none';
  }
  localStorage.setItem('baros_last_locked_check', Date.now());

  // Filtrage liste principale
  const etabIds = [...new Set(all.map(s => s.etab_id).filter(Boolean))];
  let etabsMap = {};
  if(etabIds.length) {
    const {data:etabs} = await db.from('etabs').select('id,nom').in('id', etabIds);
    (etabs||[]).forEach(e => etabsMap[e.id] = e.nom);
  }

  let filtered = all;
  if(filter === 'active')   filtered = all.filter(s => s.is_active === true);
  else if(filter === 'pending' || filter === 'inactive') filtered = all.filter(s => s.is_active === false);

  const isAdminEmail = email => ADMIN_EMAILS.includes((email||'').toLowerCase().trim());

  document.getElementById('adm-tb').innerHTML = filtered.map(s => {
    const active = s.is_active !== false;
    const admin  = isAdminEmail(s.email);
    const isLocked = s.locked_until && new Date(s.locked_until) > now;
    const statusHtml = admin
      ? `<span class="pill" style="background:rgba(200,245,90,.1);color:var(--ac)">👑 Admin</span>`
      : isLocked
        ? `<span class="pill" style="background:rgba(255,80,80,.12);color:#ff5050">🔒 Bloqué</span>`
        : active
          ? `<span class="pill p-d">✅ Actif</span>`
          : `<span class="pill p-c">⏳ En attente</span>`;
    const created = s.created_at ? new Date(s.created_at).toLocaleDateString('fr-FR') : '—';
    return `<tr>
      <td><strong>${BarOSSec.escapeHtml(s.nom||'—')}</strong></td>
      <td style="font-size:11px">${BarOSSec.escapeHtml(s.email||'—')}</td>
      <td style="font-size:11px;color:var(--mt)">${BarOSSec.escapeHtml(etabsMap[s.etab_id]||'—')}</td>
      <td style="font-size:11px">${BarOSSec.escapeHtml(s.role||'—')}</td>
      <td>${statusHtml}</td>
      <td style="font-size:11px;color:var(--mt)">${created}</td>
      <td style="white-space:nowrap">${admin ? '' : `
        ${isLocked ? `<button class="btn btn-sm btn-gn" onclick="unlockAccount('${s.id}','${BarOSSec.escapeHtml(s.email||'')}')">🔓 Débloquer</button>` : ''}
        ${!active && !isLocked ? `<button class="btn btn-sm btn-gn" onclick="setUserActive('${s.id}',true)">✅ Activer</button>` : ''}
        ${active && !isLocked  ? `<button class="btn btn-sm btn-dg" onclick="setUserActive('${s.id}',false)">🔒 Désactiver</button>` : ''}
      `}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" style="text-align:center;color:var(--mt);padding:20px">Aucun utilisateur</td></tr>`;
}

async function unlockAccount(id, email) {
  if(!confirm(`Débloquer le compte de ${email} ?`)) return;
  await db.from('sessions').update({ locked_until: null, failed_attempts: 0 }).eq('id', id);
  await BarOSSec.logSecurityEvent(db, 'account_unlocked', { target_id: id, email, actor: CU?.email });
  showN(`🔓 Compte ${email} débloqué`, 'success');
  loadAdmin();
}

async function setUserActive(id, active) {
  const msg = active ? 'Activer ce compte ?' : 'Bloquer ce compte ?';
  if(!confirm(msg)) return;
  await db.from('sessions').update({is_active: active}).eq('id', id);
  loadAdmin();
  showN(active ? '✅ Compte activé' : '🔒 Compte bloqué', active ? 'success' : 'warn');
}

async function activateAllPending() {
  if(!confirm('Activer tous les comptes en attente ?')) return;
  // [FIX C1] Filtrer par etab_id — ne jamais activer des comptes d'autres établissements
  const {data:pending} = await db.from('sessions').select('id').eq('is_active', false).eq('etab_id', ETAB.id);
  if(!pending?.length) { showN('Aucun compte en attente', 'info'); return; }
  for(const s of pending) {
    await db.from('sessions').update({is_active:true}).eq('id', s.id).eq('etab_id', ETAB.id);
  }
  loadAdmin();
  showN(`✅ ${pending.length} compte(s) activé(s)`, 'success');
}

// ===== NAV =====
function go(id, el) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));
  const pg=document.getElementById('pg-'+id);if(pg)pg.classList.add('on');
  document.querySelectorAll('.ni').forEach(n=>n.classList.remove('on'));
  if(el)el.classList.add('on');
  const titles={bars:'Bars & Compartiments',tables:'Tables & QR',dash:'Tableau de bord',caisse:'Caisse & Commandes',stock:'Stock',personnel:'Personnel',serveurs:'Performances',alertes:'Alertes Fraude IA',clients:'Clients & Fidélité',marketing:'Marketing',rapports:'Rapports',config:'Paramètres',admin:'Administration'};
  document.getElementById('pg-title').textContent=titles[id]||id;
  const loaders={bars:loadBarsPage,tables:loadTables,dash:renderDash,caisse:()=>{loadCommandes();renderCaisse();renderQCmd();},stock:loadStock,personnel:loadPersonnel,serveurs:loadServeurs,alertes:loadAlertes,clients:loadClients,marketing:()=>{loadMarketing();updSms();checkNotchpayKey();},rapports:loadRapports,config:()=>{loadConfig();loadIntegrations();setTimeout(genererQRConfig,300);},admin:loadAdmin};
  if(loaders[id])loaders[id]();
}

function openM(id){document.getElementById(id).classList.add('on');}
function closeM(id){document.getElementById(id).classList.remove('on');}
document.querySelectorAll('.modal-bg').forEach(m=>m.onclick=e=>{if(e.target===m)m.classList.remove('on');});

function updateTime(){const now=new Date();document.getElementById('live-time').textContent=now.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})+' · '+now.toTimeString().slice(0,5);}

window.addEventListener('online',()=>{document.getElementById('off-banner').style.display='none';setSyncStatus(true);});
window.addEventListener('offline',()=>{document.getElementById('off-banner').style.display='block';setSyncStatus(false,'Hors-ligne');});

updateTime();setInterval(updateTime,30000);


// ═══════════════════════════════════════════════════════════════
// BAROS EVENT BUS v1.0 — Module central de communication
// Additif strict — aucune modification du code existant
// ═══════════════════════════════════════════════════════════════
/**
 * ══════════════════════════════════════════════════════════════════════
 * BarOS EVENT BUS — Module central de communication inter-applications
 * Version 1.0 — Additif strict, aucune modification du core existant
 * ══════════════════════════════════════════════════════════════════════
 *
 * PRINCIPE D'INTÉGRATION :
 *   - Ce module est STRICTEMENT ADDITIF.
 *   - Toutes les fonctions existantes continuent de fonctionner.
 *   - Le bus écoute les canaux Supabase existants et les réplique
 *     en événements typés — il ne les remplace PAS.
 *   - Les hooks sur _mgrComm, sendNotification, validerCmd, etc.
 *     publient EN PLUS via le bus, sans modifier leur comportement.
 *
 * ARCHITECTURE :
 *
 *   Gestionnaire         Personnel           Pointage
 *       │                    │                   │
 *   _mgrComm()          sendNotification()   pointageInsert()
 *       │                    │                   │
 *       └──────────┬─────────┘                   │
 *                  ▼                             │
 *           BarOSEventBus ◄────────────────────┘
 *                  │
 *       ┌──────────┼──────────────┐
 *       ▼          ▼              ▼
 *   Subscribers  NotifCenter  AutoEngine
 *
 * TABLE SQL REQUISE (exécuter UNE FOIS dans Supabase SQL Editor) :
 *
 *   CREATE TABLE IF NOT EXISTS public.events (
 *     id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *     etab_id          uuid NOT NULL REFERENCES public.etabs(id),
 *     event_type       text NOT NULL,
 *     source_app       text NOT NULL DEFAULT 'unknown',
 *     source_user      text,
 *     target_type      text NOT NULL DEFAULT 'ALL',
 *     target_role      text,
 *     target_user      uuid,
 *     payload          jsonb DEFAULT '{}',
 *     created_at       timestamptz DEFAULT now(),
 *     read_at          timestamptz,
 *     acknowledged_at  timestamptz
 *   );
 *
 *   CREATE INDEX IF NOT EXISTS idx_events_etab ON public.events(etab_id);
 *   CREATE INDEX IF NOT EXISTS idx_events_type ON public.events(event_type);
 *   CREATE INDEX IF NOT EXISTS idx_events_created ON public.events(created_at DESC);
 *
 *   -- RLS (adapter selon votre politique existante)
 *   ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "events_etab_access" ON public.events
 *     USING (etab_id IN (SELECT etab_id FROM public.sessions WHERE email = auth.email()));
 *
 * ACTIVATION REALTIME dans Dashboard Supabase :
 *   Database → Replication → Supabase Realtime → cocher : events, communications
 *
 */

(function (global) {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // TYPES D'ÉVÉNEMENTS — référence centralisée
  // ─────────────────────────────────────────────────────────────
  const EVENT_TYPES = {
    // Communications manager → personnel
    MANAGER_MESSAGE:        'MANAGER_MESSAGE',
    MANAGER_ALERT:          'MANAGER_ALERT',
    URGENT_MEETING:         'URGENT_MEETING',

    // Appels et service
    STAFF_CALL:             'STAFF_CALL',
    STAFF_CALL_ACCEPTED:    'STAFF_CALL_ACCEPTED',
    STAFF_CALL_COMPLETED:   'STAFF_CALL_COMPLETED',

    // Pointages
    EMPLOYEE_CLOCKED_IN:    'EMPLOYEE_CLOCKED_IN',
    EMPLOYEE_CLOCKED_OUT:   'EMPLOYEE_CLOCKED_OUT',

    // Commandes
    ORDER_CREATED:          'ORDER_CREATED',
    ORDER_UPDATED:          'ORDER_UPDATED',
    ORDER_READY:            'ORDER_READY',
    ORDER_DELIVERED:        'ORDER_DELIVERED',
    ORDER_CANCELLED:        'ORDER_CANCELLED',

    // Stock
    STOCK_LOW:              'STOCK_LOW',
    STOCK_CRITICAL:         'STOCK_CRITICAL',
    STOCK_UPDATED:          'STOCK_UPDATED',

    // Système
    APP_READY:              'APP_READY',
    SESSION_EXPIRED:        'SESSION_EXPIRED',
  };

  // ─────────────────────────────────────────────────────────────
  // [BAROS NOTIF COMPLETION] SÉVÉRITÉ + DÉPARTEMENT — métadonnées
  // additives par type d'événement. Ne change rien au comportement
  // existant : un type absent de ces tables retombe sur les valeurs
  // par défaut (INFO / SYSTEME) et continue de fonctionner comme avant.
  // ─────────────────────────────────────────────────────────────
  const SEVERITY = { INFO: 'INFO', ALERT: 'ALERT', CRITICAL: 'CRITICAL' };

  const EVENT_SEVERITY = {
    MANAGER_MESSAGE:      SEVERITY.INFO,
    MANAGER_ALERT:        SEVERITY.ALERT,
    URGENT_MEETING:       SEVERITY.CRITICAL,
    STAFF_CALL:           SEVERITY.ALERT,
    STAFF_CALL_ACCEPTED:  SEVERITY.INFO,
    STAFF_CALL_COMPLETED: SEVERITY.INFO,
    EMPLOYEE_CLOCKED_IN:  SEVERITY.INFO,
    EMPLOYEE_CLOCKED_OUT: SEVERITY.INFO,
    ORDER_CREATED:        SEVERITY.INFO,
    ORDER_UPDATED:        SEVERITY.INFO,
    ORDER_READY:          SEVERITY.ALERT,
    ORDER_DELIVERED:      SEVERITY.INFO,
    ORDER_CANCELLED:      SEVERITY.ALERT,
    STOCK_LOW:            SEVERITY.ALERT,
    STOCK_CRITICAL:       SEVERITY.CRITICAL,
    STOCK_UPDATED:        SEVERITY.INFO,
    APP_READY:            SEVERITY.INFO,
    SESSION_EXPIRED:      SEVERITY.ALERT,
  };

  // 7 départements — chacun reçoit une signature audio distincte.
  const DEPARTMENT = {
    MANAGER: 'MANAGER', CUISINE: 'CUISINE', BAR: 'BAR', SERVICE: 'SERVICE',
    STOCK: 'STOCK', CAISSE: 'CAISSE', SYSTEME: 'SYSTEME',
  };

  const EVENT_DEPARTMENT = {
    MANAGER_MESSAGE:      DEPARTMENT.MANAGER,
    MANAGER_ALERT:        DEPARTMENT.MANAGER,
    URGENT_MEETING:       DEPARTMENT.MANAGER,
    STAFF_CALL:           DEPARTMENT.SERVICE,
    STAFF_CALL_ACCEPTED:  DEPARTMENT.SERVICE,
    STAFF_CALL_COMPLETED: DEPARTMENT.SERVICE,
    EMPLOYEE_CLOCKED_IN:  DEPARTMENT.SYSTEME,
    EMPLOYEE_CLOCKED_OUT: DEPARTMENT.SYSTEME,
    ORDER_CREATED:        DEPARTMENT.CUISINE,
    ORDER_UPDATED:        DEPARTMENT.CUISINE,
    ORDER_READY:          DEPARTMENT.SERVICE,
    ORDER_DELIVERED:      DEPARTMENT.CAISSE,
    ORDER_CANCELLED:      DEPARTMENT.CUISINE,
    STOCK_LOW:            DEPARTMENT.STOCK,
    STOCK_CRITICAL:       DEPARTMENT.STOCK,
    STOCK_UPDATED:        DEPARTMENT.STOCK,
    APP_READY:            DEPARTMENT.SYSTEME,
    SESSION_EXPIRED:      DEPARTMENT.SYSTEME,
  };

  // ─────────────────────────────────────────────────────────────
  // BUS CENTRAL
  // ─────────────────────────────────────────────────────────────
  const _subscribers = {};     // eventType → [ {id, callback} ]
  const _eventQueue  = [];     // file hors-ligne
  const _seenIds     = new Set(); // déduplication par id Supabase
  const _seenFingerprints = new Map(); // [BAROS NOTIF COMPLETION] déduplication par empreinte (fenêtre 3s)
  const FINGERPRINT_WINDOW_MS = 3000;
  let   _supaChannel = null;   // canal Realtime unique
  let   _db          = null;   // référence à window.db
  let   _etabId      = null;   // référence à ETAB.id
  let   _sourceApp   = 'unknown';
  let   _initialized = false;
  let   _subIdCtr    = 0;

  // ─────────────────────────────────────────────────────────────
  // [BAROS NOTIF COMPLETION] SIGNATURES AUDIO PAR DÉPARTEMENT
  // Générées via WebAudio (aucun fichier externe, aucune dépendance
  // réseau) — un motif de fréquences distinct par département pour
  // que le personnel reconnaisse la source sans regarder l'écran.
  // Échoue silencieusement si l'audio est bloqué (autoplay, etc.).
  // ─────────────────────────────────────────────────────────────
  let _audioCtx = null;
  const DEPT_TONES = {
    MANAGER:  [880, 1108],
    CUISINE:  [660, 660, 660],
    BAR:      [523, 659],
    SERVICE:  [784, 988],
    STOCK:    [440, 349],
    CAISSE:   [988, 784, 988],
    SYSTEME:  [523],
  };

  function _playSignature(department) {
    try {
      const freqs = DEPT_TONES[department] || DEPT_TONES.SYSTEME;
      if (!_audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        _audioCtx = new AC();
      }
      if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {});
      let t = _audioCtx.currentTime;
      freqs.forEach((f) => {
        const osc  = _audioCtx.createOscillator();
        const gain = _audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        osc.connect(gain).connect(_audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.18);
        t += 0.15;
      });
    } catch (e) { /* silencieux — audio non critique */ }
  }

  // ─────────────────────────────────────────────────────────────
  // [BAROS NOTIF COMPLETION] DÉDUPLICATION PAR EMPREINTE
  // Complète la dédup par id (qui ne protège que contre le doublon
  // realtime/polling d'un MÊME enregistrement). Ici on détecte les
  // événements FONCTIONNELLEMENT identiques émis en rafale (ex: double
  // clic, retry réseau) même s'ils n'ont pas encore d'id Supabase.
  // ─────────────────────────────────────────────────────────────
  function _fingerprint(event) {
    try {
      const key = [
        event.event_type,
        event.target_type || '',
        event.target_role || '',
        event.target_user || '',
        (event.payload && (event.payload.titre || event.payload.table || event.payload.produit)) || '',
      ].join('|');
      return key;
    } catch (e) { return null; }
  }

  function _isDuplicateFingerprint(event) {
    const fp = _fingerprint(event);
    if (!fp) return false;
    const now = Date.now();
    const last = _seenFingerprints.get(fp);
    _seenFingerprints.set(fp, now);
    // Nettoyage périodique pour éviter une fuite mémoire
    if (_seenFingerprints.size > 300) {
      for (const [k, ts] of _seenFingerprints) {
        if (now - ts > FINGERPRINT_WINDOW_MS) _seenFingerprints.delete(k);
      }
    }
    return !!last && (now - last) < FINGERPRINT_WINDOW_MS;
  }

  // ─────────────────────────────────────────────────────────────
  // API PUBLIQUE
  // ─────────────────────────────────────────────────────────────

  /**
   * subscribe(eventType, callback) → unsubscribeId
   * Exemples :
   *   BarOSEventBus.subscribe('MANAGER_MESSAGE', (payload) => { ... });
   *   BarOSEventBus.subscribe('*', (payload) => { ... }); // tous les events
   */
  function subscribe(eventType, callback) {
    if (typeof callback !== 'function') return null;
    const id = ++_subIdCtr;
    if (!_subscribers[eventType]) _subscribers[eventType] = [];
    _subscribers[eventType].push({ id, callback });
    return id;
  }

  /**
   * unsubscribe(eventType, id)
   */
  function unsubscribe(eventType, id) {
    if (!_subscribers[eventType]) return;
    _subscribers[eventType] = _subscribers[eventType].filter(s => s.id !== id);
  }

  /**
   * emit(eventType, payload)
   * Publie un événement localement ET persiste dans Supabase si connecté.
   * Ne bloque jamais — erreurs silencieuses (le système existant continue).
   */
  function emit(eventType, payload) {
    if (!eventType) return;

    const event = {
      event_type:  eventType,
      source_app:  _sourceApp,
      source_user: payload?.source_user || null,
      target_type: payload?.target_type || 'ALL',
      target_role: payload?.target_role || null,
      target_user: payload?.target_user || null,
      payload:     payload || {},
      _local_ts:   Date.now(),
    };

    // Distribution locale immédiate
    _dispatch(event);

    // Persistance Supabase en arrière-plan (non bloquant)
    if (_db && _etabId) {
      _persistEvent(event).catch(() => {
        // Hors ligne → file d'attente locale
        _eventQueue.push(event);
      });
    } else {
      _eventQueue.push(event);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // INITIALISATION
  // ─────────────────────────────────────────────────────────────

  /**
   * init({ db, etabId, sourceApp })
   * Appelé une fois que db et ETAB sont disponibles.
   * Idempotent.
   */
  function init({ db, etabId, sourceApp }) {
    if (_initialized) return;
    _initialized = true;
    _db         = db;
    _etabId     = etabId;
    _sourceApp  = sourceApp || 'unknown';

    _log('BarOSEventBus initialisé', { sourceApp, etabId });

    // Vider la file hors-ligne
    _flushQueue();

    // Démarrer l'écoute Realtime de la table events
    _startRealtime();

    // Écoute online → flush queue
    window.addEventListener('online', _flushQueue);

    emit(EVENT_TYPES.APP_READY, { sourceApp });
  }

  // ─────────────────────────────────────────────────────────────
  // INTERNE — dispatch local
  // ─────────────────────────────────────────────────────────────

  function _dispatch(event) {
    // Déduplication par id Supabase (évite double-notification realtime + polling)
    if (event.id && _seenIds.has(event.id)) return;
    if (event.id) _seenIds.add(event.id);
    // Nettoyer le Set après 500 entrées
    if (_seenIds.size > 500) {
      const arr = [..._seenIds];
      arr.slice(0, 250).forEach(id => _seenIds.delete(id));
    }

    // [BAROS NOTIF COMPLETION] Déduplication par empreinte fonctionnelle
    // (protège contre double-clic / retry réseau avant même l'obtention d'un id)
    if (_isDuplicateFingerprint(event)) {
      _log('Événement dupliqué (empreinte) ignoré:', event.event_type);
      return;
    }

    // [BAROS NOTIF COMPLETION] Signature audio par département,
    // uniquement pour les événements ALERT / CRITICAL (évite le bruit
    // pour les événements INFO à haute fréquence).
    const _sev = EVENT_SEVERITY[event.event_type] || SEVERITY.INFO;
    if (_sev === SEVERITY.ALERT || _sev === SEVERITY.CRITICAL) {
      _playSignature(EVENT_DEPARTMENT[event.event_type] || DEPARTMENT.SYSTEME);
    }

    const handlers = [
      ...(_subscribers[event.event_type] || []),
      ...(_subscribers['*'] || []),
    ];

    handlers.forEach(({ callback }) => {
      try {
        callback(event);
      } catch (e) {
        console.warn('[BarOSEventBus] Erreur subscriber:', e);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  // INTERNE — persistance Supabase
  // ─────────────────────────────────────────────────────────────

  async function _persistEvent(event) {
    if (!_db || !_etabId) throw new Error('not ready');
    const { error } = await _db.from('events').insert({
      etab_id:     _etabId,
      event_type:  event.event_type,
      source_app:  event.source_app,
      source_user: event.source_user,
      target_type: event.target_type,
      target_role: event.target_role,
      target_user: event.target_user,
      payload:     event.payload,
    });
    if (error) throw error;
  }

  function _flushQueue() {
    if (!_db || !_etabId || !navigator.onLine) return;
    const queue = _eventQueue.splice(0);
    queue.forEach(ev => {
      _persistEvent(ev).catch(() => _eventQueue.push(ev));
    });
  }

  // ─────────────────────────────────────────────────────────────
  // INTERNE — Realtime sur la table events
  // ─────────────────────────────────────────────────────────────

  function _startRealtime() {
    if (!_db || !_etabId) return;
    if (_supaChannel) return; // idempotent

    _supaChannel = _db.channel('baros-events-' + _etabId)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'events',
        filter: `etab_id=eq.${_etabId}`,
      }, payload => {
        if (payload.new) _dispatch(payload.new);
      })
      .subscribe(status => {
        _log('Realtime events status:', status);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          _supaChannel = null;
          // Retry dans 10s
          setTimeout(_startRealtime, 10000);
        }
      });
  }

  // ─────────────────────────────────────────────────────────────
  // HOOKS ADDITIFS sur les fonctions existantes
  // Principe : wrap sans modifier le comportement d'origine
  // ─────────────────────────────────────────────────────────────

  /**
   * _installHooks() — à appeler APRÈS que toutes les fonctions
   * applicatives soient définies (fin de chargement).
   */
  function _installHooks() {

    // ── Hook : _mgrComm (gestionnaire) ──────────────────────────
    // Publie MANAGER_MESSAGE / MANAGER_ALERT / URGENT_MEETING
    if (typeof window._mgrComm === 'function') {
      const _orig_mgrComm = window._mgrComm;
      window._mgrComm = async function(opts) {
        const result = await _orig_mgrComm.apply(this, arguments);
        // Mapper le type 'communications' → event_type BarOS
        const typeMap = {
          'GLOBAL_INSTRUCTION': EVENT_TYPES.MANAGER_MESSAGE,
          'URGENT_MEETING':     EVENT_TYPES.URGENT_MEETING,
          'COMMUNICATION':      EVENT_TYPES.MANAGER_MESSAGE,
        };
        const evType = typeMap[opts?.type] || EVENT_TYPES.MANAGER_MESSAGE;
        emit(evType, {
          titre:       opts?.titre,
          corps:       opts?.corps,
          scope:       opts?.scope,
          role_cible:  opts?.role_cible,
          target_type: opts?.scope || 'ALL',
          target_role: opts?.role_cible || null,
          comm_type:   opts?.type,
          source:      'gestionnaire',
        });
        return result;
      };
      _log('Hook installé: _mgrComm → MANAGER_MESSAGE / URGENT_MEETING');
    }

    // ── Hook : validerCmd (personnel) ───────────────────────────
    // Publie ORDER_CREATED
    if (typeof window.validerCmd === 'function') {
      const _orig_validerCmd = window.validerCmd;
      window.validerCmd = async function() {
        const result = await _orig_validerCmd.apply(this, arguments);
        // Récupérer les infos panier si disponibles globalement
        const orderInfo = {
          table:  (typeof selTable !== 'undefined') ? selTable : null,
          montant:(typeof calcTot  === 'function')  ? calcTot() : null,
          source: 'personnel',
        };
        emit(EVENT_TYPES.ORDER_CREATED, orderInfo);
        return result;
      };
      _log('Hook installé: validerCmd → ORDER_CREATED');
    }

    // ── Hook : sendNotification (personnel) ─────────────────────
    // Publie STAFF_CALL pour les appels vers la table communications
    if (typeof window.sendNotification === 'function') {
      const _orig_sendNotification = window.sendNotification;
      window.sendNotification = async function(opts) {
        const result = await _orig_sendNotification.apply(this, arguments);
        emit(EVENT_TYPES.STAFF_CALL, {
          titre:  opts?.titre,
          type:   opts?.type,
          scope:  opts?.scope,
          source: 'personnel',
        });
        return result;
      };
      _log('Hook installé: sendNotification → STAFF_CALL');
    }

    // ── Écoute Realtime existant : communications ───────────────
    // Le canal 'comm-pers-X' existant continue d'exister.
    // On s'abonne AUSSI en tant que subscriber BarOSEventBus
    // pour que les nouvelles couches puissent réagir aux messages.
    // Note : _commAfficher est appelé par le canal original, pas ici.
    subscribe(EVENT_TYPES.MANAGER_MESSAGE, (ev) => {
      _log('MANAGER_MESSAGE reçu via bus:', ev.payload?.titre);
      // Le canal comm-pers original gère déjà l'affichage.
      // Ce subscriber sert aux futures couches (historique, acquittement, etc.)
    });

    subscribe(EVENT_TYPES.URGENT_MEETING, (ev) => {
      _log('URGENT_MEETING reçu via bus:', ev.payload?.titre);
    });

  }

  // ─────────────────────────────────────────────────────────────
  // CENTRE DE NOTIFICATIONS — fondations
  // ─────────────────────────────────────────────────────────────

  /**
   * NotifCenter : stocke les notifications non acquittées en mémoire.
   * Persistance IndexedDB possible dans une future version.
   * N'affiche rien — c'est _commAfficher qui gère l'UI.
   */
  // [BAROS NOTIF COMPLETION] Paramètres d'escalade — additifs, désactivables
  // en mettant ESCALATION_ENABLED à false sans casser le reste du module.
  const ESCALATION_ENABLED   = true;
  const ESCALATION_DELAY_MS  = 60000; // 1re relance après 60s sans accusé de réception
  const ESCALATION_MAX       = 3;     // nombre max de relances avant abandon silencieux

  const NotifCenter = {
    _store: [], // { event, read: bool, ack: bool, escalations: number, _timer }

    push(event) {
      const entry = { event, read: false, ack: false, receivedAt: Date.now(), escalations: 0, _timer: null };
      this._store.push(entry);
      // Limite mémoire : garder les 200 dernières
      if (this._store.length > 200) {
        const removed = this._store.shift();
        if (removed && removed._timer) clearTimeout(removed._timer);
      }

      // [BAROS NOTIF COMPLETION] Escalade — uniquement pour ALERT / CRITICAL
      const sev = EVENT_SEVERITY[event.event_type] || SEVERITY.INFO;
      if (ESCALATION_ENABLED && (sev === SEVERITY.ALERT || sev === SEVERITY.CRITICAL)) {
        this._scheduleEscalation(entry);
      }
    },

    _scheduleEscalation(entry) {
      entry._timer = setTimeout(() => {
        // Si entre-temps acquitté ou retiré du store, ne rien faire
        if (entry.ack || !this._store.includes(entry)) return;
        entry.escalations += 1;
        _log('Escalade notification non acquittée:', entry.event.event_type, 'tentative', entry.escalations);
        _playSignature(EVENT_DEPARTMENT[entry.event.event_type] || DEPARTMENT.SYSTEME);
        if (typeof global.showN === 'function') {
          global.showN('🔁 Relance: ' + (entry.event.payload?.titre || entry.event.event_type), 'warn');
        }
        if (entry.escalations < ESCALATION_MAX) {
          this._scheduleEscalation(entry);
        }
      }, ESCALATION_DELAY_MS);
    },

    markRead(eventId) {
      const n = this._store.find(n => n.event?.id === eventId);
      if (n) n.read = true;
    },

    markAcknowledged(eventId) {
      const n = this._store.find(n => n.event?.id === eventId);
      if (n) {
        n.read = true;
        n.ack = true;
        if (n._timer) { clearTimeout(n._timer); n._timer = null; } // [BAROS NOTIF COMPLETION] stoppe l'escalade
      }
      // Persister ack dans Supabase en arrière-plan
      if (_db && eventId) {
        _db.from('events')
          .update({ acknowledged_at: new Date().toISOString() })
          .eq('id', eventId)
          .then(() => {})
          .catch(() => {});
      }
    },

    getUnread() {
      return this._store.filter(n => !n.read);
    },

    getAll() {
      return [...this._store];
    },

    // ───────────────────────────────────────────────────────────
    // [BAROS NOTIF COMPLETION] API MANAGER COCKPIT
    // Vue d'ensemble pour un tableau de bord manager : compte par
    // sévérité/département, alertes en cours d'escalade, âge moyen.
    // ───────────────────────────────────────────────────────────
    getStats() {
      const stats = {
        total: this._store.length,
        unread: 0,
        unacknowledged: 0,
        escalating: 0,
        bySeverity: { INFO: 0, ALERT: 0, CRITICAL: 0 },
        byDepartment: {},
      };
      const now = Date.now();
      let ageSum = 0, ageCount = 0;
      this._store.forEach(n => {
        const sev = EVENT_SEVERITY[n.event.event_type] || SEVERITY.INFO;
        const dep = EVENT_DEPARTMENT[n.event.event_type] || DEPARTMENT.SYSTEME;
        if (!n.read) stats.unread += 1;
        if (!n.ack) {
          stats.unacknowledged += 1;
          ageSum += (now - n.receivedAt);
          ageCount += 1;
        }
        if (n.escalations > 0 && !n.ack) stats.escalating += 1;
        stats.bySeverity[sev] = (stats.bySeverity[sev] || 0) + 1;
        stats.byDepartment[dep] = (stats.byDepartment[dep] || 0) + 1;
      });
      stats.avgUnacknowledgedAgeMs = ageCount ? Math.round(ageSum / ageCount) : 0;
      return stats;
    },

    getPendingEscalations() {
      return this._store
        .filter(n => !n.ack && n.escalations > 0)
        .map(n => ({
          event_type:  n.event.event_type,
          titre:       n.event.payload?.titre || null,
          escalations: n.escalations,
          ageMs:       Date.now() - n.receivedAt,
        }));
    },
  };

  // Alimenter le NotifCenter sur tous les événements entrants
  subscribe('*', (ev) => {
    const commsTypes = [
      EVENT_TYPES.MANAGER_MESSAGE,
      EVENT_TYPES.MANAGER_ALERT,
      EVENT_TYPES.URGENT_MEETING,
      EVENT_TYPES.STAFF_CALL,
    ];
    if (commsTypes.includes(ev.event_type)) {
      NotifCenter.push(ev);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // MOTEUR D'AUTOMATISATION — fondations
  // ─────────────────────────────────────────────────────────────

  /**
   * AutoEngine : réagit à des événements avec des règles configurables.
   * Aucune règle active par défaut — fondation uniquement.
   */
  const AutoEngine = {
    _rules: [],

    /**
     * addRule(eventType, condition, action)
     * condition : function(payload) → bool
     * action    : function(payload, emit)
     */
    addRule(eventType, condition, action) {
      this._rules.push({ eventType, condition, action });
      subscribe(eventType, (ev) => {
        if (typeof condition === 'function' && !condition(ev.payload)) return;
        try { action(ev.payload, emit); } catch(e) { console.warn('[AutoEngine]', e); }
      });
    },
  };

  // Règle exemple (inactive tant que STOCK_LOW n'est pas émis) :
  // AutoEngine.addRule(
  //   EVENT_TYPES.STOCK_LOW,
  //   (p) => p.quantite <= p.seuil_critique,
  //   (p, emit) => emit(EVENT_TYPES.MANAGER_ALERT, { titre: '⚠️ Stock critique: ' + p.produit })
  // );

  // ─────────────────────────────────────────────────────────────
  // UTILITAIRES
  // ─────────────────────────────────────────────────────────────

  function _log(...args) {
    console.log('[BarOSEventBus]', ...args);
  }

  // ─────────────────────────────────────────────────────────────
  // EXPORT GLOBAL
  // ─────────────────────────────────────────────────────────────

  global.BarOSEventBus = {
    // API principale
    init,
    emit,
    subscribe,
    unsubscribe,

    // Types d'événements (référence)
    EVENT_TYPES,

    // [BAROS NOTIF COMPLETION] Métadonnées additives
    SEVERITY,
    DEPARTMENT,
    EVENT_SEVERITY,
    EVENT_DEPARTMENT,
    playSignature: _playSignature,

    // Sous-modules
    NotifCenter,
    AutoEngine,

    // Installation des hooks additifs
    installHooks: _installHooks,

    // Debug
    getSubscribers: () => ({ ..._subscribers }),
    getQueue:       () => [..._eventQueue],
    isInitialized:  () => _initialized,
  };

  _log('Module chargé — en attente de init()');

})(window);


// ── Activation du bus dans le gestionnaire ──────────────────────
// Le bus s'active dès que db et ETAB sont disponibles
// sans modifier restoreSession() ni startApp()
(function _busActivatorMgr() {
  let _busReady = false;

  function _tryInitBus() {
    if (_busReady) return;
    if (typeof ETAB === 'undefined' || !ETAB || typeof db === 'undefined') return;
    _busReady = true;

    BarOSEventBus.init({
      db:        db,
      etabId:    ETAB.id,
      sourceApp: 'gestionnaire',
    });

    BarOSEventBus.installHooks();
    console.log('[BarOS] Event Bus actif — gestionnaire');
  }

  // Polling jusqu'à ETAB disponible
  const _iv = setInterval(() => {
    if (typeof ETAB !== 'undefined' && ETAB) {
      clearInterval(_iv);
      _tryInitBus();
    }
  }, 500);

  setTimeout(() => clearInterval(_iv), 60000);
})();

// Restauration de session avec vérification is_active
// [OFFLINE PATCH] Fallback offline si Supabase inaccessible (file://)
(async function restoreSession(){
  // [SEC H3] getSecureSession vérifie l'expiration automatiquement
  const saved = BarOSSec.getSecureSession();
  if(!saved) return;

  // ── OFFLINE PATCH : si pas de réseau, utiliser la session locale directement ──
  const isOffline = !navigator.onLine;
  const isFileProtocol = (location.protocol === 'file:');

  if (isOffline || isFileProtocol) {
    // Vérifier activation (sauf admin) — sur données locales uniquement
    if(!ADMIN_EMAILS.includes((saved.email||'').toLowerCase().trim()) && saved.is_active === false){
      BarOSSec.clearSecureSession();
      showErr('l','⛔ Compte désactivé.');
      return;
    }
    await startApp(saved);
    return;
  }

  // ── ONLINE : vérification fraîche depuis Supabase ──
  try {
    const {data:fresh} = await db.from('sessions').select('id,email,nom,role,etab_id,couleur,is_active').eq('id', saved.id).single();
    if(!fresh){ BarOSSec.clearSecureSession(); return; }
    if(!ADMIN_EMAILS.includes((fresh.email||'').toLowerCase().trim()) && fresh.is_active === false){
      BarOSSec.clearSecureSession();
      showErr('l','⛔ Compte désactivé par l\'administrateur.');
      return;
    }
    BarOSSec.saveSecureSession(fresh);
    await startApp(fresh);
  } catch(e) {
    // Supabase injoignable → fallback session locale
    console.warn('[BarOS] restoreSession: Supabase injoignable, session locale utilisée', e);
    await startApp(saved);
  }
})();
