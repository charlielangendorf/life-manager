// One flexible base entity shape shared by every module. Phase 1 uses
// 'task' and 'event'; later phases add habit, goal, contact, reading,
// journal, bookmark, trip, finance as filtered views of the same store.
import { uid, addDays, addMonths, todayKey } from './utils.js';

export const PRIORITIES = ['high', 'medium', 'low'];

export function createEntity(partial = {}) {
  const now = new Date().toISOString();
  return {
    id: uid(),
    type: 'task',
    title: '',
    notes: '',
    date: null,      // events: when it happens
    dueDate: null,   // tasks: when it's due
    tags: [],
    project: null,
    priority: null,  // 'high' | 'medium' | 'low' | null
    status: 'todo',  // 'todo' | 'done'
    linkedTo: [],
    createdAt: now,
    updatedAt: now,
    extra: {},       // type-specific: { recurrence, subtasks, completedAt, ... }
    ...partial,
  };
}

export function recurrenceLabel(rec) {
  if (!rec || !rec.freq) return '';
  const unit = { daily: 'day', weekly: 'week', monthly: 'month' }[rec.freq];
  if (!unit) return '';
  const n = Math.max(1, rec.interval || 1);
  return n === 1 ? `every ${unit}` : `every ${n} ${unit}s`;
}

export function nextOccurrence(entity) {
  const rec = entity.extra?.recurrence;
  if (!rec || !rec.freq) return null;
  const n = Math.max(1, rec.interval || 1);
  const base = entity.dueDate || entity.date || todayKey();
  const time = base.includes('T') ? base.slice(10) : '';
  let day = base.slice(0, 10);
  if (rec.freq === 'daily') day = addDays(day, n);
  else if (rec.freq === 'weekly') day = addDays(day, 7 * n);
  else if (rec.freq === 'monthly') day = addMonths(day, n);
  else return null;
  return day + time;
}

// When a recurring item is completed, the series continues as a fresh copy
// due on the next occurrence.
export function spawnNext(entity) {
  const next = nextOccurrence(entity);
  if (!next) return null;
  const copy = createEntity(JSON.parse(JSON.stringify(entity)));
  const now = new Date().toISOString();
  copy.id = uid();
  copy.createdAt = now;
  copy.updatedAt = now;
  copy.status = 'todo';
  if (entity.type === 'event') copy.date = next;
  else copy.dueDate = next;
  if (Array.isArray(copy.extra.subtasks)) {
    copy.extra.subtasks = copy.extra.subtasks.map((s) => ({ ...s, done: false }));
  }
  delete copy.extra.completedAt;
  return copy;
}
