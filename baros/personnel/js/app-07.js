// ══════════════════════════════════════════════════════════════
// 1. MAPPING RÔLES → CLÉS INTERNES
// ══════════════════════════════════════════════════════════════
// [v3 — FIXES COHÉRENCE]
// Fix #1 : Manager → 'chef' (supervision) au lieu de 'barman'
// Fix #2 : Technicien de surface → 'surface' (nouvelle clé)
// Fix #3 : Caissier(e) → 'chef' (fallback superviseur)
const ROLE_MAP={
  // Formes courtes
  'Serveuse':'serveuse','Serveur':'serveuse','Hôtesse':'serveuse',
  // Libellé exact du dropdown gestionnaire (Serveur/Serveuse)
  'Serveur/Serveuse':'serveuse',
  'Barman':'barman','Barmaid':'barman',
  'Manager':'chef',                                                   // Fix #1
  // Formes courtes cuisine
  'Cuisinier':'cuisine','Cuisinière':'cuisine','Cuisine':'cuisine','Cuistot':'cuisine',
  // Libellé exact du dropdown gestionnaire (Cuisinier(e))
  "Cuisinier(e)":'cuisine',
  'Vigile':'vigile','Sécurité':'vigile','Agent de sécurité':'vigile','Agent':'vigile',
  "Chef d'équipe":'chef','Chef':'chef','Superviseur':'chef','Responsable':'chef',
  'Directeur':'directeur','Directrice':'directeur','Direction':'directeur','PDG':'directeur','DG':'directeur',
  'Caissier':'chef','Caissière':'chef',"Caissier(e)":'chef',         // Fix #3
  'Technicien de surface':'surface','Technicien':'surface','Nettoyage':'surface', // Fix #2
};

// Fix #7 : fallback visible si rôle inconnu (au lieu de silencieusement 'serveuse')
function getRoleKey(){
  const key=ROLE_MAP[CU?.role];
  if(!key){
    console.warn('[BarOS] Rôle inconnu :',CU?.role,'— interface minimale appliquée');
    setTimeout(()=>toast('⚠️ Rôle "'+CU.role+'" non configuré — contactez le Manager','var(--wn)'),800);
    return 'surface'; // fallback minimal : onglet Alertes uniquement
  }
  return key;
}

// ══════════════════════════════════════════════════════════════
// 2. CONFIGURATION DES RÔLES
// ══════════════════════════════════════════════════════════════
const ROLE_CONFIG={
  serveuse:{
    color:'#7c6cff',
    tabs:[
      {id:'commande',  ic:'🧾',lbl:'Commander'},
      {id:'historique',ic:'📊',lbl:'Mes ventes'},
      // Fix #6 : Badges retiré de la nav principale (non opérationnel en service)
      {id:'appels',    ic:'🔔',lbl:'Appels'},
    ],
    onStart:()=>{/* canaux existants suffisent */}
  },
  barman:{
    color:'#ffb444',
    tabs:[
      {id:'barman',    ic:'🍺',lbl:'Bar'},
      {id:'historique',ic:'📊',lbl:'Stats'},
      {id:'appels',    ic:'🔔',lbl:'Appels'},
    ],
    onStart:()=>{/* canaux existants suffisent */}
  },
  cuisine:{
    color:'#f97316',
    tabs:[
      {id:'cuisine',   ic:'👨‍🍳',lbl:'Cuisine'},
    ],
    onStart:startRealtimeCuisine
  },
  vigile:{
    color:'#5ab4ff',
    tabs:[
      {id:'securite',   ic:'🛡️',lbl:'Surveillance'},
      {id:'scans',      ic:'📡',lbl:'Scans'},
      {id:'alertes-vig',ic:'⚠️',lbl:'Alertes'},
    ],
    onStart:startVigileModule
  },
  chef:{
    color:'#4ade80',
    tabs:[
      {id:'equipe',    ic:'👥',lbl:'Équipe'},
      {id:'cmd-all',   ic:'📊',lbl:'Commandes'},
      {id:'appels',    ic:'🔔',lbl:'Appels'},
    ],
    onStart:startChefModule
  },
  directeur:{
    color:'#c8f55a',
    tabs:[
      {id:'direction', ic:'📈',lbl:'Dashboard'},
      {id:'equipe',    ic:'👥',lbl:'Équipe'},
      {id:'cmd-all',   ic:'📦',lbl:'Ventes'},
      {id:'appels',    ic:'🔔',lbl:'Appels'},
    ],
    onStart:startDirecteurModule
  },
  // Fix #2 : Technicien de surface — interface minimale (alertes + notifications)
  surface:{
    color:'#a78bfa',
    tabs:[
      {id:'appels',    ic:'🔔',lbl:'Alertes'},
    ],
    onStart:()=>{ toast('👋 Bonjour '+CU.nom+' — Bonne journée !','var(--ac2)'); }
  },
};

// ══════════════════════════════════════════════════════════════
// 3. MODULE CUISINE
// ══════════════════════════════════════════════════════════════
let _curCuisTab='att';
let _cuisTimer=null;

function showCuisTab(tab){
  _curCuisTab=tab;
  ['att','pret','hist'].forEach(t=>{
    document.getElementById('cuisview-'+t)?.classList.toggle('hide',t!==tab);
    const btn=document.getElementById('ctab-'+t);
    if(btn){
      btn.style.color=t===tab?'var(--ac)':'var(--mt)';
      btn.style.borderBottom=t===tab?'2px solid var(--ac)':'2px solid transparent';
    }
  });
  if(tab==='att'||tab==='pret') loadCuisine();
  else loadHistCuisine();
}

async function loadCuisine(){
  clearTimeout(_cuisTimer);
  const isPret=_curCuisTab==='pret';
  const statuts=isPret?['Livré']:['Nouveau','En prépa'];
  const {data:cmds}=await db.from('commandes')
    .select('*').eq('etab_id',ETAB.id)
    .in('statut',statuts).eq('date_cmd',today())
    .order('created_at',{ascending:true});
  const list=cmds||[];

  const badge=document.getElementById('cuis-badge-att');
  if(badge) badge.textContent=(!isPret&&list.length>0)?list.length:'';

  const containerId=isPret?'cuisine-pret-list':'cuisine-list';
  const el=document.getElementById(containerId);
  if(!el) return;

  if(!list.length){
    el.innerHTML=`<div class="empty" style="padding:40px 20px">${isPret?'✅ Aucun plat terminé':'✅ Aucune commande en cuisine'}</div>`;
    if(!isPret) _cuisTimer=setTimeout(loadCuisine,20000);
    return;
  }

  el.innerHTML=list.map(c=>{
    const now=Date.now();
    const since=Math.round((now-new Date(c.created_at).getTime())/60000);
    const isNouv=c.statut==='Nouveau';
    const isPrep=c.statut==='En prépa';
    const urgency=since>15?'var(--dg)':since>8?'var(--wn)':'var(--mt)';
    return `
    <div class="cuisine-card ${isNouv?'nouveau':isPrep?'en-prepa':''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div>
          <div style="font-size:16px;font-weight:800">${c.table_nom}</div>
          <div style="font-size:11px;color:var(--mt);margin-top:2px">${c.employe_nom||'?'} · ${c.heure||'—'}</div>
        </div>
        <div style="text-align:right">
          <span class="cuisine-badge" style="color:${isNouv?'var(--inf)':isPrep?'var(--wn)':'var(--gn)'}">${c.statut}</span>
          <div style="font-size:11px;font-weight:700;color:${urgency};margin-top:4px">⏱ ${since} min</div>
        </div>
      </div>
      <div style="font-size:15px;line-height:2;margin-bottom:12px">
        ${(c.articles_cuisine||c.articles||'').split(',').map(a=>a.trim()?`🔸 ${a.trim()}`:'').filter(Boolean).join('<br>')}
      </div>
      <div style="display:flex;gap:7px">
        ${isNouv?`<button class="bar-btn bar-prep" style="flex:1;font-size:13px" onclick="updCuisine('${c.id}','En prépa')">🔥 En cuisine</button>`:''}
        ${isPrep?`<button class="bar-btn bar-done" style="flex:1;font-size:13px" onclick="updCuisine('${c.id}','Livré')">✅ Prêt !</button>`:''}
        <!-- Fix #5 : Annuler remplacé par Signaler — l'annulation est une décision Manager -->
        <button class="bar-btn bar-reject" style="font-size:12px;padding:8px 12px" title="Signaler un problème au Manager" onclick="signalerProblemeCuisine('${c.id}')">⚠️</button>
      </div>
    </div>`;
  }).join('');

  if(!isPret) _cuisTimer=setTimeout(loadCuisine,20000);
}

// Fix #5 : signal passif vers la table alertes — n'annule pas la commande
async function signalerProblemeCuisine(cmdId){
  if(!confirm('Signaler un problème sur cette commande au Manager ?')) return;
  try{
    await db.from('alertes').insert({
      etab_id:ETAB.id,
      type:'cuisine',
      message:`⚠️ Problème signalé sur commande #${cmdId} par ${CU.nom}`,
      cmd_id:cmdId,
      created_at:new Date().toISOString()
    });
    toast('⚠️ Problème signalé au Manager','var(--wn)');
  }catch(e){
    toast('❌ Échec signal : '+e.message,'var(--dg)');
  }
}

async function updCuisine(id,statut){
  // [FIX] Filtre etab_id — interdit la modification de commandes étrangères
  await db.from('commandes').update({statut,updated_at:new Date().toISOString()}).eq('id',id).eq('etab_id',ETAB.id);
  const m={'En prépa':['🔥 En préparation !','var(--wn)'],'Livré':['✅ Plat prêt !','var(--gn)'],'Annulé':['✕ Annulé','var(--dg)']};
  const [msg,col]=m[statut]||['OK','var(--mt)'];
  toast(msg,col);
  loadCuisine();
}

async function loadHistCuisine(){
  const {data:cmds}=await db.from('commandes')
    .select('*').eq('etab_id',ETAB.id).eq('date_cmd',today())
    .order('created_at',{ascending:false});
  const all=cmds||[];
  const livrees=all.filter(c=>c.statut==='Livré');
  const annulees=all.filter(c=>c.statut==='Annulé');
  const enCours=all.filter(c=>['Nouveau','En prépa'].includes(c.statut));
  const tempsTotal=livrees.reduce((a,c)=>{
    const d=(new Date(c.updated_at||c.created_at)-new Date(c.created_at))/60000;
    return a+Math.max(0,d);
  },0);
  const tempsMoyen=livrees.length?Math.round(tempsTotal/livrees.length):0;

  document.getElementById('cuis-stats').innerHTML=`
    <div class="stat-card"><div class="stat-v" style="color:var(--gn)">${livrees.length}</div><div class="stat-l">✅ Plats servis</div></div>
    <div class="stat-card"><div class="stat-v" style="color:var(--wn)">${enCours.length}</div><div class="stat-l">🔥 En cours</div></div>
    <div class="stat-card"><div class="stat-v" style="color:var(--dg)">${annulees.length}</div><div class="stat-l">✕ Annulés</div></div>
    <div class="stat-card"><div class="stat-v" style="color:var(--inf)">${tempsMoyen} min</div><div class="stat-l">⏱ Temps moyen</div></div>`;

  document.getElementById('cuis-hist-list').innerHTML=all.length
    ?all.map(c=>`
      <div class="hist-item">
        <div class="hist-top">
          <div class="hist-tbl">${c.table_nom}</div>
          <div class="hist-time">${c.heure||''}</div>
        </div>
        <div class="hist-items">${c.articles||''}</div>
        <div class="hist-bot">
          <div style="font-size:11px;color:var(--mt)">${c.employe_nom||'?'}</div>
          <span class="pill ${c.statut==='Livré'?'p-d':c.statut==='Nouveau'?'p-n':c.statut==='En prépa'?'p-p':'p-c'}">${c.statut}</span>
        </div>
      </div>`).join('')
    :'<div class="empty">Aucune commande aujourd\'hui</div>';
}


// Patch loadHistCuisine pour ajouter inventaire cuisine
const _origLoadHistCuisine = loadHistCuisine;
loadHistCuisine = async function() {
  await _origLoadHistCuisine();
  // CUISINE INVENTORY — Ajouter inventaire cuisine après stats
  await loadStockCache();
  const histEl = document.getElementById('cuisview-hist');
  if (histEl) {
    const existing = histEl.querySelector('#cuis-stock-section');
    if (existing) existing.remove();
    const stockHTML = buildCuisineStockSection();
    if (stockHTML) {
      const div = document.createElement('div');
      div.id = 'cuis-stock-section';
      div.innerHTML = stockHTML;
      histEl.appendChild(div);
    }
  }
};

function startRealtimeCuisine(){
  db.channel('cuisine-rt-'+ETAB.id)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'commandes',filter:`etab_id=eq.${ETAB.id}`},
      payload=>{
        const nr=payload.new||{};
        if(nr.statut==='Nouveau'){playBeepBarman();toast('👨‍🍳 Nouvelle commande — '+nr.table_nom,'var(--wn)');}
        const cv=document.querySelector('#view-cuisine:not(.hide)');
        if(cv) loadCuisine();
      })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'commandes',filter:`etab_id=eq.${ETAB.id}`},
      ()=>{const cv=document.querySelector('#view-cuisine:not(.hide)');if(cv) loadCuisine();})
    .subscribe();
}

// ══════════════════════════════════════════════════════════════
// 4. MODULE VIGILE
// ══════════════════════════════════════════════════════════════
let vigScanFilter='all';
let _vigTimer=null;

function setVigFilter(f,el){
  vigScanFilter=f;
  document.querySelectorAll('.vig-filter-bar .mf-btn').forEach(b=>b.classList.remove('on'));
  el.classList.add('on');
  loadScans(f);
}

async function loadSecurite(){
  clearTimeout(_vigTimer);
  const total=EMPS.length;

  // Tentative de chargement des pointages (table optionnelle)
  let pointages=[];
  try{
    const {data,error}=await db.from('pointages')
      .select('*').eq('etab_id',ETAB.id).eq('date_p',today());
    if(!error) pointages=data||[];
  }catch(e){}

  const presentsIds=[...new Set(pointages.filter(p=>p.type==='entree').map(p=>p.employe_id))];
  const sortisIds=[...new Set(pointages.filter(p=>p.type==='sortie').map(p=>p.employe_id))];
  const retards=pointages.filter(p=>p.statut==='retard');
  const suspects=pointages.filter(p=>p.is_valid===false||p.statut==='suspect');

  document.getElementById('vig-stats-grid').innerHTML=`
    <div class="vig-stat"><div class="vig-stat-v" style="color:var(--gn)">${presentsIds.length}</div><div class="vig-stat-l">✅ Présents</div></div>
    <div class="vig-stat"><div class="vig-stat-v" style="color:var(--mt)">${Math.max(0,total-presentsIds.length)}</div><div class="vig-stat-l">❌ Absents</div></div>
    <div class="vig-stat"><div class="vig-stat-v" style="color:var(--wn)">${retards.length}</div><div class="vig-stat-l">⏰ Retards</div></div>
    <div class="vig-stat"><div class="vig-stat-v" style="color:var(--dg)">${suspects.length}</div><div class="vig-stat-l">⚠️ Incidents</div></div>`;

  const el=document.getElementById('vig-emp-list');
  if(!el) return;

  if(!EMPS.length){
    el.innerHTML='<div class="empty">Aucun employé configuré</div>';
    _vigTimer=setTimeout(loadSecurite,30000);
    return;
  }

  el.innerHTML=EMPS.map((e,i)=>{
    const col=COLORS[i%COLORS.length];
    const empP=pointages.filter(p=>p.employe_id===e.id);
    const entree=empP.filter(p=>p.type==='entree').sort((a,b)=>a.heure>b.heure?1:-1)[0];
    const sortie=empP.filter(p=>p.type==='sortie').sort((a,b)=>a.heure>b.heure?-1:1)[0];
    const isPresent=presentsIds.includes(e.id);
    const isSorti=sortisIds.includes(e.id);
    const pRec=empP[0];
    const statut=!isPresent?'absent':pRec?.is_valid===false||pRec?.statut==='suspect'?'suspect':pRec?.statut==='retard'?'retard':'ponctuel';
    const statusMap={
      ponctuel:{cls:'ss-ok',lbl:'✓ Ponctuel'},
      retard:{cls:'ss-late',lbl:`⏰ Retard ${pRec?.retard_min||'?'} min`},
      absent:{cls:'ss-absent',lbl:'❌ Absent'},
      suspect:{cls:'ss-suspect',lbl:'⚠️ Suspect'},
    };
    const sc=statusMap[statut]||statusMap.absent;
    return `
    <div class="vig-emp-row ${statut==='absent'?'absent':statut==='suspect'?'suspect':statut==='retard'?'retard':''}">
      <div class="scan-av" style="background:${col}22;color:${col}">${ini(e.nom)}</div>
      <div style="flex:1;min-width:0">
        <div class="scan-nom">${e.nom}</div>
        <div class="scan-role">${e.role}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:11px;margin-bottom:3px">
          ${entree?`<span style="color:var(--gn)">→ ${entree.heure||'—'}</span>`:'<span style="color:var(--mt)">→ —</span>'}
          ${sortie?` <span style="color:var(--dg);margin-left:4px">← ${sortie.heure||'—'}</span>`:''}
        </div>
        <span class="scan-status ${sc.cls}">${sc.lbl}</span>
      </div>
    </div>`;
  }).join('');

  _vigTimer=setTimeout(loadSecurite,30000);
}

async function loadScans(filter='all'){
  vigScanFilter=filter;
  const el=document.getElementById('scans-list');
  if(!el) return;

  let scans=[];
  try{
    let q=db.from('pointages').select('*').eq('etab_id',ETAB.id).eq('date_p',today());
    if(filter==='entree') q=q.eq('type','entree');
    else if(filter==='sortie') q=q.eq('type','sortie');
    else if(filter==='retard') q=q.eq('statut','retard');
    else if(filter==='suspect') q=q.or('is_valid.eq.false,statut.eq.suspect');
    q=q.order('heure',{ascending:false});
    const {data,error}=await q;
    if(!error) scans=data||[];
  }catch(e){}

  if(!scans.length){
    el.innerHTML=`<div class="empty" style="padding:50px 20px;font-size:14px">${
      filter==='suspect'?'✅ Aucun incident détecté':
      filter==='retard'?'✅ Aucun retard':
      '📡 Aucun scan enregistré'
    }</div>`;
    return;
  }

  el.innerHTML=scans.map(s=>{
    const emp=EMPS.find(e=>e.id===s.employe_id);
    const col=emp?COLORS[EMPS.indexOf(emp)%COLORS.length]:'#7c6cff';
    const isEntree=s.type==='entree';
    const isInvalid=s.is_valid===false||s.statut==='suspect';
    const isRetard=s.statut==='retard';
    const stCls=isInvalid?'ss-suspect':isRetard?'ss-late':'ss-ok';
    const stLbl=isInvalid?'⚠️ Suspect':isRetard?`⏰ +${s.retard_min||'?'} min`:'✓ OK';
    return `
    <div class="scan-row">
      <div class="scan-type-ic" style="background:${isEntree?'rgba(74,222,128,.12)':'rgba(255,94,94,.1)'}">
        <span style="color:${isEntree?'var(--gn)':'var(--dg)'}">${isEntree?'→':'←'}</span>
      </div>
      <div class="scan-av" style="background:${col}22;color:${col}">${ini(s.employe_nom||'??')}</div>
      <div class="scan-info">
        <div class="scan-nom">${s.employe_nom||'Inconnu'}</div>
        <div class="scan-role">${s.employe_role||emp?.role||'—'} · ${isEntree?'Entrée':'Sortie'}</div>
        <span class="scan-status ${stCls}">${stLbl}</span>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:15px;font-weight:800">${s.heure||'—'}</div>
        <div style="font-size:10px;color:var(--mt)">${s.date_p||today()}</div>
      </div>
    </div>`;
  }).join('');
}

async function loadAlertesVig(){
  const el=document.getElementById('alertes-vig-list');
  if(!el) return;
  let alertes=[];
  try{
    const {data}=await db.from('alertes')
      .select('*').eq('etab_id',ETAB.id).eq('date_alerte',today())
      .order('created_at',{ascending:false}).limit(60);
    alertes=data||[];
  }catch(e){}

  if(!alertes.length){
    el.innerHTML='<div class="empty" style="padding:50px 20px;font-size:14px">✅ Aucune alerte aujourd\'hui</div>';
    return;
  }
  el.innerHTML=alertes.map(a=>`
    <div class="alert-vig ${a.type==='critical'?'critical':a.type==='warning'?'warning':'info'}">
      <div style="display:flex;gap:10px;align-items:flex-start">
        <span style="font-size:22px;flex-shrink:0">${a.icone||'⚠️'}</span>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:700">${a.titre||''}</div>
          <div style="font-size:11px;color:var(--mt);margin-top:3px;line-height:1.5">${a.message||''}</div>
          <div style="font-size:10px;color:var(--mt);margin-top:5px">🕐 ${a.heure||''} · ${a.date_alerte||''}</div>
        </div>
      </div>
    </div>`).join('');
}

function startVigileModule(){
  loadSecurite();
  db.channel('vigile-points-'+ETAB.id)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'pointages',filter:`etab_id=eq.${ETAB.id}`},
      payload=>{
        const s=payload.new||{};
        const isInvalid=s.is_valid===false||s.statut==='suspect';
        if(isInvalid){playBeepBarman();toast('⚠️ Scan suspect — '+(s.employe_nom||'Inconnu'),'var(--dg)');}
        else toast(`${s.type==='entree'?'→':'←'} Scan — ${s.employe_nom||'?'}`,s.type==='entree'?'var(--gn)':'var(--mt)');
        const cv=document.querySelector('#view-securite:not(.hide)');if(cv) loadSecurite();
        const cv2=document.querySelector('#view-scans:not(.hide)');if(cv2) loadScans(vigScanFilter);
      })
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'alertes',filter:`etab_id=eq.${ETAB.id}`},
      payload=>{
        const a=payload.new||{};
        if(a.type==='critical'){playBeepBarman();toast('🚨 '+a.titre,'var(--dg)');}
        else if(a.type==='warning') toast('⚠️ '+a.titre,'var(--wn)');
        const cv=document.querySelector('#view-alertes-vig:not(.hide)');if(cv) loadAlertesVig();
      })
    .subscribe();
}

// ══════════════════════════════════════════════════════════════
// 5. EXPORT PDF VIGILE
// ══════════════════════════════════════════════════════════════
async function exportPDF_vigile(period='jour'){
  if(!window.jspdf?.jsPDF){toast('jsPDF non disponible','var(--dg)');return;}
  toast('📄 Génération PDF…','var(--inf)');

  // Calcul période
  const dateDebut=new Date();
  if(period==='semaine') dateDebut.setDate(dateDebut.getDate()-7);
  else if(period==='mois') dateDebut.setDate(dateDebut.getDate()-30);
  const dateDebutStr=period==='jour'?today():dateDebut.toISOString().slice(0,10);
  const periodLabel={'jour':'Journalier','semaine':'Hebdomadaire','mois':'Mensuel'}[period];

  // Chargement données
  let pointages=[];
  try{
    let q=db.from('pointages').select('*').eq('etab_id',ETAB.id);
    if(period==='jour') q=q.eq('date_p',today());
    else q=q.gte('date_p',dateDebutStr);
    const {data}=await q.order('date_p',{ascending:true}).order('heure',{ascending:true});
    pointages=data||[];
  }catch(e){}

  let alertes=[];
  try{
    let q2=db.from('alertes').select('*').eq('etab_id',ETAB.id);
    if(period==='jour') q2=q2.eq('date_alerte',today());
    else q2=q2.gte('date_alerte',dateDebutStr);
    const {data:da}=await q2.order('created_at',{ascending:false}).limit(30);
    alertes=da||[];
  }catch(e){}

  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const W=210,ml=14,mr=14,cw=W-ml-mr;
  let y=0;

  // ── Fond header
  doc.setFillColor(10,10,15);
  doc.rect(0,0,W,38,'F');

  // Logo BarOS
  doc.setTextColor(200,245,90);
  doc.setFontSize(24);doc.setFont('helvetica','bold');
  doc.text('BarOS',ml,20);
  doc.setFontSize(9);doc.setTextColor(160,155,200);
  doc.text('Rapport de Sécurité · '+periodLabel,ml,28);
  doc.text(new Date().toLocaleDateString('fr-FR',{weekday:'long',year:'numeric',month:'long',day:'numeric'}),ml,34);
  doc.setTextColor(120,120,150);
  doc.text((ETAB.nom||'').slice(0,30),W-mr,22,'right');
  doc.text('Vigile : '+CU.nom,W-mr,28,'right');
  doc.text('Période : '+(period==='jour'?today():dateDebutStr+' → '+today()),W-mr,34,'right');

  y=46;

  // ── Ligne déco
  doc.setDrawColor(200,245,90);doc.setLineWidth(.3);
  doc.line(ml,y,W-mr,y);y+=8;

  // ── Stats résumé
  const presentsSet=new Set(pointages.filter(p=>p.type==='entree').map(p=>p.employe_id));
  const nbPresents=presentsSet.size;
  const nbAbsents=Math.max(0,EMPS.length-nbPresents);
  const nbRetards=pointages.filter(p=>p.statut==='retard').length;
  const nbSuspects=pointages.filter(p=>p.is_valid===false||p.statut==='suspect').length;
  const nbScans=pointages.length;

  doc.setFillColor(240,242,248);doc.roundedRect(ml,y,cw,16,2,2,'F');
  doc.setFontSize(8);doc.setFont('helvetica','normal');doc.setTextColor(80,80,100);
  const stats=[
    ['Scans totaux',nbScans],['Présents',nbPresents],['Absents',nbAbsents],
    ['Retards',nbRetards],['Incidents',nbSuspects],['Employés',EMPS.length]
  ];
  stats.forEach(([lbl,val],i)=>{
    const x=ml+5+(i*(cw/6));
    doc.setFont('helvetica','bold');doc.setTextColor(30,30,50);doc.setFontSize(10);
    doc.text(String(val),x,y+7);
    doc.setFont('helvetica','normal');doc.setTextColor(100,100,130);doc.setFontSize(7);
    doc.text(lbl,x,y+12);
  });
  y+=24;

  // ── Tableau des mouvements
  doc.setFontSize(11);doc.setFont('helvetica','bold');doc.setTextColor(20,20,40);
  doc.text('Mouvements enregistrés',ml,y);y+=7;

  const colsDefs=[
    {lbl:'Nom',x:ml,w:42},
    {lbl:'Poste',x:ml+42,w:28},
    {lbl:'Type',x:ml+70,w:18},
    {lbl:'Heure',x:ml+88,w:18},
    {lbl:'Date',x:ml+106,w:22},
    {lbl:'Statut',x:ml+128,w:28},
    {lbl:'Note',x:ml+156,w:cw-(156)},
  ];

  // En-tête tableau
  doc.setFillColor(15,15,25);doc.rect(ml,y,cw,7,'F');
  doc.setTextColor(200,245,90);doc.setFontSize(7.5);doc.setFont('helvetica','bold');
  colsDefs.forEach(c=>doc.text(c.lbl,c.x+1,y+5));
  y+=9;

  doc.setFont('helvetica','normal');doc.setFontSize(7.5);
  let ri=0;
  for(const s of pointages){
    if(y>265){doc.addPage();y=20;}
    const isInv=s.is_valid===false||s.statut==='suspect';
    const isRet=s.statut==='retard';
    if(ri%2===0){doc.setFillColor(248,249,252);doc.rect(ml,y,cw,6,'F');}
    doc.setTextColor(isInv?180:40,isInv?30:40,isInv?30:60);
    doc.text((s.employe_nom||'—').slice(0,20),ml+1,y+4);
    doc.setTextColor(70,70,90);
    doc.text((s.employe_role||'—').slice(0,13),ml+43,y+4);
    doc.setTextColor(s.type==='entree'?20:180,s.type==='entree'?140:30,s.type==='entree'?30:30);
    doc.text(s.type==='entree'?'→ Entrée':'← Sortie',ml+71,y+4);
    doc.setTextColor(40,40,60);
    doc.text(s.heure||'—',ml+89,y+4);
    doc.text(s.date_p||'—',ml+107,y+4);
    doc.setTextColor(isInv?180:isRet?160:50,isInv?30:isRet?120:130,isInv?30:0);
    doc.text(isInv?'⚠ Suspect':isRet?`+${s.retard_min||'?'} min`:'OK',ml+129,y+4);
    doc.setTextColor(90,90,110);
    doc.text((s.qr_data||'').slice(0,14),ml+157,y+4);
    y+=6.5;ri++;
  }

  if(!pointages.length){
    doc.setTextColor(120,120,140);doc.setFontSize(10);
    doc.text('Aucun scan enregistré pour cette période.',ml,y+6);y+=14;
  }

  // ── Section incidents
  const incidents=pointages.filter(p=>p.is_valid===false||p.statut==='suspect');
  if(incidents.length){
    if(y>240){doc.addPage();y=20;}
    y+=6;doc.setLineWidth(.2);doc.setDrawColor(220,50,50);doc.line(ml,y,W-mr,y);y+=7;
    doc.setFontSize(10);doc.setFont('helvetica','bold');doc.setTextColor(180,40,40);
    doc.text(`⚠  Incidents de sécurité (${incidents.length})`,ml,y);y+=7;
    doc.setFont('helvetica','normal');doc.setFontSize(8);
    incidents.forEach(s=>{
      if(y>268){doc.addPage();y=20;}
      doc.setTextColor(100,30,30);
      doc.text(`•  ${(s.employe_nom||'Inconnu').slice(0,25)}  ·  ${s.date_p||''}  ${s.heure||''}  ·  ${s.type}  ·  Code: ${(s.qr_data||'—').slice(0,25)}`,ml+2,y);
      y+=5.5;
    });
  }

  // ── Alertes système
  if(alertes.length){
    if(y>230){doc.addPage();y=20;}
    y+=6;doc.setLineWidth(.2);doc.setDrawColor(200,130,0);doc.line(ml,y,W-mr,y);y+=7;
    doc.setFontSize(10);doc.setFont('helvetica','bold');doc.setTextColor(140,90,0);
    doc.text(`Alertes système (${alertes.length})`,ml,y);y+=7;
    doc.setFont('helvetica','normal');doc.setFontSize(7.5);
    alertes.slice(0,15).forEach(a=>{
      if(y>268){doc.addPage();y=20;}
      doc.setTextColor(a.type==='critical'?160:80, a.type==='critical'?30:70, 20);
      doc.text(`•  [${(a.type||'').toUpperCase()}]  ${(a.titre||'').slice(0,40)}  ·  ${a.heure||''}`,ml+2,y);
      y+=5.5;
    });
  }

  // ── Zone signatures
  const sigY=Math.max(y+18,262);
  if(sigY<=275){
    doc.setDrawColor(180,180,200);doc.setLineWidth(.3);
    doc.line(ml,sigY,ml+55,sigY);doc.line(W-mr-55,sigY,W-mr,sigY);
    doc.setFontSize(7.5);doc.setTextColor(130,130,160);
    doc.text('Signature du Vigile',ml,sigY+5);
    doc.text('Signature du Responsable',W-mr-55,sigY+5);
  }

  // ── Pied de page
  const nbPages=doc.internal.getNumberOfPages();
  for(let i=1;i<=nbPages;i++){
    doc.setPage(i);
    doc.setFontSize(7);doc.setTextColor(150,150,170);
    doc.text(`BarOS © 2025 Christophe OLOCK BELANG  ·  Rapport ${periodLabel}  ·  Page ${i}/${nbPages}`,W/2,290,'center');
  }

  doc.save(`BarOS_Securite_${periodLabel}_${today()}.pdf`);
  toast('📄 PDF exporté !','var(--gn)');
}

// ══════════════════════════════════════════════════════════════
// 6. MODULE CHEF D'ÉQUIPE
// ══════════════════════════════════════════════════════════════
async function loadEquipe(){
  const {data:cmds}=await db.from('commandes')
    .select('employe_id,employe_nom,montant,statut')
    .eq('etab_id',ETAB.id).eq('date_cmd',today()).eq('statut','Livré');
  const all=cmds||[];
  const totalCA=all.reduce((a,c)=>a+c.montant,0);

  // Calcul par employé
  const byEmp={};
  all.forEach(c=>{
    if(!byEmp[c.employe_id]) byEmp[c.employe_id]={nom:c.employe_nom,ca:0,cmds:0};
    byEmp[c.employe_id].ca+=c.montant;
    byEmp[c.employe_id].cmds++;
  });
  const nbActifs=Object.keys(byEmp).length;

  document.getElementById('equipe-stats').innerHTML=`
    <div class="stat-card"><div class="stat-v">${EMPS.length}</div><div class="stat-l">👥 Employés total</div></div>
    <div class="stat-card"><div class="stat-v" style="color:var(--gn)">${nbActifs}</div><div class="stat-l">✅ Actifs ce soir</div></div>
    <div class="stat-card"><div class="stat-v" style="color:var(--ac)">${fmt(totalCA)} F</div><div class="stat-l">💵 CA équipe</div></div>
    <div class="stat-card"><div class="stat-v" style="color:var(--inf)">${all.length}</div><div class="stat-l">📦 Commandes</div></div>`;

  const sorted=EMPS.map((e,i)=>({
    ...e,col:COLORS[i%COLORS.length],
    ...({ca:0,cmds:0,...(byEmp[e.id]||{})})
  })).sort((a,b)=>b.ca-a.ca);

  document.getElementById('equipe-list').innerHTML=sorted.map((e,i)=>`
    <div class="team-card">
      <div class="team-rank">${i+1}</div>
      <div class="team-av" style="background:${e.col}22;color:${e.col}">${ini(e.nom)}</div>
      <div class="team-info">
        <div class="team-nom">${e.nom}</div>
        <div class="team-role" style="display:flex;align-items:center;gap:6px">${e.role}
          ${e.qr_code?`<span style="cursor:pointer;font-size:11px;padding:1px 6px;border-radius:6px;background:rgba(200,245,90,.1);border:1px solid rgba(200,245,90,.2);color:var(--ac)" onclick="voirQREmp('${e.id}')">🏷 QR</span>`:''}
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:15px;font-weight:800;color:var(--ac)">${fmt(e.ca)} F</div>
        <div style="font-size:10px;color:var(--mt);margin-top:2px">${e.cmds} commande${e.cmds!==1?'s':''}</div>
      </div>
    </div>`).join('')||'<div class="empty">Aucune vente enregistrée</div>';
}

async function loadCmdAll(){
  const {data:cmds}=await db.from('commandes')
    .select('*').eq('etab_id',ETAB.id).eq('date_cmd',today())
    .order('created_at',{ascending:false});
  const all=cmds||[];
  const livrees=all.filter(c=>c.statut==='Livré');
  const enCours=all.filter(c=>['Nouveau','En prépa'].includes(c.statut));
  const annulees=all.filter(c=>c.statut==='Annulé');
  const totalCA=livrees.reduce((a,c)=>a+c.montant,0);

  document.getElementById('cmd-all-stats').innerHTML=`
    <div class="stat-card"><div class="stat-v" style="color:var(--ac)">${fmt(totalCA)} F</div><div class="stat-l">💵 CA total</div></div>
    <div class="stat-card"><div class="stat-v" style="color:var(--gn)">${livrees.length}</div><div class="stat-l">✅ Livrées</div></div>
    <div class="stat-card"><div class="stat-v" style="color:var(--wn)">${enCours.length}</div><div class="stat-l">⏳ En cours</div></div>
    <div class="stat-card"><div class="stat-v" style="color:var(--dg)">${annulees.length}</div><div class="stat-l">✕ Annulées</div></div>`;

  document.getElementById('cmd-all-list').innerHTML=all.length
    ?all.map(c=>`
      <div class="hist-item">
        <div class="hist-top">
          <div class="hist-tbl">${c.table_nom} <span style="font-size:10px;font-weight:400;color:var(--mt)">— ${c.employe_nom||'?'}</span></div>
          <div class="hist-time">${c.heure||''}</div>
        </div>
        <div class="hist-items">${c.articles||''}</div>
        <div class="hist-bot">
          <div class="hist-amt">${fmt(c.montant)} F</div>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:11px;color:var(--mt)">${c.paiement||''}</span>
            <span class="pill ${c.statut==='Livré'?'p-d':c.statut==='Nouveau'?'p-n':c.statut==='En prépa'?'p-p':'p-c'}">${c.statut}</span>
          </div>
        </div>
      </div>`).join('')
    :'<div class="empty">Aucune commande aujourd\'hui</div>';
}

function startChefModule(){
  loadEquipe();
  // MODULE MANAGER — Stats appels au démarrage du chef
  if (typeof injectAppelsMgrStats === 'function') injectAppelsMgrStats();
  db.channel('chef-rt-'+ETAB.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'commandes',filter:`etab_id=eq.${ETAB.id}`},
      ()=>{
        const cv1=document.querySelector('#view-equipe:not(.hide)');if(cv1) loadEquipe();
        const cv2=document.querySelector('#view-cmd-all:not(.hide)');if(cv2) loadCmdAll();
      })
    // REALTIME CALLS — Chef voit aussi les mises à jour appels
    .subscribe();
  db.channel('appels-chef-'+ETAB.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'appels',filter:`etab_id=eq.${ETAB.id}`},
      ()=>{
        if(typeof injectAppelsMgrStats==='function') injectAppelsMgrStats();
      })
    .subscribe();
}

// ══════════════════════════════════════════════════════════════
// 7. MODULE DIRECTEUR
// ══════════════════════════════════════════════════════════════
async function loadDirection(){
  const [cmdRes,alertRes]=await Promise.all([
    db.from('commandes').select('*').eq('etab_id',ETAB.id).eq('date_cmd',today()),
    db.from('alertes').select('*').eq('etab_id',ETAB.id).eq('date_alerte',today())
      .order('created_at',{ascending:false}).limit(6),
  ]);
  const cmds=cmdRes.data||[];
  const alertes=alertRes.data||[];
  const livrees=cmds.filter(c=>c.statut==='Livré');
  const enCours=cmds.filter(c=>['Nouveau','En prépa'].includes(c.statut));
  const annulees=cmds.filter(c=>c.statut==='Annulé');
  const totalCA=livrees.reduce((a,c)=>a+c.montant,0);
  const ticketMoyen=livrees.length?Math.round(totalCA/livrees.length):0;
  const tauxAnnulation=cmds.length?Math.round(annulees.length/cmds.length*100):0;

  document.getElementById('dir-kpi').innerHTML=`
    <div class="dir-kpi">
      <div class="dir-kpi-v" style="color:var(--ac)">${fmt(totalCA)} F</div>
      <div class="dir-kpi-l">💵 Chiffre d'affaires</div>
    </div>
    <div class="dir-kpi">
      <div class="dir-kpi-v">${cmds.length}</div>
      <div class="dir-kpi-l">📦 Commandes total</div>
    </div>
    <div class="dir-kpi">
      <div class="dir-kpi-v" style="color:var(--gn)">${livrees.length}</div>
      <div class="dir-kpi-l">✅ Livrées</div>
    </div>
    <div class="dir-kpi">
      <div class="dir-kpi-v" style="color:var(--inf)">${fmt(ticketMoyen)} F</div>
      <div class="dir-kpi-l">📊 Ticket moyen</div>
    </div>
    <div class="dir-kpi">
      <div class="dir-kpi-v" style="color:var(--wn)">${enCours.length}</div>
      <div class="dir-kpi-l">⏳ En cours</div>
    </div>
    <div class="dir-kpi">
      <div class="dir-kpi-v" style="color:${tauxAnnulation>20?'var(--dg)':'var(--mt)'}">${tauxAnnulation}%</div>
      <div class="dir-kpi-l">✕ Taux annulation</div>
    </div>`;

  // Performance équipe (barres)
  const byEmp={};
  livrees.forEach(c=>{
    if(!byEmp[c.employe_id]) byEmp[c.employe_id]={nom:c.employe_nom,ca:0,cmds:0,id:c.employe_id};
    byEmp[c.employe_id].ca+=c.montant;
    byEmp[c.employe_id].cmds++;
  });
  const maxCA=Math.max(...Object.values(byEmp).map(e=>e.ca),1);
  const sorted=Object.values(byEmp).sort((a,b)=>b.ca-a.ca).slice(0,8);

  document.getElementById('dir-team').innerHTML=sorted.length
    ?sorted.map((e,i)=>{
      const emp=EMPS.find(x=>x.id===e.id);
      const col=emp?COLORS[EMPS.indexOf(emp)%COLORS.length]:'#7c6cff';
      const pct=Math.round((e.ca/maxCA)*100);
      return `
      <div class="dir-bar-row">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <div style="display:flex;align-items:center;gap:7px">
            <span style="font-size:11px;color:var(--mt);width:16px;text-align:right">${i+1}</span>
            <div style="width:24px;height:24px;border-radius:50%;background:${col}22;color:${col};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;flex-shrink:0">${ini(e.nom)}</div>
            <span style="font-size:12px;font-weight:600">${e.nom}</span>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <span style="font-size:13px;font-weight:800;color:var(--ac)">${fmt(e.ca)} F</span>
            <span style="font-size:10px;color:var(--mt);margin-left:6px">${e.cmds} cmd${e.cmds!==1?'s':''}</span>
          </div>
        </div>
        <div class="dir-bar-track">
          <div class="dir-bar-fill" style="width:${pct}%;background:${col}"></div>
        </div>
      </div>`;
    }).join('')
    :'<div class="empty" style="padding:20px">Aucune vente enregistrée</div>';

  // Alertes
  document.getElementById('dir-alertes').innerHTML=alertes.length
    ?alertes.map(a=>`
      <div class="alert-vig ${a.type==='critical'?'critical':a.type==='warning'?'warning':'info'}">
        <div style="display:flex;gap:9px;align-items:flex-start">
          <span style="font-size:20px;flex-shrink:0">${a.icone||'⚠️'}</span>
          <div style="flex:1">
            <div style="font-size:12px;font-weight:700">${a.titre}</div>
            <div style="font-size:10px;color:var(--mt);margin-top:3px">${a.message}</div>
            <div style="font-size:10px;color:var(--mt);margin-top:4px">🕐 ${a.heure} · ${a.date_alerte}</div>
          </div>
        </div>
      </div>`).join('')
    :'<div class="empty" style="padding:20px">✅ Aucune alerte</div>';

  // MODULE MANAGER — Injecter stats appels clients dans le dashboard directeur
  // TABLE CALL MANAGEMENT · ADDITION REQUEST
  if (typeof injectAppelsMgrStats === 'function') injectAppelsMgrStats();
}

function startDirecteurModule(){
  loadDirection();
  db.channel('dir-rt-'+ETAB.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'commandes',filter:`etab_id=eq.${ETAB.id}`},
      ()=>{
        const cv1=document.querySelector('#view-direction:not(.hide)');if(cv1) loadDirection();
        const cv2=document.querySelector('#view-equipe:not(.hide)');if(cv2) loadEquipe();
        const cv3=document.querySelector('#view-cmd-all:not(.hide)');if(cv3) loadCmdAll();
        refreshCA();
      })
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'alertes',filter:`etab_id=eq.${ETAB.id}`},
      ()=>{const cv=document.querySelector('#view-direction:not(.hide)');if(cv) loadDirection();})
    .subscribe();
  // REALTIME CALLS — Directeur voit les stats appels en temps réel — MODULE MANAGER
  db.channel('appels-dir-'+ETAB.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'appels',filter:`etab_id=eq.${ETAB.id}`},
      ()=>{
        if(typeof injectAppelsMgrStats==='function') injectAppelsMgrStats();
      })
    .subscribe();
}


// ═══════════════════════════════════════════════════════════════════════
// BAROS QR FIX — Voir / Télécharger / Imprimer le QR d'un employé
// EMPLOYEE QR GENERATION · MOBILE QR SUPPORT
// ═══════════════════════════════════════════════════════════════════════

// Cache temporaire des données employé pour le modal QR
let _qrModalEmp = null;

/**
 * BAROS QR FIX — Afficher le QR d'un employé en plein écran
 * Génère le QR si absent, l'affiche, propose télécharger + imprimer
 */
async function voirQREmp(empId) {
  const emp = EMPS.find(e => e.id === empId);
  if (!emp) { toast('Employé introuvable', 'var(--dg)'); return; }
  _qrModalEmp = emp;

  // BAROS QR FIX — Supprimer modal existant
  const existing = document.getElementById('qr-emp-modal');
  if (existing) existing.remove();

  // Créer le modal
  const modal = document.createElement('div');
  modal.id = 'qr-emp-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:8000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:20px';
  modal.innerHTML = `
    <div style="font-size:22px;font-weight:800;color:#fff">${emp.nom}</div>
    <div style="font-size:12px;color:rgba(255,255,255,.5)">${emp.role}</div>
    <div id="qr-emp-img-box" style="background:#fff;padding:14px;border-radius:16px;box-shadow:0 0 40px rgba(200,245,90,.2)">
      <div style="width:200px;height:200px;display:flex;align-items:center;justify-content:center;color:#333;font-size:12px">⏳ Génération...</div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
      <button onclick="downloadQREmpModal()" style="padding:10px 18px;border-radius:10px;background:rgba(200,245,90,.15);border:1px solid rgba(200,245,90,.3);color:var(--ac);font-size:13px;font-weight:700;cursor:pointer">📥 Télécharger QR</button>
      <button onclick="imprimerBadgeEmpModal()" style="padding:10px 18px;border-radius:10px;background:rgba(124,108,255,.15);border:1px solid rgba(124,108,255,.3);color:#7c6cff;font-size:13px;font-weight:700;cursor:pointer">🖨️ Imprimer badge</button>
      <button onclick="document.getElementById('qr-emp-modal').remove()" style="padding:10px 18px;border-radius:10px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.6);font-size:13px;cursor:pointer">✕ Fermer</button>
    </div>
    <div id="qr-emp-status" style="font-size:11px;color:rgba(255,255,255,.4)"></div>
  `;
  document.body.appendChild(modal);

  // EMPLOYEE QR GENERATION — Générer ou utiliser le QR existant
  let qrSrc = emp.qr_code || null;

  if (!qrSrc) {
    // QR non encore généré — générer maintenant
    document.getElementById('qr-emp-status').textContent = '⏳ Génération du QR en cours...';
    // BAROS QR FIX — Vérifier toutes les données avant génération
    const empComplet = {
      id: emp.id,
      nom: emp.nom,
      role: emp.role,
      etab_id: emp.etab_id || ETAB.id,
      pin: emp.pin || null
    };
    qrSrc = await genererQREmploye(empComplet);
    if (qrSrc) {
      // QR ERROR HANDLING — Sauvegarder dans Supabase
      const { error: qrErr } = await db.from('employes').update({ qr_code: qrSrc }).eq('id', emp.id);
      if (!qrErr) {
        emp.qr_code = qrSrc; // Mettre à jour le cache local
        document.getElementById('qr-emp-status').textContent = '✅ QR généré et sauvegardé';
        toast('✅ QR généré !', 'var(--gn)');
      } else {
        document.getElementById('qr-emp-status').textContent = '⚠️ QR généré mais non sauvegardé';
        toast('⚠️ QR non sauvegardé : ' + qrErr.message, 'var(--wn)');
      }
    } else {
      document.getElementById('qr-emp-status').textContent = '❌ Échec génération QR';
      toast('❌ Erreur génération QR', 'var(--dg)');
    }
  } else {
    document.getElementById('qr-emp-status').textContent = '✅ QR chargé';
  }

  // Afficher le QR
  const box = document.getElementById('qr-emp-img-box');
  if (box && qrSrc) {
    const img = document.createElement('img');
    img.src = qrSrc;
    img.style.cssText = 'width:200px;height:200px;border-radius:8px;display:block';
    img.alt = 'QR Badge ' + emp.nom;
    box.innerHTML = '';
    box.appendChild(img);
    // Stocker pour download/print
    box.dataset.qrSrc = qrSrc;
  } else if (box && !qrSrc) {
    box.innerHTML = '<div style="width:200px;height:200px;display:flex;align-items:center;justify-content:center;color:#333;font-size:12px;text-align:center">❌ QR non disponible<br>Réessayez</div>';
  }
}

function downloadQREmpModal() {
  const box = document.getElementById('qr-emp-img-box');
  const src = box?.dataset.qrSrc;
  if (!src || !_qrModalEmp) { toast('⚠️ QR non disponible', 'var(--wn)'); return; }
  downloadQREmp(_qrModalEmp.id, _qrModalEmp.nom, src);
}

function imprimerBadgeEmpModal() {
  const box = document.getElementById('qr-emp-img-box');
  const src = box?.dataset.qrSrc;
  if (!src || !_qrModalEmp) { toast('⚠️ QR non disponible', 'var(--wn)'); return; }
  imprimerBadgeEmp(_qrModalEmp, src);
}

/**
 * BAROS QR FIX — Régénérer le QR d'un employé (depuis la vue équipe)
 * Utile si le QR existant est corrompu ou absent
 */
async function regenQRDepuisEquipe(empId) {
  const emp = EMPS.find(e => e.id === empId);
  if (!emp) return;
  toast('⏳ Régénération QR...', 'var(--inf)');
  const empData = {
    id: emp.id, nom: emp.nom, role: emp.role,
    etab_id: emp.etab_id || ETAB.id, pin: emp.pin || null
  };
  const qrSrc = await genererQREmploye(empData);
  if (!qrSrc) { toast('❌ Échec QR', 'var(--dg)'); return; }
  const { error } = await db.from('employes').update({ qr_code: qrSrc }).eq('id', empId);
  if (error) { toast('⚠️ Sauvegarde échouée', 'var(--wn)'); return; }
  emp.qr_code = qrSrc;
  toast('✅ QR régénéré !', 'var(--gn)');
  loadEquipe();
}
