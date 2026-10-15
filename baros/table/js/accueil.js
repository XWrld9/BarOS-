// ── BarOS Table — identification, accueil animé, niveau de fidélité ──
// Après le scan : le client donne son nom et son téléphone, voit un accueil
// animé à son nom (selon l'emplacement de la table) avec son niveau
// (Bronze / Argent / Or / Platine), puis arrive sur l'écran d'appel.
const ACC_TIERS = [
  { min: 1000, label: 'Platine', ic: '💎', color: '#a78bfa', perks: ['Remise 20 %', 'Boisson offerte', 'Accès zone Platine'] },
  { min: 500,  label: 'Or',      ic: '🥇', color: '#ffb444', perks: ['Remise 10 %', 'Accès zone VIP', 'Priorité service'] },
  { min: 200,  label: 'Argent',  ic: '🥈', color: '#5eb8ff', perks: ['Remise 5 %'] },
  { min: 0,    label: 'Bronze',  ic: '🥉', color: '#a0a0b4', perks: ['Gagnez des points à chaque commande'] }
];
let ACC_CLIENT = null;   // { id, nom, tel, points, visites }

function accTier(pts) { return ACC_TIERS.find(function (t) { return (pts || 0) >= t.min; }); }
function accNext(pts) { var up = ACC_TIERS.slice().reverse().find(function (t) { return t.min > (pts || 0); }); return up || null; }
function accEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function accDigits(s) { return String(s || '').replace(/\D/g, ''); }
function accFirst(nom) { var f = String(nom || '').trim().split(/\s+/)[0] || ''; return f.charAt(0).toUpperCase() + f.slice(1).toLowerCase(); }
function accKey() { return 'baros_client_' + (TABLE_DATA ? TABLE_DATA.etab_id : ''); }
function accSaved() { try { return JSON.parse(localStorage.getItem(accKey()) || 'null'); } catch (e) { return null; } }
function accSave(c) { try { localStorage.setItem(accKey(), JSON.stringify({ id: c.id, nom: c.nom, tel: c.tel, points: c.points, visites: c.visites })); } catch (e) {} }
function accToday() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

// Texte ajouté aux appels pour que la serveuse sache qui appelle
function accPrefix(msg) {
  if (!ACC_CLIENT) return msg;
  var t = accTier(ACC_CLIENT.points);
  var who = '👤 ' + ACC_CLIENT.nom + ' · ' + t.ic + ' ' + t.label + (ACC_CLIENT.tel ? ' · ' + ACC_CLIENT.tel : '');
  return msg ? who + ' — ' + msg : who;
}
function accWho() { return ACC_CLIENT ? ACC_CLIENT.nom : ''; }

// ── Zone de la table → ambiance ──
function accZoneInfo() {
  var z = String((TABLE_DATA && TABLE_DATA.zone) || '').trim();
  var l = z.toLowerCase(), ic = '🍸';
  if (/vip|privé|prive/.test(l)) ic = '👑'; else if (/terrasse|jardin|dehors|ext/.test(l)) ic = '🌴';
  else if (/bar|comptoir/.test(l)) ic = '🥂'; else if (/restau|salle à manger|manger/.test(l)) ic = '🍽️';
  return { zone: z, ic: ic };
}
function accWhereText() { var z = accZoneInfo(); return TABLE_DATA.nom + (z.zone ? ' · ' + z.zone : ''); }

// ── Client : retrouver ou créer ──
async function accLookup(nom, tel) {
  var d = accDigits(tel), last9 = d.slice(-9);
  var cands = Array.from(new Set([d, last9, '237' + last9, '+237' + last9, '+' + d]));
  var res = await db.from('clients').select('*').eq('etab_id', TABLE_DATA.etab_id).in('telephone', cands).limit(1);
  if (res.error) return { offline: true };
  var found = (res.data || [])[0];
  if (found) {
    var visites = (found.visites || 0) + 1;
    try { await db.from('clients').update({ visites: visites, dernier_passage: accToday() }).eq('id', found.id); } catch (e) {}
    return { id: found.id, nom: found.nom || nom, tel: d, points: found.points || 0, visites: visites };
  }
  var row = { etab_id: TABLE_DATA.etab_id, nom: nom, telephone: d, points: 0, visites: 1, dernier_passage: accToday() };
  var ins = await db.from('clients').insert(row).select().single();
  if (ins.error || !ins.data) return { offline: true };
  return { id: ins.data.id, nom: nom, tel: d, points: 0, visites: 1 };
}

// ── Démarrage (appelé quand la table est chargée) ──
async function accueilStart() {
  var saved = accSaved();
  if (saved && saved.nom && saved.tel) {
    ACC_CLIENT = { id: saved.id, nom: saved.nom, tel: saved.tel, points: saved.points || 0, visites: saved.visites || 0 };
    accShowWelcome();                                    // accueil immédiat avec les infos connues
    accLookup(saved.nom, saved.tel).then(function (c) {  // puis mise à jour des points en arrière-plan
      if (c && !c.offline) { ACC_CLIENT = c; accSave(c); accRenderChip(); }
    }).catch(function () {});
    return;
  }
  accShowForm();
}

function accShowForm() {
  var ov = document.getElementById('acc-ov');
  document.getElementById('acc-form').style.display = 'block';
  document.getElementById('acc-welcome').style.display = 'none';
  document.getElementById('acc-where-f').textContent = accZoneInfo().ic + ' ' + accWhereText();
  ov.classList.add('open');
}

async function accSubmit() {
  var nom = document.getElementById('acc-nom').value.trim();
  var tel = document.getElementById('acc-tel').value.trim();
  var err = document.getElementById('acc-err'), btn = document.getElementById('acc-btn');
  err.textContent = '';
  if (nom.length < 2) { err.textContent = 'Entrez votre nom'; return; }
  if (accDigits(tel).length < 8) { err.textContent = 'Entrez un numéro de téléphone valide'; return; }
  btn.disabled = true; btn.textContent = 'Un instant…';
  var c = null;
  try { c = await accLookup(nom, tel); } catch (e) { c = { offline: true }; }
  btn.disabled = false; btn.textContent = 'Entrer';
  if (!c || c.offline) c = { id: null, nom: nom, tel: accDigits(tel), points: 0, visites: 1 };   // hors ligne : profil local
  ACC_CLIENT = c; accSave(c);
  accShowWelcome();
}

function accShowWelcome() {
  var c = ACC_CLIENT, t = accTier(c.points), nx = accNext(c.points), z = accZoneInfo();
  var ov = document.getElementById('acc-ov');
  ov.style.setProperty('--tc', t.color);
  document.getElementById('acc-form').style.display = 'none';
  var w = document.getElementById('acc-welcome'); w.style.display = 'block';
  var first = accFirst(c.nom);
  document.getElementById('acc-name').innerHTML = Array.from(first).map(function (ch, i) {
    return '<span style="animation-delay:' + (0.35 + i * 0.07).toFixed(2) + 's">' + accEsc(ch) + '</span>';
  }).join('');
  document.getElementById('acc-loc').innerHTML = z.ic + ' <b>' + accEsc(TABLE_DATA.nom) + '</b>' + (z.zone ? ' · ' + accEsc(z.zone) : '');
  document.getElementById('acc-badge').innerHTML = '<i>' + t.ic + '</i> ' + accEsc(t.label);
  document.getElementById('acc-perk').innerHTML = t.perks.slice(0, 3).map(function (p) { return '✦ ' + accEsc(p); }).join('<br>');
  var pct = nx ? Math.min(100, Math.round(((c.points - t.min) / (nx.min - t.min)) * 100)) : 100;
  document.getElementById('acc-bar-fill').dataset.pct = pct;
  document.getElementById('acc-next').textContent = nx ? (c.points + ' / ' + nx.min + ' pts pour ' + nx.label) : (c.points + ' pts · niveau maximum');
  // confettis
  var conf = document.getElementById('acc-conf'); conf.innerHTML = '';
  var bits = ['✨', '🎉', '⭐', t.ic, '🍾'];
  for (var i = 0; i < 22; i++) {
    var e = document.createElement('i'); e.textContent = bits[i % bits.length];
    e.style.left = (Math.random() * 100) + '%'; e.style.fontSize = (12 + Math.random() * 16) + 'px';
    e.style.animationDuration = (3 + Math.random() * 3) + 's'; e.style.animationDelay = (Math.random() * 1.6) + 's';
    conf.appendChild(e);
  }
  ov.classList.add('open');
  setTimeout(function () { var f = document.getElementById('acc-bar-fill'); if (f) f.style.width = f.dataset.pct + '%'; }, 60);
  accRenderChip();
}

function accEnter() { document.getElementById('acc-ov').classList.remove('open'); }
function accReset() {
  try { localStorage.removeItem(accKey()); } catch (e) {}
  ACC_CLIENT = null; document.getElementById('client-chip').classList.remove('on');
  document.getElementById('acc-nom').value = ''; document.getElementById('acc-tel').value = '';
  accShowForm();
}

function accRenderChip() {
  var chip = document.getElementById('client-chip'); if (!chip || !ACC_CLIENT) return;
  var t = accTier(ACC_CLIENT.points);
  chip.style.setProperty('--tc', t.color);
  chip.innerHTML = '<span>👋</span><span class="cc-name">' + accEsc(accFirst(ACC_CLIENT.nom)) + '</span>' +
    '<span class="cc-tier">' + t.ic + ' ' + accEsc(t.label) + '</span><span class="cc-pts">' + (ACC_CLIENT.points || 0) + ' pts</span>' +
    '<button onclick="accReset()">Changer</button>';
  chip.classList.add('on');
}

// Points gagnés à chaque commande (comme sur l'application du serveur)
async function accAddPoints(montant) {
  if (!ACC_CLIENT) return;
  var gain = Math.floor((montant || 0) / 1000) * 10 || 10;
  ACC_CLIENT.points = (ACC_CLIENT.points || 0) + gain;
  accSave(ACC_CLIENT); accRenderChip();
  if (ACC_CLIENT.id) { try { await db.from('clients').update({ points: ACC_CLIENT.points }).eq('id', ACC_CLIENT.id); } catch (e) {} }
  return gain;
}
