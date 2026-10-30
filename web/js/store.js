// État de l'application, file de modifications et synchronisation avec le classeur.
import * as db from './db.js';
import { call, ApiError, errorMessage } from './api.js';

const ENTITIES = ['client', 'visite', 'tache', 'plan'];
const PERMANENT_ERRORS = ['NOT_FOUND', 'FORBIDDEN', 'UNKNOWN_ENTITY', 'BAD_ID', 'BAD_MUTATION', 'UNKNOWN_OP'];
const PUSH_CHUNK = 50;

export const state = {
  ready: false,
  token: null,
  user: null,
  settings: { seuilARevoir: 40, seuilUrgent: 57 },
  commerciaux: [],
  clients: new Map(),
  visites: new Map(),
  taches: new Map(),
  plans: new Map(),
  outbox: [],
  conflicts: [],
  lastSync: null,
  sync: { status: 'idle', error: null, needsLogin: false }
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
let notifyQueued = false;
export function notify() {
  indexKey = null;
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => { notifyQueued = false; listeners.forEach(fn => fn()); });
}

function coll(entity) { return state[entity + 's']; }

export function genId(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const s = Array.from(bytes, b => (b % 36).toString(36)).join('').toUpperCase();
  return prefix + '-' + s + Date.now().toString(36).slice(-3).toUpperCase();
}

let seq = 0;
function nextSeq() { seq = Math.max(seq + 1, Date.now() * 1000); return seq; }

// ---------------------------------------------------------------------------
// Chargement local
// ---------------------------------------------------------------------------

export async function load() {
  const [clients, visites, taches, plans, outbox, conflicts] = await Promise.all(
    ['clients', 'visites', 'taches', 'plans', 'outbox', 'conflicts'].map(s => db.getAll(s)));
  state.clients = new Map(clients.map(r => [r.id, r]));
  state.visites = new Map(visites.map(r => [r.id, r]));
  state.taches = new Map(taches.map(r => [r.id, r]));
  state.plans = new Map(plans.map(r => [r.id, r]));
  state.outbox = outbox.sort((a, b) => a.seq - b.seq);
  seq = state.outbox.reduce((m, o) => Math.max(m, o.seq), 0);
  state.conflicts = conflicts;
  state.token = await db.getMeta('token', null);
  state.user = await db.getMeta('user', null);
  state.settings = await db.getMeta('settings', state.settings);
  state.commerciaux = await db.getMeta('commerciaux', []);
  state.lastSync = await db.getMeta('lastSync', null);
  state.ready = true;
  notify();
}

// ---------------------------------------------------------------------------
// Modifications locales (enregistrées immédiatement, envoyées plus tard)
// ---------------------------------------------------------------------------

/**
 * Enregistre une création ou une modification. Le changement et sa ligne dans la file
 * d'attente sont écrits dans la même transaction : aucun des deux ne peut se perdre seul.
 */
export async function mutate(entity, op, id, fields) {
  if (!ENTITIES.includes(entity)) throw new Error('Entité inconnue');
  const c = coll(entity);
  const prev = c.get(id);
  const now = new Date().toISOString();
  const ops = [];
  let rec;

  if (op === 'create') {
    rec = { ...fields, id, commercial: (state.user && state.user.code) || '', version: 0, majLe: now, _pending: true };
    if (entity === 'visite') rec.creeLe = now;
    const entry = { mid: genId('M'), seq: nextSeq(), entity, op, id, fields: { ...fields }, createdAt: now, status: 'pending', attempts: 0 };
    state.outbox.push(entry);
    ops.push({ store: 'outbox', put: entry });
  } else if (op === 'update') {
    if (!prev) throw new Error('Fiche introuvable');
    rec = { ...prev, ...fields, majLe: now, _pending: true };
    const pendingCreate = state.outbox.find(o => o.id === id && o.op === 'create' && o.status === 'pending');
    if (pendingCreate) {
      // Pas encore envoyée : on complète simplement la création.
      Object.assign(pendingCreate.fields, fields);
      ops.push({ store: 'outbox', put: pendingCreate });
    } else {
      const base = {};
      Object.keys(fields).forEach(f => { base[f] = expectedServerValue(entity, id, f, prev); });
      const entry = { mid: genId('M'), seq: nextSeq(), entity, op, id, fields: { ...fields }, base, createdAt: now, status: 'pending', attempts: 0 };
      state.outbox.push(entry);
      ops.push({ store: 'outbox', put: entry });
    }
  } else {
    throw new Error('Opération inconnue');
  }
  denormalizeLocal(entity, rec);
  ops.unshift({ store: entity + 's', put: rec });
  await db.write(ops);
  c.set(id, rec);
  notify();
  scheduleSync(1500);
  return rec;
}

/** Valeur que le serveur doit avoir au moment où cette modification lui parviendra. */
function expectedServerValue(entity, id, field, prev) {
  for (let i = state.outbox.length - 1; i >= 0; i--) {
    const o = state.outbox[i];
    if (o.entity === entity && o.id === id && o.status === 'pending' && o.fields && field in o.fields) return o.fields[field];
  }
  const srv = prev._srv || prev;
  return srv[field] === undefined ? '' : srv[field];
}

function denormalizeLocal(entity, rec) {
  if ((entity === 'visite' || entity === 'tache') && rec.clientId) {
    const c = state.clients.get(rec.clientId);
    if (c) { rec.clientNom = c.nom; rec.ville = c.ville; if (entity === 'visite') rec.groupement = c.groupement; }
  }
}

// ---------------------------------------------------------------------------
// Synchronisation
// ---------------------------------------------------------------------------

let syncing = null;
let timer = null;
let failures = 0;

export function scheduleSync(delay = 0) {
  clearTimeout(timer);
  timer = setTimeout(() => { sync().catch(() => {}); }, delay);
}

function setSync(patch) {
  Object.assign(state.sync, patch);
  notify();
}

export function pendingCount() {
  return state.outbox.filter(o => o.status === 'pending').length;
}

export function failedEntries() {
  return state.outbox.filter(o => o.status === 'failed');
}

export function sync() {
  if (syncing) return syncing;
  syncing = doSync().finally(() => { syncing = null; });
  return syncing;
}

async function doSync() {
  if (!state.token) return;
  if (!navigator.onLine) { setSync({ status: 'offline' }); return; }
  setSync({ status: 'syncing', error: null });
  try {
    await pushAll();
    await pull();
    failures = 0;
    setSync({ status: 'idle', error: null, needsLogin: false });
  } catch (e) {
    failures++;
    if (e instanceof ApiError && e.code === 'UNAUTHORIZED') {
      // Les données en attente sont conservées ; il suffit de se reconnecter.
      setSync({ status: 'error', error: errorMessage(e), needsLogin: true });
      return;
    }
    setSync({ status: navigator.onLine ? 'error' : 'offline', error: errorMessage(e) });
    // Nouvel essai automatique, de plus en plus espacé (max 5 min).
    scheduleSync(Math.min(300000, 5000 * Math.pow(2, failures - 1)));
  }
}

async function pushAll() {
  let pending = state.outbox.filter(o => o.status === 'pending');
  while (pending.length) {
    const chunk = pending.slice(0, PUSH_CHUNK);
    const payload = chunk.map(o => ({ mid: o.mid, entity: o.entity, op: o.op, id: o.id, fields: o.fields, base: o.base }));
    const res = await call('push', { mutations: payload }, state.token);
    const byMid = new Map(res.results.map(r => [r.mid, r]));
    const ops = [];
    for (const o of chunk) {
      const r = byMid.get(o.mid);
      if (!r) continue;
      if (r.status === 'applied') {
        ops.push({ store: 'outbox', del: o.mid });
        state.outbox = state.outbox.filter(x => x.mid !== o.mid);
      } else if (r.status === 'conflict') {
        ops.push({ store: 'outbox', del: o.mid });
        state.outbox = state.outbox.filter(x => x.mid !== o.mid);
        (r.conflicts || []).forEach(cf => {
          const k = { key: o.mid + ':' + cf.field, entity: o.entity, id: o.id, field: cf.field, server: cf.server, mine: cf.mine, date: new Date().toISOString() };
          state.conflicts.push(k);
          ops.push({ store: 'conflicts', put: k });
        });
      } else if (PERMANENT_ERRORS.includes(r.error)) {
        o.status = 'failed';
        o.error = r.error;
        o.attempts++;
        ops.push({ store: 'outbox', put: o });
      } else {
        o.attempts++;
        o.error = r.error;
        o.message = r.message || '';
        ops.push({ store: 'outbox', put: o });
      }
    }
    if (ops.length) await db.write(ops);
    notify();
    const stillPending = state.outbox.filter(o => o.status === 'pending');
    // Évite une boucle infinie si le serveur renvoie des erreurs temporaires.
    if (stillPending.length && stillPending.length >= pending.length) {
      const blocked = stillPending.find(o => o.message || o.error);
      throw new ApiError('SERVER_ERROR', stillPending.length + ' modification(s) refusée(s) par le classeur' + (blocked && blocked.message ? ' : ' + blocked.message : '.'));
    }
    pending = stillPending;
  }
}

export async function pull() {
  const snap = await call('pull', {}, state.token);
  await applySnapshot(snap);
}

async function applySnapshot(snap) {
  const maps = {};
  ENTITIES.forEach(e => {
    const m = new Map();
    (snap[e + 's'] || []).forEach(r => {
      const rec = { ...r, _srv: { ...r } };
      m.set(r.id, rec);
    });
    maps[e] = m;
  });
  // Les modifications pas encore confirmées restent visibles par-dessus les données du serveur.
  state.outbox.forEach(o => {
    const m = maps[o.entity];
    if (!m) return;
    if (o.op === 'create' && !m.has(o.id)) {
      m.set(o.id, { ...o.fields, id: o.id, commercial: state.user && state.user.code, version: 0, _pending: true });
    } else if (o.op === 'update' && m.has(o.id)) {
      Object.assign(m.get(o.id), o.fields, { _pending: true });
    }
  });
  ENTITIES.forEach(e => maps[e].forEach(rec => { if (rec._pending) denormalizeLocalWith(maps, e, rec); }));

  const ops = [];
  ENTITIES.forEach(e => {
    ops.push({ store: e + 's', clear: true });
    maps[e].forEach(rec => ops.push({ store: e + 's', put: rec }));
  });
  const now = new Date().toISOString();
  ops.push({ store: 'meta', put: { k: 'lastSync', v: now } });
  ops.push({ store: 'meta', put: { k: 'settings', v: snap.settings || state.settings } });
  ops.push({ store: 'meta', put: { k: 'commerciaux', v: snap.commerciaux || [] } });
  if (snap.user) ops.push({ store: 'meta', put: { k: 'user', v: snap.user } });
  await db.write(ops);

  ENTITIES.forEach(e => { state[e + 's'] = maps[e]; });
  state.lastSync = now;
  state.settings = snap.settings || state.settings;
  state.commerciaux = snap.commerciaux || [];
  if (snap.user) state.user = snap.user;
  notify();
}

function denormalizeLocalWith(maps, entity, rec) {
  if ((entity === 'visite' || entity === 'tache') && rec.clientId && maps.client.has(rec.clientId)) {
    const c = maps.client.get(rec.clientId);
    rec.clientNom = c.nom; rec.ville = c.ville;
  }
}

// ---------------------------------------------------------------------------
// Connexion, conflits, erreurs
// ---------------------------------------------------------------------------

export async function requestCode(email) {
  await call('requestCode', { email });
}

export async function verifyCode(email, code) {
  const device = (navigator.userAgent || '').slice(0, 100);
  const res = await call('verifyCode', { email, code, device });
  const previousUser = state.user;
  // Changement de compte sur le même appareil : on repart d'une base vide (sauf modifications en attente).
  if (previousUser && previousUser.email !== res.user.email && pendingCount() === 0) await db.wipe();
  state.token = res.token;
  state.user = res.user;
  await db.write([{ store: 'meta', put: { k: 'token', v: res.token } }, { store: 'meta', put: { k: 'user', v: res.user } }]);
  setSync({ needsLogin: false, error: null });
  await sync();
}

export async function logout() {
  try { if (state.token && navigator.onLine) await call('logout', {}, state.token); } catch (e) { /* hors ligne */ }
  await db.wipe();
  location.reload();
}

export async function resolveConflict(conflict, keepMine) {
  const ops = [{ store: 'conflicts', del: conflict.key }];
  state.conflicts = state.conflicts.filter(c => c.key !== conflict.key);
  await db.write(ops);
  if (keepMine) {
    const rec = coll(conflict.entity).get(conflict.id);
    if (rec) {
      // La valeur du classeur devient la nouvelle base : la modification passera.
      rec._srv = { ...(rec._srv || {}), [conflict.field]: conflict.server };
      await mutate(conflict.entity, 'update', conflict.id, { [conflict.field]: conflict.mine });
    }
  }
  notify();
}

export async function retryFailed(entry) {
  entry.status = 'pending';
  entry.error = null;
  await db.write([{ store: 'outbox', put: entry }]);
  notify();
  scheduleSync(0);
}

export async function discardFailed(entry) {
  state.outbox = state.outbox.filter(o => o.mid !== entry.mid);
  await db.write([{ store: 'outbox', del: entry.mid }]);
  notify();
}

/** Copie de secours des modifications non synchronisées (fichier JSON). */
export function exportPending() {
  return JSON.stringify({ exportedAt: new Date().toISOString(), user: state.user, outbox: state.outbox, conflicts: state.conflicts }, null, 2);
}

// ---------------------------------------------------------------------------
// Calculs (mêmes règles que le classeur)
// ---------------------------------------------------------------------------

export function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function daysBetween(a, b) {
  const da = new Date(a + 'T00:00:00');
  const dbb = new Date(b + 'T00:00:00');
  return Math.round((dbb - da) / 86400000);
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

let indexCache = null;
let indexKey = null;

/** Dernière visite et historique par client (recalculés seulement si les visites changent). */
export function visitIndex() {
  if (indexKey === state.visites) return indexCache;
  const last = new Map();
  const byClient = new Map();
  state.visites.forEach(v => {
    if (!v.clientId) return;
    if (!byClient.has(v.clientId)) byClient.set(v.clientId, []);
    byClient.get(v.clientId).push(v);
    if (v.type === 'NOTE' || !v.date) return;
    if (!last.has(v.clientId) || last.get(v.clientId) < v.date) last.set(v.clientId, v.date);
  });
  byClient.forEach(list => list.sort((a, b) => (b.date || '').localeCompare(a.date || '')));
  indexCache = { last, byClient };
  indexKey = state.visites;
  return indexCache;
}

export function isFollowed(c) {
  return c.statut === 'CLIENT' || c.statut === 'PROSPECT';
}

export function clientInfo(c) {
  const { last } = visitIndex();
  const lastVisit = last.get(c.id) || '';
  const days = lastVisit ? daysBetween(lastVisit, todayStr()) : null;
  let priorite = 'Jamais visité';
  if (days !== null) {
    priorite = days >= state.settings.seuilUrgent ? 'Urgent' : days >= state.settings.seuilARevoir ? 'À revoir' : 'OK';
  }
  return { lastVisit, days, priorite };
}

export { errorMessage };
