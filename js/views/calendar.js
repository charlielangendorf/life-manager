// Calendar with month / week / day modes. Tasks appear on their due date,
// events on their date. Clicking an empty cell creates a task for that day;
// clicking a day number (or column header) drills into the day view.
import { store } from '../store.js';
import {
  todayKey, addDays, addMonths, startOfWeekKey, escapeHtml,
  timeOf, fmtTime, fmtDate, fmtDateFull, fmtMonthYear, WEEKDAYS,
} from '../utils.js';
import { entityRow, bindRows } from './shared.js';
import { openEditor } from '../taskModal.js';

let mode = 'month';
let anchor = todayKey();

const whenOf = (e) => (e.type === 'event' ? e.date : e.dueDate) || '';

function dayItems(day) {
  // Calendar shows tasks and events only — other types (habits, goals,
  // journal) live in their own views and would open the wrong editor here.
  return store.entities
    .filter((e) => (e.type === 'task' || e.type === 'event') && whenOf(e).slice(0, 10) === day)
    .sort((a, b) => timeOf(whenOf(a)).localeCompare(timeOf(whenOf(b))));
}

function chip(e) {
  const t = timeOf(whenOf(e));
  return `
    <div class="cal-chip ${e.type} ${e.status === 'done' ? 'done' : ''} pri-${e.priority || 'none'}"
         data-id="${e.id}" title="${escapeHtml(e.title)}">
      ${t ? `<b>${fmtTime(t)}</b> ` : ''}${escapeHtml(e.title)}
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
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const day = addDays(start, i);
    const items = dayItems(day);
    const shown = items.slice(0, 3);
    cells.push(`
      <div class="cal-cell ${day.slice(0, 7) === month ? '' : 'dim'} ${day === today ? 'today' : ''}"
           data-day="${day}">
        <div class="cal-daynum" title="Open day view">${Number(day.slice(8))}</div>
        ${shown.map(chip).join('')}
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
  const cols = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    cols.push(`
      <div class="cal-week-col ${day === today ? 'today' : ''}" data-day="${day}">
        <div class="cal-week-head" title="Open day view">
          <span class="dow">${WEEKDAYS[i]}</span>
          <span class="dnum">${Number(day.slice(8))}</span>
        </div>
        <div class="cal-week-items">${dayItems(day).map(chip).join('')}</div>
        <button class="cal-add" data-day="${day}" title="Add task on ${day}">+</button>
      </div>`);
  }
  return `<div class="cal-week">${cols.join('')}</div>`;
}

function dayList() {
  const items = dayItems(anchor);
  return `
    <section class="card">
      <div class="rows">
        ${items.map(entityRow).join('') || '<div class="empty">Nothing scheduled this day.</div>'}
      </div>
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
