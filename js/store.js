// Local-first data store. All entities live in memory + localStorage; the
// GitHub sync layer (github.js) reads/writes the same doc shape via exportDoc
// and mergeRemote. Deletes leave timestamped tombstones so they survive merges.
import { createEntity, spawnNext } from './models.js';

const DATA_KEY = 'lifeman.data.v1';
const SETTINGS_KEY = 'lifeman.settings.v1';
const TOMBSTONE_TTL_MS = 1000 * 60 * 60 * 24 * 60; // 60 days

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

class Store {
  constructor() {
    this.entities = [];
    this.deleted = {}; // id -> ISO timestamp of deletion
    this.listeners = new Set();
    this.load();
  }

  load() {
    try {
      const doc = JSON.parse(localStorage.getItem(DATA_KEY)) || {};
      this.entities = Array.isArray(doc.entities) ? doc.entities : [];
      this.deleted = doc.deleted || {};
    } catch {
      this.entities = [];
      this.deleted = {};
    }
  }

  persist() {
    localStorage.setItem(DATA_KEY, JSON.stringify({ entities: this.entities, deleted: this.deleted }));
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(change) {
    this.persist();
    for (const fn of this.listeners) fn(change);
  }

  all(type) {
    return type ? this.entities.filter((e) => e.type === type) : this.entities;
  }

  get(id) {
    return this.entities.find((e) => e.id === id);
  }

  add(partial) {
    const e = createEntity(partial);
    this.entities.push(e);
    this.notify({ verb: 'add', entity: e });
    return e;
  }

  update(id, patch) {
    const e = this.get(id);
    if (!e) return null;
    Object.assign(e, patch, { updatedAt: new Date().toISOString() });
    this.notify({ verb: 'update', entity: e });
    return e;
  }

  // Returns the removed entity so callers can offer undo via restore().
  remove(id) {
    const i = this.entities.findIndex((e) => e.id === id);
    if (i === -1) return null;
    const [e] = this.entities.splice(i, 1);
    this.deleted[id] = new Date().toISOString();
    this.notify({ verb: 'delete', entity: e });
    return e;
  }

  restore(entity) {
    delete this.deleted[entity.id];
    entity.updatedAt = new Date().toISOString();
    this.entities.push(entity);
    this.notify({ verb: 'restore', entity });
  }

  toggleComplete(id) {
    const e = this.get(id);
    if (!e) return;
    if (e.status === 'done') {
      this.update(id, { status: 'todo', extra: { ...e.extra, completedAt: undefined } });
    } else {
      this.update(id, { status: 'done', extra: { ...e.extra, completedAt: new Date().toISOString() } });
      const next = spawnNext(e);
      if (next) {
        this.entities.push(next);
        this.notify({ verb: 'add', entity: next });
      }
    }
  }

  // ---- sync support ----

  // Returns a detached snapshot — safe to hold across later store mutations.
  exportDoc() {
    return structuredClone({
      version: 1,
      updatedAt: new Date().toISOString(),
      entities: this.entities,
      deleted: this.deleted,
    });
  }

  // Entity-level last-write-wins merge of a remote doc into local state.
  // Tombstones beat entities with an older updatedAt, in both directions.
  mergeRemote(doc) {
    const remoteEntities = Array.isArray(doc.entities) ? doc.entities : [];
    const remoteDeleted = doc.deleted || {};
    const byId = new Map(this.entities.map((e) => [e.id, e]));

    for (const [id, ts] of Object.entries(remoteDeleted)) {
      const local = byId.get(id);
      if (local && local.updatedAt <= ts) byId.delete(id);
      if (!this.deleted[id] || this.deleted[id] < ts) this.deleted[id] = ts;
    }
    for (const r of remoteEntities) {
      if (!r || !r.id) continue;
      if (this.deleted[r.id] && this.deleted[r.id] >= (r.updatedAt || '')) continue;
      const local = byId.get(r.id);
      if (!local || (local.updatedAt || '') < (r.updatedAt || '')) {
        byId.set(r.id, r);
        delete this.deleted[r.id];
      }
    }

    this.entities = [...byId.values()];
    this.pruneTombstones();
    this.notify({ verb: 'merge' });
  }

  // True when local state matches the given doc (same entity versions and
  // tombstones) — used to decide whether a push is needed after a pull.
  docEquals(doc) {
    const sig = (list) =>
      JSON.stringify((list || []).map((e) => [e.id, e.updatedAt]).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
    const deadSig = (map) => JSON.stringify(Object.entries(map || {}).sort());
    return sig(this.entities) === sig(doc.entities) && deadSig(this.deleted) === deadSig(doc.deleted);
  }

  pruneTombstones() {
    const cutoff = new Date(Date.now() - TOMBSTONE_TTL_MS).toISOString();
    for (const [id, ts] of Object.entries(this.deleted)) {
      if (ts < cutoff) delete this.deleted[id];
    }
  }

  // Clears this browser's copy only; callers re-pull from GitHub afterwards
  // if sync is configured.
  clearLocal() {
    this.entities = [];
    this.deleted = {};
    this.notify({ verb: 'merge' });
  }
}

export const store = new Store();
