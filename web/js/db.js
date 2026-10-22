// Stockage local (IndexedDB). Toutes les données restent sur l'appareil jusqu'à la synchronisation.
const DB_NAME = 'crm-volaille';
const DB_VERSION = 1;
export const STORES = ['clients', 'visites', 'taches', 'plans'];

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      STORES.forEach(s => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'mid' });
      if (!db.objectStoreNames.contains('conflicts')) db.createObjectStore('conflicts', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Base locale bloquée : fermez les autres onglets de l\'application.'));
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction annulée'));
  });
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll(store) {
  const db = await openDb();
  return reqP(db.transaction(store).objectStore(store).getAll());
}

/**
 * Écrit plusieurs magasins dans une seule transaction : soit tout est enregistré, soit rien.
 * ops : [{ store, put: obj } | { store, del: key } | { store, clear: true }]
 */
export async function write(ops) {
  const db = await openDb();
  const names = [...new Set(ops.map(o => o.store))];
  const tx = db.transaction(names, 'readwrite', { durability: 'strict' });
  ops.forEach(o => {
    const s = tx.objectStore(o.store);
    if (o.clear) s.clear();
    if (o.put) s.put(o.put);
    if (o.del !== undefined) s.delete(o.del);
  });
  return done(tx);
}

export async function getMeta(k, fallback) {
  const db = await openDb();
  const r = await reqP(db.transaction('meta').objectStore('meta').get(k));
  return r ? r.v : fallback;
}

export function setMeta(k, v) {
  return write([{ store: 'meta', put: { k, v } }]);
}

export async function wipe() {
  const db = await openDb();
  const names = [...STORES, 'outbox', 'conflicts', 'meta'];
  const tx = db.transaction(names, 'readwrite');
  names.forEach(n => tx.objectStore(n).clear());
  return done(tx);
}
