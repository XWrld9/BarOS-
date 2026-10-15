// ── BarOS Gestionnaire — paiements mobiles (MTN MoMo / Orange Money) ──
// Mode assisté : le client paie depuis son téléphone puis saisit sa référence ;
// le caissier valide ici après avoir reçu l'argent. (Branchement automatique
// possible plus tard avec l'API d'un opérateur.)
var _payTab = 'wait', _payRows = [], _payInit = false;

function _pEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function _pHour(iso) { try { var d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); } catch (e) { return ''; } }

async function openPayModal() { openM('m-pay'); await payTab(_payTab || 'wait'); }

async function payTab(t) {
  _payTab = t;
  ['wait', 'hist', 'cfg'].forEach(function (k) { var b = document.getElementById('pt-' + k); if (b) b.classList.toggle('on', k === t); });
  if (t === 'cfg') { payRenderCfg(); return; }
  var body = document.getElementById('pay-body');
  body.innerHTML = '<div class="pay-empty">Chargement…</div>';
  await payLoad();
  payRender();
}

async function payLoad() {
  if (!ETAB) return;
  var res = await db.from('paiements').select('*').eq('etab_id', ETAB.id).order('created_at', { ascending: false }).limit(60);
  if (res.error) { _payRows = null; _payErr = res.error.message; }
  else { _payRows = res.data || []; _payErr = ''; }
  payUpdateBadge();
}
var _payErr = '';

function payRender() {
  var body = document.getElementById('pay-body');
  if (_payRows === null) {
    body.innerHTML = '<div class="pay-empty">Table des paiements introuvable.<br>Lancez le script <b>baros-migration-v2.sql</b> dans Supabase.<br><small>' + _pEsc(_payErr) + '</small></div>';
    return;
  }
  var rows = _payTab === 'wait' ? _payRows.filter(function (p) { return p.statut === 'En attente'; })
                                 : _payRows.filter(function (p) { return p.statut !== 'En attente'; });
  if (!rows.length) { body.innerHTML = '<div class="pay-empty">' + (_payTab === 'wait' ? 'Aucun paiement en attente' : 'Aucun paiement dans l\'historique') + '</div>'; return; }
  body.innerHTML = rows.map(function (p) {
    var pill = p.statut === 'Confirmé' ? '<span class="pay-pill ok">Confirmé</span>' : p.statut === 'Refusé' ? '<span class="pay-pill ko">Refusé</span>' : '<span class="pay-pill wait">En attente</span>';
    var act = p.statut === 'En attente'
      ? '<div class="pay-actions"><button class="btn btn-sm btn-gn" onclick="payValidate(\'' + _pEsc(p.id) + '\',true)">✓ Valider</button><button class="btn btn-sm btn-dg" onclick="payValidate(\'' + _pEsc(p.id) + '\',false)">✕ Refuser</button></div>' : '';
    return '<div class="mt-row" style="display:block"><div style="display:flex;align-items:center;gap:8px">' +
      '<div class="mt-info"><div class="mt-nom">' + _pEsc(p.operateur || '—') + ' · ' + _pEsc(p.table_nom || '') + '</div>' +
      '<div class="mt-sub">' + _pEsc(p.telephone || '') + (p.reference ? ' · réf. ' + _pEsc(p.reference) : '') + ' · ' + _pHour(p.created_at) + '</div></div>' +
      '<div class="mt-ca">' + fmt(p.montant) + ' F</div>' + pill + '</div>' + act + '</div>';
  }).join('');
}

async function payValidate(id, ok) {
  var p = (_payRows || []).find(function (x) { return x.id === id; });
  if (!p) return;
  var res = await db.from('paiements').update({
    statut: ok ? 'Confirmé' : 'Refusé', valide_at: new Date().toISOString(), valide_par: CU ? CU.nom : null
  }).eq('id', id).eq('etab_id', ETAB.id);
  if (res.error) { showN('Erreur : ' + res.error.message, 'error'); return; }
  if (ok && p.commande_id) {
    try { await db.from('commandes').update({ paiement: p.operateur || 'Mobile Money' }).eq('id', p.commande_id).eq('etab_id', ETAB.id); } catch (e) {}
  }
  showN(ok ? '✅ Paiement confirmé' : 'Paiement refusé', ok ? 'success' : 'warn');
  await payTab(_payTab);
  if (ok && typeof renderDash === 'function') { try { renderDash(); } catch (e) {} }
}

function payRenderCfg() {
  var body = document.getElementById('pay-body');
  body.innerHTML =
    '<div class="frow"><div class="flbl">Numéro MTN MoMo de l\'établissement</div><input class="finp" id="cfg-momo" inputmode="tel" placeholder="ex: 6 70 00 00 00" value="' + _pEsc((ETAB && ETAB.momo_numero) || '') + '"></div>' +
    '<div class="frow"><div class="flbl">Numéro Orange Money de l\'établissement</div><input class="finp" id="cfg-om" inputmode="tel" placeholder="ex: 6 90 00 00 00" value="' + _pEsc((ETAB && ETAB.om_numero) || '') + '"></div>' +
    '<div class="auth-err" id="cfg-pay-err"></div>' +
    '<button class="btn btn-ac btn-full" onclick="paySaveCfg()">✓ Enregistrer</button>' +
    '<div class="pay-note">Ces numéros s\'affichent sur la page de la table. Le client paie depuis son téléphone, saisit sa référence, et vous validez ici le paiement après l\'avoir reçu. Laissez un champ vide pour désactiver cet opérateur.</div>';
}

async function paySaveCfg() {
  var momo = document.getElementById('cfg-momo').value.trim(), om = document.getElementById('cfg-om').value.trim();
  var err = document.getElementById('cfg-pay-err'); err.textContent = '';
  var res = await db.from('etabs').update({ momo_numero: momo || null, om_numero: om || null }).eq('id', ETAB.id).select('id');
  if (res.error) {
    err.textContent = /column|schema cache|momo|om_numero/i.test(res.error.message)
      ? 'Colonnes manquantes : lancez baros-migration-v2.sql dans Supabase.' : 'Erreur : ' + res.error.message;
    return;
  }
  ETAB.momo_numero = momo || null; ETAB.om_numero = om || null;
  try { localStorage.setItem('baros_etab_' + ETAB.id, JSON.stringify(ETAB)); } catch (e) {}
  showN('✅ Numéros enregistrés', 'success');
}

function payUpdateBadge() {
  var b = document.getElementById('b-pay'); if (!b || !_payRows) return;
  var n = _payRows.filter(function (p) { return p.statut === 'En attente'; }).length;
  b.textContent = n; b.style.display = n ? '' : 'none';
}

// Démarre l'écoute dès que l'établissement est chargé
setInterval(function () {
  if (_payInit || typeof ETAB === 'undefined' || !ETAB || !ETAB.id) return;
  _payInit = true;
  payLoad();
  db.channel('paiements-changes')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'paiements', filter: 'etab_id=eq.' + ETAB.id },
      function (payload) {
        showN('💳 Paiement mobile à valider : ' + fmt(payload.new.montant) + ' F', 'warn');
        payLoad().then(function () { if (document.getElementById('m-pay').classList.contains('on')) payRender(); });
      }).subscribe();
  setInterval(payLoad, 45000);
}, 1500);
