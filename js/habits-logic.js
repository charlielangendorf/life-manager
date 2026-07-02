// Pure, DOM-free habit computations: streaks, completion %, and log helpers.
// Imports only from utils.js so the administrator can test this headlessly.
import { todayKey, addDays, startOfWeekKey } from './utils.js';

// A day is "checked" when its log entry exists and has done === true.
export function isDayDone(habit, dayKey) {
  const entry = habit?.extra?.log?.[dayKey];
  return Boolean(entry && entry.done);
}

// Count checked days within [startKey, endKey] inclusive.
function countDoneInRange(habit, startKey, endKey) {
  const log = habit?.extra?.log || {};
  let n = 0;
  for (const [k, v] of Object.entries(log)) {
    if (v && v.done && k >= startKey && k <= endKey) n += 1;
  }
  return n;
}

// Number of checked days in the ISO week starting at weekStartKey (Sunday).
export function weekDoneCount(habit, weekStartKey) {
  const end = addDays(weekStartKey, 6);
  return countDoneInRange(habit, weekStartKey, end);
}

// ---- streaks ----

// Daily: consecutive checked days ending today, or ending yesterday when today
// is still unchecked (so an unchecked "today" doesn't break an active streak).
export function dailyStreak(habit, today = todayKey()) {
  let cursor = isDayDone(habit, today) ? today : addDays(today, -1);
  let streak = 0;
  while (isDayDone(habit, cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

// Weekly: consecutive weeks (Sunday start) meeting weeklyTarget. The current
// week counts only if already met; otherwise the streak is measured through
// last week so an in-progress week can't break it.
export function weeklyStreak(habit, today = todayKey()) {
  const target = weeklyTargetOf(habit);
  const thisWeek = startOfWeekKey(today);
  let cursor = weekDoneCount(habit, thisWeek) >= target
    ? thisWeek
    : addDays(thisWeek, -7);
  let streak = 0;
  while (weekDoneCount(habit, cursor) >= target) {
    streak += 1;
    cursor = addDays(cursor, -7);
  }
  return streak;
}

export function currentStreak(habit, today = todayKey()) {
  return frequencyOf(habit) === 'weekly'
    ? weeklyStreak(habit, today)
    : dailyStreak(habit, today);
}

// Longest streak ever. Scans the sorted set of checked-day keys for daily; for
// weekly it scans distinct qualifying week-starts.
export function longestStreak(habit, today = todayKey()) {
  return frequencyOf(habit) === 'weekly'
    ? longestWeeklyStreak(habit)
    : longestDailyStreak(habit);
}

function longestDailyStreak(habit) {
  const days = doneDayKeys(habit);
  if (!days.length) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    if (days[i] === addDays(days[i - 1], 1)) run += 1;
    else run = 1;
    if (run > best) best = run;
  }
  return best;
}

function longestWeeklyStreak(habit) {
  const target = weeklyTargetOf(habit);
  const weeks = qualifyingWeekStarts(habit, target);
  if (!weeks.length) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < weeks.length; i += 1) {
    if (weeks[i] === addDays(weeks[i - 1], 7)) run += 1;
    else run = 1;
    if (run > best) best = run;
  }
  return best;
}

// ---- completion % ----

// Fraction 0..1 of expected occurrences met over the recent window:
// last 30 days for daily, last 12 weeks for weekly. Rounded to a whole percent.
export function completionRate(habit, today = todayKey()) {
  if (frequencyOf(habit) === 'weekly') {
    const target = weeklyTargetOf(habit);
    const thisWeek = startOfWeekKey(today);
    let met = 0;
    for (let i = 0; i < 12; i += 1) {
      const wk = addDays(thisWeek, -7 * i);
      if (weekDoneCount(habit, wk) >= target) met += 1;
    }
    return { done: met, expected: 12, pct: Math.round((met / 12) * 100) };
  }
  const start = addDays(today, -29);
  const done = countDoneInRange(habit, start, today);
  return { done, expected: 30, pct: Math.round((done / 30) * 100) };
}

// ---- "to do today" helpers (used by list view and dashboard) ----

// True when a habit still needs attention today: daily unchecked today, or
// weekly not yet at target for the current week.
export function needsToday(habit, today = todayKey()) {
  if (frequencyOf(habit) === 'weekly') {
    const wk = startOfWeekKey(today);
    return weekDoneCount(habit, wk) < weeklyTargetOf(habit);
  }
  return !isDayDone(habit, today);
}

// ---- small accessors so the view never reaches into extra directly ----

export function frequencyOf(habit) {
  return habit?.extra?.frequency === 'weekly' ? 'weekly' : 'daily';
}

export function weeklyTargetOf(habit) {
  const t = Number(habit?.extra?.weeklyTarget);
  if (!Number.isFinite(t)) return 1;
  return Math.min(7, Math.max(1, Math.round(t)));
}

export function dayNote(habit, dayKey) {
  const entry = habit?.extra?.log?.[dayKey];
  return (entry && entry.note) || '';
}

// Sorted ascending list of YYYY-MM-DD keys that are checked.
export function doneDayKeys(habit) {
  const log = habit?.extra?.log || {};
  return Object.keys(log).filter((k) => log[k] && log[k].done).sort();
}

// Sorted ascending list of week-start keys (Sunday) that met the target.
function qualifyingWeekStarts(habit, target) {
  const weeks = new Set();
  for (const day of doneDayKeys(habit)) weeks.add(startOfWeekKey(day));
  return [...weeks].filter((wk) => weekDoneCount(habit, wk) >= target).sort();
}

// Returns an immutably-updated log with dayKey toggled (or set to a state).
// Toggling off removes the key entirely so the shape stays clean.
export function toggleLog(log, dayKey) {
  const next = { ...(log || {}) };
  if (next[dayKey] && next[dayKey].done) delete next[dayKey];
  else next[dayKey] = { done: true, note: next[dayKey]?.note || '' };
  return next;
}

// Returns an immutably-updated log with a note set on dayKey. A note can only
// exist on a checked day; setting a note on an unchecked day also checks it.
export function setLogNote(log, dayKey, note) {
  const next = { ...(log || {}) };
  next[dayKey] = { done: true, note: note || '' };
  return next;
}
