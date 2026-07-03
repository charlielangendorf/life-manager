// Row renderer + click handling shared by the tasks and calendar-day views.
import { store } from '../store.js';
import { escapeHtml, relativeDue, timeOf, fmtTime, todayKey } from '../utils.js';
import { recurrenceLabel } from '../models.js';
import { openEditor } from '../taskModal.js';
import { iconFor } from '../icons.js';

export function entityRow(e) {
  const done = e.status === 'done';
  const when = e.type === 'event' ? e.date : e.dueDate;
  const overdue = e.type === 'task' && !done && when && when.slice(0, 10) < todayKey();
  const subs = e.extra?.subtasks || [];
  const rec = e.extra?.recurrence;
  const icon = iconFor(e);

  const meta = [];
  if (e.project) meta.push(`<span class="badge badge-project">${escapeHtml(e.project)}</span>`);
  const linkedGoal = (e.linkedTo || []).map((id) => store.get(id)).find((g) => g?.type === 'goal');
  if (linkedGoal) {
    const t = linkedGoal.title || '';
    const short = t.length > 24 ? t.slice(0, 23) + '…' : t;
    meta.push(`<span class="badge badge-goal">◎ ${escapeHtml(short)}</span>`);
  }
  for (const t of e.tags || []) meta.push(`<span class="badge badge-tag">#${escapeHtml(t)}</span>`);
  if (when) {
    const t = timeOf(when);
    meta.push(`<span class="badge badge-due ${overdue ? 'overdue' : ''}">${relativeDue(when)}${t ? ' · ' + fmtTime(t) : ''}</span>`);
  }
  if (subs.length) meta.push(`<span class="badge">${subs.filter((s) => s.done).length}/${subs.length} subtasks</span>`);
  if (rec) meta.push(`<span class="badge">↻ ${recurrenceLabel(rec)}</span>`);

  // Priority reads as a thin left-border tint on the row (via pri-* class), not
  // a filled badge. The leading glyph is the content-matched icon when we have
  // one; otherwise the task keeps its check circle and events keep their dot.
  const pri = e.type === 'task' && !done && e.priority ? `pri-${e.priority}` : '';
  const lead = e.type === 'task'
    ? `<button class="check ${done ? 'checked' : ''}" data-action="toggle" aria-label="Toggle complete"></button>`
    : '<span class="event-dot"></span>';
  const glyph = icon ? `<span class="row-icon" aria-hidden="true">${icon}</span>` : '';

  return `
    <div class="row row-accent ${pri} ${done ? 'done' : ''}" data-id="${e.id}">
      ${lead}
      ${glyph}
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
