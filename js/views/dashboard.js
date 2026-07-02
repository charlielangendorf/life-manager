// "Today" landing page: overdue, today's schedule, due today, next 7 days.
import { store } from '../store.js';
import { todayKey, addDays, fmtDateFull } from '../utils.js';
import { entityRow, bindRows } from './shared.js';

const byDue = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999');

function section(label, items, cls = '') {
  if (!items.length) return '';
  return `
    <section class="card ${cls}">
      <h2>${label}</h2>
      <div class="rows">${items.map(entityRow).join('')}</div>
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

  const allEmpty = !overdue.length && !dueToday.length && !events.length && !upcoming.length;

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
    ${section('Next 7 days', upcoming)}
    ${doneToday.length ? section(`Completed today (${doneToday.length})`, doneToday) : ''}
    ${allEmpty ? '<section class="card"><div class="empty">Nothing due — enjoy the clear day, or quick-add something above.</div></section>' : ''}
  `;

  bindRows(container);
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
