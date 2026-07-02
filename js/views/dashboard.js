// "Today" landing page: overdue, today's schedule, due today, next 7 days.
import { store } from '../store.js';
import { todayKey, addDays, fmtDateFull, escapeHtml, startOfWeekKey } from '../utils.js';
import { entityRow, bindRows } from './shared.js';
import {
  needsToday, frequencyOf, weeklyTargetOf, weekDoneCount, toggleLog,
} from '../habits-logic.js';

const byDue = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999');

function section(label, items, cls = '') {
  if (!items.length) return '';
  return `
    <section class="card ${cls}">
      <h2>${label}</h2>
      <div class="rows">${items.map(entityRow).join('')}</div>
    </section>`;
}

// "Habits" card: habits still to do today. Daily ones unchecked today, weekly
// ones not yet at weeklyTarget this week. Empty → omit the card entirely.
function habitsSection(today) {
  const due = store.all('habit').filter((h) => needsToday(h, today));
  if (!due.length) return '';
  const week = startOfWeekKey(today);
  const rows = due
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((h) => {
      let sub = 'Daily';
      if (frequencyOf(h) === 'weekly') {
        sub = `Weekly · ${weekDoneCount(h, week)}/${weeklyTargetOf(h)} this week`;
      }
      return `
        <div class="dash-habit-row" data-habit-id="${h.id}">
          <button class="dash-habit-check" data-action="habit-check" aria-label="Check off ${escapeHtml(h.title)}"></button>
          <div class="dash-habit-main">
            <div class="dash-habit-title">${escapeHtml(h.title)}</div>
            <div class="dash-habit-sub">${escapeHtml(sub)}</div>
          </div>
        </div>`;
    })
    .join('');
  return `
    <section class="card">
      <h2>Habits</h2>
      <div class="dash-habits">${rows}</div>
    </section>`;
}

export function render(container) {
  const today = todayKey();
  const horizon = addDays(today, 7);
  const tasks = store.all('task');
  const open = tasks.filter((t) => t.status !== 'done');

  const overdue = open.filter((t) => t.dueDate && t.dueDate.slice(0, 10) < today).sort(byDue);
  const dueToday = open.filter((t) => t.dueDate && t.dueDate.slice(0, 10) === today).sort(byDue);
  const upcoming = open
    .filter((t) => t.dueDate && t.dueDate.slice(0, 10) > today && t.dueDate.slice(0, 10) <= horizon)
    .sort(byDue);
  const doneToday = tasks.filter(
    (t) => t.status === 'done' && (t.extra?.completedAt || '').slice(0, 10) === today,
  );
  const events = store.all('event')
    .filter((e) => e.date && e.date.slice(0, 10) === today)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const habitsDue = store.all('habit').some((h) => needsToday(h, today));
  const allEmpty = !overdue.length && !dueToday.length && !events.length
    && !upcoming.length && !habitsDue;

  container.innerHTML = `
    <div class="view-head">
      <h1>Today</h1>
      <div class="subtitle">${fmtDateFull(today)}</div>
    </div>
    <form id="quick-add" class="quick-add">
      <input id="quick-add-input" placeholder="Quick add a task for today… (press Enter)" autocomplete="off">
    </form>
    ${section('Overdue', overdue, 'overdue')}
    ${section("Today's schedule", events)}
    ${section('Due today', dueToday)}
    ${habitsSection(today)}
    ${section('Next 7 days', upcoming)}
    ${doneToday.length ? section(`Completed today (${doneToday.length})`, doneToday) : ''}
    ${allEmpty ? '<section class="card"><div class="empty">Nothing due — enjoy the clear day, or quick-add something above.</div></section>' : ''}
  `;

  bindRows(container);

  // One-tap check-off for the Habits card (marks today done immutably).
  container.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-action="habit-check"]');
    if (!btn) return;
    const row = btn.closest('[data-habit-id]');
    const habit = row && store.get(row.dataset.habitId);
    if (!habit) return;
    const log = toggleLog(habit.extra?.log || {}, today);
    store.update(habit.id, { extra: { ...habit.extra, log } });
  });

  container.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = ev.target.querySelector('input');
    const title = input.value.trim();
    if (!title) return;
    store.add({ type: 'task', title, dueDate: todayKey() });
    // The add re-rendered the view; put the cursor back for rapid entry.
    document.getElementById('quick-add-input')?.focus();
  });
}
