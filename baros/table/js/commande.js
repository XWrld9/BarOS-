// ── BarOS — Commande autonome client (QR de table) ─────────────
// Charge le menu (table stock), gère le panier et envoie la commande
// en caisse (table commandes, statut "Nouveau"). Si l'envoi direct est
// refusé, la commande est transmise à la serveuse via un appel.
let CM_ARTICLES = [];
let CM_CART = {};          // { stockId: quantité }
let CM_CAT = 'Tous';
let CM_LOADED = false;
let CM_SENDING = false;

function cmEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function cmFmt(n) { return Number(n || 0).toLocaleString('fr-FR'); }

function cmTypeService(p) {
  if (p.type_service === 'bar' || p.type_service === 'cuisine') return p.type_service;
  const c = (p.categorie || '').toLowerCase();
  const cuisine = ['cuisine', 'plat', 'food', 'repas', 'nourriture', 'snack', 'entrée', 'dessert', 'grillad', 'brochette', 'viande', 'poisson', 'petit-déjeuner', 'accompagnement', 'glace'];
  return cuisine.some(k => c.includes(k)) ? 'cuisine' : 'bar';
}

async function openMenuClient() {
  if (!TABLE_DATA) return;
  document.getElementById('menu-overlay').classList.add('open');
  if (!CM_LOADED) await cmLoadMenu();
  cmRender();
}

function closeMenuClient() {
  document.getElementById('menu-overlay').classList.remove('open');
}

async function cmLoadMenu() {
  const list = document.getElementById('cm-list');
  list.innerHTML = '<div class="cm-empty">Chargement du menu…</div>';
  const cacheKey = 'baros_menu_' + TABLE_DATA.etab_id;
  let { data, error } = await db.from('stock').select('*').eq('etab_id', TABLE_DATA.etab_id).order('categorie');
  if (!error && data) { try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch (e) { /* photos trop lourdes : on ignore */ } }
  if (error) {
    try { data = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch (e) { data = null; }   // menu vu précédemment
    if (!data) {
      list.innerHTML = '<div class="cm-empty">Menu indisponible. Appelez une serveuse.</div>';
      showToast('Menu indisponible — vérifiez votre connexion', 'var(--dg)');
      return;
    }
  }
  CM_ARTICLES = (data || [])
    .filter(s => s.actif !== false && (s.quantite === undefined || s.quantite === null || s.quantite > 0))
    .map(s => ({ ...s, prix: s.prix_vente ?? s.prix ?? 0, icone: s.icone || '🍶', categorie: s.categorie || 'Autres' }))
    .filter(s => s.prix > 0);
  CM_LOADED = true;
}

function cmRender() {
  const cats = ['Tous', ...Array.from(new Set(CM_ARTICLES.map(a => a.categorie)))];
  if (!cats.includes(CM_CAT)) CM_CAT = 'Tous';
  document.getElementById('cm-cats').innerHTML = cats.map(c =>
    `<button class="cm-cat${c === CM_CAT ? ' on' : ''}" data-cat="${cmEsc(c)}">${cmEsc(c)}</button>`).join('');
  const items = CM_ARTICLES.filter(a => CM_CAT === 'Tous' || a.categorie === CM_CAT);
  const list = document.getElementById('cm-list');
  if (!items.length) {
    list.innerHTML = '<div class="cm-empty">Aucun article disponible.</div>';
  } else {
    list.innerHTML = items.map(a => {
      const q = CM_CART[a.id] || 0;
      const en = (typeof getLang === 'function' && getLang() === 'en');
      const nom = (en && a.nom_en) ? a.nom_en : a.nom;
      const desc = (en ? (a.description_en || a.description_fr) : (a.description_fr || a.description_en)) || '';
      const all = a.allergenes ? `<div class="cm-all">${en ? 'Allergens' : 'Allergènes'} : ${cmEsc(a.allergenes)}</div>` : '';
      const vis = a.photo ? `<img class="cm-photo" src="${cmEsc(a.photo)}" alt="" loading="lazy">` : `<div class="cm-ic">${cmEsc(a.icone)}</div>`;
      return `<div class="cm-item">
        ${vis}
        <div class="cm-info"><div class="cm-nom">${cmEsc(nom)}</div>${desc ? `<div class="cm-desc">${cmEsc(desc)}</div>` : ''}${all}<div class="cm-prix">${cmFmt(a.prix)} F</div></div>
        <div class="cm-qty">
          ${q > 0 ? `<button data-act="minus" data-id="${cmEsc(a.id)}">−</button><span>${q}</span>` : ''}
          <button class="plus" data-act="plus" data-id="${cmEsc(a.id)}">+</button>
        </div></div>`;
    }).join('');
  }
  cmUpdateTotal();
}

function cmTotals() {
  let n = 0, t = 0;
  Object.entries(CM_CART).forEach(([id, q]) => {
    const a = CM_ARTICLES.find(x => String(x.id) === String(id));
    if (a) { n += q; t += a.prix * q; }
  });
  return { n, t };
}

function cmUpdateTotal() {
  const { n, t } = cmTotals();
  document.getElementById('cm-total').textContent = cmFmt(t) + ' F';
  document.getElementById('cm-count').textContent = n + (n > 1 ? ' articles' : ' article');
  document.getElementById('cm-send-btn').disabled = n === 0 || CM_SENDING;
}

function cmChange(id, delta) {
  const a = CM_ARTICLES.find(x => String(x.id) === String(id));
  if (!a) return;
  const max = (a.quantite === undefined || a.quantite === null) ? 99 : a.quantite;
  const q = Math.max(0, Math.min(max, (CM_CART[a.id] || 0) + delta));
  if (q === 0) delete CM_CART[a.id]; else CM_CART[a.id] = q;
  cmRender();
}

function cmUuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
}

function cmNowTime() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function cmToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function cmDecrementStock(lines) {
  for (const { art, qty } of lines) {
    try {
      const { data: s } = await db.from('stock').select('id,quantite,vendu_systeme').eq('id', art.id).maybeSingle();
      if (!s) continue;
      await db.from('stock').update({
        quantite: Math.max(0, (s.quantite || 0) - qty),
        vendu_systeme: (s.vendu_systeme || 0) + qty
      }).eq('id', s.id);
    } catch (e) { console.warn('[BarOS] stock client:', e); }
  }
}

async function sendCommandeClient() {
  if (CM_SENDING) return;
  const lines = Object.entries(CM_CART).map(([id, qty]) => ({ art: CM_ARTICLES.find(x => String(x.id) === String(id)), qty })).filter(l => l.art);
  if (!lines.length) { showToast('Votre panier est vide', 'var(--wn)'); return; }
  CM_SENDING = true;
  const btn = document.getElementById('cm-send-btn');
  btn.disabled = true; btn.textContent = 'Envoi…';

  const all = [], bar = [], cuisine = [];
  let total = 0;
  lines.forEach(({ art, qty }) => {
    const label = art.nom + (qty > 1 ? ' ×' + qty : '');
    all.push(label);
    (cmTypeService(art) === 'cuisine' ? cuisine : bar).push(label);
    total += art.prix * qty;
  });
  const note = (document.getElementById('cm-note').value || '').trim();
  const articles = all.join(', ') + (note ? ' — Note : ' + note : '');

  let barId = null;
  try { barId = TABLE_DATA.bar_id || null; } catch (_) {}

  const orderId = cmUuid();
  const payload = {
    id: orderId,
    etab_id: TABLE_DATA.etab_id,
    table_nom: TABLE_DATA.nom,
    articles,
    articles_bar: bar.join(', ') || null,
    articles_cuisine: cuisine.join(', ') || null,
    employe_nom: 'Client QR' + ((typeof accWho === 'function' && accWho()) ? ' · ' + accWho() : ''),
    montant: total,
    remise: 0,
    paiement: 'À table',
    statut: 'Nouveau',
    heure: cmNowTime(),
    date_cmd: cmToday(),
    bar_id: barId
  };

  let ok = false;
  const { error } = await db.from('commandes').insert(payload);
  if (!error) {
    ok = true;
    await cmDecrementStock(lines);
  } else {
    console.warn('[BarOS] commande directe refusée, bascule en appel :', error.message);
    // Secours : la commande part vers la serveuse via un appel de type "commande"
    const msg = (typeof accPrefix === 'function' ? accPrefix('') + ' — ' : '') + all.join(', ') + ' — Total ' + cmFmt(total) + ' F' + (note ? ' — Note : ' + note : '');
    const { error: e2 } = await db.from('appels').insert({
      etab_id: TABLE_DATA.etab_id, table_id: TABLE_DATA.id, table_nom: TABLE_DATA.nom,
      type: 'commande', message: msg, statut: 'pending'
    });
    ok = !e2;
  }

  CM_SENDING = false;
  btn.textContent = '✓ Envoyer la commande';
  if (ok) {
    CM_CART = {};
    document.getElementById('cm-note').value = '';
    closeMenuClient();
    if (typeof accAddPoints === 'function') accAddPoints(total);
    showToast('Commande envoyée ! Total ' + cmFmt(total) + ' F ✅', 'var(--gn)');
    if (!error && typeof paySetLast === 'function') {       // proposer le paiement mobile
      paySetLast({ id: orderId, montant: total, paid: false, at: Date.now() });
      payRefreshAction();
      setTimeout(function () { if (typeof openPaiement === 'function') openPaiement(); }, 900);
    }
  } else {
    cmUpdateTotal();
    showToast('Envoi impossible — vérifiez votre connexion', 'var(--dg)');
  }
}

document.addEventListener('click', function (e) {
  const cat = e.target.closest('.cm-cat');
  if (cat) { CM_CAT = cat.dataset.cat; cmRender(); return; }
  const b = e.target.closest('.cm-qty button');
  if (b) cmChange(b.dataset.id, b.dataset.act === 'plus' ? 1 : -1);
});
