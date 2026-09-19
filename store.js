/* store.js — IndexedDB adapter for Bin & Shelf.
   One small module behind the whole app, with the shape the UI expects:
     subscribe(collection, cb) -> unsubscribe
     add(collection, data)     -> Promise<id>
     update(collection, id, patch)
     remove(collection, id)
   Collections: 'places', 'containers'. A sync backend can replace the guts
   later without the UI noticing. */

const DB_NAME = 'bin-and-shelf';
const DB_VERSION = 1;
const COLLECTIONS = ['places', 'containers'];
const META = 'meta';

let dbp = null;

function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      COLLECTIONS.concat([META]).forEach((name) => {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
  return dbp;
}

function reqp(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* Run fn against one store and settle on the transaction, so a write is
   really on disk before the UI hears about it. */
function tx(storeName, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        let result;
        let failure = null;
        t.oncomplete = () => (failure ? reject(failure) : resolve(result));
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(failure || t.error || new Error('aborted'));
        Promise.resolve(fn(t.objectStore(storeName))).then(
          (v) => { result = v; },
          (e) => {
            failure = e;
            try { t.abort(); } catch (_) { /* already settled */ }
          }
        );
      })
  );
}

/* Errors get a short code the UI can speak about. */
function wrap(err) {
  const e = err instanceof Error ? err : new Error(String(err));
  const name = (err && err.name) || '';
  if (!e.code) {
    if (name === 'QuotaExceededError') e.code = 'quota_exceeded';
    else if (name === 'ConstraintError' || name === 'DataError') e.code = 'invalid_argument';
    else e.code = 'failed';
  }
  return e;
}

export function uid() {
  try {
    if (self.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  } catch (e) { /* older Safari */ }
  return 'x' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/* ---- in-memory mirror, so reads are instant and listeners are cheap ---- */
const cache = Object.create(null);
const listeners = Object.create(null);
COLLECTIONS.forEach((c) => { cache[c] = null; listeners[c] = []; });

let channel = null;
try { channel = new BroadcastChannel('bin-and-shelf'); } catch (e) { /* not everywhere */ }
if (channel) {
  channel.onmessage = (ev) => {
    const c = ev.data && ev.data.collection;
    if (c && COLLECTIONS.indexOf(c) !== -1) load(c, true).then(() => emit(c), () => {});
  };
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function emit(collection) {
  const rows = cache[collection] || [];
  listeners[collection].slice().forEach((cb) => {
    try { cb(rows.map(clone)); } catch (e) { console.error(e); }
  });
}

function announce(collection) {
  emit(collection);
  if (channel) { try { channel.postMessage({ collection }); } catch (e) { /* closed */ } }
}

function load(collection, force) {
  if (cache[collection] && !force) return Promise.resolve(cache[collection]);
  return tx(collection, 'readonly', (store) => reqp(store.getAll())).then(
    (rows) => { cache[collection] = rows || []; return cache[collection]; },
    (e) => { throw wrap(e); }
  );
}

/* ---------------- public API ---------------- */

export function subscribe(collection, cb) {
  listeners[collection].push(cb);
  load(collection).then(
    () => cb((cache[collection] || []).map(clone)),
    (e) => { console.error('Could not read ' + collection, e); cb([]); }
  );
  return function unsubscribe() {
    const i = listeners[collection].indexOf(cb);
    if (i !== -1) listeners[collection].splice(i, 1);
  };
}

export function add(collection, data) {
  const rec = Object.assign({}, data, { id: (data && data.id) || uid() });
  return load(collection)
    .then(() => tx(collection, 'readwrite', (store) => reqp(store.put(rec))))
    .then(
      () => {
        cache[collection] = (cache[collection] || []).filter((r) => r.id !== rec.id).concat([rec]);
        announce(collection);
        return rec.id;
      },
      (e) => { throw wrap(e); }
    );
}

export function update(collection, id, patch) {
  return load(collection)
    .then(() => tx(collection, 'readwrite', (store) => reqp(store.get(id)).then((cur) => {
      if (!cur) throw Object.assign(new Error('No such record'), { code: 'invalid_argument' });
      const next = Object.assign({}, cur, patch, { id: id });
      return reqp(store.put(next)).then(() => next);
    })))
    .then(
      (next) => {
        cache[collection] = (cache[collection] || []).map((r) => (r.id === id ? next : r));
        announce(collection);
      },
      (e) => { throw wrap(e); }
    );
}

export function remove(collection, id) {
  return load(collection)
    .then(() => tx(collection, 'readwrite', (store) => reqp(store.delete(id))))
    .then(
      () => {
        cache[collection] = (cache[collection] || []).filter((r) => r.id !== id);
        announce(collection);
      },
      (e) => { throw wrap(e); }
    );
}

export function all(collection) {
  return load(collection).then((rows) => rows.map(clone));
}

/* ---- small key/value side table: seed flag, last backup date ---- */
export function getMeta(key) {
  return tx(META, 'readonly', (store) => reqp(store.get(key))).then(
    (r) => (r ? r.value : undefined),
    () => undefined
  );
}

export function setMeta(key, value) {
  return tx(META, 'readwrite', (store) => reqp(store.put({ id: key, value: value }))).then(
    () => value,
    (e) => { throw wrap(e); }
  );
}

/* ---- backup / restore ---- */
export function exportAll() {
  return Promise.all(COLLECTIONS.map((c) => all(c))).then((sets) => {
    const out = { app: 'bin-and-shelf', version: 1, exportedAt: new Date().toISOString() };
    /* always the same order, so two backups of the same data compare equal */
    COLLECTIONS.forEach((c, i) => {
      out[c] = sets[i].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    });
    return out;
  });
}

/* Replaces everything. Used by Import JSON, after the user confirms. */
export function replaceAll(data) {
  const next = {};
  COLLECTIONS.forEach((c) => {
    const rows = Array.isArray(data && data[c]) ? data[c] : [];
    next[c] = rows
      .filter((r) => r && typeof r === 'object')
      .map((r) => Object.assign({}, r, { id: r.id || uid() }));
  });
  return openDb()
    .then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(COLLECTIONS, 'readwrite');
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('aborted'));
      COLLECTIONS.forEach((c) => {
        const store = t.objectStore(c);
        store.clear();
        next[c].forEach((r) => store.put(r));
      });
    }))
    .then(() => Promise.all(COLLECTIONS.map((c) => load(c, true))))
    .then(
      () => { COLLECTIONS.forEach(announce); },
      (e) => { throw wrap(e); }
    );
}

/* Ask the browser to keep this data. Installed home-screen apps are mostly
   exempt from eviction anyway, but it costs nothing to ask. */
export function persist() {
  if (!navigator.storage || !navigator.storage.persist) return Promise.resolve(false);
  const s = navigator.storage;
  const already = s.persisted ? s.persisted() : Promise.resolve(false);
  return already.then((p) => (p ? true : s.persist())).catch(() => false);
}
