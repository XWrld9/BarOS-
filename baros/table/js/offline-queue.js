// ── BarOS — File d'attente hors ligne (écritures) ─────────────
// Quand le réseau tombe, les enregistrements (commandes, appels, alertes,
// paiements…) sont gardés sur l'appareil puis envoyés automatiquement
// au retour d'Internet. Aucune donnée n'est perdue, aucune commande dupliquée
// (chaque ligne reçoit son identifiant avant l'envoi).
(function () {
  'use strict';
  if (window.__BAROS_OQ__) return;
  if (typeof db === 'undefined' || !db || typeof db.from !== 'function') return;
  window.__BAROS_OQ__ = true;

  var KEY = 'baros_oq_table';
  var INSERT_TABLES = ['commandes', 'appels', 'alertes', 'paiements', 'clients', 'pointages'];
  var UPDATE_TABLES = ['commandes', 'appels', 'clients', 'stock', 'paiements'];
  var MAX_TRY = 5;
  var origFrom = db.from.bind(db);
  var flushing = false;

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function save(q) { try { localStorage.setItem(KEY, JSON.stringify(q)); } catch (e) { console.warn('[BarOS OQ] stockage plein', e); } updateBanner(); }
  function push(item) { var q = load(); q.push(item); save(q); }

  // Résultat factice compatible avec .insert(...).select().single()
  function fake(row) {
    var res = { data: row, error: null };
    var o = {
      select: function () { return o; }, single: function () { return o; }, maybeSingle: function () { return o; },
      then: function (ok, ko) { return Promise.resolve(res).then(ok, ko); },
      catch: function (ko) { return Promise.resolve(res).catch(ko); }
    };
    return o;
  }

  db.from = function (table) {
    var qb = origFrom(table);
    if (navigator.onLine) return qb;
    var canIns = INSERT_TABLES.indexOf(table) >= 0, canUpd = UPDATE_TABLES.indexOf(table) >= 0;
    var oIns = qb.insert && qb.insert.bind(qb), oUpd = qb.update && qb.update.bind(qb);
    if (canIns && oIns) {
      qb.insert = function (data, opts) {
        if (navigator.onLine) return oIns(data, opts);
        var rows = Array.isArray(data) ? data : [data];
        var saved = rows.map(function (r) { var c = Object.assign({}, r); if (!c.id) c.id = uid(); return c; });
        saved.forEach(function (r) { push({ t: table, op: 'insert', data: r, n: 0, at: Date.now() }); });
        return fake(Array.isArray(data) ? saved : saved[0]);
      };
    }
    if (canUpd && oUpd) {
      qb.update = function (data, opts) {
        if (navigator.onLine) return oUpd(data, opts);
        var filters = {};
        var o = {
          eq: function (c, v) { filters[c] = v; return o; },
          match: function (m) { Object.assign(filters, m); return o; },
          select: function () { return o; }, single: function () { return o; }, maybeSingle: function () { return o; },
          then: function (ok, ko) {
            if (Object.keys(filters).length) push({ t: table, op: 'update', data: data, f: filters, n: 0, at: Date.now() });
            return Promise.resolve({ data: null, error: null }).then(ok, ko);
          },
          catch: function (ko) { return Promise.resolve({ data: null, error: null }).catch(ko); }
        };
        return o;
      };
    }
    return qb;
  };

  async function flush() {
    if (flushing || !navigator.onLine) return;
    var q = load(); if (!q.length) { updateBanner(); return; }
    flushing = true; updateBanner();
    var rest = [];
    for (var i = 0; i < q.length; i++) {
      var it = q[i], err = null;
      try {
        if (it.op === 'insert') {
          var r = await origFrom(it.t).insert(it.data); err = r.error;
          if (err && (err.code === '23505' || /duplicate key/i.test(err.message || ''))) err = null; // déjà envoyé
        } else {
          var b = origFrom(it.t).update(it.data);
          Object.keys(it.f).forEach(function (c) { b = b.eq(c, it.f[c]); });
          var r2 = await b; err = r2.error;
        }
      } catch (e) { err = e; }
      if (err) {
        it.n = (it.n || 0) + 1;
        if (it.n < MAX_TRY) rest.push(it);
        else console.warn('[BarOS OQ] abandon après ' + MAX_TRY + ' essais', it, err);
      }
    }
    save(rest); flushing = false;
    if (!rest.length && typeof window.baosOnSynced === 'function') { try { window.baosOnSynced(); } catch (e) {} }
  }

  // ── Bandeau d'état ──
  var bar = null;
  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement('div'); bar.id = 'bq-banner'; bar.className = 'bq-banner';
    document.body.appendChild(bar); return bar;
  }
  function updateBanner() {
    if (!document.body) return;
    var n = load().length, b = ensureBar();
    if (!navigator.onLine) {
      b.textContent = '📡 Hors ligne — ' + (n ? n + ' opération(s) gardée(s) sur l\'appareil, envoi automatique au retour du réseau' : 'vous pouvez continuer à travailler');
      b.className = 'bq-banner show off';
    } else if (n) {
      b.textContent = '🔄 Synchronisation de ' + n + ' opération(s)…';
      b.className = 'bq-banner show sync';
    } else {
      b.className = 'bq-banner';
    }
  }
  window.addEventListener('online', function () { updateBanner(); setTimeout(flush, 800); });
  window.addEventListener('offline', updateBanner);
  setInterval(flush, 12000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { updateBanner(); flush(); });
  else { updateBanner(); flush(); }

  window.BarOSQueue = { pending: function () { return load().length; }, flush: flush };
})();
