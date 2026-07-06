// Calendar with month / week / day modes. Tasks appear on their due date,
// events on their date. Clicking an empty cell creates a task for that day;
// clicking a day number (or column header) drills into the day view.
//
// Two projection features live here (both computed, never persisted):
//  1. Multi-day events span every day from `date` to `dueDate` (inclusive end
//     day, plain 'YYYY-MM-DD'). Continuation days show a quiet mono marker.
//  2. Open recurring items (extra.recurrence) render VIRTUAL "ghost"
//     occurrences on every future matching day in the visible range. The base
//     day shows the real item; later days show a quieter, non-completable ghost
//     that opens the source entity when clicked.
import { store } from '../store.js';
import {
  todayKey, addDays, addMonths, startOfWeekKey, escapeHtml,
  timeOf, fmtTime, fmtDate, fmtDateFull, fmtMonthYear, WEEKDAYS, parseDate,
} from '../utils.js';
import { entityRow, bindRows } from './shared.js';
import { openEditor } from '../taskModal.js';

let mode = 'month';
let anchor = todayKey();

const whenOf = (e) => (e.type === 'event' ? e.date : e.dueDate) || '';
const baseDayOf = (e) => whenOf(e).slice(0, 10);
const isWeekend = (day) => { const g = parseDate(day).getDay(); return g === 0 || g === 6; };
const isCalItem = (e) => e.type === 'task' || e.type === 'event';

// Inclusive end day of a multi-day event. Events store their end in dueDate as
// a plain 'YYYY-MM-DD'; anything else (tasks, single-day events) spans one day.
function spanEndOf(e) {
  if (e.type !== 'event') return baseDayOf(e);
  const end = (e.dueDate || '').slice(0, 10);
  const start = baseDayOf(e);
  return end && end >= start ? end : start;
}

// Span length in whole days (0 = single day) — the same window applied to every
// occurrence of a recurring multi-day event.
function spanLenOf(e) {
  const base = baseDayOf(e);
  return Math.max(0, Math.round((parseDate(spanEndOf(e)) - parseDate(base)) / 86400000));
}

// ---------------------------------------------------------------------------
// Pure occurrence logic (exported for headless testing).
// ---------------------------------------------------------------------------

// Does a recurrence starting at `baseDay` land exactly on `dayKey`?
// daily → every `interval` days; weekly → every 7*interval days; monthly →
// same day-of-month stepping via addMonths (month-end clamping matches
// utils.addMonths, so e.g. Jan 31 → Feb 28 counts as an occurrence).
export function recurrenceHits(rec, baseDay, dayKey) {
  if (!rec || !rec.freq) return false;
  const base = baseDay.slice(0, 10);
  const target = dayKey.slice(0, 10);
  if (target < base) return false;
  if (target === base) return true;
  const n = Math.max(1, rec.interval || 1);
  if (rec.freq === 'daily') {
    const diff = Math.round((parseDate(target) - parseDate(base)) / 86400000);
    return diff % n === 0;
  }
  if (rec.freq === 'weekly') {
    const diff = Math.round((parseDate(target) - parseDate(base)) / 86400000);
    return diff % (7 * n) === 0;
  }
  if (rec.freq === 'monthly') {
    // Step month-by-month from the base and compare against the (clamped) key.
    // Cap the walk so a far-future target can't loop unbounded.
    let cursor = base;
    for (let i = 0; i < 1200 && cursor <= target; i++) {
      if (cursor === target) return true;
      cursor = addMonths(cursor, n);
    }
    return false;
  }
  return false;
}

// True when `entity` occupies `dayKey` on the calendar — accounting for
// multi-day spans and (for open recurring items) projected future occurrences.
// The single source of truth for both the grid builder and headless tests.
export function occursOn(entity, dayKey) {
  if (!entity || !isCalItem(entity)) return false;
  const day = dayKey.slice(0, 10);
  const base = baseDayOf(entity);
  if (!base) return false;

  const rec = entity.extra?.recurrence;
  const recurs = Boolean(rec && rec.freq) && entity.status !== 'done';

  // Length of the (multi-day) span in days, applied to every occurrence.
  const spanDays = spanLenOf(entity);

  // Non-recurring: a single window base..base+spanDays.
  if (!recurs) {
    return day >= base && day <= addDays(base, spanDays);
  }

  // Recurring: `day` is covered if some occurrence start S (a recurrence hit)
  // satisfies S <= day <= S+spanDays. Occurrence starts are on or before `day`,
  // so it suffices to check the recurrence-hit days within [day-spanDays, day].
  for (let back = 0; back <= spanDays; back++) {
    const start = addDays(day, -back);
    if (start < base) break;
    if (recurrenceHits(rec, base, start)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Visible-range index: one pass over entities → Map(dayKey -> placement[]).
// A placement is { entity, start, first, ghost }:
//   start  = the occurrence's first day (may be before the visible range)
//   first  = dayKey is that first day (else a multi-day continuation)
//   ghost  = a projected recurrence occurrence (start !== the real base day)
// Exported for headless testing; pass an explicit entity list to test without a
// store (defaults to store.entities for the live views).
// ---------------------------------------------------------------------------
export function buildRange(fromKey, toKey, entities = store.entities) {
  const from = fromKey.slice(0, 10);
  const to = toKey.slice(0, 10);
  const map = new Map();
  const push = (day, placement) => {
    if (!map.has(day)) map.set(day, []);
    map.get(day).push(placement);
  };

  for (const e of entities) {
    if (!isCalItem(e)) continue;
    const base = baseDayOf(e);
    if (!base) continue;
    const rec = e.extra?.recurrence;
    const recurs = Boolean(rec && rec.freq) && e.status !== 'done';
    const spanDays = spanLenOf(e);

    // Collect each occurrence START that could touch the visible range, then
    // paint base..base+spanDays for it, clipped to [from, to].
    const starts = [];
    if (!recurs) {
      starts.push(base);
    } else {
      // Occurrences whose span can reach `from` begin as early as from-spanDays.
      let start = base;
      const earliest = addDays(from, -spanDays);
      // Fast-forward to the first relevant occurrence without O(range) work for
      // sparse recurrences: step until at/after `earliest`.
      let guard = 0;
      while (start < earliest && guard++ < 100000) {
        const nxt = stepOccurrence(rec, start);
        if (nxt <= start) break;
        start = nxt;
      }
      // If we overshot (base itself is already >= earliest), keep base.
      if (base >= earliest) start = base;
      for (guard = 0; start <= to && guard < 100000; guard++) {
        if (start >= earliest) starts.push(start);
        const nxt = stepOccurrence(rec, start);
        if (nxt <= start) break;
        start = nxt;
      }
    }

    for (const start of starts) {
      const ghost = recurs && start !== base;
      const end = addDays(start, spanDays);
      const lo = start < from ? from : start;
      const hi = end > to ? to : end;
      for (let d = lo; d <= hi; d = addDays(d, 1)) {
        push(d, { entity: e, start, first: d === start, ghost });
      }
    }
  }

  for (const list of map.values()) list.sort(placementCmp);
  return map;
}

// One recurrence step from an occurrence start.
function stepOccurrence(rec, start) {
  const n = Math.max(1, rec.interval || 1);
  if (rec.freq === 'daily') return addDays(start, n);
  if (rec.freq === 'weekly') return addDays(start, 7 * n);
  if (rec.freq === 'monthly') return addMonths(start, n);
  return start;
}

// Sort a day's placements by the time-of-day of their occurrence, matching the
// old per-day sort (timed first, then untimed by title stability of the array).
function placementCmp(a, b) {
  return timeOf(whenOf(a.entity)).localeCompare(timeOf(whenOf(b.entity)));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// The quiet mono marker shown in place of the time on continuation days or
// projected (ghost) occurrences. `day` is the day the chip is being drawn on.
function markerFor(p, day) {
  if (p.ghost) return '<b class="cal-ghost-mark" aria-hidden="true">↻</b> ';
  // Continuation day of a multi-day span: point at the end, or "cont." on the
  // final day of the span.
  const end = addDays(p.start, spanLenOf(p.entity));
  return day === end
    ? '<b class="cal-cont-mark">cont.</b> '
    : `<b class="cal-cont-mark">thru ${escapeHtml(fmtDate(end))}</b> `;
}

function chip(p, day) {
  const e = p.entity;
  const t = timeOf(whenOf(e));
  const cont = !p.first;
  const marker = cont || p.ghost
    ? markerFor(p, day)
    : (t ? `<b>${fmtTime(t)}</b> ` : '');
  const cls = [
    'cal-chip', e.type,
    e.status === 'done' ? 'done' : '',
    `pri-${e.priority || 'none'}`,
    p.ghost ? 'ghost' : '',
    cont ? 'cont' : '',
  ].filter(Boolean).join(' ');
  return `
    <div class="${cls}" data-id="${e.id}" title="${escapeHtml(e.title)}">
      ${marker}${escapeHtml(e.title)}
    </div>`;
}

function navigate(dir) {
  if (dir === 0) {
    anchor = todayKey();
  } else if (mode === 'month') {
    anchor = addMonths(anchor, dir);
  } else if (mode === 'week') {
    anchor = addDays(anchor, 7 * dir);
  } else {
    anchor = addDays(anchor, dir);
  }
}

function title() {
  if (mode === 'month') return fmtMonthYear(anchor);
  if (mode === 'week') {
    const start = startOfWeekKey(anchor);
    return `${fmtDate(start)} – ${fmtDate(addDays(start, 6))}`;
  }
  return fmtDateFull(anchor);
}

function monthGrid() {
  const today = todayKey();
  const month = anchor.slice(0, 7);
  const start = startOfWeekKey(month + '-01');
  const end = addDays(start, 41);
  const range = buildRange(start, end);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const day = addDays(start, i);
    const items = range.get(day) || [];
    const shown = items.slice(0, 3);
    cells.push(`
      <div class="cal-cell ${day.slice(0, 7) === month ? '' : 'dim'} ${day === today ? 'today' : ''} ${isWeekend(day) ? 'weekend' : ''}"
           data-day="${day}">
        <div class="cal-daynum" title="Open day view">${Number(day.slice(8))}</div>
        ${shown.map((p) => chip(p, day)).join('')}
        ${items.length > 3 ? `<div class="cal-more" data-day="${day}">+${items.length - 3} more</div>` : ''}
      </div>`);
  }
  return `
    <div class="cal-weekdays">${WEEKDAYS.map((w) => `<div>${w}</div>`).join('')}</div>
    <div class="cal-grid">${cells.join('')}</div>`;
}

function weekGrid() {
  const today = todayKey();
  const start = startOfWeekKey(anchor);
  const end = addDays(start, 6);
  const range = buildRange(start, end);
  const cols = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    const items = range.get(day) || [];
    // Each day column is a mini vertical sequence: a thin rail threads the
    // chips as ordered nodes, rather than a plain stack.
    const seq = items.length
      ? `<div class="cal-week-seq">${items.map((p) => `
          <div class="cal-week-node">${chip(p, day)}</div>`).join('')}</div>`
      : '<div class="cal-week-empty">—</div>';
    cols.push(`
      <div class="cal-week-col ${day === today ? 'today' : ''} ${isWeekend(day) ? 'weekend' : ''}" data-day="${day}">
        <div class="cal-week-head" title="Open day view">
          <span class="dow">${WEEKDAYS[i]}</span>
          <span class="dnum">${Number(day.slice(8))}</span>
        </div>
        ${seq}
        <button class="cal-add" data-day="${day}" title="Add task on ${day}">+</button>
      </div>`);
  }
  return `<div class="cal-week">${cols.join('')}</div>`;
}

// Day view: a proper vertical timeline. Timed items get a time label; untimed
// ones collect under an "Anytime" node. Real single-day items use entityRow so
// toggle + open-editor keep working through bindRows; ghosts and multi-day
// continuations use a quiet read-only row that opens the source editor.
function dayList() {
  const items = buildRange(anchor, anchor).get(anchor) || [];
  const body = items.length
    ? `<div class="cal-timeline">${items.map((p) => {
        const e = p.entity;
        const t = timeOf(whenOf(e));
        // Base occurrence on its own first day → the normal interactive row.
        if (p.first && !p.ghost) {
          return `
            <div class="tl-item">
              <div class="tl-time">${t ? fmtTime(t) : 'Anytime'}</div>
              <div class="tl-row">${entityRow(e)}</div>
            </div>`;
        }
        // Ghost occurrence or multi-day continuation → quiet, non-completable
        // row. Clicking opens the SOURCE entity's editor (data-id = source id).
        const occEnd = addDays(p.start, spanLenOf(e));
        const label = p.ghost
          ? '↻ repeats'
          : (anchor === occEnd ? 'cont.' : `thru ${fmtDate(occEnd)}`);
        return `
          <div class="tl-item ${p.ghost ? 'tl-ghost' : 'tl-cont'}">
            <div class="tl-time"><span class="cal-cont-mark">${escapeHtml(label)}</span></div>
            <div class="tl-row">
              <div class="row row-accent cal-ghost-row" data-id="${e.id}">
                <span class="event-dot"></span>
                <div class="row-main"><div class="row-title">${escapeHtml(e.title)}</div></div>
              </div>
            </div>
          </div>`;
      }).join('')}</div>`
    : '<div class="empty">Nothing scheduled this day.</div>';
  return `
    <section class="card cal-day">
      ${body}
      <div class="btn-row">
        <button class="ghost-btn cal-add" data-day="${anchor}">+ Add task on this day</button>
      </div>
    </section>`;
}

function draw(container) {
  container.innerHTML = `
    <div class="view-head">
      <h1>Calendar</h1>
      <div class="cal-controls">
        <button class="ghost-btn" data-nav="-1" title="Previous">‹</button>
        <button class="ghost-btn" data-nav="0">Today</button>
        <button class="ghost-btn" data-nav="1" title="Next">›</button>
        <span class="cal-title">${title()}</span>
        <span class="spacer"></span>
        <div class="seg">
          ${['month', 'week', 'day'].map((m) =>
            `<button data-mode="${m}" class="${m === mode ? 'active' : ''}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}
        </div>
      </div>
    </div>
    ${mode === 'month' ? monthGrid() : mode === 'week' ? weekGrid() : dayList()}`;
}

export function render(container) {
  if (mode === 'day') bindRows(container);
  container.addEventListener('click', (ev) => {
    const chipEl = ev.target.closest('.cal-chip');
    if (chipEl) {
      const entity = store.get(chipEl.dataset.id);
      if (entity) openEditor(entity);
      return;
    }
    const more = ev.target.closest('.cal-more');
    if (more) {
      anchor = more.dataset.day;
      mode = 'day';
      render(rebuild(container));
      return;
    }
    const nav = ev.target.closest('[data-nav]');
    if (nav) {
      navigate(Number(nav.dataset.nav));
      draw(container);
      return;
    }
    const modeBtn = ev.target.closest('[data-mode]');
    if (modeBtn) {
      mode = modeBtn.dataset.mode;
      render(rebuild(container));
      return;
    }
    const addBtn = ev.target.closest('.cal-add');
    if (addBtn) {
      openEditor(null, { dueDate: addBtn.dataset.day });
      return;
    }
    const head = ev.target.closest('.cal-week-head');
    if (head) {
      anchor = head.closest('.cal-week-col').dataset.day;
      mode = 'day';
      render(rebuild(container));
      return;
    }
    const daynum = ev.target.closest('.cal-daynum');
    if (daynum) {
      anchor = daynum.closest('.cal-cell').dataset.day;
      mode = 'day';
      render(rebuild(container));
      return;
    }
    const cell = ev.target.closest('.cal-cell');
    if (cell) openEditor(null, { dueDate: cell.dataset.day });
  });
  draw(container);
}

// Mode switches change which listeners are needed (day view binds rows), so
// swap in a fresh node to drop the old delegated handlers before re-rendering.
function rebuild(container) {
  const fresh = container.cloneNode(false);
  container.replaceWith(fresh);
  return fresh;
}
