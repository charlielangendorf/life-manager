// Node smoke test for the DOM-free modules. Run: node test/smoke.mjs
import assert from 'node:assert/strict';

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.get(k) ?? null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

const { addDays, addMonths, dateKey, parseDate, timeOf, startOfWeekKey } = await import('../js/utils.js');
const { createEntity, nextOccurrence, spawnNext } = await import('../js/models.js');
const { store } = await import('../js/store.js');

// ---- date helpers ----
assert.equal(addDays('2026-07-02', 1), '2026-07-03');
assert.equal(addDays('2026-12-31', 1), '2027-01-01');
assert.equal(addMonths('2026-01-31', 1), '2026-02-28'); // clamps to month end
assert.equal(addMonths('2026-11-15', 2), '2027-01-15'); // year rollover
assert.equal(timeOf('2026-07-02T17:30'), '17:30');
assert.equal(timeOf('2026-07-02'), '');
assert.equal(startOfWeekKey('2026-07-02'), '2026-06-28'); // Thu -> preceding Sun
assert.equal(dateKey(parseDate('2026-07-02T09:15')), '2026-07-02');

// ---- recurrence ----
const weekly = createEntity({
  title: 'Run', dueDate: '2026-07-02',
  extra: { recurrence: { freq: 'weekly', interval: 1 } },
});
assert.equal(nextOccurrence(weekly), '2026-07-09');
const spawned = spawnNext(weekly);
assert.equal(spawned.dueDate, '2026-07-09');
assert.notEqual(spawned.id, weekly.id);
assert.equal(spawned.status, 'todo');

const timed = createEntity({
  title: 'Standup', dueDate: '2026-07-02T09:30',
  extra: { recurrence: { freq: 'daily', interval: 1 } },
});
assert.equal(nextOccurrence(timed), '2026-07-03T09:30'); // keeps the time

// ---- store CRUD + undo tombstones ----
const t = store.add({ title: 'Test task', dueDate: '2026-07-03' });
assert.ok(store.get(t.id));
store.update(t.id, { title: 'Renamed' });
assert.equal(store.get(t.id).title, 'Renamed');
const removed = store.remove(t.id);
assert.equal(store.get(t.id), undefined);
assert.ok(store.deleted[t.id]);
store.restore(removed);
assert.ok(store.get(t.id));
assert.equal(store.deleted[t.id], undefined);

// ---- completing a recurring task spawns the next occurrence ----
const r2 = store.add({
  title: 'Daily thing', dueDate: '2026-07-02',
  extra: { recurrence: { freq: 'daily', interval: 2 } },
});
store.toggleComplete(r2.id);
assert.equal(store.get(r2.id).status, 'done');
const follower = store.all('task').find((e) => e.title === 'Daily thing' && e.status === 'todo');
assert.equal(follower.dueDate, '2026-07-04');

// ---- merge: newer remote version wins ----
const local = store.add({ title: 'Local version' });
store.mergeRemote({
  entities: [{ ...local, title: 'Remote version', updatedAt: new Date(Date.now() + 1000).toISOString() }],
  deleted: {},
});
assert.equal(store.get(local.id).title, 'Remote version');

// ---- merge: local tombstone beats an older remote copy ----
const dead = store.add({ title: 'Doomed' });
await new Promise((r) => setTimeout(r, 5));
store.remove(dead.id);
store.mergeRemote({ entities: [{ ...dead }], deleted: {} });
assert.equal(store.get(dead.id), undefined);

// ---- docEquals reflects sync state ----
const doc = store.exportDoc();
assert.ok(store.docEquals(JSON.parse(JSON.stringify(doc))));
store.add({ title: 'One more' });
assert.ok(!store.docEquals(doc));

console.log('All smoke tests passed.');
