/**
 * ══════════════════════════════════════════════════════════════════
 * BAROS OFFLINE-FIRST + SESSION 30 JOURS — baros-offline.js v1.0
 * ══════════════════════════════════════════════════════════════════
 *
 * PRINCIPE : patch NON INVASIF — aucune ligne du core BarOS modifiée.
 *
 * Ce module :
 *   1. Étend BarOSSec pour persister la session 30 jours en IndexedDB
 *   2. Wrape window.db (client Supabase) pour intercepter les writes
 *      lorsque le réseau est absent et les mettre en queue locale
 *   3. Rejoue la queue automatiquement au retour du réseau
 *   4. Ne modifie aucune logique métier, aucun endpoint, aucun format
 *
 * INSTALLATION :
 *   Ajouter dans chaque HTML, APRÈS tous les <script> existants :
 *   <script src="baros-offline.js"><\/script>
 *
 * ── CONTRAINTES RESPECTÉES ───────────────────────────────────────
 *   ✔ Aucun fichier core modifié
 *   ✔ Aucune logique métier changée
 *   ✔ Backend totalement inchangé
 *   ✔ Wrappers + IndexedDB uniquement
 *   ✔ S'auto-désactive si le core change d'interface
 * ══════════════════════════════════════════════════════════════════
 */

(function (global) {
  'use strict';

  // ── Guard : ne s'initialise qu'une fois ──────────────────────────
  if (global.__BAROS_OFFLINE_LOADED__) return;
  global.__BAROS_OFFLINE_LOADED__ = true;

  // ═══════════════════════════════════════════════════════════════
  // SECTION 1 — CONFIGURATION
  // ═══════════════════════════════════════════════════════════════

  const CFG = Object.freeze({
    SESSION_TTL_MS:    30 * 24 * 60 * 60 * 1000,   // 30 jours
    IDB_NAME:          'baros_offline_v1',
    IDB_VERSION:       1,
    STORE_SESSION:     'session',
    STORE_QUEUE:       'event_queue',
    STORE_NOTIFS:      'notif_queue',
    SYNC_RETRY_MS:     5_000,          // Retry auto toutes les 5s si online
    SYNC_BATCH_SIZE:   20,             // Max events rejoués par cycle
    LOG_PREFIX:        '[BarOS Offline]',
  });

  // ═══════════════════════════════════════════════════════════════
  // SECTION 2 — INDEXEDDB LAYER
  // ═══════════════════════════════════════════════════════════════

  let _idb = null;

  function openIDB() {
    if (_idb) return Promise.resolve(_idb);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(CFG.IDB_NAME, CFG.IDB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        // Store session (clé fixe 'current')
        if (!db.objectStoreNames.contains(CFG.STORE_SESSION)) {
          db.createObjectStore(CFG.STORE_SESSION, { keyPath: 'key' });
        }
        // Event queue — auto-incrémentée
        if (!db.objectStoreNames.contains(CFG.STORE_QUEUE)) {
          const qs = db.createObjectStore(CFG.STORE_QUEUE, {
            keyPath: 'id', autoIncrement: true
          });
          qs.createIndex('status', 'status');
        }
        // Notifications offline
        if (!db.objectStoreNames.contains(CFG.STORE_NOTIFS)) {
          db.createObjectStore(CFG.STORE_NOTIFS, {
            keyPath: 'id', autoIncrement: true
          });
        }
      };
      req.onsuccess = (e) => { _idb = e.target.result; resolve(_idb); };
      req.onerror   = (e) => { reject(e.target.error); };
    });
  }

  function idbGet(storeName, key) {
    return openIDB().then(db => new Promise((res, rej) => {
      const tx  = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => res(req.result ?? null);
      req.onerror   = () => rej(req.error);
    }));
  }

  function idbPut(storeName, value) {
    return openIDB().then(db => new Promise((res, rej) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(value);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    }));
  }

  function idbDelete(storeName, key) {
    return openIDB().then(db => new Promise((res, rej) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(key);
      req.onsuccess = () => res();
      req.onerror   = () => rej(req.error);
    }));
  }

  /** Récupérer tous les enregistrements d'un store par index */
  function idbGetAllByIndex(storeName, indexName, value) {
    return openIDB().then(db => new Promise((res, rej) => {
      const tx    = db.transaction(storeName, 'readonly');
      const index = tx.objectStore(storeName).index(indexName);
      const req   = index.getAll(value);
      req.onsuccess = () => res(req.result ?? []);
      req.onerror   = () => rej(req.error);
    }));
  }

  function idbUpdateStatus(storeName, id, status) {
    return openIDB().then(db => new Promise((res, rej) => {
      const tx    = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req   = store.get(id);
      req.onsuccess = () => {
        const rec = req.result;
        if (!rec) { res(); return; }
        rec.status = status;
        rec.updated_at = Date.now();
        store.put(rec).onsuccess = () => res();
      };
      req.onerror = () => rej(req.error);
    }));
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 3 — SESSION 30 JOURS
  // Étend BarOSSec si présent, sinon crée les méthodes directement
  // ═══════════════════════════════════════════════════════════════

  /**
   * Sauvegarde la session dans IndexedDB avec TTL 30 jours.
   * Compatible avec BarOSSec.saveSecureSession (lecture uniquement).
   */
  async function saveSession30j(sessionData) {
    if (!sessionData) return;
    const record = {
      key:        'current',
      user_id:    sessionData.id,
      role:       sessionData.role,
      etab_id:    sessionData.etab_id,
      email:      sessionData.email,
      nom:        sessionData.nom,
      couleur:    sessionData.couleur,
      is_active:  sessionData.is_active,
      created_at: Date.now(),
      expires_at: Date.now() + CFG.SESSION_TTL_MS,
      _raw:       JSON.stringify(sessionData),   // données complètes pour startApp
    };
    try {
      await idbPut(CFG.STORE_SESSION, record);
      _log('Session 30j sauvegardée', { etab_id: record.etab_id, role: record.role });
    } catch (e) {
      _warn('Impossible de sauvegarder la session IDB', e);
    }
  }

  /**
   * Lit la session depuis IndexedDB. Retourne null si expirée.
   */
  async function getSession30j() {
    try {
      const rec = await idbGet(CFG.STORE_SESSION, 'current');
      if (!rec) return null;
      if (Date.now() > rec.expires_at) {
        await clearSession30j();
        _log('Session IDB expirée — effacée');
        return null;
      }
      return JSON.parse(rec._raw);
    } catch (e) {
      _warn('Lecture session IDB échouée', e);
      return null;
    }
  }

  /**
   * Efface la session IndexedDB (logout ou expiration).
   */
  async function clearSession30j() {
    try {
      await idbDelete(CFG.STORE_SESSION, 'current');
    } catch (e) { /* silent */ }
  }

  /**
   * Patch de BarOSSec : on enveloppe ses méthodes sans les écraser.
   * BarOSSec continue de fonctionner normalement (localStorage/sessionStorage),
   * on ajoute juste la persistance IDB en parallèle.
   */
  function _patchBarOSSec() {
    if (typeof global.BarOSSec !== 'object' || !global.BarOSSec) return false;

    const orig = global.BarOSSec;

    // saveSecureSession → en plus : sauvegarder en IDB
    const _origSave = orig.saveSecureSession?.bind(orig);
    if (_origSave) {
      orig.saveSecureSession = function (sessionData) {
        if (_origSave) _origSave(sessionData);     // comportement original intact
        saveSession30j(sessionData);               // extension IDB
      };
    }

    // clearSecureSession → en plus : effacer IDB
    const _origClear = orig.clearSecureSession?.bind(orig);
    if (_origClear) {
      orig.clearSecureSession = function () {
        if (_origClear) _origClear();
        clearSession30j();
      };
    }

    // getSecureSession → si null (sessionStorage expiré), tenter IDB
    // On NE remplace PAS : on expose une fonction auxiliaire
    // que restoreSession peut appeler (voir Section 5)

    _log('BarOSSec patché pour session 30j IDB');
    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 4 — EVENT QUEUE (OFFLINE WRITE BUFFER)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Ajoute un événement à la queue offline.
   * Chaque event est append-only et immuable une fois écrit.
   */
  async function enqueueEvent(type, table, operation, payload, filter = null) {
    const event = {
      type,
      table,
      operation,   // 'insert' | 'update' | 'delete' | 'upsert'
      payload,
      filter,
      timestamp:   Date.now(),
      status:      'PENDING',
      retry_count: 0,
      created_at:  Date.now(),
    };
    try {
      const id = await idbPut(CFG.STORE_QUEUE, event);
      _log(`Event enqueued: ${operation} ${table}`, { id, type });
      return id;
    } catch (e) {
      _warn('Impossible d\'enqueuer l\'event', e);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 5 — WRAPPER SUPABASE DB
  // Intercepte uniquement les appels write (insert/update/delete/upsert)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Crée un proxy sur db.from(table) qui intercepte les méthodes write
   * quand l'application est hors-ligne. Les reads passent toujours.
   */
  function _wrapDbClient(originalDb) {
    if (!originalDb || typeof originalDb.from !== 'function') return originalDb;

    const origFrom = originalDb.from.bind(originalDb);

    originalDb.from = function (tableName) {
      const queryBuilder = origFrom(tableName);

      // Si en ligne, comportement totalement transparent
      if (navigator.onLine) return queryBuilder;

      // Hors-ligne : wrapper sur les méthodes write uniquement
      return _wrapQueryBuilder(queryBuilder, tableName);
    };

    _log('Wrapper db.from() installé');
    return originalDb;
  }

  function _wrapQueryBuilder(qb, tableName) {
    // Tables pour lesquelles on accepte la mise en queue offline
    // (exclude: sessions, security_logs — pas de sens hors-ligne)
    const QUEUEABLE_TABLES = [
      'commandes', 'stock', 'alertes', 'employes',
      'pointages', 'communications', 'clients',
    ];

    const isQueueable = QUEUEABLE_TABLES.includes(tableName);

    // Intercepter insert
    const origInsert = qb.insert?.bind(qb);
    if (origInsert && isQueueable) {
      qb.insert = function (data, opts) {
        if (!navigator.onLine) {
          enqueueEvent('WRITE', tableName, 'insert', data);
          _showOfflineBanner();
          // Retourner un résultat factice sans erreur pour ne pas bloquer l'UI
          return Promise.resolve({ data: _fakeInsertResult(data), error: null });
        }
        return origInsert(data, opts);
      };
    }

    // Intercepter update
    const origUpdate = qb.update?.bind(qb);
    if (origUpdate && isQueueable) {
      // update() retourne un builder avec .eq()/.match() — on intercepte après
      qb.update = function (data, opts) {
        if (!navigator.onLine) {
          // Capturer le filtre via proxy sur la chain .eq()
          const updateProxy = _chainProxy(
            origUpdate(data, opts),
            tableName, 'update', data
          );
          return updateProxy;
        }
        return origUpdate(data, opts);
      };
    }

    // Intercepter upsert
    const origUpsert = qb.upsert?.bind(qb);
    if (origUpsert && isQueueable) {
      qb.upsert = function (data, opts) {
        if (!navigator.onLine) {
          enqueueEvent('WRITE', tableName, 'upsert', data);
          _showOfflineBanner();
          return Promise.resolve({ data: _fakeInsertResult(data), error: null });
        }
        return origUpsert(data, opts);
      };
    }

    return qb;
  }

  /**
   * Proxy sur la chain .eq()/.match() d'un update builder hors-ligne.
   * Capture le filtre et enqueue sans bloquer la chain.
   */
  function _chainProxy(builder, tableName, operation, data) {
    const filter = {};
    const proxy = new Proxy(builder || {}, {
      get(target, prop) {
        if (prop === 'eq') {
          return function (col, val) {
            filter[col] = val;
            return proxy; // chaînable
          };
        }
        if (prop === 'match') {
          return function (obj) {
            Object.assign(filter, obj);
            return proxy;
          };
        }
        // Toute autre méthode (then, catch, finally) → enqueue et résoudre
        if (prop === 'then') {
          return function (resolve, reject) {
            enqueueEvent('WRITE', tableName, operation, data, filter);
            _showOfflineBanner();
            resolve({ data: null, error: null });
          };
        }
        if (prop === 'catch') return () => proxy;
        if (prop === 'finally') return (fn) => { if (fn) fn(); return proxy; };
        // Fallback target original
        const val = target[prop];
        return typeof val === 'function' ? val.bind(target) : val;
      }
    });
    return proxy;
  }

  function _fakeInsertResult(data) {
    // Retourner une structure minimale compatible avec ce qu'attend le code existant
    if (Array.isArray(data)) return data.map(d => ({ ...d, id: d.id || '__offline__' }));
    return { ...data, id: data?.id || '__offline__' };
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 6 — SYNCHRONISATION (REPLAY)
  // Rejoue la queue sur l'API existante, sans modifier les endpoints
  // ═══════════════════════════════════════════════════════════════

  let _syncTimer = null;
  let _syncing   = false;

  async function syncQueue() {
    if (_syncing || !navigator.onLine) return;
    _syncing = true;

    try {
      const pending = await idbGetAllByIndex(CFG.STORE_QUEUE, 'status', 'PENDING');
      if (pending.length === 0) { _syncing = false; return; }

      _log(`Sync: ${pending.length} event(s) en attente`);

      const batch = pending.slice(0, CFG.SYNC_BATCH_SIZE);
      const originalDb = global.db;   // db original (non wrappé pour les writes de sync)

      if (!originalDb) { _syncing = false; return; }

      for (const event of batch) {
        try {
          await _replayEvent(originalDb, event);
          await idbUpdateStatus(CFG.STORE_QUEUE, event.id, 'SYNCED');
          _log(`Event ${event.id} rejoué: ${event.operation} ${event.table}`);
        } catch (e) {
          // Incrémenter retry_count, marquer FAILED après 5 tentatives
          await _incrementRetry(event);
          _warn(`Event ${event.id} échoué (retry ${event.retry_count})`, e);
        }
      }

      // Nettoyer les events SYNCED vieux de plus de 24h
      _cleanOldEvents();

    } catch (e) {
      _warn('Erreur sync queue', e);
    } finally {
      _syncing = false;
    }
  }

  /**
   * Rejoue un event sur l'API existante.
   * Format de requête 100% identique à l'original.
   */
  async function _replayEvent(db, event) {
    const { table, operation, payload, filter } = event;
    let q = db.from(table);

    switch (operation) {
      case 'insert':
        q = q.insert(payload);
        break;
      case 'update': {
        q = q.update(payload);
        if (filter) {
          for (const [col, val] of Object.entries(filter)) {
            q = q.eq(col, val);
          }
        }
        break;
      }
      case 'upsert':
        q = q.upsert(payload);
        break;
      case 'delete': {
        q = q.delete();
        if (filter) {
          for (const [col, val] of Object.entries(filter)) {
            q = q.eq(col, val);
          }
        }
        break;
      }
      default:
        throw new Error(`Operation inconnue: ${operation}`);
    }

    const { error } = await q;
    if (error) throw error;
  }

  async function _incrementRetry(event) {
    return openIDB().then(db => new Promise((res) => {
      const tx    = db.transaction(CFG.STORE_QUEUE, 'readwrite');
      const store = tx.objectStore(CFG.STORE_QUEUE);
      const req   = store.get(event.id);
      req.onsuccess = () => {
        const rec = req.result;
        if (!rec) { res(); return; }
        rec.retry_count = (rec.retry_count || 0) + 1;
        if (rec.retry_count >= 5) rec.status = 'FAILED';
        rec.updated_at = Date.now();
        store.put(rec).onsuccess = () => res();
      };
    }));
  }

  async function _cleanOldEvents() {
    try {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const db = await openIDB();
      const tx = db.transaction(CFG.STORE_QUEUE, 'readwrite');
      const store = tx.objectStore(CFG.STORE_QUEUE);
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return;
        const rec = cursor.value;
        if (rec.status === 'SYNCED' && rec.created_at < cutoff) {
          cursor.delete();
        }
        cursor.continue();
      };
    } catch (e) { /* silent */ }
  }

  // Scheduler de sync
  function _startSyncScheduler() {
    if (_syncTimer) return;
    _syncTimer = setInterval(() => {
      if (navigator.onLine) syncQueue();
    }, CFG.SYNC_RETRY_MS);
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 7 — NOTIFICATIONS OFFLINE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Stocker une notification hors-ligne pour affichage ultérieur.
   * Compatible avec le système sendNotification() existant.
   */
  async function storeNotifOffline(notif) {
    try {
      await idbPut(CFG.STORE_NOTIFS, {
        ...notif,
        stored_at: Date.now(),
        displayed: false,
      });
    } catch (e) { /* silent */ }
  }

  /**
   * Afficher les notifications stockées offline au retour du réseau.
   */
  async function flushOfflineNotifs() {
    try {
      const db  = await openIDB();
      const all = await new Promise((res) => {
        const tx  = db.transaction(CFG.STORE_NOTIFS, 'readwrite');
        const req = tx.objectStore(CFG.STORE_NOTIFS).getAll();
        req.onsuccess = () => res(req.result ?? []);
      });

      const pending = all.filter(n => !n.displayed);
      if (pending.length === 0) return;

      // Utiliser le système de notification existant (showN) si disponible
      for (const notif of pending) {
        if (typeof global.showN === 'function') {
          global.showN('📬 ' + (notif.titre || 'Notification'), 'info');
        }
        await idbUpdateStatus(CFG.STORE_NOTIFS, notif.id, 'displayed');
      }

      _log(`${pending.length} notification(s) offline affichée(s)`);
    } catch (e) { /* silent */ }
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 8 — RESTAURATION SESSION 30J AU DÉMARRAGE
  // Tente de restaurer depuis IDB si BarOSSec.getSecureSession() = null
  // ═══════════════════════════════════════════════════════════════

  /**
   * Hook sur restoreSession existant dans gestionnaire.
   * Écoute l'événement DOMContentLoaded + attend que startApp soit disponible.
   */
  function _hookSessionRestore() {
    // Observer quand l'app est prête (auth-wrap visible = pas encore connecté)
    const _tryRestoreFromIDB = async () => {
      // Vérifier si l'app est déjà connectée (startApp appelé)
      const authWrap = document.getElementById('auth-wrap');
      const shell    = document.getElementById('shell');
      const app      = document.getElementById('app');

      const isConnected = (shell && !shell.classList.contains('hide')) ||
                          (app   && !app.classList.contains('hide'));
      if (isConnected) return; // Déjà connecté, ne rien faire

      // Tenter de récupérer la session IDB
      const session30j = await getSession30j();
      if (!session30j) return;

      _log('Session 30j trouvée en IDB — tentative de restauration');

      // Vérifier que startApp est disponible
      if (typeof global.startApp !== 'function') {
        _warn('startApp non trouvé — restauration ignorée');
        return;
      }

      // Pour gestionnaire : vérifier is_active via Supabase si online
      if (navigator.onLine && global.db) {
        try {
          const { data: fresh } = await global.db
            .from('sessions')
            .select('id,email,nom,role,etab_id,couleur,is_active')
            .eq('id', session30j.id)
            .single();

          if (!fresh) {
            await clearSession30j();
            _log('Session IDB invalide côté serveur — effacée');
            return;
          }

          const adminEmails = global.ADMIN_EMAILS || [];
          if (fresh.is_active === false && !adminEmails.includes((fresh.email || '').toLowerCase().trim())) {
            await clearSession30j();
            _log('Compte désactivé — session IDB effacée');
            return;
          }

          // Mettre à jour le cache IDB avec les données fraîches
          await saveSession30j(fresh);
          global.startApp(fresh);
          _log('Session 30j restaurée depuis IDB (online)');

        } catch (e) {
          _warn('Vérification Supabase échouée — restauration offline', e);
          // En offline, utiliser les données IDB directement
          global.startApp(session30j);
        }
      } else {
        // Offline : restaurer directement depuis IDB (lecture seule)
        _log('Restauration session 30j en mode offline');
        global.startApp(session30j);
      }
    };

    // Pour personnel (PIN screen) : le localStorage gère déjà la session courte
    // On se contente de persister en IDB quand loginByEmail réussit
    const _hookPersonnelLogin = () => {
      const origLoginByEmail = global.loginByEmail;
      if (typeof origLoginByEmail === 'function') {
        global.loginByEmail = async function () {
          await origLoginByEmail.apply(this, arguments);
          // Sauvegarder la session lue dans localStorage en IDB aussi
          try {
            const saved = JSON.parse(localStorage.getItem('baros_session') || 'null');
            if (saved) await saveSession30j(saved);
          } catch (e) { /* silent */ }
        };
        _log('loginByEmail hooked pour session 30j IDB (personnel)');
      }
    };

    // Délai court pour s'assurer que le DOM et les scripts sont prêts
    const _init = () => {
      // Attendre que startApp soit défini (peut être après DOMContentLoaded)
      let attempts = 0;
      const iv = setInterval(async () => {
        attempts++;
        if (attempts > 30) { clearInterval(iv); return; } // 15s max

        if (typeof global.startApp === 'function' || typeof global.loadLogin === 'function') {
          clearInterval(iv);
          _hookPersonnelLogin();

          // Pour gestionnaire : le restoreSession IIFE tourne déjà.
          // On agit uniquement si la session Sec (sessionStorage) est null.
          const secSession = (typeof global.BarOSSec?.getSecureSession === 'function')
            ? global.BarOSSec.getSecureSession()
            : null;

          if (!secSession) {
            await _tryRestoreFromIDB();
          }
        }
      }, 500);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _init);
    } else {
      _init();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 9 — BANNER OFFLINE UI
  // ═══════════════════════════════════════════════════════════════

  function _showOfflineBanner() {
    // Utiliser la bannière existante si présente (off-banner dans gestionnaire)
    const existing = document.getElementById('off-banner');
    if (existing) {
      existing.style.display = 'block';
      return;
    }
    // Créer une bannière minimale si absente (pour pointage)
    if (document.getElementById('__baros_offline_banner__')) return;
    const banner = document.createElement('div');
    banner.id = '__baros_offline_banner__';
    banner.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0',
      'background:#b45309', 'color:#fff', 'font-size:11px',
      'font-weight:500', 'text-align:center', 'padding:6px',
      'z-index:9999', 'display:block'
    ].join(';');
    banner.textContent = '📵 Hors-ligne — opérations en file d\'attente (sync auto au retour)';
    document.body.prepend(banner);
  }

  function _hideOfflineBanner() {
    const existing = document.getElementById('off-banner');
    if (existing) existing.style.display = 'none';
    const custom = document.getElementById('__baros_offline_banner__');
    if (custom) custom.remove();
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 10 — ÉVÉNEMENTS RÉSEAU
  // ═══════════════════════════════════════════════════════════════

  global.addEventListener('online', async () => {
    _log('Réseau rétabli — démarrage sync');
    _hideOfflineBanner();
    await syncQueue();
    await flushOfflineNotifs();
    // Réactiver le wrapper db pour passer en mode transparent
    if (global.db && typeof global.db.from === 'function') {
      _wrapDbClient(global.db);
    }
  });

  global.addEventListener('offline', () => {
    _log('Réseau perdu — mode offline activé');
    _showOfflineBanner();
    // Installer le wrapper intercepteur sur db.from
    if (global.db && typeof global.db.from === 'function') {
      _wrapDbClient(global.db);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // SECTION 11 — API PUBLIQUE
  // ═══════════════════════════════════════════════════════════════

  global.BarOSOffline = {
    version: '1.0.0',

    /** Retourne le nombre d'events en attente de sync */
    async getPendingCount() {
      try {
        const pending = await idbGetAllByIndex(CFG.STORE_QUEUE, 'status', 'PENDING');
        return pending.length;
      } catch { return 0; }
    },

    /** Déclenche manuellement une tentative de sync */
    async forceSync() {
      return syncQueue();
    },

    /** Lire la session IDB directement */
    getSession: getSession30j,
    saveSession: saveSession30j,
    clearSession: clearSession30j,

    /** Enqueue manuel (pour usage avancé) */
    enqueue: enqueueEvent,

    /** Stocker une notification offline */
    storeNotif: storeNotifOffline,

    /** Vider la queue (debug uniquement) */
    async clearQueue() {
      try {
        const db = await openIDB();
        const tx = db.transaction(CFG.STORE_QUEUE, 'readwrite');
        tx.objectStore(CFG.STORE_QUEUE).clear();
        _log('Queue vidée manuellement');
      } catch (e) { _warn('Erreur clear queue', e); }
    },

    /** Stats complètes (debug) */
    async getStats() {
      const pending = await this.getPendingCount();
      const session = await getSession30j();
      const idb     = await openIDB();
      return {
        pending_events: pending,
        session_active: !!session,
        session_expires: session ? new Date(
          (await idbGet(CFG.STORE_SESSION, 'current'))?.expires_at
        ).toLocaleString() : null,
        is_online:      navigator.onLine,
        db_name:        CFG.IDB_NAME,
      };
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // SECTION 12 — INITIALISATION AUTOMATIQUE
  // ═══════════════════════════════════════════════════════════════

  function _autoInit() {
    // 1. Ouvrir IndexedDB immédiatement (warm-up)
    openIDB().then(() => _log('IndexedDB initialisée')).catch(_warn);

    // 2. Patcher BarOSSec si disponible
    // (peut être chargé après ce script → retry)
    let barOSSecPatched = false;
    const patchIv = setInterval(() => {
      if (!barOSSecPatched && typeof global.BarOSSec === 'object') {
        barOSSecPatched = _patchBarOSSec();
        if (barOSSecPatched) clearInterval(patchIv);
      }
    }, 200);
    setTimeout(() => clearInterval(patchIv), 5000);

    // 3. Wrapper db (Supabase) — s'applique quand offline
    // Le wrapper est installé dynamiquement via les events réseau
    // Installer si déjà offline au chargement
    if (!navigator.onLine) {
      const dbWaitIv = setInterval(() => {
        if (global.db) {
          _wrapDbClient(global.db);
          clearInterval(dbWaitIv);
        }
      }, 300);
      setTimeout(() => clearInterval(dbWaitIv), 8000);
    }

    // 4. Hook restauration session
    _hookSessionRestore();

    // 5. Démarrer le scheduler de sync
    _startSyncScheduler();

    // 6. Sync immédiate si online et queue non vide
    if (navigator.onLine) {
      setTimeout(syncQueue, 2000);
    }

    _log('Initialisation complète v' + global.BarOSOffline.version);
  }

  // ── Utilitaires ──────────────────────────────────────────────────
  function _log(...args)  { console.log(CFG.LOG_PREFIX, ...args); }
  function _warn(...args) { console.warn(CFG.LOG_PREFIX, ...args); }

  // ── Lancement ────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _autoInit);
  } else {
    _autoInit();
  }

})(window);

/* ═══════════════════════════════════════════════════════════════════
   GUIDE D'INSTALLATION — 3 ÉTAPES
   ═══════════════════════════════════════════════════════════════════

   ÉTAPE 1 — Déposer ce fichier à la racine du projet
   ────────────────────────────────────────────────────
   Même dossier que les trois HTML BarOS.


   ÉTAPE 2 — Ajouter une ligne dans chaque HTML
   ─────────────────────────────────────────────
   Dans gestionnaire_fixed_6_secured.html — AVANT </body> :
     <script src="baros-offline.js"><\/script>

   Dans personnel_callsystem_fixed__4_.html — AVANT </body> :
     <script src="baros-offline.js"><\/script>

   Dans pointage_v9_hyperscan.html — AVANT </body> :
     <script src="baros-offline.js"><\/script>


   ÉTAPE 3 — Vérification (console navigateur)
   ────────────────────────────────────────────
   // État global
   await BarOSOffline.getStats()

   // Nombre d'events en attente
   await BarOSOffline.getPendingCount()

   // Forcer une sync manuelle
   await BarOSOffline.forceSync()

   // Session IDB active
   await BarOSOffline.getSession()


   COMPORTEMENT ATTENDU
   ─────────────────────
   Online  → tout fonctionne exactement comme avant (transparent)
   Offline → les writes (commandes, stock, alertes) sont mis en queue
             locale. L'UI ne bloque pas. La bannière s'affiche.
   Retour  → les events sont rejoués automatiquement dans l'ordre
             d'insertion, sur les mêmes endpoints Supabase.
   Session → après login, la session est persistée 30 jours en IDB.
             Au prochain chargement, même sans re-login, l'app
             restaure la session si elle n'a pas expiré.


   LIMITES VOLONTAIRES (conformité anti-rebuild)
   ──────────────────────────────────────────────
   • Les reads (SELECT) ne sont pas mis en cache offline (pas de scope)
   • Les writes sur tables système (sessions, security_logs) ne sont
     pas mis en queue (ne font pas sens hors-ligne)
   • Si un event échoue 5× il passe en FAILED (visible en console)
   • La session 30j ne bypasse pas is_active === false (vérification
     backend conservée dès que le réseau est disponible)

   ═══════════════════════════════════════════════════════════════════ */
