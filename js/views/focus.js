// Focus mode (#/focus): a calm, minimal screen with only today's actionable
// tasks — overdue open tasks + tasks due today — plus a bare quick-add.
// No cards/filters/badges beyond an overdue marker. Larger type, lots of air.
import { store } from '../store.js';
import { todayKey, fmtDateFull, escapeHtml } from '../utils.js';

const byDue = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999');

function focusRow(e, overdue) {
  const done = e.status === 'done';
  return `
    <div class="focus-row ${done ? 'done' : ''}" data-id="${e.id}">
      <button class="check ${done ? 'checked' : ''}" data-action="toggle" aria-label="Toggle complete"></button>
      <span class="focus-title">${escapeHtml(e.title)}</span>
      ${overdue && !done ? '<span class="focus-overdue">overdue</span>' : ''}
    </div>`;
}

export function render(container) {
  const today = todayKey();
  const tasks = store.all('task');
  const open = tasks.filter((t) => t.status !== 'done');

  const overdue = open.filter((t) => t.dueDate && t.dueDate.slice(0, 10) < today).sort(byDue);
  const dueToday = open.filter((t) => t.dueDate && t.dueDate.slice(0, 10) === today).sort(byDue);
  const actionable = [...overdue, ...dueToday];
  const overdueIds = new Set(overdue.map((t) => t.id));

  const list = actionable.length
    ? `<div class="focus-list">${actionable.map((t) => focusRow(t, overdueIds.has(t.id))).join('')}</div>`
    : `<div class="focus-done">
         <div class="focus-done-mark">✓</div>
         <div class="focus-done-title">All clear for today</div>
         <div class="focus-done-copy">Nothing overdue, nothing due today. Enjoy the space —
           or add something below if you're ready.</div>
       </div>`;

  container.innerHTML = `
    <div class="focus">
      <a class="focus-back" href="#/dashboard">← Back to dashboard</a>
      <h1 class="focus-date">${escapeHtml(fmtDateFull(today))}</h1>
      ${list}
      <form id="focus-add" class="focus-add">
        <input id="focus-add-input" placeholder="add a task for today" autocomplete="off">
      </form>
    </div>`;

  // Delegated: check-off toggles; the rest of the row is inert (calm, no editor).
  container.addEventListener('click', (ev) => {
    const toggle = ev.target.closest('[data-action="toggle"]');
    if (!toggle) return;
    const row = toggle.closest('.focus-row[data-id]');
    if (row) store.toggleComplete(row.dataset.id);
  });

  container.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = ev.target.querySelector('input');
    const title = input.value.trim();
    if (!title) return;
    store.add({ type: 'task', title, dueDate: todayKey() });
    // The add re-rendered the view; restore the cursor for rapid entry.
    document.getElementById('focus-add-input')?.focus();
  });
}
