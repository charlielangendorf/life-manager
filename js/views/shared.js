// Row renderer + click handling shared by the dashboard, tasks, and
// calendar-day views.
import { store } from '../store.js';
import { escapeHtml, relativeDue, timeOf, fmtTime, todayKey } from '../utils.js';
import { recurrenceLabel } from '../models.js';
import { openEditor } from '../taskModal.js';

export function entityRow(e) {
  const done = e.status === 'done';
  const when = e.type === 'event' ? e.date : e.dueDate;
  const overdue = e.type === 'task' && !done && when && when.slice(0, 10) < todayKey();
  const subs = e.extra?.subtasks || [];
  const rec = e.extra?.recurrence;

  const meta = [];
  if (e.priority) meta.push(`<span class="badge pri-${e.priority}">${e.priority}</span>`);
  if (e.project) meta.push(`<span class="badge badge-project">${escapeHtml(e.project)}</span>`);
  for (const t of e.tags || []) meta.push(`<span class="badge badge-tag">#${escapeHtml(t)}</span>`);
  if (when) {
    const t = timeOf(when);
    meta.push(`<span class="badge badge-due ${overdue ? 'overdue' : ''}">${relativeDue(when)}${t ? ' · ' + fmtTime(t) : ''}</span>`);
  }
  if (subs.length) meta.push(`<span class="badge">${subs.filter((s) => s.done).length}/${subs.length} subtasks</span>`);
  if (rec) meta.push(`<span class="badge">↻ ${recurrenceLabel(rec)}</span>`);

  return `
    <div class="row ${done ? 'done' : ''}" data-id="${e.id}">
      ${e.type === 'task'
        ? `<button class="check ${done ? 'checked' : ''}" data-action="toggle" aria-label="Toggle complete"></button>`
        : '<span class="event-dot"></span>'}
      <div class="row-main">
        <div class="row-title">${escapeHtml(e.title)}</div>
        ${meta.length ? `<div class="row-meta">${meta.join('')}</div>` : ''}
      </div>
    </div>`;
}

// Delegated click handling: checkbox toggles completion, anywhere else on the
// row opens the editor. Attach once per fresh view root.
export function bindRows(container) {
  container.addEventListener('click', (ev) => {
    const row = ev.target.closest('.row[data-id]');
    if (!row) return;
    const entity = store.get(row.dataset.id);
    if (!entity) return;
    if (ev.target.closest('[data-action="toggle"]')) {
      store.toggleComplete(entity.id);
      return;
    }
    openEditor(entity);
  });
}
