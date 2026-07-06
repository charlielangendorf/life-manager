// Shared create/edit modal for tasks and events.
import { store } from './store.js';
import { uid, escapeHtml, timeOf } from './utils.js';
import { showToast } from './toast.js';

let overlay = null;

function onKey(e) {
  if (e.key === 'Escape') closeEditor();
}

export function closeEditor() {
  overlay?.remove();
  overlay = null;
  document.removeEventListener('keydown', onKey);
}

function refreshProjectList() {
  const datalist = document.getElementById('project-list');
  const projects = [...new Set(store.entities.map((e) => e.project).filter(Boolean))].sort();
  datalist.innerHTML = projects.map((p) => `<option value="${escapeHtml(p)}"></option>`).join('');
}

function subtaskRow(s) {
  const row = document.createElement('div');
  row.className = 'subtask-row';
  row.dataset.sid = s.id || uid();
  row.innerHTML = `
    <input type="checkbox">
    <input type="text" class="subtask-title" placeholder="Subtask…">
    <button type="button" class="icon-btn" title="Remove">✕</button>`;
  row.querySelector('[type=checkbox]').checked = Boolean(s.done);
  row.querySelector('.subtask-title').value = s.title || '';
  row.querySelector('button').addEventListener('click', () => row.remove());
  return row;
}

export function openEditor(entity = null, defaults = {}) {
  closeEditor();
  refreshProjectList();

  const isNew = !entity;
  const e = entity || {
    type: 'task', title: '', notes: '', tags: [], project: '',
    priority: null, extra: {}, ...defaults,
  };
  const when = (e.type === 'event' ? e.date : e.dueDate) || '';
  const dateVal = when.slice(0, 10);
  const timeVal = timeOf(when);
  const rec = e.extra?.recurrence || null;
  const subtasks = e.extra?.subtasks || [];

  overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <select id="f-type" class="modal-type">
          <option value="task">Task</option>
          <option value="event">Event</option>
        </select>
        <span class="spacer"></span>
        <button type="button" class="icon-btn" data-close title="Close (Esc)">✕</button>
      </div>
      <div class="modal-body">
        <input id="f-title" placeholder="Title" autocomplete="off">
        <textarea id="f-notes" placeholder="Notes…"></textarea>
        <div class="form-grid">
          <label><span id="f-date-label">Due date</span><input type="date" id="f-date"></label>
          <label>Time<input type="time" id="f-time"></label>
          <label id="f-end-label">End date (optional)<input type="date" id="f-end"></label>
          <label>Priority
            <select id="f-priority">
              <option value="">None</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label>Project<input id="f-project" list="project-list" placeholder="e.g. coursework"></label>
          <label>Goal
            <select id="f-goal"></select>
          </label>
          <label class="full">Tags<input id="f-tags" placeholder="comma, separated"></label>
          <label class="full">Repeat
            <div class="rec-wrap">
              <select id="f-rec">
                <option value="">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
              <input type="number" id="f-rec-n" min="1" value="1" title="Every N days/weeks/months">
            </div>
          </label>
        </div>
        <div id="subtasks-section">
          <div class="section-label">Subtasks</div>
          <div id="subtask-list"></div>
          <button type="button" id="add-subtask" class="ghost-btn">+ Add subtask</button>
        </div>
      </div>
      <div class="modal-foot">
        ${isNew ? '' : '<button type="button" id="f-delete" class="danger-btn">Delete</button>'}
        <span class="spacer"></span>
        <button type="button" class="ghost-btn" data-close>Cancel</button>
        <button type="button" id="f-save" class="primary-btn">${isNew ? 'Add' : 'Save'}</button>
      </div>
    </div>`;

  const $ = (sel) => overlay.querySelector(sel);

  $('#f-type').value = e.type;
  $('#f-title').value = e.title || '';
  $('#f-notes').value = e.notes || '';
  $('#f-date').value = dateVal;
  $('#f-time').value = timeVal;
  // Multi-day events store their inclusive END DAY in dueDate (plain YYYY-MM-DD).
  $('#f-end').value = e.type === 'event' ? (e.dueDate || '').slice(0, 10) : '';
  $('#f-priority').value = e.priority || '';
  $('#f-project').value = e.project || '';
  $('#f-tags').value = (e.tags || []).join(', ');

  // Goal link: options are open goals; the value lives in linkedTo. Any goal id
  // already linked is shown as selected even if the goal is now done, so saving
  // doesn't silently drop it.
  const openGoals = store.all('goal').filter((g) => g.status !== 'done');
  const linkedGoalId = (e.linkedTo || []).find((id) => store.get(id)?.type === 'goal') || '';
  const goalOptions = [...openGoals];
  if (linkedGoalId && !goalOptions.some((g) => g.id === linkedGoalId)) {
    const g = store.get(linkedGoalId);
    if (g) goalOptions.push(g);
  }
  const goalSel = $('#f-goal');
  const noneLabel = goalOptions.length ? 'None' : 'No goals yet';
  goalSel.innerHTML = `<option value="">${noneLabel}</option>`
    + goalOptions.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.title)}</option>`).join('');
  goalSel.value = linkedGoalId;
  $('#f-rec').value = rec?.freq || '';
  $('#f-rec-n').value = rec?.interval || 1;
  $('#f-rec-n').disabled = !rec;

  const subtaskList = $('#subtask-list');
  for (const s of subtasks) subtaskList.appendChild(subtaskRow(s));

  const applyType = () => {
    const isEvent = $('#f-type').value === 'event';
    $('#f-date-label').textContent = isEvent ? 'Date' : 'Due date';
    $('#subtasks-section').hidden = isEvent;
    // The optional end date applies to events only (multi-day spans).
    $('#f-end-label').hidden = !isEvent;
  };
  applyType();

  $('#f-type').addEventListener('change', applyType);
  $('#f-rec').addEventListener('change', () => {
    $('#f-rec-n').disabled = !$('#f-rec').value;
  });
  $('#add-subtask').addEventListener('click', () => {
    const row = subtaskRow({});
    subtaskList.appendChild(row);
    row.querySelector('.subtask-title').focus();
  });

  $('#f-save').addEventListener('click', () => {
    const type = $('#f-type').value;
    const title = $('#f-title').value.trim();
    if (!title) {
      $('#f-title').classList.add('invalid');
      $('#f-title').focus();
      return;
    }
    const date = $('#f-date').value;
    const time = $('#f-time').value;
    const stamp = date ? (time ? `${date}T${time}` : date) : null;

    // Events may carry an inclusive end day in dueDate. Keep it only when it is
    // on or after the start day; an earlier/blank end silently clears the span.
    let eventEnd = null;
    if (type === 'event') {
      const end = $('#f-end').value;
      // Compare day parts only — the start may carry a time (YYYY-MM-DDTHH:mm).
      if (end && date && end >= date.slice(0, 10)) eventEnd = end;
    }

    const patch = {
      type,
      title,
      notes: $('#f-notes').value.trim(),
      priority: $('#f-priority').value || null,
      project: $('#f-project').value.trim() || null,
      tags: $('#f-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
      dueDate: type === 'task' ? stamp : eventEnd,
      date: type === 'event' ? stamp : null,
      extra: { ...(entity?.extra || {}) },
    };

    // Preserve any non-goal links; replace the single goal link with the picked one.
    const nonGoalIds = (entity?.linkedTo || []).filter((id) => store.get(id)?.type !== 'goal');
    const pickedGoal = $('#f-goal').value;
    patch.linkedTo = pickedGoal ? [...nonGoalIds, pickedGoal] : nonGoalIds;

    const freq = $('#f-rec').value;
    if (freq) {
      patch.extra.recurrence = { freq, interval: Math.max(1, parseInt($('#f-rec-n').value, 10) || 1) };
    } else {
      delete patch.extra.recurrence;
    }

    const subs = [...subtaskList.children].map((row) => ({
      id: row.dataset.sid,
      title: row.querySelector('.subtask-title').value.trim(),
      done: row.querySelector('[type=checkbox]').checked,
    })).filter((s) => s.title);
    if (type === 'task' && subs.length) patch.extra.subtasks = subs;
    else delete patch.extra.subtasks;

    if (isNew) store.add(patch);
    else store.update(entity.id, patch);
    closeEditor();
  });

  if (!isNew) {
    $('#f-delete').addEventListener('click', () => {
      const removed = store.remove(entity.id);
      closeEditor();
      if (removed) {
        showToast(`Deleted "${removed.title}"`, {
          actionLabel: 'Undo',
          onAction: () => store.restore(removed),
        });
      }
    });
  }

  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) closeEditor();
    if (ev.target.closest('[data-close]')) closeEditor();
  });
  document.addEventListener('keydown', onKey);

  document.getElementById('modal-root').appendChild(overlay);
  $('#f-title').focus();
}
