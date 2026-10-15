const SB_URL='https://fijmxmaupjsdyqgynrem.supabase.co';
const SB_KEY='sb_publishable_B3NJtcctuVVbvE_S44oP9A_qiMHK1dd';
const {createClient}=supabase;
const db=createClient(SB_URL,SB_KEY);

let CU=null,ETAB=null,EMPS=[],ARTICLES=[],NIVEAUX=[];
let curStep=1,selTable=null,selPay='Cash',panier={},selClient=null,clientsCache=[];
let realtimeChannel=null;
let menuCatFilter='Tous', menuArticleSearch='';
const ARTICLE_CATS = ['Boissons gazeuses','Bières','Vins','Whiskys','Liqueurs','Cocktails','Jus','Eau','Café','Thé','Petit-déjeuner','Entrées','Plats','Grillades','Poissons','Accompagnements','Desserts','Glaces','Chichas','Divers'];
// Regroupe les rafales d'événements Realtime (ex: import en masse d'articles côté gestionnaire)
// en un seul rechargement, pour limiter le nombre de requêtes Supabase.
const _debounceTimers = {};
function _debounce(key, fn, delay) {
  clearTimeout(_debounceTimers[key]);
  _debounceTimers[key] = setTimeout(fn, delay);
}
// Normalise une ligne "stock" (source unique de vérité) en objet "article" compatible
// avec l'ancien format "produit" (prix, icone, type_service...) utilisé partout dans l'UI.
// quantite: si absente (ex. vieux cache offline pré-migration), on suppose l'article
// disponible par défaut jusqu'au prochain sync réseau, plutôt que de le masquer à tort.
function normArticle(s) {
  const art = {
    ...s,
    prix: s.prix_vente ?? s.prix ?? 0,
    icone: s.icone || '🍶',
    favori: !!s.favori,
    mots_cles: s.mots_cles || '',
    quantite: s.quantite === undefined ? 1 : s.quantite,
    actif: s.actif !== false, // désactivation manuelle par le gestionnaire (indépendante du stock)
  };
  art.type_service = s.type_service || getProdTypeService(art);
  return art;
}

// ═══════════════════════════════════════════════════════
// BAROS BAR/CUISINE SPLIT — Variables globales
// panierGlace stocke l'état glacé PAR UNITÉ pour chaque produit bar
// Structure : { produit_id: [bool, bool, ...] }  — un booléen par exemplaire
// Exemple : 2× Castel = { "castel-id": [true, false] }
//   → unité 0 : glacée  |  unité 1 : non glacée
// ═══════════════════════════════════════════════════════
let panierGlace = {}; // { produit_id: [bool, bool, ...] } — un bool par unité commandée

// BAROS STOCK SYSTEM — Cache stock temps réel
let stockCache = {}; // { nom_produit: { stock_restant, stock_initial, ... } }

const fmt=n=>Math.round(n||0).toString().replace(/\B(?=(\d{3})+(?!\d))/g,'.');
const ini=n=>(n||'?').split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
const today=()=>new Date().toISOString().slice(0,10);
/* [FIX-COMPAT] toTimeString() varie sur Safari macOS — format HH:MM explicite */
const nowT=()=>{const d=new Date();return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');};
const isBarman=()=>CU&&(CU.role==='Barman'||CU.role==='Manager');

function toast(msg,col='var(--gn)'){
  const t=document.getElementById('toast');t.textContent=msg;t.style.borderColor=col;
  t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500);
}

// ===== SONS / BEEPS =====
function playBeep(freq=880, duration=0.15, repeats=1, gap=0.18) {
  try {
    /* [FIX-COMPAT] Safari iOS suspend l'AudioContext sans geste utilisateur */
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const _play = () => {
      for (let i = 0; i < repeats; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = freq; osc.type = 'sine';
        const t0 = ctx.currentTime + i * gap;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(0.35, t0 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
        osc.start(t0); osc.stop(t0 + duration + 0.02);
      }
      setTimeout(()=>ctx.close(), (repeats*gap+duration+0.1)*1000);
    };
    if (ctx.state === 'suspended') { ctx.resume().then(_play).catch(()=>{}); }
    else { _play(); }
  } catch(e){}
}
// Barman : double ding aigu → nouvelle commande arrivée
function playBeepBarman() { playBeep(980, 0.13, 2, 0.17); }
// Serveur : ding grave → commande validée par le barman
function playBeepServeur() { playBeep(660, 0.35, 1); }

// ===== LOGIN =====
let pinBuf='',pendEmp=null,_pinFailCount=0,_pinLockedUntil=0;

function _showEmailForm(msg){
  document.getElementById('pin-who').textContent = msg || 'Connexion requise';
  document.getElementById('profiles').innerHTML = `<div class="login-box">
    <div style="font-size:12px;color:var(--mt);margin-bottom:12px;line-height:1.7">
      Entrez l'email du compte manager pour charger les profils.
      <br><span style="color:rgba(240,239,245,0.3);font-size:10px">Connexion internet nécessaire.</span>
    </div>
    <input id="l-email" class="finp" type="email" placeholder="manager@monbar.com" autocomplete="email">
    <button class="btn-ac" id="l-btn" onclick="loginByEmail()">Charger les profils &#8594;</button>
    <div id="l-err" style="font-size:11px;color:var(--dg);margin-top:8px;min-height:14px"></div>
  </div>`;
}

// Fix local : localStorage peut lever SecurityError sur content:// ou file://
function _safeLS(key){ try{ return localStorage.getItem(key); }catch(e){ return null; } }
function _safeLS_set(key,val){ try{ localStorage.setItem(key,val); }catch(e){} }
function _safeLS_rm(key){ try{ localStorage.removeItem(key); }catch(e){} }

async function loadLogin(){
  let saved = null;
  try{ saved = JSON.parse(_safeLS('baros_session')||'null'); }catch(e){ saved = null; }

  // 1. Cache local disponible → afficher les profils immédiatement
  if(saved?.etab_id){
    const cached = _loadEtabCache(saved.etab_id);
    if(cached){
      ETAB=cached.etab; EMPS=cached.emps||[];
      // Compat cache : nouveau format 'articles' (table stock) ou ancien format 'prods' (table produits, pré-migration)
      ARTICLES=(cached.articles||cached.prods||[]).map(normArticle);
      await loadNiveauxFromDB(saved.etab_id);
      buildProfiles();
      // Rafraîchir en arrière-plan sans bloquer l'UI
      if(navigator.onLine){
        Promise.race([
          loadEtab(saved.etab_id),
          new Promise((_,r)=>setTimeout(()=>r('timeout'),5000))
        ]).catch(()=>{});
      }
      return;
    }
  }

  // 2. Pas de cache → afficher le formulaire email IMMÉDIATEMENT sans rien attendre
  // Lancer Supabase en arrière-plan si session connue
  _showEmailForm('Connecte-toi pour continuer');

  if(saved?.etab_id && navigator.onLine){
    // Tentative silencieuse en arrière-plan — si ça marche, on remplace le formulaire par les profils
    setTimeout(async () => {
      try {
        const result = await Promise.race([
          db.from('sessions').select('*').eq('etab_id', saved.etab_id).maybeSingle(),
          new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')),8000))
        ]);
        const fresh = result?.data;
        if(fresh && fresh.is_active !== false){
          _safeLS_set('baros_session', JSON.stringify(fresh));
          await loadEtab(fresh.etab_id);
        } else if(fresh && fresh.is_active === false){
          _safeLS_rm('baros_session');
        }
      } catch(e) {
        // Supabase inaccessible depuis file:// — l'utilisateur utilise le formulaire email
        console.warn('[BarOS] Supabase background check échoué:', e.message);
      }
    }, 100);
  }
}

async function loginByEmail(){
  const email=document.getElementById('l-email').value.trim();
  if(!email)return;
  const btn=document.getElementById('l-btn');
  const err=document.getElementById('l-err');
  if(btn){btn.textContent='Chargement…';btn.disabled=true;}
  err.textContent='';
  try{
    const {data:s,error}=await Promise.race([
      db.from('sessions').select('etab_id,is_active').eq('email',email).single(),
      new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')),10000))
    ]);
    if(error||!s){err.textContent='Email non trouvé';if(btn){btn.textContent='Charger →';btn.disabled=false;}return;}
    if(s.is_active===false){err.textContent='⛔ Compte non activé.';if(btn){btn.textContent='Charger →';btn.disabled=false;}return;}
    _safeLS_set('baros_session',JSON.stringify(s));
    await loadEtab(s.etab_id);
  }catch(e){
    err.textContent='❌ Connexion impossible — vérifiez votre réseau.';
    if(btn){btn.textContent='Réessayer →';btn.disabled=false;}
  }
}

// ── Cache helpers pour ETAB / EMPS / ARTICLES (table "stock") ───────────────
function _saveEtabCache(etabId, etab, emps, articles){
  try {
    _safeLS_set('baros_etab_cache_'+etabId, JSON.stringify({
      etab, emps, articles, ts: Date.now()
    }));
  } catch(e) {}
}
function _loadEtabCache(etabId){
  try {
    const raw = _safeLS('baros_etab_cache_'+etabId);
    if(!raw) return null;
    return JSON.parse(raw); // { etab, emps, articles, ts } (ou legacy { ...,prods,... })
  } catch(e) { return null; }
}

async function loadEtab(etabId){
  const [{data:etab},{data:emps},{data:stock}]=await Promise.all([
    db.from('etabs').select('*').eq('id',etabId).single(),
    db.from('employes').select('*').eq('etab_id',etabId).eq('actif',true),
    db.from('stock').select('*').eq('etab_id',etabId).order('categorie'),
  ]);
  if(!etab){document.getElementById('pin-who').textContent='Établissement introuvable';return;}
  ETAB=etab; EMPS=emps||[];
  const rows = stock||[];
  ARTICLES = rows.map(normArticle);
  _rebuildStockCache(rows);
  // [OFFLINE PATCH] Persister en cache local pour les prochains démarrages offline
  _saveEtabCache(etabId, etab, emps||[], rows);
  await loadNiveauxFromDB(etabId);
  buildProfiles();
  preloadClients();
}

async function loadNiveauxFromDB(etabId){
  NIVEAUX=[];
  try {
    const { data, error } = await db.from('tables_config')
      .select('nom, zone')
      .eq('etab_id', etabId)
      .order('zone').order('nom');
    if(error || !data || !data.length) return;
    // Regrouper par zone (ou 'Tables' si pas de zone)
    const zones = {};
    data.forEach(row=>{
      const z = (row.zone||'Tables').trim();
      if(!zones[z]) zones[z]=[];
      zones[z].push(row.nom);
    });
    NIVEAUX = Object.entries(zones).map(([nom,tables])=>({nom,tables}));
  } catch(e) { console.warn('[NIVEAUX] Erreur DB:', e); }
}

const COLORS=['#7c6cff','#c8f55a','#5ab4ff','#ff5e5e','#ffb444','#4ade80','#f97316','#ec4899'];

function buildProfiles(){
  const cont=document.getElementById('profiles');cont.innerHTML='';
  if(!EMPS.length){cont.innerHTML='<div style="font-size:12px;color:var(--mt);text-align:center">Aucun employé configuré dans l\'app manager.</div>';return;}
  EMPS.forEach((e,i)=>{
    const col=COLORS[i%COLORS.length];
    const d=document.createElement('div');d.className='prof-btn';
    d.innerHTML=`<div class="prof-av" style="background:${col}22;color:${col}">${ini(e.nom)}</div><div class="prof-name">${e.nom.split(' ')[0]}</div><div class="prof-role">${e.role}</div>`;
    d.onclick=()=>selectEmp(e,col);
    cont.appendChild(d);
  });
}

function selectEmp(e,col){
  pendEmp={...e,col};pinBuf='';
  document.getElementById('profiles').classList.add('hide');
  document.getElementById('pin-who').textContent='PIN pour '+e.nom.split(' ')[0];
  const sec=document.getElementById('pin-sec');sec.classList.remove('hide');sec.style.display='flex';
  buildDots();buildPad();
}

function buildDots(){
  const d=document.getElementById('pin-dots');d.innerHTML='';
  for(let i=0;i<4;i++){const dot=document.createElement('div');dot.className='dot'+(i<pinBuf.length?' fill':'');d.appendChild(dot);}
}
function buildPad(){
  const p=document.getElementById('pin-pad');p.innerHTML='';
  [1,2,3,4,5,6,7,8,9,'',0,'⌫'].forEach(k=>{
    const key=document.createElement('div');key.className='pin-key';key.textContent=k===''?'':k;
    if(k!=='')key.onclick=()=>pinPress(k);else key.style.visibility='hidden';
    p.appendChild(key);
  });
}

function pinPress(k){
  // [FIX] Verrouillage PIN après 5 échecs — 2 minutes de blocage
  const now=Date.now();
  if(_pinLockedUntil && now < _pinLockedUntil){
    const resteSec=Math.ceil((_pinLockedUntil-now)/1000);
    toast('🔒 Trop de tentatives — attends '+resteSec+'s','var(--dg)');
    return;
  }
  if(k==='⌫')pinBuf=pinBuf.slice(0,-1);
  else if(pinBuf.length<4)pinBuf+=String(k);
  buildDots();
  if(pinBuf.length===4){
    if(String(pinBuf)===String(pendEmp.pin)){
      _pinFailCount=0;_pinLockedUntil=0;
      CU=pendEmp;startApp();
    } else {
      pinBuf='';
      _pinFailCount++;
      if(_pinFailCount>=5){
        _pinLockedUntil=Date.now()+2*60*1000;
        _pinFailCount=0;
        buildDots();
        toast('🔒 5 échecs — clavier bloqué 2 min','var(--dg)');
      } else {
        buildDots();
        toast('PIN incorrect ('+_pinFailCount+'/5)','var(--dg)');
      }
    }
  }
}

function resetPin(){
  pinBuf='';pendEmp=null;
  document.getElementById('pin-sec').classList.add('hide');
  document.getElementById('profiles').classList.remove('hide');
  document.getElementById('pin-who').textContent='Sélectionne ton profil';
}

function doLogout(){
  CU=null;resetPin();
  if(realtimeChannel)db.removeChannel(realtimeChannel);
  document.getElementById('app').classList.add('hide');
  document.getElementById('pin-screen').classList.remove('hide');
}

// ===== START =====
function startApp(){
  document.getElementById('pin-screen').classList.add('hide');
  document.getElementById('app').classList.remove('hide');
  document.getElementById('hdr-av').textContent=ini(CU.nom);
  document.getElementById('hdr-av').style.background=CU.col+'22';
  document.getElementById('hdr-av').style.color=CU.col;
  document.getElementById('hdr-name').textContent=CU.nom;
  document.getElementById('hdr-etab').textContent=ETAB.nom;

  // ── Système multi-rôles v4.0 ──────────────────────────────
  // ROLE_CONFIG défini dans le bloc script suivant.
  // Fallback serveuse si getRoleKey non encore disponible.
  const _roleKey = (typeof getRoleKey === 'function') ? getRoleKey() : 'serveuse';
  const _roleConf = (typeof ROLE_CONFIG !== 'undefined' && ROLE_CONFIG[_roleKey]) || {
    color:'#7c6cff',
    tabs:[
      {id:'commande',ic:'🧾',lbl:'Commander'},
      {id:'historique',ic:'📊',lbl:'Mes ventes'},
      {id:'badges',ic:'🏅',lbl:'Badges'},
      {id:'appels',ic:'🔔',lbl:'Appels'},
    ]
  };
  const navEl=document.getElementById('nav');navEl.innerHTML='';
  const tabs=_roleConf.tabs;
  tabs.forEach(t=>{
    const tab=document.createElement('div');tab.className='nav-tab';tab.id='tab-'+t.id;
    tab.innerHTML=`<span class="nav-ic">${t.ic}</span>${t.lbl}`;
    tab.onclick=()=>showTab(t.id);
    navEl.appendChild(tab);
  });
  // Badge de rôle dans le header
  const _oldChip=document.getElementById('hdr-role-chip');if(_oldChip)_oldChip.remove();
  const _chip=document.createElement('div');
  _chip.id='hdr-role-chip';_chip.className='role-chip';
  _chip.style.cssText=`background:${_roleConf.color}1a;border:1px solid ${_roleConf.color}33;color:${_roleConf.color}`;
  _chip.textContent=CU.role;
  document.getElementById('hdr-right').prepend(_chip);

  showTab(tabs[0].id);
  refreshCA();
  // BAROS STOCK SYSTEM — Charger le cache stock au démarrage
  loadStockCache().then(() => { if (curStep === 2) renderStep(2); });
  // REALTIME INVENTORY — Canal stock temps réel
  startStockRealtime();
  
  // Temps réel Supabase
  // ── ROUTAGE BAR — filtre Realtime par bar_id si le barman est assigné ──
  // Si bar_id est null (migration non encore appliquée), le filtre etab_id suffit.
  const _realtimeBarFilter = (CU && CU.bar_id && isBarman())
    ? `bar_id=eq.${CU.bar_id}`
    : `etab_id=eq.${ETAB.id}`;
  const _realtimeFilter = (CU && CU.bar_id && isBarman())
    ? `bar_id=eq.${CU.bar_id}`
    : `etab_id=eq.${ETAB.id}`;
  // ── FIN ROUTAGE ──
  realtimeChannel=db.channel('cmd-rt-'+ETAB.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'commandes',filter:_realtimeFilter},
      payload=>{
        refreshCA();
        const ev = payload.eventType;
        const newRec = payload.new || {};
        const oldRec = payload.old || {};

        // Barman : beep sur toute nouvelle commande (INSERT statut Nouveau)
        if(isBarman() && ev === 'INSERT' && newRec.statut === 'Nouveau') {
          playBeepBarman();
          toast('🍺 Nouvelle commande — '+newRec.table_nom, 'var(--wn)');
        }

        // Serveur : beep quand SON order passe à En prépa ou Livré
        if(!isBarman() && ev === 'UPDATE'
          && newRec.employe_id === CU.id
          && (newRec.statut === 'En prépa' || newRec.statut === 'Livré')
          && oldRec.statut !== newRec.statut) {
          playBeepServeur();
          const msg = newRec.statut === 'Livré' ? '✅ Commande prête — '+newRec.table_nom : '🍳 En préparation — '+newRec.table_nom;
          toast(msg, 'var(--gn)');
        }

        if(isBarman()){
          const pending=document.getElementById('badge-pending');pending.classList.remove('hide');
          if(curBarTab==='attente') loadBarman();
          else loadBarHist();
        }
      })
    .subscribe();

  // ── Appels clients temps réel — REALTIME CALLS ──
  db.channel('appels-pers-'+ETAB.id)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'appels',filter:`etab_id=eq.${ETAB.id}`},
      payload => {
        const a = payload.new || {};
        // BAROS CLIENT CALL SYSTEM — Son + vibration selon type
        if (a.type === 'urgence') {
          // URGENCE — alerte triple beep aigu + vibration mobile
          playBeepUrgence();
          if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
          toast('🚨 URGENCE — ' + a.table_nom + ' !', 'var(--dg)');
        } else {
          playBeepAppel();
          const icons = {serveuse:'🔔', addition:'💰', message:'💬', commande:'🛒'};
          const labels = {serveuse:'Appel serveuse', addition:'Demande addition', message:'Message client', commande:'Commande'};
          toast(`${icons[a.type]||'🔔'} ${labels[a.type]||a.type} — ${a.table_nom}`, 'var(--dg)');
        }
        updateAppelsBadge();
        // REALTIME CALLS — Rafraîchir si vue active
        const cv = document.querySelector('[id^="view-"]:not(.hide)');
        if (cv?.id === 'view-appels') loadAppelsPers();
        // Rafraîchir stats manager si vue direction/équipe active
        if (cv?.id === 'view-direction') injectAppelsMgrStats();
      })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'appels',filter:`etab_id=eq.${ETAB.id}`},
      () => {
        updateAppelsBadge();
        const cv = document.querySelector('[id^="view-"]:not(.hide)');
        if (cv?.id === 'view-appels') loadAppelsPers();
        if (cv?.id === 'view-direction') injectAppelsMgrStats();
      })
    .subscribe();

  // ── Init module spécifique au rôle ─────────────────────────
  if(typeof ROLE_CONFIG!=='undefined' && ROLE_CONFIG[_roleKey]?.onStart){
    ROLE_CONFIG[_roleKey].onStart();
  }

  // Fix #8 : masquer les boutons dont data-hide-for-role correspond au rôle courant
  document.querySelectorAll('[data-hide-for-role]').forEach(btn=>{
    if(btn.dataset.hideForRole===_roleKey) btn.style.display='none';
    else btn.style.display='';
  });

  // ── Communications temps réel — démarrage garanti ────────
  // Double sécurité : startApp() l'appelle directement EN PLUS du MutationObserver
  setTimeout(function(){
    if(typeof _startCommRealtime === 'function' && ETAB && db){
      _startCommRealtime();
    }
    // [BUS FIX] Init bus ici — toutes les fn applicatives sont definies a ce stade
    if (typeof BarOSEventBus !== 'undefined' && !BarOSEventBus.isInitialized()) {
      BarOSEventBus.init({ db, etabId: ETAB.id, sourceApp: 'personnel' });
      BarOSEventBus.installHooks();
      console.log('[BarOS] Event Bus actif (via startApp) — personnel');
    }
  }, 600);
}

// Liste exhaustive — existants + nouveaux rôles v4.0
const ALL_VIEW_IDS=[
  'commande','historique','badges','barman','appels',
  'cuisine','securite','scans','alertes-vig','equipe','cmd-all','direction'
];

function showTab(id){
  ALL_VIEW_IDS.forEach(v=>{
    const el=document.getElementById('view-'+v);if(el)el.classList.add('hide');
    const tab=document.getElementById('tab-'+v);if(tab)tab.classList.remove('on');
  });
  const el=document.getElementById('view-'+id);if(el)el.classList.remove('hide');
  const tab=document.getElementById('tab-'+id);if(tab)tab.classList.add('on');
  // ── Handlers existants (inchangés) ──
  if(id==='commande'){resetCmd();}
  if(id==='historique')loadHistorique();
  if(id==='badges')renderBadges();
  if(id==='barman')showBarTab(curBarTab);
  if(id==='appels')loadAppelsPers();
  // ── Nouveaux handlers v4.0 ──────────
  if(id==='cuisine')showCuisTab('att');
  if(id==='securite')loadSecurite();
  if(id==='scans')loadScans(vigScanFilter);
  if(id==='alertes-vig')loadAlertesVig();
  if(id==='equipe')loadEquipe();
  if(id==='cmd-all')loadCmdAll();
  if(id==='direction')loadDirection();
  // MODULE MANAGER — Injecter stats appels à l'entrée des vues chef/directeur
  if((id==='direction'||id==='equipe') && typeof injectAppelsMgrStats==='function'){
    setTimeout(injectAppelsMgrStats, 400); // délai pour laisser loadDirection/loadEquipe finir
  }
}

// ===== CA TEMPS RÉEL =====
async function refreshCA(){
  const {data:cmds}=await db.from('commandes').select('montant,statut').eq('etab_id',ETAB.id).eq('employe_id',CU.id).eq('date_cmd',today()).eq('statut','Livré');
  const ca=(cmds||[]).reduce((a,c)=>a+c.montant,0);
  document.getElementById('badge-ca').textContent=fmt(ca)+' F';
  // Commandes en attente pour barman
  if(isBarman()){
    const {count}=await db.from('commandes').select('id',{count:'exact'}).eq('etab_id',ETAB.id).in('statut',['Nouveau','En prépa']).eq('date_cmd',today());
    const p=document.getElementById('badge-pending');
    if(count>0){p.textContent=count+' 🍺';p.classList.remove('hide');}
    else p.classList.add('hide');
  }
}

// ===== COMMANDE (étapes) =====
const STEPS=['Table','Articles','Récap'];
function resetCmd(){
  curStep=1;selTable=null;selPay='Cash';panier={};selClient=null;
  menuCatFilter='Tous';
  // BAROS BAR/CUISINE SPLIT — Vider aussi le cache glacé
  panierGlace = {};
  renderStepsBar();renderStep(1);
  document.getElementById('tot-lbl').textContent='Sélectionne une table';
  document.getElementById('tot-val').textContent='';
  document.getElementById('btn-next').disabled=true;
  document.getElementById('btn-next').textContent='Choisir les articles →';
  document.getElementById('btn-back').classList.add('hide');
}

function renderStepsBar(){
  const bar=document.getElementById('steps-bar');
  bar.innerHTML=STEPS.map((s,i)=>{
    const idx=i+1;
    const cls=idx<curStep?'si done':idx===curStep?'si on':'si';
    return `${i>0?'<div class="ssep"></div>':''}<div class="${cls}"><div class="sn">${idx<curStep?'✓':idx}</div>${s}</div>`;
  }).join('');
}

function renderStep(step){
  const cont=document.getElementById('step-content');
  if(step===1){
    // Tables
    cont.innerHTML='';
    NIVEAUX.forEach(niv=>{
      const block=document.createElement('div');block.className='niveau-block';
      block.innerHTML=`<div class="niveau-lbl">${niv.nom}</div><div class="tbl-grid">${niv.tables.map(t=>{const isSel=t===selTable;return `<div class="tbl-btn${isSel?' sel':''}" onclick="selTbl('${t}')"><span class="tbl-ic">🪑</span><div class="tbl-nm">${t}</div></div>`;}).join('')}</div>`;
      cont.appendChild(block);
    });
    document.getElementById('btn-next').textContent='Choisir les articles →';
    document.getElementById('btn-next').disabled=!selTable;
    document.getElementById('btn-back').classList.add('hide');
  } else if(step===2){
    // ═══════════════════════════════════════════════════════
    // ARTICLES (table "stock", source unique de vérité) :
    //  - recherche instantanée (nom / catégorie / mots-clés-variantes)
    //  - regroupement automatique par catégorie, catégories clairement séparées
    //  - favoris en tête de catégorie, puis tri alphabétique
    //  - ruptures de stock masquées (sauf article déjà présent dans le panier)
    // ═══════════════════════════════════════════════════════
    const q = menuArticleSearch;
    const _wasSearchFocused = document.activeElement?.id === 'art-search';
    let base = ARTICLES.filter(p =>
      ((p.quantite||0) > 0 && p.actif !== false) || (panier[p.id]||0) > 0
    );
    if (q) base = base.filter(p =>
      p.nom.toLowerCase().includes(q) ||
      (p.categorie||'').toLowerCase().includes(q) ||
      (p.mots_cles||'').toLowerCase().includes(q)
    );

    const cats=['Tous', ...ARTICLE_CATS.filter(c=>base.some(p=>(p.categorie||'Divers')===c)),
                ...[...new Set(base.map(p=>p.categorie).filter(c=>c && !ARTICLE_CATS.includes(c)))].sort()];
    const filtered = menuCatFilter==='Tous' ? base : base.filter(p=>(p.categorie||'Divers')===menuCatFilter);

    let html = `<input class="finp" id="art-search" placeholder="🔍 Rechercher un article, un mot-clé…" value="${(menuArticleSearch||'').replace(/"/g,'&quot;')}" oninput="setMenuSearch(this.value)" autocomplete="off" style="margin-bottom:8px">`;
    html += `<div class="menu-filter">${cats.map(c=>`<div class="mf-btn${c===menuCatFilter?' on':''}" onclick="setMenuCat('${c}')">${c}</div>`).join('')}</div>`;

    if(!filtered.length){
      html += `<div class="empty">${ARTICLES.length?'Aucun article trouvé':'Aucun produit dans cette catégorie'}</div>`;
    } else {
      // Regrouper par catégorie — ordre de référence ARTICLE_CATS, favoris en tête puis alphabétique
      const byCat = {};
      filtered.forEach(p => { const cat=p.categorie||'Divers'; (byCat[cat]=byCat[cat]||[]).push(p); });
      const catOrder = menuCatFilter!=='Tous' ? [menuCatFilter] :
        [...ARTICLE_CATS.filter(c=>byCat[c]), ...Object.keys(byCat).filter(c=>!ARTICLE_CATS.includes(c)).sort()];

      html += catOrder.map(cat => {
        const rows = byCat[cat].slice().sort((a,b)=>(b.favori-a.favori)||a.nom.localeCompare(b.nom));
        return `<div class="prod-cat-label">${cat} <span style="opacity:.6;font-weight:400">(${rows.length})</span></div>` +
          `<div class="prods-grid">${rows.map(p=>{
          const qty=panier[p.id]||0;
          // AUTO ROUTING — Détermination automatique du type_service
          const ts = getProdTypeService(p);
          const isBar = ts === 'bar';
          // OPTION GLACÉ PAR UNITÉ — un tableau de booléens, un par exemplaire
          const glaceArr = panierGlace[p.id] || [];
          // Disponibilité — la ligne "stock" EST l'article : plus de lookup séparé
          const rupture = (p.quantite||0) <= 0;
          const desactive = p.actif === false;
          const indispo = rupture || desactive;
          const stockBadge = desactive
            ? '<span style="position:absolute;top:5px;left:5px;font-size:9px;background:rgba(150,150,160,.9);color:#fff;border-radius:4px;padding:1px 5px">⏸️ Indisponible</span>'
            : rupture
              ? '<span style="position:absolute;top:5px;left:5px;font-size:9px;background:rgba(255,94,94,.9);color:#fff;border-radius:4px;padding:1px 5px">\u274c Épuisé</span>'
              : p.quantite <= (p.seuil_alerte || 5)
                ? '<span style="position:absolute;top:5px;left:5px;font-size:9px;background:rgba(255,180,68,.9);color:#0a0a0f;border-radius:4px;padding:1px 5px">\u26a0\ufe0f Bas</span>'
                : '';
          const favBadge = p.favori ? '<span style="position:absolute;top:5px;right:5px;font-size:11px">⭐</span>' : '';
          // Générer une ligne glacé par unité commandée (bar uniquement)
          let glaceRows = '';
          if (qty > 0 && isBar) {
            for (let ui = 0; ui < qty; ui++) {
              const gVal = glaceArr[ui] || false;
              glaceRows += `<div style="margin-top:4px;display:flex;align-items:center;gap:5px;cursor:pointer" onclick="event.stopPropagation();toggleGlace('${p.id}',${ui})">
                <div style="width:16px;height:16px;border-radius:4px;border:1.5px solid ${gVal?'var(--inf)':'var(--bd2)'};background:${gVal?'rgba(90,180,255,.2)':'transparent'};display:flex;align-items:center;justify-content:center;font-size:9px">${gVal?'\u2713':''}</div>
                <span style="font-size:10px;color:${gVal?'var(--inf)':'var(--mt)'}">🧊 Unité ${ui+1} — ${gVal?'Glacée':'Non glacée'}</span>
              </div>`;
            }
          }
          // Plafond anti-survente : on ne peut pas commander plus que le stock disponible
          const atMax = !rupture && qty >= p.quantite;
          return `<div class="prod-btn${qty>0?' sel':''}" id="pb-${p.id}" style="position:relative;flex-direction:column;align-items:flex-start${indispo?';opacity:.55':''}">
            ${stockBadge}${favBadge}
            <div style="display:flex;align-items:center;gap:9px;width:100%">
              <span class="prod-ic">${p.icone}</span>
              <div style="flex:1;min-width:0">
                <div class="prod-nm">${p.nom}</div>
                <div class="prod-pr">${fmt(p.prix)} F</div>
                <div style="font-size:9px;color:${isBar?'var(--inf)':'var(--wn)'};margin-top:1px">${isBar?'🍺 Bar':'🍳 Cuisine'}</div>
              </div>
              ${qty>0?`<div class="prod-badge" style="position:static;margin-left:auto;flex-shrink:0">${qty}</div>`:''}
            </div>
            ${qty>0?`<div class="qty-row" style="margin-top:6px"><div class="qb" onclick="changeQty('${p.id}',-1,${p.prix},event)">−</div><div class="qv">${qty}</div><div class="qb" style="${atMax?'opacity:.35;pointer-events:none':''}" onclick="changeQty('${p.id}',1,${p.prix},event)">+</div></div>`:''}
            ${glaceRows}
          </div>`;
        }).join('')}</div>`;
      }).join('');
    }

    cont.innerHTML = html;

    // Attacher onclick sur prod-btn (indisponible = non cliquable pour un NOUVEL ajout)
    filtered.forEach(p=>{
      const el=document.getElementById('pb-'+p.id);
      const indispo = (p.quantite||0) <= 0 || p.actif === false;
      if(el && !(indispo && !panier[p.id])) el.addEventListener('click',()=>toggleProd(p.id,p.prix));
    });
    // Remettre le focus sur la recherche si l'utilisateur était en train d'y taper
    // (évite de perdre le focus/curseur à chaque frappe, sans voler le focus sinon)
    if (_wasSearchFocused) {
      const sEl = document.getElementById('art-search');
      if (sEl) { sEl.focus(); sEl.setSelectionRange(sEl.value.length, sEl.value.length); }
    }

    updateFooter();
    document.getElementById('btn-next').textContent='Voir le récapitulatif →';
    document.getElementById('btn-next').disabled=calcTot()===0;
    document.getElementById('btn-back').classList.remove('hide');
  } else if(step===3){
    // Récap + identification client fidélité
    const items=Object.entries(panier).filter(([,q])=>q>0);
    const tot=calcTot();
    const tier=selClient?getClientTier(selClient.points||0):null;
    const remise=tier?tier.remise:0;
    const totRemise=remise>0?Math.round(tot*(1-remise/100)):tot;
    cont.innerHTML=`
      <div style="margin-bottom:12px">
        ${items.map(([id,qty])=>{const p=ARTICLES.find(x=>x.id===id);return p?`<div class="recap-row"><div><div class="recap-nm">${p.icone} ${p.nom}</div><div class="recap-qty">${qty} × ${fmt(p.prix)} F</div></div><div class="recap-amt">${fmt(p.prix*qty)} F</div></div>`:''}).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid var(--bd);margin-bottom:4px"><span style="font-weight:600">TOTAL brut</span><span style="font-weight:700;color:var(--mt)">${fmt(tot)} F</span></div>
      ${remise>0?`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;margin-bottom:10px;background:rgba(200,245,90,.07);border:1px solid rgba(200,245,90,.25);border-radius:var(--rs)"><span style="font-size:12px;color:var(--ac)">${tier.ic} Remise ${tier.label} −${remise}%</span><span style="font-weight:800;font-size:16px;color:var(--ac)">${fmt(totRemise)} F</span></div>`:'<div style="margin-bottom:10px"></div>'}
      <div style="margin-bottom:12px;background:var(--s2);border-radius:var(--rs);padding:10px">
        <div style="font-size:11px;color:var(--mt);margin-bottom:7px;display:flex;align-items:center;justify-content:space-between"><span>👤 Client fidélité</span>${selClient?`<span style="color:var(--mt);cursor:pointer;font-size:10px;padding:2px 7px;border:1px solid var(--bd);border-radius:6px" onclick="clearSelClient()">✕ Retirer</span>`:''}</div>
        ${selClient
          ? `<div style="display:flex;align-items:center;gap:10px;padding:9px;background:${tier.color}18;border:1px solid ${tier.color}44;border-radius:var(--rs)"><span style="font-size:22px">${tier.ic}</span><div><div style="font-weight:700;font-size:13px">${selClient.nom}</div><div style="font-size:11px;color:${tier.color};margin-top:1px">${tier.label} · ${selClient.points||0} pts</div><div style="font-size:10px;color:var(--mt);margin-top:3px">${tier.avantages.join(' · ')}</div></div></div>`
          : `<input id="cli-lookup" class="finp" placeholder="🔍 Rechercher un client..." oninput="lookupClients(this.value)" autocomplete="off" style="margin-bottom:5px"><div id="cli-results"></div>`
        }
      </div>
      <div style="font-size:12px;color:var(--mt);margin-bottom:8px">Mode de paiement</div>
      <div class="pay-grid">
        ${['Cash','MTN MoMo','Orange Money','Crédit client'].map(m=>`<div class="pay-btn${selPay===m?' sel':''}" onclick="selPayMode('${m}','${m.replace(/'/g,"\'")}',this)">${m}</div>`).join('')}
      </div>`;
    document.getElementById('btn-next').textContent=remise>0?`✓ Envoyer (remise ${remise}% appliquée)`:'✓ Envoyer au bar';
    document.getElementById('btn-next').disabled=false;
    document.getElementById('btn-back').classList.remove('hide');
    document.getElementById('tot-lbl').textContent=selTable;
    document.getElementById('tot-val').textContent=fmt(totRemise)+' F';
    if(!clientsCache.length) preloadClients();
  }
}

// ===== FIDÉLITÉ CLIENT =====
function getClientTier(pts){
  if(pts>=1000)return{label:'Platine',ic:'💎',color:'#a78bfa',remise:20,avantages:['Remise 20%','Table réservée','Boisson offerte']};
  if(pts>=500)return{label:'Or',ic:'🥇',color:'#ffb444',remise:10,avantages:['Remise 10%','Accès VIP','Priorité service']};
  if(pts>=200)return{label:'Argent',ic:'🥈',color:'#5ab4ff',remise:5,avantages:['Remise 5%']};
  return{label:'Bronze',ic:'🥉',color:'rgba(240,239,245,0.45)',remise:0,avantages:['Accumulation de points']};
}

async function preloadClients(){
  const {data}=await db.from('clients').select('id,nom,telephone,points,visites,dernier_passage').eq('etab_id',ETAB.id);
  clientsCache=data||[];
}

function lookupClients(q){
  const box=document.getElementById('cli-results');
  if(!box)return;
  if(!q||q.length<2){box.innerHTML='';return;}
  const ql=q.toLowerCase();
  const hits=clientsCache.filter(c=>c.nom.toLowerCase().includes(ql)||(c.telephone||'').includes(q)).slice(0,5);
  if(!hits.length){box.innerHTML='<div style="font-size:11px;color:var(--mt);padding:6px">Aucun client trouvé</div>';return;}
  box.innerHTML=hits.map(c=>{
    const tier=getClientTier(c.points||0);
    return `<div onclick="pickClient('${c.id}')" style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:var(--rs);cursor:pointer;margin-bottom:3px;background:var(--s1);border:1px solid var(--bd)" onmouseover="this.style.borderColor='var(--ac)'" onmouseout="this.style.borderColor='var(--bd)'">
      <span style="font-size:16px">${tier.ic}</span>
      <div><div style="font-size:12px;font-weight:600">${c.nom}</div><div style="font-size:10px;color:${tier.color}">${tier.label} · ${c.points||0} pts</div></div>
    </div>`;
  }).join('');
}

function pickClient(id){
  selClient=clientsCache.find(c=>c.id===id)||null;
  renderStep(3);
}

function clearSelClient(){
  selClient=null;
  renderStep(3);
}


function setMenuCat(cat){
  menuCatFilter=cat;
  renderStep(2);
}

// Recherche instantanée d'articles (nom / catégorie / mots-clés-variantes)
function setMenuSearch(v){
  menuArticleSearch = (v||'').trim().toLowerCase();
  renderStep(2);
}

function toggleProd(id, prix){
  // Prevent double-trigger from qty buttons
  if(event && event.target && event.target.classList.contains('qb')) return;
  if(panier[id]){
    delete panier[id];
    delete panierGlace[id]; // Nettoyer le tableau glacé quand produit retiré
  } else {
    // Garde-fou anti-survente/anti-désactivation : impossible d'ajouter un article
    // en rupture de stock ou désactivé manuellement par le gestionnaire
    const art = ARTICLES.find(a=>a.id===id);
    if(art && ((art.quantite||0)<=0 || art.actif===false)) return;
    panier[id]=1;
    panierGlace[id]=[false]; // Initialiser avec 1 unité non glacée
  }
  updateFooter();
  renderStep(2);
}

function changeQty(id, delta, prix, ev){
  ev.stopPropagation();
  const cur=panier[id]||0;
  let next=cur+delta;
  // Garde-fou anti-survente : ne jamais dépasser la quantité disponible en stock
  if(delta>0){
    const art = ARTICLES.find(a=>a.id===id);
    if(art && art.quantite>0 && next>art.quantite) next=art.quantite;
  }
  if(next<=0){
    delete panier[id];
    delete panierGlace[id]; // Nettoyer le tableau glacé
  } else {
    panier[id]=next;
    // Synchroniser le tableau glacé avec la nouvelle quantité
    if(!panierGlace[id]) panierGlace[id]=[];
    while(panierGlace[id].length < next) panierGlace[id].push(false); // Ajouter unité non glacée
    if(panierGlace[id].length > next) panierGlace[id].length = next;   // Retirer la dernière unité
  }
  updateFooter();
  renderStep(2);
}

function updateFooter(){
  const tot=calcTot();
  const n=Object.values(panier).reduce((a,q)=>a+q,0);
  document.getElementById('tot-lbl').textContent=selTable+(n>0?' · '+n+' article(s)':'');
  document.getElementById('tot-val').textContent=tot>0?fmt(tot)+' F':'';
  document.getElementById('btn-next').disabled=tot===0;
}

function calcTot(){return Object.entries(panier).reduce((a,[id,q])=>{const p=ARTICLES.find(x=>x.id===id);return a+(p?p.prix*q:0);},0);}

function selTbl(t){
  selTable=t;
  document.getElementById('tot-lbl').textContent='Table: '+t;
  document.getElementById('btn-next').disabled=false;
  renderStep(1);
}

function selPayMode(m,_,el){
  selPay=m;
  document.querySelectorAll('.pay-btn').forEach(b=>b.classList.remove('sel'));
  el.classList.add('sel');
}

function nextStep(){
  if(curStep===3){window.validerCmd();return;}
  curStep++;renderStepsBar();renderStep(curStep);
}
function prevStep(){
  if(curStep<=1)return;
  curStep--;renderStepsBar();renderStep(curStep);
}

// Décrémente le stock d'un article. La table "stock" étant l'unique source de vérité,
// on met à jour directement par id quand l'article provient de ARTICLES ; sinon
// (article hors-menu / saisi manuellement) on recherche/crée par nom, comme avant.
async function decrementStock(produit, qty=1){
  const nomRecherche = produit.nom;
  let s = null;
  if (produit.id) {
    const {data} = await db.from('stock').select('*').eq('id', produit.id).eq('etab_id', ETAB.id).maybeSingle();
    s = data;
  }
  if (!s) {
    const r = await db.from('stock').select('*').eq('etab_id', ETAB.id).eq('nom', nomRecherche).maybeSingle();
    s = r.data;
  }
  if(!s){
    const {data:nouv} = await db.from('stock').insert({
      etab_id:ETAB.id, nom:nomRecherche,
      quantite:99, quantite_initiale:99,
      seuil_alerte:10, vendu_systeme:0, prix_vente:produit.prix||0
    }).select().single();
    s=nouv;
  }
  if(!s||s.quantite<=0) return;
  const nouvelleQte = Math.max(0, s.quantite - qty);
  await db.from('stock').update({
    quantite: nouvelleQte,
    vendu_systeme: (s.vendu_systeme||0)+qty,
    updated_at: 'now()'
  }).eq('id', s.id);
  if(nouvelleQte<=s.seuil_alerte && s.quantite>s.seuil_alerte){
    await db.from('alertes').insert({etab_id:ETAB.id,type:'warning',icone:'⚠️',
      titre:'Stock bas — '+nomRecherche,
      message:'Reste '+nouvelleQte+' unité(s). Seuil: '+s.seuil_alerte+'.',
      heure:nowT(),date_alerte:today()});
  }
  if(nouvelleQte===0){
    await db.from('alertes').insert({etab_id:ETAB.id,type:'critical',icone:'🚨',
      titre:'Rupture stock — '+nomRecherche,
      message:'Stock épuisé.',heure:nowT(),date_alerte:today()});
  }
}

// VALIDER
async function validerCmd(){
  const btn=document.getElementById('btn-next');btn.disabled=true;btn.textContent='Envoi...';

  // ═══════════════════════════════════════════════════════
  // BAROS BAR/CUISINE SPLIT — Séparation automatique des articles
  // AUTO ROUTING — La serveuse ne choisit rien manuellement
  // ═══════════════════════════════════════════════════════
  const itemsBar = [];    // Articles destinés au module BAR
  const itemsCuisine = []; // Articles destinés au module CUISINE
  const itemsAll = [];    // Tous les articles (pour affichage global)

  for (const [id, qty] of Object.entries(panier)) {
    const p = ARTICLES.find(x => x.id === id);
    if (!p) continue;
    const ts = getProdTypeService(p);
    // OPTION GLACÉ PAR UNITÉ — chaque exemplaire a son propre état
    const glaceArr = panierGlace[id] || [];
    if (ts === 'bar' && qty > 0) {
      // Grouper les unités identiques pour un label plus lisible
      // Ex : [true, true, false] → "🧊 Castel ×2", "🌡️ Castel ×1"
      let nbGlace   = 0;
      let nbChaud   = 0;
      for (let ui = 0; ui < qty; ui++) {
        if (glaceArr[ui]) nbGlace++; else nbChaud++;
      }
      if (nbGlace > 0) {
        const lbl = '🧊 ' + p.nom + (nbGlace > 1 ? ' ×' + nbGlace : '');
        itemsAll.push(lbl);
        itemsBar.push(lbl);
      }
      if (nbChaud > 0) {
        const lbl = '🌡️ ' + p.nom + (nbChaud > 1 ? ' ×' + nbChaud : '');
        itemsAll.push(lbl);
        itemsBar.push(lbl);
      }
    } else if (ts === 'cuisine') {
      const label = p.nom + (qty > 1 ? ' ×' + qty : '');
      itemsAll.push(label);
      itemsCuisine.push(label);
    } else {
      // bar sans variante glacé (ne devrait pas arriver, fallback sécurisé)
      const label = p.nom + (qty > 1 ? ' ×' + qty : '');
      itemsAll.push(label);
      itemsBar.push(label);
    }
  }

  const items = itemsAll.join(', ');
  const itemsBarStr = itemsBar.join(', ');
  const itemsCuisineStr = itemsCuisine.join(', ');

  const tot=calcTot();
  // Remise fidélité
  const tier=selClient?getClientTier(selClient.points||0):null;
  const remise=tier?tier.remise:0;
  const montantFinal=remise>0?Math.round(tot*(1-remise/100)):tot;

  // BAROS STOCK SYSTEM — Décrément stock pour chaque produit vendu
  for(const [id,qty] of Object.entries(panier)){
    const p=ARTICLES.find(x=>x.id===id);
    if(p) await decrementStock(p, qty);
  }

  // AUTO ROUTING — Insertion commande principale (tous articles)
  // Le champ articles_bar et articles_cuisine permettent au barman/cuisinier
  // de ne voir QUE ce qui les concerne
  // ── ROUTAGE BAR/COMPARTIMENT ──
  // Résoudre bar_id depuis la table sélectionnée pour cibler le bon barman
  let _cmdBarId = null;
  let _cmdCompartimentId = null;
  try {
    const { data: _tblRow } = await db.from('tables_config')
      .select('bar_id, compartiment_id')
      .eq('etab_id', ETAB.id)
      .eq('nom', selTable)
      .maybeSingle();
    if (_tblRow) {
      _cmdBarId = _tblRow.bar_id || null;
      _cmdCompartimentId = _tblRow.compartiment_id || null;
    }
  } catch(_) {}
  // ── FIN ROUTAGE ──
  const cmdPayload = {
    etab_id: ETAB.id,
    table_nom: selTable,
    articles: items,
    articles_bar: itemsBarStr || null,
    articles_cuisine: itemsCuisineStr || null,
    employe_id: CU.id,
    employe_nom: CU.nom,
    montant: montantFinal,
    remise: tot - montantFinal,
    paiement: selPay,
    statut: 'Nouveau',
    heure: nowT(),
    date_cmd: today(),
    bar_id: _cmdBarId
    // compartiment_id retiré : colonne absente du schéma commandes
  };
  const {error}=await db.from('commandes').insert(cmdPayload);
  if(error){toast('Erreur: '+error.message,'var(--dg)');btn.disabled=false;btn.textContent='✓ Envoyer au bar';return;}
  // Créditer points + mise à jour visite client
  if(selClient){
    const ptsGagnes=Math.floor(montantFinal/1000)*10||10;
    await db.from('clients').update({
      points:(selClient.points||0)+ptsGagnes,
      visites:(selClient.visites||0)+1,
      dernier_passage:today()
    }).eq('id',selClient.id);
    // Refresh cache
    const updated=clientsCache.find(c=>c.id===selClient.id);
    if(updated){updated.points=(selClient.points||0)+ptsGagnes;updated.visites=(selClient.visites||0)+1;}
  }
  // Confirmation screen
  const confLines=Object.entries(panier).map(([id,qty])=>{const p=ARTICLES.find(x=>x.id===id);return p?`<div>${p.icone} ${p.nom} ×${qty} — ${fmt(p.prix*qty)} F</div>`:''}).join('');
  // Fix typo: "−90${remise}" → "−${remise}"
  const remiseLine=remise>0?`<div style="margin-top:6px;color:var(--ac);font-size:12px">${tier.ic} Remise ${tier.label} −${remise}% = −${fmt(tot-montantFinal)} F</div>`:'';
  const ptsLine=selClient?`<div style="margin-top:5px;color:#a78bfa;font-size:11px">⭐ +${Math.floor(montantFinal/1000)*10||10} pts ajoutés — total: ${(selClient.points||0)+(Math.floor(montantFinal/1000)*10||10)} pts</div>`:'';
  document.getElementById('conf-sub').textContent=selTable+' · '+selPay+(selClient?' · '+selClient.nom:'');
  document.getElementById('conf-detail').innerHTML=confLines+remiseLine+`<div style="margin-top:7px;font-weight:600;color:var(--ac)">Total: ${fmt(montantFinal)} F</div>`+ptsLine;
  document.getElementById('app').classList.add('hide');
  document.getElementById('confirm-ov').classList.remove('hide');
  const cmdObj={table_nom:selTable,articles:items,montant:montantFinal,paiement:selPay,heure:nowT(),date_cmd:today(),employe_nom:CU.nom,statut:'Livré'};
  prepareReceiptContent(cmdObj);
  refreshCA();
}

function newCmd(){
  document.getElementById('confirm-ov').classList.add('hide');
  document.getElementById('app').classList.remove('hide');
  showTab('commande');
}

// ===== HISTORIQUE VENTES =====
async function loadHistorique(){
  const {data:cmds}=await db.from('commandes').select('*').eq('etab_id',ETAB.id).eq('employe_id',CU.id).eq('date_cmd',today()).order('created_at',{ascending:false});
  const list=cmds||[];
  const totalVentes=list.filter(c=>c.statut==='Livré').reduce((a,c)=>a+c.montant,0);
  const nbLivrees=list.filter(c=>c.statut==='Livré').length;
  const nbAttente=list.filter(c=>c.statut==='Nouveau'||c.statut==='En prépa').length;
  document.getElementById('hist-stats').innerHTML=`
    <div class="stat-card"><div class="stat-v" style="color:var(--ac)">${fmt(totalVentes)} F</div><div class="stat-l">💵 CA aujourd'hui</div></div>
    <div class="stat-card"><div class="stat-v">${nbLivrees}</div><div class="stat-l">✓ Commandes livrées</div></div>
    <div class="stat-card"><div class="stat-v" style="color:var(--wn)">${nbAttente}</div><div class="stat-l">⏳ En attente</div></div>
    <div class="stat-card"><div class="stat-v" style="color:var(--gn)">${list.length?Math.round(totalVentes/Math.max(nbLivrees,1)).toLocaleString('fr-FR'):0} F</div><div class="stat-l">📊 Ticket moyen</div></div>`;
  document.getElementById('hist-list').innerHTML=list.length?list.map(c=>`
    <div class="hist-item">
      <div class="hist-top"><div class="hist-tbl">${c.table_nom}</div><div class="hist-time">${c.heure||''}</div></div>
      <div class="hist-items">${c.articles||''}</div>
      <div class="hist-bot">
        <div class="hist-amt">${fmt(c.montant)} F</div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:11px;color:var(--mt)">${c.paiement}</span>
          <span class="pill ${c.statut==='Livré'?'p-d':c.statut==='Nouveau'?'p-n':c.statut==='En prépa'?'p-p':'p-c'}">${c.statut}</span>
          <button style="padding:3px 9px;border-radius:8px;background:rgba(200,245,90,.1);border:1px solid rgba(200,245,90,.2);color:var(--ac);font-size:11px;cursor:pointer" onclick='showReceipt(${JSON.stringify(c)})'>🧾</button>
        </div>
      </div>
    </div>`).join(''):'<div class="empty">Aucune vente aujourd\'hui</div>';
}

// ===== BADGES =====
const BADGE_DEFS=[
  {id:'first',ic:'🥇',nm:'Première vente',desc:'Enregistre ta première commande',check:stats=>stats.total>=1,prog:stats=>Math.min(1,stats.total)},
  {id:'speed',ic:'⚡',nm:'Service express',desc:'5 commandes en une soirée',check:stats=>stats.total>=5,prog:stats=>Math.min(5,stats.total)/5},
  {id:'seller',ic:'💰',nm:'Bon vendeur',desc:'100 000 FCFA de CA en un soir',check:stats=>stats.ca>=100000,prog:stats=>Math.min(100000,stats.ca)/100000},
  {id:'loyal',ic:'🌟',nm:'Régulier',desc:'10 jours de service',check:stats=>stats.jours>=10,prog:stats=>Math.min(10,stats.jours)/10},
  {id:'vip',ic:'👑',nm:'Top vendeur',desc:'N°1 de l\'équipe ce soir',check:stats=>stats.top,prog:stats=>stats.top?1:0},
  {id:'streak',ic:'🔥',nm:'En feu',desc:'20 commandes livrées en un soir',check:stats=>stats.total>=20,prog:stats=>Math.min(20,stats.total)/20},
];

async function renderBadges(){
  const {data:cmds}=await db.from('commandes').select('montant,statut').eq('etab_id',ETAB.id).eq('employe_id',CU.id).eq('date_cmd',today()).eq('statut','Livré');
  const ca=(cmds||[]).reduce((a,c)=>a+c.montant,0);
  const total=(cmds||[]).length;
  const {data:allCmds}=await db.from('commandes').select('employe_id,montant').eq('etab_id',ETAB.id).eq('date_cmd',today()).eq('statut','Livré');
  const byEmp={};(allCmds||[]).forEach(c=>{byEmp[c.employe_id]=(byEmp[c.employe_id]||0)+c.montant;});
  const topEmpId=Object.entries(byEmp).sort((a,b)=>b[1]-a[1])[0]?.[0];
  const stats={ca,total,jours:1,top:topEmpId===CU.id};
  document.getElementById('badges-grid').innerHTML=BADGE_DEFS.map(b=>{
    const earned=b.check(stats);const prog=b.prog(stats);
    return `<div class="badge-card${earned?' earned':' locked'}">
      <span class="badge-icon">${b.ic}</span>
      <div class="badge-nm">${b.nm}</div>
      <div class="badge-desc">${b.desc}</div>
      <div class="badge-prog">
        <div style="font-size:10px;color:var(--mt);text-align:right">${earned?'✓ Obtenu':Math.round(prog*100)+'%'}</div>
        <div class="bpb"><div class="bpf" style="width:${Math.round(prog*100)}%"></div></div>
      </div>
    </div>`;
  }).join('');
}

// ===== BARMAN =====
let curBarTab = 'attente';

function showBarTab(tab) {
  curBarTab = tab;
  ['attente','hist'].forEach(t => {
    const view = document.getElementById('barview-'+t);
    const btab = document.getElementById('btab-'+t);
    if (!view || !btab) return;
    const on = t === tab;
    view.classList.toggle('hide', !on);
    btab.style.color = on ? 'var(--ac)' : 'var(--mt)';
    btab.style.borderBottom = on ? '2px solid var(--ac)' : '2px solid transparent';
  });
  if (tab === 'attente') loadBarman();
  else loadBarHist();
}

async function loadBarman(){
  // ── ROUTAGE BAR ──
  // Si le Barman connecté a un bar_id assigné, ne montrer que ses commandes.
  // Si bar_id est null (données antérieures à la migration), afficher tout.
  let q = db.from('commandes').select('*').eq('etab_id',ETAB.id).in('statut',['Nouveau','En prépa']).eq('date_cmd',today()).order('created_at',{ascending:true});
  if (CU && CU.bar_id) q = q.eq('bar_id', CU.bar_id);
  // ── FIN ROUTAGE ──
  const {data:cmds}=await q;
  const n = (cmds||[]).length;
  const badge = document.getElementById('bar-badge-att');
  if (badge) badge.textContent = n > 0 ? n : '';
  // BAROS BAR/CUISINE SPLIT — Le barman ne voit QUE les articles bar
  // AFFICHAGE COMMANDES — icônes 🧊/🌡️ déjà encodées dans les labels
  document.getElementById('barman-list').innerHTML=n&&(cmds||[]).map(c=>{
    const articlesAff = c.articles_bar || c.articles || '';
    const hasBar = articlesAff.trim().length > 0;
    if (!hasBar && c.articles_bar !== undefined) return '';
    const lignes = articlesAff.split(',').map(a => {
      const t = a.trim(); if (!t) return '';
      if (t.startsWith('🧊')) return `<span style="color:var(--inf)">${t}</span>`;
      if (t.startsWith('🌡️')) return `<span style="color:var(--wn)">${t}</span>`;
      return `🔹 ${t}`;
    }).filter(Boolean).join('<br>');
    return `
    <div class="bar-cmd" id="bc-${c.id}">
      <div class="bar-top">
        <div>
          <div class="bar-tbl">${c.table_nom}</div>
          <div class="bar-srv">Serveur: ${c.employe_nom||'—'} · ${c.paiement}</div>
        </div>
        <div class="bar-time">${c.heure||''} <span class="pill ${c.statut==='Nouveau'?'p-n':'p-p'}">${c.statut}</span></div>
      </div>
      <div class="bar-items" style="line-height:1.9">${lignes||'—'}</div>
      <div style="font-weight:700;color:var(--ac);margin-bottom:9px;font-size:15px">${fmt(c.montant)} F</div>
      <div class="bar-actions">
        ${c.statut==='Nouveau'?`<button class="bar-btn bar-prep" onclick="updCmd('${c.id}','En prépa')">🍳 En prépa</button>`:''}
        <button class="bar-btn bar-done" onclick="updCmd('${c.id}','Livré')">✅ Livré</button>
        <button class="bar-btn bar-reject" onclick="updCmd('${c.id}','Annulé')">✕</button>
      </div>
      <div style="margin-top:7px">
        <button style="width:100%;padding:8px;border-radius:var(--rs);background:rgba(200,245,90,.08);border:1px solid rgba(200,245,90,.25);color:var(--ac);font-size:12px;font-weight:600;cursor:pointer" onclick='showReceipt(${JSON.stringify(c)})'>🧾 Générer facture</button>
      </div>
    </div>`;
  }).filter(Boolean).join('')||'<div class="empty">✅ Aucune commande en attente</div>';
  refreshCA();
}

async function loadBarHist(){
  // ── ROUTAGE BAR ──
  let qh = db.from('commandes').select('*').eq('etab_id',ETAB.id).eq('date_cmd',today()).order('created_at',{ascending:false});
  if (CU && CU.bar_id) qh = qh.eq('bar_id', CU.bar_id);
  // ── FIN ROUTAGE ──
  const {data:cmds}=await qh;
  const all = cmds||[];
  const livrees = all.filter(c=>c.statut==='Livré');
  const annulees = all.filter(c=>c.statut==='Annulé');
  const enCours = all.filter(c=>c.statut==='Nouveau'||c.statut==='En prépa');
  const ca = livrees.reduce((a,c)=>a+c.montant,0);
  document.getElementById('bar-hist-stats').innerHTML=`
    <div class="stat-card"><div class="stat-v" style="color:var(--gn)">${livrees.length}</div><div class="stat-l">✅ Livrées</div></div>
    <div class="stat-card"><div class="stat-v" style="color:var(--wn)">${enCours.length}</div><div class="stat-l">⏳ En cours</div></div>
    <div class="stat-card"><div class="stat-v" style="color:var(--dg)">${annulees.length}</div><div class="stat-l">✕ Annulées</div></div>
    <div class="stat-card"><div class="stat-v" style="color:var(--ac)">${fmt(ca)} F</div><div class="stat-l">💵 CA total</div></div>`;
  document.getElementById('bar-hist-list').innerHTML=all.length?all.map(c=>`
    <div class="hist-item">
      <div class="hist-top">
        <div class="hist-tbl">${c.table_nom} <span style="font-size:10px;font-weight:400;color:var(--mt)">— ${c.employe_nom||'?'}</span></div>
        <div class="hist-time">${c.heure||''}</div>
      </div>
      <div class="hist-items">${c.articles||''}</div>
      <div class="hist-bot">
        <div class="hist-amt">${fmt(c.montant)} F</div>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="pill ${c.statut==='Livré'?'p-d':c.statut==='Nouveau'?'p-n':c.statut==='En prépa'?'p-p':'p-c'}">${c.statut}</span>
          <button style="padding:3px 9px;border-radius:8px;background:rgba(200,245,90,.1);border:1px solid rgba(200,245,90,.2);color:var(--ac);font-size:11px;cursor:pointer" onclick='showReceipt(${JSON.stringify(c)})'>🧾</button>
        </div>
      </div>
    </div>`).join(''):'<div class="empty">Aucune commande aujourd\'hui</div>';
}

async function updCmd(id,statut){
  // [FIX] Filtre etab_id — interdit la modification de commandes étrangères
  await db.from('commandes').update({statut}).eq('id',id).eq('etab_id',ETAB.id);
  loadBarman();
  if(statut==='Livré')toast('✅ Livré !','var(--gn)');
  else if(statut==='En prépa')toast('🍳 En préparation','var(--wn)');
  else toast('✕ Annulé','var(--dg)');
}

// ===== FACTURE / REÇU =====
let _lastCmdForReceipt = null;

function buildReceiptHTML(c) {
  const numFact = 'F-' + (c.id ? String(c.id).slice(-5) : Date.now().toString().slice(-5));
  const lignes = (c.articles||'').split(',').map(a => a.trim()).filter(Boolean);
  const rows = lignes.map(art => {
    const match = art.match(/^(.+?)\s*[×x](\d+)$/);
    const nom = match ? match[1].trim() : art;
    const qty = match ? parseInt(match[2]) : 1;
    const prod = ARTICLES.find(p => p.nom === nom || art.includes(p.nom));
    const pu = prod ? prod.prix : null;
    return { nom, qty, pu };
  });
  const hasDetail = rows.some(r => r.pu !== null);
  const storedLogo = _safeLS('baros_logo_'+(ETAB?.id||''));

  const logoHtml = storedLogo
    ? `<div style="margin-bottom:6px"><img src="${storedLogo}" style="max-height:38px;max-width:140px;object-fit:contain"></div>`
    : `<div class="receipt-logo-wrap">BarOS</div>`;

  const etabSub = [ETAB.ville, ETAB.tel ? 'Tél\u00a0: '+ETAB.tel : null].filter(Boolean).join('  ·  ');

  const itemsHtml = hasDetail
    ? rows.map(r => r.pu !== null
        ? `<div class="receipt-item">
            <span class="receipt-item-nm">${r.nom}</span>
            <span class="receipt-item-qty">×${r.qty}</span>
            <span class="receipt-item-amt">${fmt(r.pu*r.qty)} F</span>
           </div>`
        : `<div class="receipt-item"><span class="receipt-item-nm">${r.nom}</span><span class="receipt-item-amt">—</span></div>`
      ).join('')
    : lignes.map(a => `<div class="receipt-item"><span class="receipt-item-nm">${a}</span></div>`).join('');

  return `
    <div class="receipt-header">
      ${logoHtml}
      <div class="receipt-etab">${ETAB.nom}</div>
      ${etabSub ? `<div class="receipt-etab-sub">${etabSub}</div>` : ''}
    </div>
    <div class="receipt-meta">
      <div class="receipt-meta-item"><span class="receipt-meta-lbl">Date</span><span class="receipt-meta-val">${c.date_cmd||today()}</span></div>
      <div class="receipt-meta-item"><span class="receipt-meta-lbl">Heure</span><span class="receipt-meta-val">${c.heure||''}</span></div>
      <div class="receipt-meta-item"><span class="receipt-meta-lbl">Reçu N°</span><span class="receipt-meta-val">${numFact}</span></div>
      <div class="receipt-meta-item"><span class="receipt-meta-lbl">Table</span><span class="receipt-meta-val">${c.table_nom||'—'}</span></div>
    </div>
    <div class="receipt-items">${itemsHtml}</div>
    <div class="receipt-total-row">
      <span class="receipt-total-lbl">Total</span>
      <span class="receipt-total-val">${fmt(c.montant)} F</span>
    </div>
    <div class="receipt-pay-row">
      <span class="receipt-pay-lbl">Mode de paiement</span>
      <span class="receipt-pay-val">${c.paiement||'—'}</span>
    </div>
    <div class="receipt-pay-row">
      <span class="receipt-pay-lbl">Servi par</span>
      <span class="receipt-pay-val">${c.employe_nom||CU?.nom||'—'}</span>
    </div>
    <div class="receipt-footer-txt">
      Merci pour votre confiance !<br>
      <span style="color:rgba(200,245,90,0.4)">BarOS</span> · ${new Date().toLocaleDateString('fr-FR')}
    </div>`
}

function prepareReceiptContent(c) {
  _lastCmdForReceipt = c;
}

function showReceipt(c) {
  _lastCmdForReceipt = c;
  document.getElementById('receipt-content').innerHTML = buildReceiptHTML(c);
  document.getElementById('receipt-overlay').classList.remove('hide');
  updatePrinterUI();
}

function showReceiptFromConf() {
  if (!_lastCmdForReceipt) return;
  document.getElementById('receipt-content').innerHTML = buildReceiptHTML(_lastCmdForReceipt);
  document.getElementById('receipt-overlay').classList.remove('hide');
}

function closeReceipt() {
  document.getElementById('receipt-overlay').classList.add('hide');
}

function doPrint() {
  window.print();
}

// ===== BLUETOOTH PRINTER =====
class BTPrinter {
  constructor() {
    this.device = null;
    this.char   = null;
    this.width  = 48; // 48 = 80mm · 32 = 58mm
  }

  get connected() {
    return !!(this.device && this.device.gatt && this.device.gatt.connected && this.char);
  }

  // Essaie toutes les combinaisons service/caractéristique connues
  async connect() {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth non supporté. Utilise Chrome sur Android.');

    const OPT_SVCS = [
      '000018f0-0000-1000-8000-00805f9b34fb',
      '0000ff00-0000-1000-8000-00805f9b34fb',
      '49535343-fe7d-4ae5-8fa9-9fafd205e455',
      '0000ffe0-0000-1000-8000-00805f9b34fb',
      'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
      '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
      '0000fff0-0000-1000-8000-00805f9b34fb',
    ];
    const NAME_PFX = ['MTP','PTP','Printer','PRINTER','Peripage','Phomemo','Paperang',
      'EPSON','Epson','Star','STAR','Sewoo','SEWOO','RPP','DP-','PT-','MP-','BTP',
      'Goojprt','GOOJPRT','Rongta','iDPRT','Xprinter','XPRINTER','POS','BlueTooth'];

    let device;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [
          ...OPT_SVCS.map(s => ({services:[s]})),
          ...NAME_PFX.map(p => ({namePrefix:p})),
        ],
        optionalServices: OPT_SVCS,
      });
    } catch(e) {
      if (e.name === 'NotFoundError') {
        const ok = confirm('Aucune imprimante détectée automatiquement.\nAfficher tous les appareils Bluetooth ?');
        if (!ok) throw new Error('Annulé.');
        device = await navigator.bluetooth.requestDevice({ acceptAllDevices:true, optionalServices:OPT_SVCS });
      } else throw e;
    }

    const server = await device.gatt.connect();
    device.addEventListener('gattserverdisconnected', () => {
      this.device = null; this.char = null;
      updatePrinterUI();
      toast('🔌 Imprimante déconnectée', 'var(--wn)');
    });

    // Découverte automatique de la caractéristique d'écriture.
    // On explore d'abord les services connus d'imprimantes (OPT_SVCS), puis les autres,
    // en excluant les services système Android génériques qui peuvent aussi exposer
    // une caractéristique "write" (Battery, Device Info...) mais ne sont jamais le vrai
    // canal de données — sinon la découverte "premier trouvé" peut s'y accrocher à tort.
    const GENERIC_UUIDS = [
      '00001800-0000-1000-8000-00805f9b34fb', // Generic Access
      '00001801-0000-1000-8000-00805f9b34fb', // Generic Attribute
      '0000180a-0000-1000-8000-00805f9b34fb', // Device Information
      '0000180f-0000-1000-8000-00805f9b34fb', // Battery Service
    ];
    let ch = null;
    const allSvcs = await server.getPrimaryServices().catch(()=>[]);
    const priority = allSvcs.filter(s => OPT_SVCS.includes(s.uuid));
    const rest     = allSvcs.filter(s => !OPT_SVCS.includes(s.uuid) && !GENERIC_UUIDS.includes(s.uuid));
    outer: for (const svc of [...priority, ...rest]) {
      const chars = await svc.getCharacteristics().catch(()=>[]);
      for (const c of chars) {
        if (c.properties.write || c.properties.writeWithoutResponse) { ch = c; this._writeMode = c.properties.write ? 'write' : 'noresp'; break outer; }
      }
    }
    if (!ch) throw new Error('Caractéristique d\'écriture introuvable sur cet appareil.');

    this.device = device;
    this.char   = ch;
    return device.name || 'Imprimante';
  }

  disconnect() {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.device = null; this.char = null;
  }

  // Envoi par chunks (BLE MTU variable). Délai généreux car writeValueWithoutResponse
  // résout dès que les octets sont mis en file côté OS, pas quand l'imprimante les a
  // réellement reçus/traités — un envoi trop rapide tronque silencieusement le buffer
  // interne (souvent minuscule) du firmware sur les imprimantes thermiques bas de gamme.
  async send(data) {
    const CHUNK = 100;
    for (let i = 0; i < data.length; i += CHUNK) {
      const slice = data.slice(i, i + CHUNK);
      if (this._writeMode === 'noresp') {
        await this.char.writeValueWithoutResponse(slice);
      } else {
        try {
          await this.char.writeValue(slice);
        } catch(e) {
          await this.char.writeValueWithoutResponse(slice);
        }
      }
      await new Promise(r => setTimeout(r, 60));
    }
  }

  // Translittération → ASCII (encodage cp437 des imprimantes thermiques)
  _ascii(s) {
    return (s||'')
      .replace(/[àáâãä]/g,'a').replace(/[ÀÁÂÃÄ]/g,'A')
      .replace(/[éèêë]/g,'e').replace(/[ÉÈÊË]/g,'E')
      .replace(/[îï]/g,'i')  .replace(/[ÎÏ]/g,'I')
      .replace(/[ôõö]/g,'o') .replace(/[ÔÕÖ]/g,'O')
      .replace(/[ùûü]/g,'u') .replace(/[ÙÛÜ]/g,'U')
      .replace(/ç/g,'c')     .replace(/Ç/g,'C')
      .replace(/ñ/g,'n')     .replace(/[«»""]/g,'"')
      .replace(/['']/g,"'")  .replace(/[–—]/g,'-')
      .replace(/[^\x20-\x7E]/g,'?');
  }

  _padLine(l, r, w) {
    const sp = w - l.length - r.length;
    return sp > 0 ? l + ' '.repeat(sp) + r : l.slice(0, w - r.length - 1) + ' ' + r;
  }

  // Génère les bytes ESC/POS complets pour un reçu
  buildESCPOS(cmd) {
    const W = this.width;
    const b = [];
    const p  = (...v) => b.push(...v);
    const tx = s => [...s].forEach(c => p(c.charCodeAt(0) & 0xFF));
    const LF = 0x0A;
    const sep = () => { tx('-'.repeat(W)); p(LF); };

    // Init (reset uniquement — pas de sélection de table de code : le texte est déjà translittéré en ASCII pur par _ascii(), et ESC t sur une table non supportée fait planter silencieusement certains firmwares chinois)
    p(0x1B,0x40);           // ESC @ — reset

    // ── HEADER ──────────────────────────────────────────
    p(0x1B,0x61,0x01);      // centrer
    p(0x1D,0x21,0x11);      // double taille
    p(0x1B,0x45,0x01);      // gras
    tx(this._ascii(cmd.etab)); p(LF);
    p(0x1D,0x21,0x00); p(0x1B,0x45,0x00); // normal
    if (cmd.ville || cmd.tel) {
      const sub = [cmd.ville, cmd.tel ? 'Tel: '+cmd.tel : null].filter(Boolean).join(' | ');
      tx(this._ascii(sub)); p(LF);
    }
    p(LF);
    p(0x1B,0x61,0x00);      // gauche
    sep();

    // ── META ────────────────────────────────────────────
    tx(this._ascii(this._padLine('Recu N: '+cmd.num, cmd.date+' '+cmd.heure, W))); p(LF);
    tx(this._ascii(this._padLine('Table : '+cmd.table, 'Serveur: '+cmd.serveur, W))); p(LF);
    sep();

    // ── ARTICLES ────────────────────────────────────────
    p(0x1B,0x45,0x01);
    tx(this._ascii(this._padLine('Article','Montant',W))); p(LF);
    p(0x1B,0x45,0x00);
    sep();

    if (cmd.items && cmd.items.length) {
      cmd.items.forEach(it => {
        const left = this._ascii(it.nom + (it.qty > 1 ? ' x'+it.qty : ''));
        if (it.pu != null) {
          const right = fmt(it.pu * it.qty) + ' F';
          tx(this._padLine(left.slice(0, W - right.length - 1), right, W)); p(LF);
        } else {
          tx(left.slice(0, W)); p(LF);
        }
      });
    } else {
      (cmd.articles||'').split(',').forEach(a => {
        tx(this._ascii(a.trim()).slice(0, W)); p(LF);
      });
    }

    // ── TOTAL ────────────────────────────────────────────
    tx('='.repeat(W)); p(LF);
    p(0x1B,0x61,0x02);      // droite
    p(0x1D,0x21,0x01);      // double hauteur
    p(0x1B,0x45,0x01);
    tx(this._ascii('TOTAL : '+fmt(cmd.total)+' F')); p(LF);
    p(0x1D,0x21,0x00); p(0x1B,0x45,0x00);
    p(0x1B,0x61,0x00);      // gauche
    tx(this._ascii(this._padLine('Paiement : '+cmd.paiement,'',W).trim())); p(LF);

    // ── FOOTER ───────────────────────────────────────────
    p(LF); p(0x1B,0x61,0x01);
    sep();
    tx('Merci de votre confiance !'); p(LF);
    tx(this._ascii('BarOS - '+new Date().toLocaleDateString('fr-FR'))); p(LF);
    p(LF,LF,LF);

    return new Uint8Array(b);
  }

  // Coupe papier envoyée séparément, avec pause, une fois le texte
  // du reçu réellement traité par le firmware (évite que la coupe
  // matérielle intervienne avant l'impression du texte en buffer)
  async cutPaper() {
    await new Promise(r => setTimeout(r, 300));
    await this.send(new Uint8Array([0x1D,0x56,0x42,0x00]));
  }
}

let BTP = new BTPrinter();

// ══════════════════════════════════════════════════════════════════
// CatPrinter — protocole GB01/GT01 ("cat printer" à transfert thermique
// direct, type WalkPrint : MiNi Printer, YHK-XXXX, etc.)
// Classe ENTIÈREMENT séparée de BTPrinter (ESC/POS ci-dessus). Aucune
// ligne de BTPrinter, btConnect(), doPrintBT() ou updatePrinterUI()
// n'est modifiée par ce bloc — activation uniquement via un bouton
// dédié pour ne jamais interférer avec le flux ESC/POS existant.
//
// Protocole documenté publiquement (famille GB01), implémentation du
// mode non compressé (0xA2), le plus simple et le plus universellement
// supporté sur cette famille de puces :
// https://github.com/JJJollyjim/catprinter/blob/master/COMMANDS.md
//
// Trame :  51 78 <opcode> <flag=00> <len_lo> <len_hi> <data...> <crc8> FF
// crc8  :  CRC-8 CCITT (poly 0x07, init 0x00) sur <data> uniquement
// image :  384 px de large (48 octets/ligne), 1 bit = 1 pixel,
//          LSB en premier dans chaque octet, bit=1 → noircir
// ══════════════════════════════════════════════════════════════════
class CatPrinter {
  constructor() {
    this.device = null;
    this.char   = null;
    this.width  = 384; // largeur fixe des cat printers GB01/GT01
  }

  get connected() {
    return !!(this.device && this.device.gatt && this.device.gatt.connected && this.char);
  }

  async connect() {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth non supporté. Utilise Chrome sur Android.');

    // Services connus des cat printers GB01/GT01/GB02 (UART-like, souvent
    // exposés sous ces UUID génériques par les puces JieLi/Bluetrum)
    const CAT_SVCS = [
      '0000ae30-0000-1000-8000-00805f9b34fb',
      '0000ff00-0000-1000-8000-00805f9b34fb',
      '49535343-fe7d-4ae5-8fa9-9fafd205e455',
      '0000ffe0-0000-1000-8000-00805f9b34fb',
    ];
    const NAME_PFX = ['GB0','GT0','MX','YHK','GB','Cat','CAT','MiNi','Mini',
      'PR','Print','JX','Y1','MP-','JP-'];

    let device;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [
          ...CAT_SVCS.map(s => ({services:[s]})),
          ...NAME_PFX.map(p => ({namePrefix:p})),
        ],
        optionalServices: CAT_SVCS,
      });
    } catch(e) {
      if (e.name === 'NotFoundError') {
        const ok = confirm('Aucune imprimante détectée automatiquement.\nAfficher tous les appareils Bluetooth ?');
        if (!ok) throw new Error('Annulé.');
        device = await navigator.bluetooth.requestDevice({ acceptAllDevices:true, optionalServices:CAT_SVCS });
      } else throw e;
    }

    const server = await device.gatt.connect();
    device.addEventListener('gattserverdisconnected', () => {
      this.device = null; this.char = null;
      updateCatPrinterUI();
      toast('🔌 Imprimante déconnectée', 'var(--wn)');
    });

    let ch = null;
    const svcs = await server.getPrimaryServices().catch(()=>[]);
    outer: for (const svc of svcs) {
      const chars = await svc.getCharacteristics().catch(()=>[]);
      for (const c of chars) {
        if (c.properties.write || c.properties.writeWithoutResponse) {
          ch = c; this._writeMode = c.properties.write ? 'write' : 'noresp'; break outer;
        }
      }
    }
    if (!ch) throw new Error('Caractéristique d\'écriture introuvable sur cet appareil.');

    this.device = device;
    this.char   = ch;
    return device.name || 'Cat Printer';
  }

  disconnect() {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.device = null; this.char = null;
  }

  // Envoi par chunks (BLE MTU variable). Délai après CHAQUE chunk, aligné sur
  // BTPrinter.send() : writeValueWithoutResponse résout dès que l'OS a mis les
  // octets en file, pas quand le firmware les a réellement traités. Sans pause,
  // un chip BLE bas de gamme (souvent sans vraie négociation MTU, cas fréquent
  // sur les clones GB01/GT01) tronque silencieusement les trames contenant des
  // pixels — seul feed() (trame ~10 octets) passait, d'où "papier avance, rien
  // n'imprime". Un sleep fixe avait été retiré ici pour la vitesse ; remis suite
  // au diagnostic "aucune trace papier" du 07/07/2026.
  async send(data) {
    const CHUNK = 100;
    for (let i = 0; i < data.length; i += CHUNK) {
      const slice = data.slice(i, i + CHUNK);
      if (this._writeMode === 'noresp') {
        await this.char.writeValueWithoutResponse(slice);
      } else {
        try {
          await this.char.writeValue(slice);
        } catch(e) {
          await this.char.writeValueWithoutResponse(slice);
        }
      }
      await new Promise(r => setTimeout(r, 60));
    }
  }

  _crc8(bytes) {
    let crc = 0x00;
    for (const byte of bytes) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) {
        crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xFF : (crc << 1) & 0xFF;
      }
    }
    return crc;
  }

  // Construit une trame complète 51 78 <op> 00 <len_lo> <len_hi> <data> <crc8> FF
  _frame(opcode, data) {
    const len = data.length;
    const head = [0x51, 0x78, opcode, 0x00, len & 0xFF, (len >> 8) & 0xFF];
    const crc  = this._crc8(data);
    return new Uint8Array([...head, ...data, crc, 0xFF]);
  }

  async _sendCmd(opcode, data) {
    await this.send(this._frame(opcode, data));
  }

  // Avance le papier de n lignes (0xA1)
  async feed(lines) {
    await this._sendCmd(0xA1, [lines & 0xFF, 0x00]);
  }

  // Imprime une seule ligne de pixels (48 octets = 384 bits, MSB first, 1=noir) (0xA2)
  async printRow(rowBytes) {
    await this._sendCmd(0xA2, Array.from(rowBytes));
  }

  // Imprime plusieurs lignes de pixels regroupées dans UNE seule trame 0xA2
  // (payload = lignes concaténées). Réduit drastiquement le nombre de trames
  // BLE (et donc le nombre d'attentes de 20ms entre chunks) par rapport à un
  // envoi ligne par ligne, sans changer le format de trame côté firmware qui
  // accepte un multiple de bytesPerRow comme payload de 0xA2.
  async printRows(rowsBytes, batchSize = 24) {
    const bytesPerRow = rowsBytes.length ? rowsBytes[0].length : 0;
    for (let i = 0; i < rowsBytes.length; i += batchSize) {
      const batch = rowsBytes.slice(i, i + batchSize);
      const merged = new Uint8Array(batch.length * bytesPerRow);
      batch.forEach((row, j) => merged.set(row, j * bytesPerRow));
      await this._sendCmd(0xA2, Array.from(merged));
    }
  }

  // Séquence d'initialisation avant une image (0xA6 printLattice, 0xBD vitesse, 0xAF énergie, 0xBE mode image)
  async beginPrint() {
    await this._sendCmd(0xA6, [0xAA,0x55,0x17,0x38,0x44,0x5F,0x5F,0x5F,0x44,0x38,0x2C]);
    await this._sendCmd(0xBD, [35]);
    await this._sendCmd(0xAF, [8000 & 0xFF, (8000 >> 8) & 0xFF]);
    await this._sendCmd(0xBE, [0x00]);
  }

  // Séquence de fin après une image (0xA6 finishLattice)
  async endPrint() {
    await this._sendCmd(0xA6, [0xAA,0x55,0x17,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x17]);
    await this.feed(60);
  }

  // ── Rendu canvas → bitmap 1-bit avec dithering Floyd-Steinberg ──
  // Rend le reçu (texte + mise en page) sur un canvas hors-écran à la
  // largeur fixe de 384px, puis convertit chaque ligne de pixels en
  // octets 1-bit LSB-first pour printRow().
  _renderReceiptCanvas(cmd) {
    const W = this.width; // 384
    const PAD = 8;
    const lineH = 22;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    const ctx0 = canvas.getContext('2d');
    ctx0.font = '13px monospace';

    // Construction des lignes de texte (même contenu logique que buildESCPOS)
    const lines = [];
    lines.push({t: cmd.etab, size: 20, bold: true, center: true});
    if (cmd.ville || cmd.tel) {
      const sub = [cmd.ville, cmd.tel ? 'Tel: '+cmd.tel : null].filter(Boolean).join(' | ');
      lines.push({t: sub, size: 13, center: true});
    }
    lines.push({t: '', size: 6});
    lines.push({t: '-'.repeat(46), size: 13});
    lines.push({t: `Recu N: ${cmd.num}`, size: 13});
    lines.push({t: `${cmd.date} ${cmd.heure}`, size: 13});
    lines.push({t: `Table : ${cmd.table}`, size: 13});
    lines.push({t: `Serveur: ${cmd.serveur}`, size: 13});
    lines.push({t: '-'.repeat(46), size: 13});
    lines.push({t: 'Article', size: 13, bold: true});
    lines.push({t: '-'.repeat(46), size: 13});

    if (cmd.items && cmd.items.length) {
      cmd.items.forEach(it => {
        const nom = it.nom + (it.qty > 1 ? ' x'+it.qty : '');
        const prix = it.pu != null ? fmt(it.pu * it.qty) + ' F' : '';
        lines.push({t: nom + (prix ? '  '+prix : ''), size: 13});
      });
    } else {
      (cmd.articles||'').split(',').forEach(a => {
        if (a.trim()) lines.push({t: a.trim(), size: 13});
      });
    }

    lines.push({t: '='.repeat(46), size: 13});
    lines.push({t: `TOTAL : ${fmt(cmd.total)} F`, size: 18, bold: true, right: true});
    lines.push({t: `Paiement : ${cmd.paiement}`, size: 13});
    lines.push({t: '', size: 6});
    lines.push({t: '-'.repeat(46), size: 13, center: true});
    lines.push({t: 'Merci de votre confiance !', size: 13, center: true});
    lines.push({t: 'BarOS - '+new Date().toLocaleDateString('fr-FR'), size: 13, center: true});
    lines.push({t: '', size: 20});

    // Hauteur totale
    let totalH = PAD * 2;
    lines.forEach(l => { totalH += (l.size || 13) + 8; });
    canvas.height = Math.ceil(totalH);

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';

    let y = PAD;
    lines.forEach(l => {
      const size = l.size || 13;
      ctx.font = (l.bold ? 'bold ' : '') + size + 'px monospace';
      const txt = l.t || '';
      const width = ctx.measureText(txt).width;
      let x = PAD;
      if (l.center) x = Math.max(PAD, (W - width) / 2);
      else if (l.right) x = Math.max(PAD, W - PAD - width);
      ctx.fillText(txt, x, y);
      y += size + 8;
    });

    return canvas;
  }

  // Convertit un canvas en tableau de lignes de 48 octets (1-bit, LSB first, 1=noir)
  // avec dithering Floyd-Steinberg pour un rendu propre sur imprimante 1-bit.
  _canvasToBitmapRows(canvas) {
    const W = this.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, W, H);
    const gray = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const r = imgData.data[i*4], g = imgData.data[i*4+1], b = imgData.data[i*4+2];
      gray[i] = 0.299*r + 0.587*g + 0.114*b;
    }
    // Floyd-Steinberg dithering
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y*W + x;
        const old = gray[idx];
        const nw  = old < 128 ? 0 : 255;
        const err = old - nw;
        gray[idx] = nw;
        if (x+1 < W)          gray[idx+1]     += err * 7/16;
        if (y+1 < H && x>0)   gray[idx+W-1]   += err * 3/16;
        if (y+1 < H)          gray[idx+W]     += err * 5/16;
        if (y+1 < H && x+1<W) gray[idx+W+1]   += err * 1/16;
      }
    }
    const bytesPerRow = W / 8; // 48
    const rows = [];
    for (let y = 0; y < H; y++) {
      const row = new Uint8Array(bytesPerRow);
      for (let x = 0; x < W; x++) {
        const black = gray[y*W + x] < 128 ? 1 : 0;
        // LSB first — vérifié contre la doc officielle GB01/GT01 (commande 0xA2,
        // "Print uncompressed" : "packed with the least significant bit first").
        // Le commentaire précédent avait inversé cet ordre en pensant corriger un
        // "papier vierge" ; c'est cette inversion en MSB-first qui produisait un
        // bitmap illisible pour le firmware, pas l'ancien LSB-first (qui était correct).
        if (black) row[x >> 3] |= (0x01 << (x & 7)); // LSB first
      }
      rows.push(row);
    }
    return rows;
  }

  // Impression complète d'un reçu (rendu + dithering + envoi par lots de lignes)
  async printReceipt(cmd) {
    const canvas = this._renderReceiptCanvas(cmd);
    const rows = this._canvasToBitmapRows(canvas);
    await this.beginPrint();
    await this.printRows(rows);
    await this.endPrint();
  }
}

let CATP = new CatPrinter();

function updateCatPrinterUI() {
  const dot  = document.getElementById('catpt-dot');
  const name = document.getElementById('catpt-name');
  const btn  = document.getElementById('catpt-btn');
  const pbtn = document.getElementById('catpt-print-btn');
  if (!dot) return;
  if (CATP.connected) {
    dot.className  = 'printer-dot on';
    name.textContent = CATP.device.name || 'Cat Printer connectée';
    btn.textContent  = '🔌 Déconnecter';
    btn.className    = 'printer-connect-btn on';
    if (pbtn) pbtn.classList.remove('disabled');
  } else {
    dot.className  = 'printer-dot off';
    name.textContent = 'Non connectée';
    btn.textContent  = '🔗 Connecter';
    btn.className    = 'printer-connect-btn';
    if (pbtn) pbtn.classList.add('disabled');
  }
}

async function catPrinterConnect() {
  if (CATP.connected) { CATP.disconnect(); updateCatPrinterUI(); return; }
  const btn = document.getElementById('catpt-btn');
  const dot = document.getElementById('catpt-dot');
  if (btn) { btn.textContent = '🔍 Recherche…'; btn.disabled = true; }
  if (dot) dot.className = 'printer-dot busy';
  try {
    const name = await CATP.connect();
    toast('✅ ' + name + ' connectée !', 'var(--gn)');
    updateCatPrinterUI();
  } catch(e) {
    if (e.message !== 'Annulé.') toast('❌ ' + (e.message || 'Connexion échouée'), 'var(--rd)');
    if (dot) dot.className = 'printer-dot off';
  } finally {
    if (btn) btn.disabled = false;
    updateCatPrinterUI();
  }
}

async function doPrintCatPrinter() {
  if (!CATP.connected) { toast('⚠️ Aucune Cat Printer connectée', 'var(--wn)'); return; }
  const c = _lastCmdForReceipt;
  if (!c) return;
  const btn = document.getElementById('catpt-print-btn');
  if (btn) { btn.textContent = '⏳ Impression…'; btn.disabled = true; }
  try {
    const items = (c.articles||'').split(',').map(a => {
      const art = a.trim();
      const m   = art.match(/^(.+?)\s*[×x](\d+)$/);
      const nom = m ? m[1].trim() : art;
      const qty = m ? parseInt(m[2]) : 1;
      const prod = ARTICLES.find(p => p.nom === nom || art.includes(p.nom));
      return { nom, qty, pu: prod ? prod.prix : null };
    }).filter(it => it.nom);

    await CATP.printReceipt({
      etab   : ETAB.nom,
      ville  : ETAB.ville||'',
      tel    : ETAB.tel||'',
      date   : c.date_cmd || today(),
      heure  : c.heure||'',
      num    : 'F-'+(c.id?String(c.id).slice(-5):Date.now().toString().slice(-5)),
      table  : c.table_nom||'—',
      serveur: c.employe_nom || CU?.nom || '—',
      items,
      articles: c.articles||'',
      total  : c.montant,
      paiement: c.paiement||'—',
    });
    toast('✅ Reçu imprimé !', 'var(--gn)');
  } catch(e) {
    toast('❌ Erreur impression : ' + (e.message||''), 'var(--rd)');
    CATP.device = null; CATP.char = null;
    updateCatPrinterUI();
  } finally {
    if (btn) { btn.textContent = '🐱 Cat Printer'; btn.disabled = false; }
  }
}

// ══════════════════════════════════════════════════════════════════
// DIAGNOSTIC TEMPORAIRE — Cat Printer "aucune trace papier"
// N'appelle QUE des méthodes déjà existantes de CATP (_sendCmd,
// printRows, feed, beginPrint, endPrint). Aucune ligne de CatPrinter,
// beginPrint(), printRows() ou endPrint() n'est modifiée ici — trois
// séquences alternatives isolées, à retirer une fois le bug résolu.
// ══════════════════════════════════════════════════════════════════
function _catDiagBlock(nRows = 40) {
  const bytesPerRow = CATP.width / 8; // 48
  const row = new Uint8Array(bytesPerRow).fill(0xFF); // ligne 100% noire
  return Array.from({length: nRows}, () => row);
}

// Test A — AUCUNE initialisation : bloc noir envoyé directement en 0xA2.
// Isole : le firmware accepte-t-il le bitmap sans préambule du tout ?
async function catDiagTestA() {
  if (!CATP.connected) { toast('⚠️ Cat Printer non connectée', 'var(--wn)'); return; }
  try {
    toast('🧪 Test A : sans init du tout…', 'var(--inf)');
    await CATP.printRows(_catDiagBlock());
    await CATP.feed(60);
    toast('✅ Test A envoyé — regarde le papier', 'var(--gn)');
  } catch(e) {
    toast('❌ Test A a échoué : ' + (e.message||''), 'var(--rd)');
  }
}

// Test B — Énergie (0xAF) + mode image (0xBE) SEULS, sans le lattice 0xA6.
// Isole : est-ce spécifiquement l'opcode 0xA6 qui bloque ce firmware ?
async function catDiagTestB() {
  if (!CATP.connected) { toast('⚠️ Cat Printer non connectée', 'var(--wn)'); return; }
  try {
    toast('🧪 Test B : énergie+mode, sans lattice…', 'var(--inf)');
    await CATP._sendCmd(0xAF, [8000 & 0xFF, (8000 >> 8) & 0xFF]);
    await CATP._sendCmd(0xBE, [0x00]);
    await CATP.printRows(_catDiagBlock());
    await CATP.feed(60);
    toast('✅ Test B envoyé — regarde le papier', 'var(--gn)');
  } catch(e) {
    toast('❌ Test B a échoué : ' + (e.message||''), 'var(--rd)');
  }
}

// Test C — Séquence actuelle beginPrint() + délai de 2s avant la 1ère ligne.
// Isole : le firmware a-t-il juste besoin de plus de temps après le lattice ?
async function catDiagTestC() {
  if (!CATP.connected) { toast('⚠️ Cat Printer non connectée', 'var(--wn)'); return; }
  try {
    toast('🧪 Test C : lattice + délai 2s…', 'var(--inf)');
    await CATP.beginPrint();
    await new Promise(r => setTimeout(r, 2000));
    await CATP.printRows(_catDiagBlock());
    await CATP.endPrint();
    toast('✅ Test C envoyé — regarde le papier', 'var(--gn)');
  } catch(e) {
    toast('❌ Test C a échoué : ' + (e.message||''), 'var(--rd)');
  }
}

function updatePrinterUI() {
  const dot  = document.getElementById('pt-dot');
  const name = document.getElementById('pt-name');
  const btn  = document.getElementById('pt-btn');
  const pbtn = document.getElementById('bt-print-btn');
  if (!dot) return;
  if (BTP.connected) {
    dot.className  = 'printer-dot on';
    name.textContent = BTP.device.name || 'Imprimante connectée';
    btn.textContent  = '🔌 Déconnecter';
    btn.className    = 'printer-connect-btn on';
    pbtn.classList.remove('disabled');
  } else {
    dot.className  = 'printer-dot off';
    name.textContent = 'Non connectée';
    btn.textContent  = '🔗 Connecter';
    btn.className    = 'printer-connect-btn';
    pbtn.classList.add('disabled');
  }
}

async function btConnect() {
  if (BTP.connected) { BTP.disconnect(); updatePrinterUI(); return; }
  const btn = document.getElementById('pt-btn');
  const dot = document.getElementById('pt-dot');
  btn.textContent = '🔍 Recherche…'; btn.disabled = true;
  dot.className = 'printer-dot busy';
  try {
    const name = await BTP.connect();
    toast('✅ ' + name + ' connectée !', 'var(--gn)');
    // Format papier sélectionné
    const sel = document.getElementById('pt-paper');
    BTP.width = sel && sel.value === '58mm' ? 32 : 48;
    updatePrinterUI();
  } catch(e) {
    if (e.message !== 'Annulé.') toast('❌ ' + (e.message || 'Connexion échouée'), 'var(--rd)');
    dot.className = 'printer-dot off';
  } finally {
    btn.disabled = false;
    updatePrinterUI();
  }
}

async function doPrintBT() {
  if (!BTP.connected) { toast('⚠️ Aucune imprimante connectée', 'var(--wn)'); return; }
  const c = _lastCmdForReceipt;
  if (!c) return;
  const btn = document.getElementById('bt-print-btn');
  btn.textContent = '⏳ Impression…'; btn.disabled = true;
  try {
    // Construction des lignes articles avec prix si disponibles
    const items = (c.articles||'').split(',').map(a => {
      const art = a.trim();
      const m   = art.match(/^(.+?)\s*[×x](\d+)$/);
      const nom = m ? m[1].trim() : art;
      const qty = m ? parseInt(m[2]) : 1;
      const prod = ARTICLES.find(p => p.nom === nom || art.includes(p.nom));
      return { nom, qty, pu: prod ? prod.prix : null };
    }).filter(it => it.nom);

    const bytes = BTP.buildESCPOS({
      etab   : ETAB.nom,
      ville  : ETAB.ville||'',
      tel    : ETAB.tel||'',
      date   : c.date_cmd || today(),
      heure  : c.heure||'',
      num    : 'F-'+(c.id?String(c.id).slice(-5):Date.now().toString().slice(-5)),
      table  : c.table_nom||'—',
      serveur: c.employe_nom || CU?.nom || '—',
      items,
      articles: c.articles||'',
      total  : c.montant,
      paiement: c.paiement||'—',
    });
    await BTP.send(bytes);
    await BTP.cutPaper();
    toast('✅ Reçu imprimé !', 'var(--gn)');
  } catch(e) {
    toast('❌ Erreur impression : ' + (e.message||''), 'var(--rd)');
    BTP.device = null; BTP.char = null;
    updatePrinterUI();
  } finally {
    btn.textContent = '🖨️ Bluetooth'; btn.disabled = false;
  }
}

// [DIAG TEMPORAIRE] Test ESC/POS minimal et autonome (aucune donnée de commande,
// aucun passage par buildESCPOS/_lastCmdForReceipt). Sert à isoler la cause en
// deux clics : si CE test sort vierge, le problème est en dessous — transmission
// Bluetooth ou imprimante elle-même — indépendamment de tout code de facture.
// Si CE test sort bien mais qu'une vraie facture reste vierge, le problème est
// spécifique aux données de la commande (c.articles/c.montant/etc.) ou à
// buildESCPOS(), pas à l'envoi. À retirer une fois le doute levé.
async function btDiagTest() {
  if (!BTP.connected) { toast('⚠️ Aucune imprimante connectée', 'var(--wn)'); return; }
  const btn = document.getElementById('bt-diag-btn');
  if (btn) { btn.textContent = '⏳…'; btn.disabled = true; }
  try {
    const b  = [];
    const p  = (...v) => b.push(...v);
    const tx = s => [...s].forEach(ch => p(ch.charCodeAt(0) & 0xFF));
    p(0x1B,0x40);                 // ESC @ — init
    p(0x1B,0x61,0x01);            // centré
    p(0x1D,0x21,0x11);            // double largeur + double hauteur
    p(0x1B,0x45,0x01);            // gras ON
    tx('TEST OK'); p(0x0A);
    p(0x1D,0x21,0x00);            // taille normale
    p(0x1B,0x45,0x00);            // gras OFF
    p(0x1B,0x61,0x00);            // aligné gauche
    tx('-'.repeat(BTP.width)); p(0x0A);
    tx(new Date().toLocaleString('fr-FR')); p(0x0A);
    p(0x0A,0x0A,0x0A);
    await BTP.send(new Uint8Array(b));
    await BTP.cutPaper();
    toast('✅ Test envoyé — regarde le papier', 'var(--gn)');
  } catch(e) {
    toast('❌ Erreur test : ' + (e.message||''), 'var(--rd)');
  } finally {
    if (btn) { btn.textContent = '🧪BT'; btn.disabled = false; }
  }
}


// ═══════════════════════════════════════════════════════════════════════
// BAROS BAR/CUISINE SPLIT — Module complet
// AUTO ROUTING · OPTION GLACÉ · BAROS STOCK SYSTEM · REALTIME INVENTORY
// © 2025 Christophe OLOCK BELANG
// ═══════════════════════════════════════════════════════════════════════

// ── BAROS BAR/CUISINE SPLIT ──────────────────────────────────────────
// Mots-clés qui identifient les catégories boissons (→ bar)
const BAR_KEYWORDS = [
  'bière','beer','coca','soda','jus','eau','vin','whisky','gin','vodka',
  'rhum','rum','boisson','drink','cocktail','champagne','bier','sprite',
  'fanta','tonic','juice','wine','brewski','alcool','malta','sucré',
  'smoothie','shake','café','coffee','thé','tea','lait','milk','limon',
  'orangina','schweppes','heineken','castel','guinness','33','regab',
  'ngok','flag','ohlala','beaufort','mutzig','hr','primus','turbo king'
];

// Mots-clés cuisine (→ cuisine)
const CUISINE_KEYWORDS = [
  // Viandes & protéines
  'poulet','chicken','poisson','fish','viande','meat','boeuf','beef','mouton',
  'agneau','crevette','shrimp','thon','sardine','tilapia','capitaine','silure',
  'soya','brochette','dibi','grillé','braiser','braisé','rôti',
  // Plats africains
  'ndolé','eru','koki','mbongo','nkui','miondo','fufu','foufou','yassa',
  'mafé','thiéboudienne','plantain','beignet','accra','arachide',
  'okok','nnam','bobolo','couscous','feijoada','egusi',
  // Féculents & accompagnements
  'riz','frites','pâtes','pasta','spaghetti','macaroni','manioc','igname',
  'patate','couscous','pain','sandwich','wrap',
  // Plats internationaux
  'pizza','burger','shawarma','kebab','tacos','hot dog','hotdog',
  'salade','salad','soupe','soup','potage',
  // Œufs & petit-déj
  'omelette','egg','oeuf','crêpe','pancake','gaufre',
  // Snacks solides
  'pop-corn','popcorn','chips','cacahuète','peanut',
  // Termes génériques cuisine
  'plat','repas','meal','food','nourriture','snack','entrée','dessert',
  'gâteau','cake','tarte','glace','ice cream'
];

/**
 * BAROS BAR/CUISINE SPLIT
 * Retourne le type_service d'un produit.
 * Priorité : champ explicite → catégorie → mots-clés dans le nom.
 * Fallback : "bar" (boissons restent la majorité dans un bar)
 */
function getProdTypeService(p) {
  // 1. Champ explicite stocké en base (défini par le manager)
  if (p.type_service === 'bar' || p.type_service === 'cuisine') return p.type_service;

  // 2. Détection par catégorie — couvre toutes les catégories connues du menu camerounais
  const cat = (p.categorie || '').toLowerCase();

  // Catégories → bar
  if (cat.includes('bière') || cat.includes('biere') || cat.includes('beer') ||
      cat.includes('soft') || cat.includes('soda') || cat.includes('boisson') ||
      cat.includes('drink') || cat.includes('bar') || cat.includes('alcool') ||
      cat.includes('spiritueux') || cat.includes('vin') || cat.includes('wine') ||
      cat.includes('whisky') || cat.includes('liqueur') ||
      cat.includes('cocktail') || cat.includes('café') || cat.includes('coffee') ||
      cat.includes('thé') || cat.includes('jus') || cat.includes('eau') ||
      cat.includes('chicha')) {
    return 'bar';
  }

  // Catégories → cuisine (inclut 'Nourriture' et 'Snacks' du menu camerounais)
  if (cat.includes('cuisine') || cat.includes('plat') || cat.includes('food') ||
      cat.includes('repas') || cat.includes('nourriture') || cat.includes('snack') ||
      cat.includes('entrée') || cat.includes('dessert') || cat.includes('grillad') ||
      cat.includes('brochette') || cat.includes('viande') || cat.includes('poisson') ||
      cat.includes('petit-déjeuner') || cat.includes('accompagnement') || cat.includes('glace')) {
    return 'cuisine';
  }

  // 3. Mots-clés dans le nom du produit
  const nom = (p.nom || '').toLowerCase();
  // Cuisine en priorité (plats solides > boissons en cas d'ambiguïté)
  for (const kw of CUISINE_KEYWORDS) { if (nom.includes(kw)) return 'cuisine'; }
  for (const kw of BAR_KEYWORDS)     { if (nom.includes(kw)) return 'bar'; }

  // 4. Fallback : bar
  return 'bar';
}

// ── OPTION GLACÉ ──────────────────────────────────────────────────────
/**
 * OPTION GLACÉ — Toggle glacé pour UNE UNITÉ SPÉCIFIQUE d'un produit bar
 * panierGlace[prodId] = tableau de booléens, un par unité commandée
 * toggleGlace(id, 0) → toggle la 1re unité
 * toggleGlace(id, 1) → toggle la 2e unité
 */
function toggleGlace(prodId, unitIndex) {
  const qty = panier[prodId] || 0;
  if (!panierGlace[prodId]) panierGlace[prodId] = Array(qty).fill(false);
  // S'assurer que le tableau a la bonne taille si qty a changé
  while (panierGlace[prodId].length < qty) panierGlace[prodId].push(false);
  panierGlace[prodId][unitIndex] = !panierGlace[prodId][unitIndex];
  renderStep(2); // Re-render pour mettre à jour les checkboxes
}

// ── BAROS STOCK SYSTEM — Chargement cache stock temps réel ───────────
/**
 * REALTIME INVENTORY — Charger le stock courant depuis Supabase
 * Alimenté au démarrage et sur chaque changement realtime
 */
// Reconstruit stockCache (clé = id ET nom, pour compat avec tout ancien lookup
// par "stock_nom || nom") à partir des lignes brutes de la table "stock".
function _rebuildStockCache(rows) {
  stockCache = {};
  (rows || []).forEach(s => { stockCache[s.id] = s; stockCache[s.nom] = s; });
}

async function loadStockCache() {
  if (!ETAB) return;
  try {
    const { data } = await db.from('stock').select('*').eq('etab_id', ETAB.id);
    const rows = data || [];
    ARTICLES = rows.map(normArticle);
    _rebuildStockCache(rows);
    _saveEtabCache(ETAB.id, ETAB, EMPS, rows); // garder le cache offline synchronisé
  } catch(e) {
    // Réseau indisponible — on garde le cache ARTICLES/stockCache existant (offline-first)
  }
}

// ── BAROS STOCK SYSTEM — Vues stock BAR et CUISINE ───────────────────

/**
 * REALTIME INVENTORY — Afficher vue stock bar dans la vue barman
 * Appelé depuis le sous-onglet historique du barman
 */
function buildBarStockSection() {
  // BAR INVENTORY — Articles bar avec leurs stocks
  const prodsBar = ARTICLES.filter(p => getProdTypeService(p) === 'bar');
  if (!prodsBar.length) return '';
  let html = `<div class="sec-lbl" style="margin-top:14px">🍺 Inventaire Bar</div>`;
  prodsBar.forEach(p => {
    const s = stockCache[p.stock_nom || p.nom];
    if (!s) return;
    const rest = s.quantite || 0;
    const init = s.quantite_initiale || s.quantite_initiale || rest;
    const vendu = s.vendu_systeme || 0;
    const pv = s.prix_vente || p.prix || 0;
    const caRealise = vendu * pv;
    const pct = init > 0 ? Math.round(rest / init * 100) : 0;
    const col = rest <= 0 ? 'var(--dg)' : rest <= (s.seuil_alerte || 5) ? 'var(--wn)' : 'var(--gn)';
    const alerte = rest <= 0 ? '❌ Rupture' : rest <= (s.seuil_alerte || 5) ? '⚠️ Stock faible' : '';
    html += `<div style="background:var(--s1);border:1px solid var(--bd);border-radius:var(--rs);padding:10px 12px;margin-bottom:7px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
        <div style="font-size:13px;font-weight:600">${p.icone || '🍺'} ${p.nom}</div>
        ${alerte ? `<span style="font-size:10px;color:${col};font-weight:700">${alerte}</span>` : ''}
      </div>
      <div style="display:flex;gap:12px;font-size:11px;color:var(--mt);margin-bottom:5px">
        <span>Stock : <strong style="color:${col}">${rest}</strong></span>
        <span>Vendues : <strong style="color:var(--tx)">${vendu}</strong></span>
        <span>CA : <strong style="color:var(--ac)">${fmt(caRealise)} F</strong></span>
      </div>
      <div style="height:3px;background:var(--bd);border-radius:2px">
        <div style="height:100%;width:${pct}%;background:${col};border-radius:2px;transition:width .4s"></div>
      </div>
    </div>`;
  });
  return html;
}

/**
 * CUISINE INVENTORY — Afficher vue stock cuisine dans les stats cuisine
 */
function buildCuisineStockSection() {
  const prodsCuis = ARTICLES.filter(p => getProdTypeService(p) === 'cuisine');
  if (!prodsCuis.length) return '';
  let html = `<div class="sec-lbl" style="margin-top:14px">🍽️ Inventaire Cuisine</div>`;
  prodsCuis.forEach(p => {
    const s = stockCache[p.stock_nom || p.nom];
    if (!s) return;
    const rest = s.quantite || 0;
    const init = s.quantite_initiale || rest;
    const vendu = s.vendu_systeme || 0;
    const pv = s.prix_vente || p.prix || 0;
    const caRealise = vendu * pv;
    const pct = init > 0 ? Math.round(rest / init * 100) : 0;
    const col = rest <= 0 ? 'var(--dg)' : rest <= (s.seuil_alerte || 3) ? 'var(--wn)' : 'var(--gn)';
    const alerte = rest <= 0 ? '❌ Rupture' : rest <= (s.seuil_alerte || 3) ? '⚠️ Stock faible' : '';
    const unite = p.unite || s.unite || 'unité';
    html += `<div style="background:var(--s1);border:1px solid ${rest<=0?'rgba(255,94,94,.4)':rest<=(s.seuil_alerte||3)?'rgba(255,180,68,.3)':'var(--bd)'};border-radius:var(--rs);padding:10px 12px;margin-bottom:7px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
        <div style="font-size:13px;font-weight:600">${p.icone || '🍽️'} ${p.nom}</div>
        ${alerte ? `<span style="font-size:10px;color:${col};font-weight:700">${alerte}</span>` : ''}
      </div>
      <div style="display:flex;gap:12px;font-size:11px;color:var(--mt);flex-wrap:wrap;margin-bottom:5px">
        <span>Stock : <strong style="color:${col}">${rest} ${unite}${rest>1?'s':''}</strong></span>
        <span>Vendues : <strong style="color:var(--tx)">${vendu}</strong></span>
        <span>CA : <strong style="color:var(--ac)">${fmt(caRealise)} F</strong></span>
      </div>
      <div style="height:3px;background:var(--bd);border-radius:2px">
        <div style="height:100%;width:${pct}%;background:${col};border-radius:2px;transition:width .4s"></div>
      </div>
    </div>`;
  });
  return html;
}

// ── Injecter le stock dans les vues existantes ────────────────────────

// Patch loadBarHist pour ajouter la section inventaire bar
const _origLoadBarHist = loadBarHist;
loadBarHist = async function() {
  await _origLoadBarHist();
  // BAR INVENTORY — Ajouter inventaire bar après stats
  await loadStockCache();
  const histEl = document.getElementById('barview-hist');
  if (histEl) {
    const existing = histEl.querySelector('#bar-stock-section');
    if (existing) existing.remove();
    const stockHTML = buildBarStockSection();
    if (stockHTML) {
      const div = document.createElement('div');
      div.id = 'bar-stock-section';
      div.innerHTML = stockHTML;
      histEl.appendChild(div);
    }
  }
};

// ── REALTIME INVENTORY — Canal stock temps réel ───────────────────────
function startStockRealtime() {
  if (!ETAB) return;
  db.channel('stock-rt-pers-' + ETAB.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'stock', filter: `etab_id=eq.${ETAB.id}` },
      () => {
        _debounce('stock-pers', async () => {
          await loadStockCache();
          // Rafraîchir l'affichage des articles si step 2
          if (curStep === 2) renderStep(2);
        }, 350);
      })
    .subscribe();
}

// ── HISTORIQUE PERSISTANT — Alertes stock ────────────────────────────
// HISTORIQUE PERSISTANT — déjà géré par decrementStock existant
// Les alertes sont sauvegardées dans la table 'alertes' de Supabase

// ═══════════════════════════════════════════════════════════════════════
// BAROS QR FIX — Génération QR employé robuste
// EMPLOYEE QR GENERATION · QR ERROR HANDLING · MOBILE QR SUPPORT
// ═══════════════════════════════════════════════════════════════════════

/**
 * BAROS QR FIX — Génère un QR code contenant les données employé complètes
 * Format JSON : { employee_id, nom, role, etab_id, pin }
 * Compatible Android, PWA, Chrome mobile
 * Utilise qrcode-generator (déjà chargé dans le gestionnaire)
 * Fallback sur canvas natif si bibliothèque absente
 */
function genererQREmploye(emp) {
  return new Promise(resolve => {
    try {
      // EMPLOYEE QR GENERATION — Vérifications préalables obligatoires
      if (!emp || !emp.id) {
        console.warn('[BarOS QR] ID employé manquant');
        resolve(null);
        return;
      }
      if (!emp.nom || !emp.role || !emp.etab_id) {
        console.warn('[BarOS QR] Données employé incomplètes');
        resolve(null);
        return;
      }

      // Format JSON attendu — contient toutes les infos nécessaires au pointage
      const qrData = JSON.stringify({
        employee_id: emp.id,
        nom: emp.nom,
        role: emp.role,
        etab_id: emp.etab_id,
        pin: emp.pin || null
      });

      const size = 400;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');

      // QR ERROR HANDLING — Essayer qrcode-generator en premier
      if (typeof qrcode !== 'undefined') {
        try {
          const qr = qrcode(0, 'H'); // Niveau H = correction max
          qr.addData(qrData);
          qr.make();
          const count = qr.getModuleCount();
          const cell = size / count;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, size, size);
          ctx.fillStyle = '#000000';
          for (let row = 0; row < count; row++) {
            for (let col = 0; col < count; col++) {
              if (qr.isDark(row, col)) {
                ctx.fillRect(
                  Math.floor(col * cell), Math.floor(row * cell),
                  Math.ceil(cell), Math.ceil(cell)
                );
              }
            }
          }
          resolve(canvas.toDataURL('image/png'));
          return;
        } catch(e) {
          console.warn('[BarOS QR] qrcode-generator échoué, fallback:', e);
        }
      }

      // MOBILE QR SUPPORT — Fallback : QRious ou autre lib si disponible
      if (typeof QRious !== 'undefined') {
        const qr = new QRious({ element: canvas, value: qrData, size: size, level: 'H' });
        resolve(canvas.toDataURL('image/png'));
        return;
      }

      // Fallback ultime : QR basique via canvas (texte centré)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('QR non disponible', size/2, size/2 - 10);
      ctx.font = '12px monospace';
      ctx.fillText('ID: ' + emp.id.slice(0, 16), size/2, size/2 + 10);
      ctx.fillText(emp.nom, size/2, size/2 + 28);
      resolve(canvas.toDataURL('image/png'));
    } catch(e) {
      console.error('[BarOS QR] Erreur génération:', e);
      resolve(null);
    }
  });
}

/**
 * BAROS QR FIX — Télécharger le QR code d'un employé
 */
function downloadQREmp(empId, empNom, qrSrc) {
  const a = document.createElement('a');
  a.href = qrSrc;
  a.download = 'QR_' + (empNom || empId).replace(/\s+/g, '_') + '.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast('📥 QR téléchargé !', 'var(--gn)');
}

/**
 * BAROS QR FIX — Imprimer le badge employé
 * Ouvre une fenêtre d'impression avec le badge formaté
 */
function imprimerBadgeEmp(emp, qrSrc) {
  const win = window.open('', '_blank', 'width=400,height=600');
  if (!win) { toast('⚠️ Popup bloquée — autorisez les popups', 'var(--wn)'); return; }
  win.document.write(`<!DOCTYPE html><html><head><title>Badge ${emp.nom}</title>
  <style>
    body{margin:0;background:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .badge{width:280px;border:2px solid #7c6cff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.15)}
    .badge-head{background:linear-gradient(135deg,#0a0a0f,#1a1a26);padding:16px;text-align:center}
    .badge-logo{color:#c8f55a;font-size:20px;font-weight:900;letter-spacing:-1px}
    .badge-etab{color:rgba(255,255,255,.5);font-size:10px;margin-top:2px}
    .badge-body{padding:16px;text-align:center;background:#fff}
    .badge-nom{font-size:18px;font-weight:800;color:#0a0a0f;margin-bottom:4px}
    .badge-role{font-size:12px;color:#7c6cff;font-weight:600;margin-bottom:12px}
    .badge-qr img{width:160px;height:160px;border:2px solid #eee;border-radius:8px}
    .badge-foot{background:#f5f5f5;padding:8px;text-align:center;font-size:9px;color:#888}
    @media print{body{min-height:auto}.badge{box-shadow:none}}
  </style></head><body>
  <div class="badge">
    <div class="badge-head">
      <div class="badge-logo">BarOS</div>
      <div class="badge-etab">${(window.ETAB && window.ETAB.nom) || 'Établissement'}</div>
    </div>
    <div class="badge-body">
      <div class="badge-nom">${emp.nom}</div>
      <div class="badge-role">${emp.role}</div>
      <div class="badge-qr"><img src="${qrSrc}" alt="QR Badge"></div>
    </div>
    <div class="badge-foot">© 2025 Christophe OLOCK BELANG · BarOS</div>
  </div>
  <script>window.onload=function(){window.print();}<\/script>
  

</body></html>`);
  win.document.close();
}


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
  // BUS CENTRAL
  // ─────────────────────────────────────────────────────────────
  const _subscribers = {};     // eventType → [ {id, callback} ]
  const _eventQueue  = [];     // file hors-ligne
  const _seenIds     = new Set(); // déduplication
  let   _supaChannel = null;   // canal Realtime unique
  let   _db          = null;   // référence à window.db
  let   _etabId      = null;   // référence à ETAB.id
  let   _sourceApp   = 'unknown';
  let   _initialized = false;
  let   _subIdCtr    = 0;

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
  const NotifCenter = {
    _store: [], // { event, read: bool, ack: bool }

    push(event) {
      this._store.push({ event, read: false, ack: false, receivedAt: Date.now() });
      // Limite mémoire : garder les 200 dernières
      if (this._store.length > 200) this._store.shift();
    },

    markRead(eventId) {
      const n = this._store.find(n => n.event?.id === eventId);
      if (n) n.read = true;
    },

    markAcknowledged(eventId) {
      const n = this._store.find(n => n.event?.id === eventId);
      if (n) { n.read = true; n.ack = true; }
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


// ── Activation du bus après le boot ─────────────────────────────
// On attend que ETAB et db soient disponibles (après loadEtab)
// sans modifier startApp() qui est critique
(function _busActivator() {
  let _busReady = false;

  function _tryInitBus() {
    if (_busReady) return;
    if (typeof ETAB === 'undefined' || !ETAB || typeof db === 'undefined') return;
    _busReady = true;

    BarOSEventBus.init({
      db:        db,
      etabId:    ETAB.id,
      sourceApp: 'personnel',
    });

    // Installer les hooks additifs (après que toutes les fn soient définies)
    BarOSEventBus.installHooks();

    console.log('[BarOS] Event Bus actif — personnel');
  }

  // Polling léger jusqu'à ce que ETAB soit prêt
  const _iv = setInterval(() => {
    if (typeof ETAB !== 'undefined' && ETAB) {
      clearInterval(_iv);
      _tryInitBus();
    }
  }, 500);

  // Sécurité : abandon après 60s
  setTimeout(() => clearInterval(_iv), 60000);
})();

// ===== BOOT =====
// Filet global : si loadLogin() plante (ex: content:// bloque localStorage), forcer le formulaire
(async function boot(){
  try{
    await loadLogin();
  }catch(e){
    console.warn('[BarOS] loadLogin() a echoue :', e);
    _showEmailForm('Connexion requise');
  }
})();
