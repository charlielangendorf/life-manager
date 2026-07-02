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
          <label>Priority
            <select id="f-priority">
              <option value="">None</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label>Project<input id="f-project" list="project-list" placeholder="e.g. coursework"></label>
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
  $('#f-priority').value = e.priority || '';
  $('#f-project').value = e.project || '';
  $('#f-tags').value = (e.tags || []).join(', ');
  $('#f-rec').value = rec?.freq || '';
  $('#f-rec-n').value = rec?.interval || 1;
  $('#f-rec-n').disabled = !rec;

  const subtaskList = $('#subtask-list');
  for (const s of subtasks) subtaskList.appendChild(subtaskRow(s));

  const applyType = () => {
    const isEvent = $('#f-type').value === 'event';
    $('#f-date-label').textContent = isEvent ? 'Date' : 'Due date';
    $('#subtasks-section').hidden = isEvent;
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

    const patch = {
      type,
      title,
      notes: $('#f-notes').value.trim(),
      priority: $('#f-priority').value || null,
      project: $('#f-project').value.trim() || null,
      tags: $('#f-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
      dueDate: type === 'task' ? stamp : null,
      date: type === 'event' ? stamp : null,
      extra: { ...(entity?.extra || {}) },
    };

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
