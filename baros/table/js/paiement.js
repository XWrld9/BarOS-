// ── BarOS Table — paiement mobile (MTN MoMo / Orange Money) ───
// Le client paie depuis son téléphone puis saisit sa référence ; la caisse valide.
let PAY_OPS = null;     // { momo, om }
let PAY_CHOSEN = null;  // 'MTN MoMo' | 'Orange Money'

function payLastKey() { return 'baros_last_order_' + (TABLE_DATA ? TABLE_DATA.id : ''); }
function payGetLast() { try { return JSON.parse(localStorage.getItem(payLastKey()) || 'null'); } catch (e) { return null; } }
function paySetLast(o) { try { if (o) localStorage.setItem(payLastKey(), JSON.stringify(o)); else localStorage.removeItem(payLastKey()); } catch (e) {} }

function payRefreshAction() {
  const el = document.getElementById('pay-action'); if (!el) return;
  const o = payGetLast();
  el.style.display = (o && !o.paid) ? '' : 'none';
}

async function payLoadOps() {
  if (PAY_OPS) return PAY_OPS;
  const key = 'baros_payops_' + TABLE_DATA.etab_id;
  let ops = null;
  try {
    const { data, error } = await db.from('etabs').select('momo_numero,om_numero').eq('id', TABLE_DATA.etab_id).maybeSingle();
    if (!error && data) { ops = { momo: data.momo_numero || '', om: data.om_numero || '' }; localStorage.setItem(key, JSON.stringify(ops)); }
  } catch (e) {}
  if (!ops) { try { ops = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) {} }
  PAY_OPS = ops || { momo: '', om: '' };
  return PAY_OPS;
}

async function openPaiement() {
  if (!TABLE_DATA) return;
  const order = payGetLast();
  if (!order || order.paid) { showToast('Aucune commande à payer', 'var(--wn)'); return; }
  await payLoadOps();
  document.getElementById('pay-total').textContent = 'Total à payer : ' + cmFmt(order.montant) + ' F';
  document.getElementById('pay-step2').style.display = 'none';
  const ops = [];
  if (PAY_OPS.momo) ops.push({ id: 'MTN MoMo', num: PAY_OPS.momo, color: '#ffcc00' });
  if (PAY_OPS.om) ops.push({ id: 'Orange Money', num: PAY_OPS.om, color: '#ff7900' });
  const box = document.getElementById('pay-ops');
  if (!ops.length) {
    box.innerHTML = '<div class="pay-none">Le paiement mobile n\'est pas encore activé ici. Réglez auprès de la serveuse.</div>';
  } else {
    box.innerHTML = '<div class="sec-title" style="margin-top:0">Choisissez votre moyen de paiement</div>' + ops.map(o =>
      `<button class="pay-op" data-op="${cmEsc(o.id)}" data-num="${cmEsc(o.num)}"><span class="pay-dot" style="background:${o.color}"></span><span>${cmEsc(o.id)}<small>${cmEsc(o.num)}</small></span></button>`).join('');
  }
  document.getElementById('pay-overlay').classList.add('open');
}

function closePaiement() { document.getElementById('pay-overlay').classList.remove('open'); }

function payPick(op, num) {
  PAY_CHOSEN = op;
  const order = payGetLast();
  document.getElementById('pay-instr').innerHTML =
    'Envoyez ' + cmFmt(order.montant) + ' F au ' + cmEsc(num) + ' (' + cmEsc(op) + ') depuis votre téléphone, puis saisissez votre numéro et la référence reçue.';
  document.getElementById('pay-step2').style.display = 'block';
  if (typeof ACC_CLIENT !== 'undefined' && ACC_CLIENT && ACC_CLIENT.tel && !document.getElementById('pay-tel').value) document.getElementById('pay-tel').value = ACC_CLIENT.tel;
}

async function submitPaiement() {
  const order = payGetLast();
  if (!order || !PAY_CHOSEN) return;
  const tel = document.getElementById('pay-tel').value.replace(/[^0-9+]/g, '');
  if (tel.replace(/\D/g, '').length < 8) { showToast('Entrez un numéro de téléphone valide', 'var(--wn)'); return; }
  const btn = document.getElementById('pay-send');
  btn.disabled = true;
  const { error } = await db.from('paiements').insert({
    etab_id: TABLE_DATA.etab_id, commande_id: order.id || null, table_nom: TABLE_DATA.nom,
    montant: order.montant, operateur: PAY_CHOSEN, telephone: tel,
    reference: document.getElementById('pay-ref').value.trim() || null,
    statut: 'En attente', mode: 'manuel'
  });
  btn.disabled = false;
  if (error) { showToast('Envoi impossible — vérifiez votre connexion', 'var(--dg)'); return; }
  order.paid = true; paySetLast(order);
  closePaiement(); payRefreshAction();
  showToast('Paiement envoyé — en attente de validation par la caisse ✅', 'var(--gn)');
}

document.addEventListener('click', function (e) {
  const b = e.target.closest('.pay-op');
  if (b) payPick(b.dataset.op, b.dataset.num);
});
