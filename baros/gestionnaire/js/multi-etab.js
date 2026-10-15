// ── BarOS Gestionnaire — plusieurs établissements dans un seul compte ──
function _meEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function _meToday() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function openMultiEtab() {
  openM('m-multi');
  document.getElementById('me-err').textContent = '';
  await loadMultiEtab();
}

async function loadMultiEtab() {
  var list = document.getElementById('multi-list'), sum = document.getElementById('multi-sum');
  list.innerHTML = '<div class="pay-empty">Chargement…</div>'; sum.innerHTML = '';
  if (!CU || !ETAB) return;
  var res = await db.from('etabs').select('*').eq('owner_email', String(CU.email || '').toLowerCase()).order('created_at');
  if (res.error) { list.innerHTML = '<div class="pay-empty">Impossible de charger : ' + _meEsc(res.error.message) + '</div>'; return; }
  var rows = res.data || [];
  if (!rows.some(function (e) { return e.id === ETAB.id; })) rows.unshift(ETAB);

  var ids = rows.map(function (e) { return e.id; });
  var ca = {}, nb = {};
  var cm = await db.from('commandes').select('etab_id,montant,statut').in('etab_id', ids).eq('date_cmd', _meToday());
  (cm.data || []).forEach(function (c) {
    if (c.statut === 'Livré') ca[c.etab_id] = (ca[c.etab_id] || 0) + (c.montant || 0);
    if (c.statut !== 'Annulé') nb[c.etab_id] = (nb[c.etab_id] || 0) + 1;
  });
  var total = 0, totalNb = 0; ids.forEach(function (i) { total += ca[i] || 0; totalNb += nb[i] || 0; });

  sum.innerHTML =
    '<div class="mt-kpi"><small>Établissements</small><b>' + rows.length + '</b></div>' +
    '<div class="mt-kpi"><small>CA du jour (tous)</small><b>' + fmt(total) + ' F</b></div>' +
    '<div class="mt-kpi"><small>Commandes</small><b>' + totalNb + '</b></div>';

  list.innerHTML = rows.map(function (e) {
    var cur = e.id === ETAB.id;
    return '<div class="mt-row' + (cur ? ' cur' : '') + '">' +
      '<div class="mt-info"><div class="mt-nom">' + _meEsc(e.nom) + '</div>' +
      '<div class="mt-sub">' + _meEsc([e.type, e.ville].filter(Boolean).join(' · ') || '—') + '</div></div>' +
      '<div class="mt-ca">' + fmt(ca[e.id] || 0) + ' F</div>' +
      (cur ? '<span class="pay-pill ok">Actif</span>'
           : '<button class="btn btn-sm btn-ac" onclick="switchEtab(\'' + _meEsc(e.id) + '\')">Ouvrir</button>') +
      '</div>';
  }).join('');
}

async function switchEtab(id) {
  if (!CU || !id || id === ETAB.id) return;
  try { await db.from('sessions').update({ etab_id: id }).eq('id', CU.id); } catch (e) { console.warn('[BarOS] switchEtab:', e); }
  var s = Object.assign({}, CU, { etab_id: id });
  saveSecureSession(s);
  try { if (window.BarOSOffline && BarOSOffline.saveSession) await BarOSOffline.saveSession(s); } catch (e) {}
  location.reload();
}

async function createEtab() {
  var nom = document.getElementById('me-nom').value.trim();
  var ville = document.getElementById('me-ville').value.trim();
  var type = document.getElementById('me-type').value;
  var err = document.getElementById('me-err'), btn = document.getElementById('me-btn');
  err.textContent = '';
  if (nom.length < 2) { err.textContent = 'Entrez le nom de l\'établissement'; return; }
  btn.disabled = true; btn.textContent = 'Création…';
  var res = await db.from('etabs').insert({
    nom: nom, ville: ville || null, type: type, tel: ETAB.tel || null, obj: 0,
    owner_email: String(CU.email || '').toLowerCase()
  }).select('id').single();
  btn.disabled = false; btn.textContent = '+ Créer et ouvrir cet établissement';
  if (res.error || !res.data) { err.textContent = 'Erreur : ' + ((res.error && res.error.message) || 'création impossible'); return; }
  showN('✅ ' + nom + ' créé', 'success');
  await switchEtab(res.data.id);
}
