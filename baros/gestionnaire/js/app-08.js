// ═══════════════════════════════════════════════════════════════
// TABLES & QR MODULE — BarOS
// Ajouté lors de la migration Tables connectées.
// NE MODIFIE PAS la logique métier existante.
// ═══════════════════════════════════════════════════════════════

let TABLES_DATA = [];
let _tblEditId  = null;
let _tblQRcurrent = null;
let _appelsMgrTimer = null;
// ── BAR/COMPARTIMENT DATA ──
let BARS_DATA = [];
let COMPARTIMENTS_DATA = [];

// Charge les bars et compartiments de l'établissement
async function loadBarsData() {
  if (!ETAB) return;
  const { data: bars } = await db.from('bars').select('*').eq('etab_id', ETAB.id).eq('actif', true).order('nom');
  BARS_DATA = bars || [];
  const { data: comps } = await db.from('compartiments').select('*').eq('etab_id', ETAB.id).eq('actif', true).order('nom');
  COMPARTIMENTS_DATA = comps || [];
}

// Peuple le select Bar du modal employé
function _populateEmpBarSelect(selectedBarId) {
  const sel = document.getElementById('emp-bar-id');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Non assigné —</option>';
  BARS_DATA.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.nom + (b.type === 'cuisine' ? ' (cuisine)' : '');
    if (b.id === selectedBarId) opt.selected = true;
    sel.appendChild(opt);
  });
}

// Peuple le select Bar du modal table
function populateTblBarSelect(selectedBarId) {
  const sel = document.getElementById('tbl-bar-id');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Sélectionner un Bar —</option>';
  BARS_DATA.filter(b => b.type === 'bar').forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.nom;
    if (b.id === selectedBarId) opt.selected = true;
    sel.appendChild(opt);
  });
}

// Peuple le select Compartiment selon le bar sélectionné
function populateTblCompartimentSelect(barId, selectedCompId) {
  const sel  = document.getElementById('tbl-compartiment-id');
  const row  = document.getElementById('tbl-comp-row');
  if (!sel || !row) return;
  const comps = COMPARTIMENTS_DATA.filter(c => c.bar_id === barId);
  if (!comps.length) { row.style.display = 'none'; return; }
  row.style.display = '';
  sel.innerHTML = '<option value="">— Aucun compartiment —</option>';
  comps.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.nom;
    if (c.id === selectedCompId) opt.selected = true;
    sel.appendChild(opt);
  });
}

// Appelé au changement du select Bar dans le modal
function onTblBarChange() {
  const barId = document.getElementById('tbl-bar-id')?.value || '';
  populateTblCompartimentSelect(barId, '');
}

// ── URL QR dynamique ──────────────────────────────────────────
function buildTableUrl(tableId) {
  // Toujours produire une URL absolue commencant par https://
  // pour que les scanners Android (Samsung, MIUI, Google Lens, app camera)
  // l'ouvrent automatiquement dans le navigateur sans afficher le texte brut.
  //
  // window.location.origin   → "https://bar-alpha.vercel.app"  (toujours fiable)
  // window.location.pathname → "/index.html" ou "/manager/" selon le deploiement
  const origin  = window.location.origin;
  const pathDir = window.location.pathname.replace(/[^/]*$/, '');
  // Plateforme BarOS : /gestionnaire/ et /table/ sont des dossiers freres
  const rootDir = pathDir.replace(/[^/]+\/$/, '');
  return origin + rootDir + 'table/?t=' + encodeURIComponent(tableId);
}

// ── Chargement des tables ─────────────────────────────────────
// ═══════════════════════════════════════════════════════
// BARS & COMPARTIMENTS — GESTION COMPLÈTE
// ═══════════════════════════════════════════════════════

let _barEditId  = null;
let _compEditId = null;

// ── Chargement principal de la page ─────────────────────
async function loadBarsPage() {
  if (!ETAB) return;
  await loadBarsData();
  renderBarsList();
  renderCompsList();
  updateBarsKPIs();
  // Recharger les sélecteurs des autres modals
  _populateEmpBarSelect('');
  populateTblBarSelect('');
}

// ── KPIs ────────────────────────────────────────────────
function updateBarsKPIs() {
  document.getElementById('bar-stat-total').textContent   = BARS_DATA.length;
  document.getElementById('bar-stat-comps').textContent   = COMPARTIMENTS_DATA.length;
  document.getElementById('bar-stat-cuisine').textContent = BARS_DATA.filter(b => b.type === 'cuisine').length;
  document.getElementById('bar-stat-actifs').textContent  = BARS_DATA.filter(b => b.actif).length;
}

// ── Rendu liste Bars ─────────────────────────────────────
function renderBarsList() {
  const list = document.getElementById('bars-list');
  if (!list) return;
  if (!BARS_DATA.length) {
    list.innerHTML = '<div style="text-align:center;padding:32px;color:var(--mt);font-size:12px">Aucun Bar créé.<br>Commencez par ajouter votre premier Bar.</div>';
    return;
  }
  list.innerHTML = BARS_DATA.map(b => {
    const typeLabel = b.type === 'cuisine' ? '🍳 Cuisine' : '🍺 Bar';
    const typeColor = b.type === 'cuisine' ? 'var(--wn)' : 'var(--ac)';
    const compCount = COMPARTIMENTS_DATA.filter(c => c.bar_id === b.id).length;
    return `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--bd);${!b.actif?'opacity:.45':''}">
      <div style="width:40px;height:40px;border-radius:10px;background:${typeColor}18;border:2px solid ${typeColor}40;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${b.type==='cuisine'?'🍳':'🍺'}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px">
          ${b.nom}
          ${!b.actif?'<span class="pill p-c" style="font-size:9px">Inactif</span>':''}
        </div>
        <div style="font-size:10px;color:${typeColor};margin-top:2px;display:flex;align-items:center;gap:8px">
          <span>${typeLabel}</span>
          ${b.type!=='cuisine'?`<span style="color:var(--mt)">· ${compCount} compartiment${compCount>1?'s':''}</span>`:'<span style="color:var(--mt)">· Pas de compartiment</span>'}
        </div>
      </div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-sm" onclick="openEditBar('${b.id}')">✏️</button>
        <button class="btn btn-sm btn-dg" onclick="deleteBarConfirm('${b.id}','${b.nom.replace(/'/g,"\\'")}')">🗑</button>
      </div>
    </div>`;
  }).join('');
}

// ── Rendu liste Compartiments ───────────────────────────
function renderCompsList() {
  const list = document.getElementById('comps-list');
  if (!list) return;
  if (!COMPARTIMENTS_DATA.length) {
    list.innerHTML = '<div style="text-align:center;padding:32px;color:var(--mt);font-size:12px">Aucun compartiment créé.<br>Créez d\'abord un Bar, puis ajoutez ses compartiments.</div>';
    return;
  }
  // Grouper par bar
  const grouped = {};
  COMPARTIMENTS_DATA.forEach(c => {
    if (!grouped[c.bar_id]) grouped[c.bar_id] = [];
    grouped[c.bar_id].push(c);
  });
  let html = '';
  Object.keys(grouped).forEach(barId => {
    const bar = BARS_DATA.find(b => b.id === barId);
    const barNom = bar ? bar.nom : '—';
    html += `<div style="padding:8px 14px 4px;font-size:10px;font-weight:700;color:var(--ac);letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid var(--bd)">${barNom}</div>`;
    grouped[barId].forEach(c => {
      html += `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--bd);${!c.actif?'opacity:.45':''}">
        <div style="width:8px;height:8px;border-radius:50%;background:${c.actif?'var(--gn)':'var(--mt)'};flex-shrink:0"></div>
        <div style="flex:1;font-size:12px;font-weight:500">${c.nom}${!c.actif?' <span style="font-size:10px;color:var(--mt)">(inactif)</span>':''}</div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-sm" onclick="openEditCompartiment('${c.id}')">✏️</button>
          <button class="btn btn-sm btn-dg" onclick="deleteCompConfirm('${c.id}','${c.nom.replace(/'/g,"\\'")}')">🗑</button>
        </div>
      </div>`;
    });
  });
  list.innerHTML = html;
}

// ── Modal Bar — Créer ────────────────────────────────────
function openCreateBar() {
  _barEditId = null;
  document.getElementById('bar-modal-title').textContent = '🍺 Créer un Bar';
  document.getElementById('bar-nom').value   = '';
  document.getElementById('bar-type').value  = 'bar';
  document.getElementById('bar-actif').checked = true;
  document.getElementById('bar-edit-id').value  = '';
  openM('m-bar');
}

// ── Modal Bar — Modifier ─────────────────────────────────
function openEditBar(id) {
  const b = BARS_DATA.find(b => b.id === id);
  if (!b) return;
  _barEditId = id;
  document.getElementById('bar-modal-title').textContent = '✏️ Modifier — ' + b.nom;
  document.getElementById('bar-nom').value    = b.nom;
  document.getElementById('bar-type').value   = b.type || 'bar';
  document.getElementById('bar-actif').checked = b.actif !== false;
  document.getElementById('bar-edit-id').value  = b.id;
  openM('m-bar');
}

// ── Sauvegarder Bar ──────────────────────────────────────
async function saveBar() {
  const nom   = (document.getElementById('bar-nom').value || '').trim();
  const type  = document.getElementById('bar-type').value || 'bar';
  const actif = document.getElementById('bar-actif').checked;
  const editId = document.getElementById('bar-edit-id').value;
  if (!nom) { showN('Le nom du Bar est requis', 'error'); return; }

  const btn = document.getElementById('bar-save-btn');
  btn.disabled = true; btn.textContent = '…';
  try {
    if (editId) {
      const { error } = await db.from('bars').update({ nom, type, actif }).eq('id', editId).eq('etab_id', ETAB.id);
      if (error) throw error;
      showN('✓ Bar ' + nom + ' mis à jour', 'success');
    } else {
      const { error } = await db.from('bars').insert({ etab_id: ETAB.id, nom, type, actif });
      if (error) throw error;
      showN('✓ Bar ' + nom + ' créé', 'success');
    }
    closeM('m-bar');
    await loadBarsPage();
  } catch(err) {
    showN('Erreur: ' + (err.message || err), 'error');
  } finally {
    btn.disabled = false; btn.textContent = '✓ Enregistrer';
  }
}

// ── Supprimer Bar ────────────────────────────────────────
async function deleteBarConfirm(id, nom) {
  const compCount = COMPARTIMENTS_DATA.filter(c => c.bar_id === id).length;
  const msg = compCount > 0
    ? `Supprimer le Bar "${nom}" et ses ${compCount} compartiment${compCount>1?'s':''} ?`
    : `Supprimer le Bar "${nom}" ?`;
  if (!confirm(msg)) return;
  const { error } = await db.from('bars').delete().eq('id', id).eq('etab_id', ETAB.id);
  if (error) { showN('Erreur: ' + error.message, 'error'); return; }
  showN('Bar ' + nom + ' supprimé', 'warn');
  await loadBarsPage();
}

// ── Peupler select Bar dans modal compartiment ───────────
function _populateCompBarSelect(selectedBarId) {
  const sel = document.getElementById('comp-bar-id');
  if (!sel) return;
  // Exclure les cuisines : elles n'ont pas de compartiments (règle §8)
  const bars = BARS_DATA.filter(b => b.type === 'bar' && b.actif);
  sel.innerHTML = '<option value="">— Sélectionner un Bar —</option>';
  bars.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.nom;
    if (b.id === selectedBarId) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ── Modal Compartiment — Créer ───────────────────────────
function openCreateCompartiment() {
  _compEditId = null;
  document.getElementById('comp-modal-title').textContent = '🔲 Créer un Compartiment';
  document.getElementById('comp-nom').value  = '';
  document.getElementById('comp-actif').checked = true;
  document.getElementById('comp-edit-id').value  = '';
  _populateCompBarSelect('');
  openM('m-comp');
}

// ── Modal Compartiment — Modifier ────────────────────────
function openEditCompartiment(id) {
  const c = COMPARTIMENTS_DATA.find(c => c.id === id);
  if (!c) return;
  _compEditId = id;
  document.getElementById('comp-modal-title').textContent = '✏️ Modifier — ' + c.nom;
  document.getElementById('comp-nom').value    = c.nom;
  document.getElementById('comp-actif').checked = c.actif !== false;
  document.getElementById('comp-edit-id').value  = c.id;
  _populateCompBarSelect(c.bar_id || '');
  openM('m-comp');
}

// ── Sauvegarder Compartiment ─────────────────────────────
async function saveCompartiment() {
  const nom    = (document.getElementById('comp-nom').value || '').trim();
  const barId  = document.getElementById('comp-bar-id').value || '';
  const actif  = document.getElementById('comp-actif').checked;
  const editId = document.getElementById('comp-edit-id').value;
  if (!nom)   { showN('Le nom du compartiment est requis', 'error'); return; }
  if (!barId) { showN('Sélectionnez un Bar parent', 'error'); return; }

  const btn = document.getElementById('comp-save-btn');
  btn.disabled = true; btn.textContent = '…';
  try {
    if (editId) {
      const { error } = await db.from('compartiments').update({ nom, bar_id: barId, actif }).eq('id', editId).eq('etab_id', ETAB.id);
      if (error) throw error;
      showN('✓ Compartiment ' + nom + ' mis à jour', 'success');
    } else {
      const { error } = await db.from('compartiments').insert({ etab_id: ETAB.id, bar_id: barId, nom, actif });
      if (error) throw error;
      showN('✓ Compartiment ' + nom + ' créé', 'success');
    }
    closeM('m-comp');
    await loadBarsPage();
  } catch(err) {
    showN('Erreur: ' + (err.message || err), 'error');
  } finally {
    btn.disabled = false; btn.textContent = '✓ Enregistrer';
  }
}

// ── Supprimer Compartiment ────────────────────────────────
async function deleteCompConfirm(id, nom) {
  if (!confirm(`Supprimer le compartiment "${nom}" ?`)) return;
  const { error } = await db.from('compartiments').delete().eq('id', id).eq('etab_id', ETAB.id);
  if (error) { showN('Erreur: ' + error.message, 'error'); return; }
  showN('Compartiment ' + nom + ' supprimé', 'warn');
  await loadBarsPage();
}

// ═══════════════════════════════════════════════════════
// FIN BARS & COMPARTIMENTS
// ═══════════════════════════════════════════════════════

async function loadTables() {
  if (!ETAB) return;
  await loadBarsData();
  const { data, error } = await db.from('tables_config')
    .select('*').eq('etab_id', ETAB.id).order('nom');
  TABLES_DATA = data || [];
  renderTablesList();
  loadAppelsMgr();
}

// ── Rendu liste tables ────────────────────────────────────────
function renderTablesList() {
  const list = document.getElementById('tbl-list');
  if (!list) return;

  const total  = TABLES_DATA.length;
  const actif  = TABLES_DATA.filter(t => t.actif).length;
  const libre  = TABLES_DATA.filter(t => t.statut === 'libre'  && t.actif).length;
  const occup  = TABLES_DATA.filter(t => t.statut === 'occupee').length;

  const s = id => document.getElementById(id);
  if(s('tbl-stat-total')) s('tbl-stat-total').textContent = total;
  if(s('tbl-stat-actif')) s('tbl-stat-actif').textContent = actif;
  if(s('tbl-stat-libre')) s('tbl-stat-libre').textContent = libre;
  if(s('tbl-stat-occup')) s('tbl-stat-occup').textContent = occup;

  if (!total) {
    list.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--mt)">Aucune table créée.<br><br><button class="btn btn-ac" onclick="openCreateTable()">+ Créer la première table</button></div>';
    return;
  }

  const statColors  = { libre:'var(--gn)', occupee:'var(--wn)', reservee:'var(--inf)' };
  const statLabels  = { libre:'Libre', occupee:'Occupée', reservee:'Réservée' };

  list.innerHTML = TABLES_DATA.map(t => {
    const color = statColors[t.statut] || 'var(--mt)';
    const label = statLabels[t.statut] || t.statut;
    const inactif = !t.actif;
    const url = buildTableUrl(t.id);
    // ── BAR/COMPARTIMENT — badge d'affichage ──
    const bar   = BARS_DATA.find(b => b.id === t.bar_id);
    const comp  = COMPARTIMENTS_DATA.find(c => c.id === t.compartiment_id);
    const barBadge = bar
      ? `<span style="font-size:9px;padding:1px 6px;background:rgba(200,245,90,.12);border:1px solid rgba(200,245,90,.2);border-radius:20px;color:var(--ac)">${bar.nom}${comp ? ' › ' + comp.nom : ''}</span>`
      : `<span style="font-size:9px;padding:1px 6px;background:rgba(255,180,68,.08);border:1px solid rgba(255,180,68,.2);border-radius:20px;color:var(--wn)">Bar non assigné</span>`;
    // ── FIN BAR/COMPARTIMENT ──
    return `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--bd);${inactif?'opacity:.45':''}">
      <div style="width:42px;height:42px;border-radius:12px;background:var(--s2);display:flex;align-items:center;justify-content:center;font-family:Syne,sans-serif;font-size:14px;font-weight:800;flex-shrink:0;border:2px solid ${color}40;color:${color}">${t.nom}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${t.nom}
          ${t.zone?`<span style="font-size:10px;color:var(--mt);font-weight:400">${t.zone}</span>`:''}
          ${inactif?'<span class="pill p-c" style="font-size:9px">Désactivée</span>':''}
        </div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
          <div style="font-size:10px;color:${color}">● ${label}</div>
          ${barBadge}
        </div>
      </div>
      <div style="display:flex;gap:4px;align-items:center">
        <button class="btn btn-sm" onclick="showQRFullscreen('${t.id}','${t.nom}')" title="Voir QR code">🔲</button>
        <button class="btn btn-sm btn-ac" onclick="printTableCardPDF('${t.id}')" title="Télécharger PDF">📄</button>
        <button class="btn btn-sm" onclick="openEditTable('${t.id}')" title="Modifier">✏️</button>
        <button class="btn btn-sm btn-dg" onclick="deleteTableConfirm('${t.id}','${t.nom}')" title="Supprimer">🗑</button>
      </div>
    </div>`;
  }).join('');
}

// ── Appels en attente (panneau manager) ───────────────────────
async function loadAppelsMgr() {
  if (!ETAB) return;
  const { data } = await db.from('appels')
    .select('*').eq('etab_id', ETAB.id)
    .in('statut', ['pending','accepted'])
    .order('created_at', { ascending: true });
  const appels = data || [];

  const lbl = document.getElementById('appels-count-lbl');
  const list = document.getElementById('tbl-appels-list');
  if (!lbl || !list) return;

  const pending = appels.filter(a => a.statut === 'pending').length;
  lbl.textContent = pending ? `${pending} en attente` : 'Aucun';
  lbl.style.background = pending ? 'rgba(255,94,94,.1)' : 'rgba(74,222,128,.1)';
  lbl.style.color = pending ? 'var(--dg)' : 'var(--gn)';

  if (!appels.length) {
    list.innerHTML = '<div style="text-align:center;padding:28px 16px;color:var(--mt);font-size:12px">✓ Aucun appel en attente</div>';
    return;
  }

  const icons  = { serveuse:'🔔', addition:'💳', commande:'🛒', message:'💬' };
  const colors = { pending:'var(--dg)', accepted:'var(--wn)', completed:'var(--gn)', cancelled:'var(--mt)' };
  const now = Date.now();

  list.innerHTML = appels.map(a => {
    const age = Math.round((now - new Date(a.created_at).getTime()) / 1000);
    const ageStr = age < 60 ? age + 's' : Math.floor(age/60) + 'min ' + (age%60) + 's';
    const col = colors[a.statut] || 'var(--mt)';
    return `
    <div class="appel-row">
      <div class="appel-type-badge" style="background:${col}18">${icons[a.type]||'🔔'}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600">${a.table_nom} — <span style="text-transform:capitalize">${a.type}</span></div>
        ${a.message?`<div style="font-size:10px;color:var(--mt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.message}</div>`:''}
        <div class="appel-timer" style="color:${a.statut==='pending'?'var(--dg)':'var(--wn)'}">⏱ ${ageStr}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${a.statut==='pending'?`<button class="btn btn-sm btn-gn" onclick="acceptAppelMgr('${a.id}')">✓ Accepter</button>`:''}
        ${a.statut==='accepted'?`<button class="btn btn-sm btn-ac" onclick="completeAppelMgr('${a.id}')">✅ Terminé</button>`:''}
        <button class="btn btn-sm btn-dg" style="font-size:10px" onclick="cancelAppelMgr('${a.id}')">✕</button>
      </div>
    </div>`;
  }).join('');

  // Rafraîchissement des timers toutes les 10s
  clearTimeout(_appelsMgrTimer);
  _appelsMgrTimer = setTimeout(loadAppelsMgr, 10000);
}

async function acceptAppelMgr(id) {
  await db.from('appels').update({ statut:'accepted', employe_id: CU?.id, updated_at: new Date().toISOString() }).eq('id', id);
  loadAppelsMgr();
}
async function completeAppelMgr(id) {
  await db.from('appels').update({ statut:'completed', updated_at: new Date().toISOString() }).eq('id', id);
  loadAppelsMgr(); updateBadges();
}
async function cancelAppelMgr(id) {
  await db.from('appels').update({ statut:'cancelled', updated_at: new Date().toISOString() }).eq('id', id);
  loadAppelsMgr(); updateBadges();
}

// ── Son appel (contexte AudioContext) ────────────────────────
function playAppelSound() {
  try {
    /* [FIX-COMPAT] Safari iOS suspend l'AudioContext sans geste utilisateur — resume() requis */
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const _play = () => {
      [880, 1100, 880].forEach((freq, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = freq; o.type = 'sine';
        g.gain.setValueAtTime(0, ctx.currentTime + i * 0.18);
        g.gain.linearRampToValueAtTime(0.3, ctx.currentTime + i * 0.18 + 0.03);
        g.gain.linearRampToValueAtTime(0, ctx.currentTime + i * 0.18 + 0.15);
        o.start(ctx.currentTime + i * 0.18);
        o.stop(ctx.currentTime + i * 0.18 + 0.18);
      });
    };
    if (ctx.state === 'suspended') { ctx.resume().then(_play).catch(()=>{}); }
    else { _play(); }
  } catch(e) {}
}

// ── Créer table ───────────────────────────────────────────────
function openCreateTable() {
  _tblEditId = null;
  document.getElementById('tbl-modal-title').textContent = '🪑 Créer une table';
  document.getElementById('tbl-nom').value   = '';
  document.getElementById('tbl-zone').value  = '';
  document.getElementById('tbl-actif').checked = true;
  // ── BAR/COMPARTIMENT ──
  populateTblBarSelect('');
  const compRow = document.getElementById('tbl-comp-row');
  if (compRow) compRow.style.display = 'none';
  const compSel = document.getElementById('tbl-compartiment-id');
  if (compSel) compSel.innerHTML = '<option value="">— Aucun compartiment —</option>';
  // ── FIN BAR/COMPARTIMENT ──
  openM('m-table');
}

// ── Modifier table ────────────────────────────────────────────
function openEditTable(id) {
  const t = TABLES_DATA.find(t => t.id === id);
  if (!t) return;
  _tblEditId = id;
  document.getElementById('tbl-modal-title').textContent = '✏️ Modifier — ' + t.nom;
  document.getElementById('tbl-nom').value   = t.nom;
  document.getElementById('tbl-zone').value  = t.zone || '';
  document.getElementById('tbl-actif').checked = t.actif !== false;
  // ── BAR/COMPARTIMENT ──
  populateTblBarSelect(t.bar_id || '');
  populateTblCompartimentSelect(t.bar_id || '', t.compartiment_id || '');
  // ── FIN BAR/COMPARTIMENT ──
  openM('m-table');
}

// ── Sauvegarder table ─────────────────────────────────────────
async function saveTable() {
  const nom   = (document.getElementById('tbl-nom').value  || '').trim().toUpperCase();
  const zone  = (document.getElementById('tbl-zone').value || '').trim();
  const actif = document.getElementById('tbl-actif').checked;
  if (!nom) { showN('Le nom de la table est requis', 'error'); return; }

  // ── BAR/COMPARTIMENT ──
  const barId         = document.getElementById('tbl-bar-id')?.value         || null;
  const compartimentId = document.getElementById('tbl-compartiment-id')?.value || null;
  // ── FIN BAR/COMPARTIMENT ──

  const btn = document.getElementById('tbl-save-btn');
  btn.disabled = true; btn.textContent = '…';

  try {
    if (_tblEditId) {
      const { error } = await db.from('tables_config').update({
        nom, zone, actif,
        bar_id: barId || null,
        compartiment_id: compartimentId || null
      }).eq('id', _tblEditId);
      if (error) throw error;
      showN('✓ Table ' + nom + ' mise à jour', 'success');
    } else {
      const { error } = await db.from('tables_config')
        .insert({
          etab_id: ETAB.id, nom, zone, actif, statut: 'libre',
          bar_id: barId || null,
          compartiment_id: compartimentId || null
        });
      if (error) throw error;
      showN('✓ Table ' + nom + ' créée', 'success');
    }
    closeM('m-table');
    loadTables();
  } catch(err) {
    showN('Erreur: ' + (err.message || err), 'error');
  } finally {
    btn.disabled = false; btn.textContent = '✓ Enregistrer';
  }
}

// ── Supprimer table ───────────────────────────────────────────
async function deleteTableConfirm(id, nom) {
  if (!confirm('Supprimer la table "' + nom + '" ? Les appels associés seront aussi supprimés.')) return;
  const { error } = await db.from('tables_config').delete().eq('id', id);
  if (error) { showN('Erreur: ' + error.message, 'error'); return; }
  showN('Table ' + nom + ' supprimée', 'warn');
  loadTables();
}

// ── QR Fullscreen ─────────────────────────────────────────────
function showQRFullscreen(id, nom) {
  const t = TABLES_DATA.find(t => t.id === id);
  if (!t) return;
  _tblQRcurrent = t;
  const url = buildTableUrl(id);
  document.getElementById('tbl-qrf-nom').textContent = nom;
  document.getElementById('tbl-qrf-url').textContent = url;
  const qrEl = document.getElementById('tbl-qrf-qr');
  qrEl.innerHTML = '';
  // BAROS QR FIX — génération via qrcode-generator (inline, synchrone, sans dépendance CDN)
  try {
    if (typeof qrcode !== 'undefined') {
      const qr = qrcode(0, 'H');
      qr.addData(url);
      qr.make();
      const img = document.createElement('img');
      img.width = 240; img.height = 240;
      img.alt = 'QR Code';
      img.src = qr.createDataURL(6, 2);
      qrEl.appendChild(img);
    } else {
      console.error('[BarOS] showQRFullscreen : librairie qrcode-generator absente');
      showN('❌ Erreur génération QR', 'error');
    }
  } catch(e) {
    console.error('[BarOS] showQRFullscreen erreur:', e);
    showN('❌ Erreur génération QR : ' + e.message, 'error');
  }
  document.getElementById('tbl-qr-fullscreen').classList.add('open');
}

function closeTblQRFullscreen() {
  document.getElementById('tbl-qr-fullscreen').classList.remove('open');
}

function copyTableUrl() {
  if (!_tblQRcurrent) return;
  const url = buildTableUrl(_tblQRcurrent.id);
  navigator.clipboard.writeText(url).then(() => showN('Lien copié !', 'success'));
}

// ── [BAROS QR FIX] Téléchargement direct QR table (PNG) ─────────
// Même mécanisme éprouvé que exportQRImage() (badges employés) :
// canvas → toDataURL('image/png') → <a download> attaché au DOM
// avant click() → nettoyage. Complète printTableCardPDF() (PDF),
// ne le remplace pas. N'utilise aucune dépendance externe (jsPDF
// non requis ici), donc ne peut pas échouer si le CDN est lent/hors-ligne.
function exportTableQRImage() {
  if (!_tblQRcurrent) { showN('Aucune table sélectionnée', 'error'); return; }
  const t = _tblQRcurrent;
  const url = buildTableUrl(t.id);

  // Régénération QR synchrone via qrcode-generator (inline, même approche que printTableCardPDF)
  let qrSrc = null;
  try {
    if (typeof qrcode !== 'undefined') {
      const qr = qrcode(0, 'H');
      qr.addData(url);
      qr.make();
      qrSrc = qr.createDataURL(6, 2);
    } else {
      console.error('[BarOS] exportTableQRImage : librairie qrcode-generator absente');
    }
  } catch(e) { console.error('[BarOS] exportTableQRImage QR gen error:', e); }

  if (!qrSrc) { showN('❌ Erreur génération QR', 'error'); return; }

  try {
    const canvas = document.createElement('canvas');
    const W = 600, H = 750;
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Fond sombre
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, W, H);

    // Logo/titre BarOS
    ctx.fillStyle = '#c8f55a';
    ctx.font = 'bold 52px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BarOS', W / 2, 70);

    // Sous-titre
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '22px sans-serif';
    ctx.fillText('Scannez pour commander', W / 2, 108);

    // Cadre QR
    const qrSize = 340, qrX = (W - qrSize) / 2, qrY = 130;
    ctx.strokeStyle = '#c8f55a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(qrX - 8, qrY - 8, qrSize + 16, qrSize + 16, 16);
    ctx.stroke();

    // Fond blanc derrière le QR
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(qrX, qrY, qrSize, qrSize);

    // QR image
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, qrX, qrY, qrSize, qrSize);

      // Ligne décorative
      ctx.strokeStyle = 'rgba(200,245,90,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(40, qrY + qrSize + 30);
      ctx.lineTo(W - 40, qrY + qrSize + 30);
      ctx.stroke();

      // Nom table
      ctx.fillStyle = '#f0eff5';
      ctx.font = 'bold 32px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(t.nom || 'Table', W / 2, qrY + qrSize + 70);

      // Zone
      if (t.zone) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '20px sans-serif';
        ctx.fillText(t.zone, W / 2, qrY + qrSize + 104);
      }

      // Pied de page
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font = '14px sans-serif';
      ctx.fillText('© BarOS — Système de gestion', W / 2, H - 24);

      // Télécharger — même garde-fou que exportQRImage() : le lien doit
      // être attaché au DOM avant le click() (sinon échec silencieux sur
      // certains navigateurs / WebView Android en contexte PWA)
      const link = document.createElement('a');
      link.download = 'table-qr-' + (t.nom || 'table').replace(/\s+/g, '-').toLowerCase() + '.png';
      link.href = canvas.toDataURL('image/png');
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showN('📥 QR table téléchargé', 'success');
    };
    img.onerror = () => showN('❌ Erreur chargement image QR', 'error');
    img.src = qrSrc;
  } catch(e) {
    showN('❌ Erreur export image : ' + e.message, 'error');
    console.error('[BarOS] exportTableQRImage erreur:', e);
  }
}

// ── Export PDF carte de table ─────────────────────────────────
function printTableCardFromQR() {
  // Appelé depuis le bouton fullscreen — utilise _tblQRcurrent directement
  if (!_tblQRcurrent) { showN('Aucune table sélectionnée', 'error'); return; }
  printTableCardPDF(_tblQRcurrent.id);
}

async function printTableCardPDF(tableId) {
  const t = TABLES_DATA.find(x => x.id === tableId) || _tblQRcurrent;
  if (!t) { showN('Table introuvable', 'error'); return; }
  const url = buildTableUrl(t.id);

  // ── Générer QR via qrcode-generator (inline, synchrone, sans dépendance CDN) ──
  let qrSrc = null;
  try {
    if (typeof qrcode !== 'undefined') {
      // qrcode-generator : API synchrone → dataURL direct
      const qr = qrcode(0, 'H');
      qr.addData(url);
      qr.make();
      // createDataURL(cellSize, margin)
      qrSrc = qr.createDataURL(6, 2);
    } else {
      console.error('[BarOS] printTableCardPDF : librairie qrcode-generator absente');
    }
  } catch(e) { console.error('QR gen error', e); }

  if (!qrSrc) { showN('Erreur génération QR — vérifiez la connexion', 'error'); return; }

  // [BAROS QR FIX] try/catch ajouté — auparavant, si jsPDF n'avait pas
  // fini de charger (CDN lent/instable), cette ligne levait une exception
  // non interceptée : rien ne s'affichait à l'utilisateur, aucun message.
  // Comportement du cas normal (jsPDF chargé) strictement inchangé.
  try {
    if (typeof window.jspdf === 'undefined') {
      showN('❌ Module PDF non chargé — utilisez "Télécharger QR" ou réessayez', 'error');
      return;
    }
    const { jsPDF } = window.jspdf;
    // Format carte : 85×105mm
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:[85,105] });

    // Fond sombre
    doc.setFillColor(10, 10, 15);
    doc.rect(0, 0, 85, 105, 'F');
    // Cadre décoratif lime
    doc.setDrawColor(200, 245, 90);
    doc.setLineWidth(0.6);
    doc.roundedRect(2.5, 2.5, 80, 100, 4, 4, 'S');

    // Logo
    doc.setFont('helvetica','bold');
    doc.setFontSize(13);
    doc.setTextColor(200, 245, 90);
    doc.text('BarOS', 42.5, 11, { align:'center' });

    // Nom table
    doc.setFontSize(t.nom.length > 4 ? 18 : 24);
    doc.setTextColor(240, 239, 245);
    doc.text(t.nom, 42.5, 22, { align:'center' });

    // Zone
    if (t.zone) {
      doc.setFontSize(7.5);
      doc.setTextColor(120, 120, 140);
      doc.setFont('helvetica','normal');
      doc.text(t.zone, 42.5, 28, { align:'center' });
    }

    // QR (fond blanc pour lisibilité)
    const qrW = 50, qrX = (85-qrW)/2, qrY = t.zone ? 31 : 26;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(qrX-2, qrY-2, qrW+4, qrW+4, 3, 3, 'F');
    doc.addImage(qrSrc, 'PNG', qrX, qrY, qrW, qrW);

    // Texte bas
    const textY = qrY + qrW + 8;
    doc.setFont('helvetica','bold');
    doc.setFontSize(7);
    doc.setTextColor(200, 245, 90);
    doc.text('Scannez pour commander', 42.5, textY, { align:'center' });
    doc.setFont('helvetica','normal');
    doc.setFontSize(6.5);
    doc.setTextColor(110, 110, 130);
    doc.text('ou appeler une serveuse', 42.5, textY + 5, { align:'center' });
    doc.setFontSize(5.5);
    doc.text('Propulsé par BarOS', 42.5, 101, { align:'center' });

    doc.save('table-qr-' + t.nom.toLowerCase().replace(/\s+/g,'-') + '.pdf');
    showN('PDF téléchargé — ' + t.nom, 'success');
  } catch(e) {
    console.error('[BarOS] printTableCardPDF erreur:', e);
    showN('❌ Erreur génération PDF : ' + (e.message || 'inconnue'), 'error');
  }
}
