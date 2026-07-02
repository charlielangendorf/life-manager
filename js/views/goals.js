// Goals view: a card per goal with milestone progress and its "feeders"
// (tasks/habits whose linkedTo points at the goal). Own create/edit modal with
// a dynamic milestones editor. Deletes are undoable. See docs/phase2-brief.md.
import { store } from '../store.js';
import { uid, escapeHtml, relativeDue } from '../utils.js';
import { showToast } from '../toast.js';

// UI state kept at module level so it survives store-triggered re-renders.
const expanded = new Set();
let completedOpen = false;

// ---- pure computation (DOM-free, headlessly testable) ----

// Milestone completion for a goal: how many of m milestones are done + percent.
export function milestoneStats(goal) {
  const list = goal?.extra?.milestones || [];
  const total = list.length;
  const done = list.filter((mi) => mi.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return { done, total, pct };
}

// Feeders = entities whose linkedTo contains this goal's id. Tasks/habits point
// AT goals, never the reverse, so we scan the whole store.
export function feedersFor(goalId) {
  const linked = store.entities.filter((e) => (e.linkedTo || []).includes(goalId));
  const tasks = linked.filter((e) => e.type === 'task');
  return {
    openTasks: tasks.filter((t) => t.status !== 'done'),
    doneTasks: tasks.filter((t) => t.status === 'done'),
    habits: linked.filter((e) => e.type === 'habit'),
  };
}

// ---- rendering ----

function progressBar(pct) {
  return `
    <div class="goal-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
      <span style="width:${pct}%"></span>
    </div>`;
}

function feederSummary(f) {
  const bits = [];
  bits.push(`<span class="badge">${f.openTasks.length} open</span>`);
  if (f.doneTasks.length) bits.push(`<span class="badge">${f.doneTasks.length} done</span>`);
  if (f.habits.length) bits.push(`<span class="badge">${f.habits.length} habit${f.habits.length === 1 ? '' : 's'}</span>`);
  return `<div class="goal-feeders">${bits.join('')}</div>`;
}

function milestoneDetail(goal) {
  const list = goal.extra?.milestones || [];
  if (!list.length) return '<div class="empty">No milestones yet.</div>';
  return `
    <ul class="goal-milestones">
      ${list.map((mi) => `
        <li class="goal-milestone ${mi.done ? 'done' : ''}">
          <button class="check ${mi.done ? 'checked' : ''}" data-action="toggle-milestone"
            data-mid="${escapeHtml(mi.id)}" aria-label="Toggle milestone"></button>
          <span class="goal-milestone-title">${escapeHtml(mi.title)}</span>
          ${mi.targetDate ? `<span class="badge badge-due">${relativeDue(mi.targetDate)}</span>` : ''}
        </li>`).join('')}
    </ul>`;
}

function feederDetail(f) {
  const section = (label, items, render) => (items.length
    ? `<div class="goal-feeder-group">
         <div class="section-label">${label}</div>
         <ul class="goal-links">${items.map(render).join('')}</ul>
       </div>`
    : '');
  const li = (e) => `<li>${escapeHtml(e.title)}</li>`;
  return `
    ${section(`Open tasks (${f.openTasks.length})`, f.openTasks, li)}
    ${section(`Habits (${f.habits.length})`, f.habits, li)}
    ${(!f.openTasks.length && !f.habits.length)
      ? '<div class="empty">Nothing links to this goal yet.</div>' : ''}`;
}

function goalCard(goal) {
  const done = goal.status === 'done';
  const stats = milestoneStats(goal);
  const f = feedersFor(goal.id);
  const isOpen = expanded.has(goal.id);

  const meta = [];
  if (goal.dueDate) meta.push(`<span class="badge badge-due">${relativeDue(goal.dueDate)}</span>`);
  if (stats.total) meta.push(`<span class="badge">${stats.done}/${stats.total} milestones</span>`);

  return `
    <section class="card goal-card ${done ? 'goal-done' : ''}" data-id="${escapeHtml(goal.id)}">
      <div class="goal-head">
        <button class="goal-expand" data-action="expand" aria-expanded="${isOpen}"
          aria-label="Toggle details">${isOpen ? '▾' : '▸'}</button>
        <div class="goal-headmain">
          <div class="goal-title">${escapeHtml(goal.title)}</div>
          ${meta.length ? `<div class="row-meta">${meta.join('')}</div>` : ''}
        </div>
        <span class="spacer"></span>
        <button class="ghost-btn" data-action="edit">Edit</button>
        <button class="ghost-btn" data-action="toggle-done">${done ? 'Reopen' : 'Mark done'}</button>
      </div>
      ${goal.notes ? `<div class="goal-notes">${escapeHtml(goal.notes)}</div>` : ''}
      ${stats.total ? progressBar(stats.pct) : ''}
      ${feederSummary(f)}
      ${isOpen ? `
        <div class="goal-detail">
          <div class="section-label">Milestones</div>
          ${milestoneDetail(goal)}
          ${feederDetail(f)}
        </div>` : ''}
    </section>`;
}

function emptyState() {
  return `
    <section class="card goal-empty">
      <div class="empty">
        <h2>No goals yet</h2>
        <p class="hint">Goals are the bigger outcomes you're working toward. Break each
          one into milestones, then link tasks and habits to it from their editors —
          they'll show up here as "feeders" so you can see what's actually moving the
          goal forward.</p>
        <button id="new-goal-empty" class="primary-btn">+ New goal</button>
      </div>
    </section>`;
}

function draw(container) {
  const goals = store.all('goal');
  const open = goals.filter((g) => g.status !== 'done');
  const doneGoals = goals.filter((g) => g.status === 'done');

  if (!goals.length) {
    container.innerHTML = `
      <div class="view-head">
        <h1>Goals</h1>
        <span class="spacer"></span>
        <button id="new-goal" class="primary-btn">+ New goal</button>
      </div>
      ${emptyState()}`;
    return;
  }

  container.innerHTML = `
    <div class="view-head">
      <h1>Goals</h1>
      <span class="spacer"></span>
      <button id="new-goal" class="primary-btn">+ New goal</button>
    </div>
    <div class="goal-list">
      ${open.map(goalCard).join('') || '<div class="empty">No active goals — nice work.</div>'}
    </div>
    ${doneGoals.length ? `
      <div class="goal-completed">
        <button id="toggle-completed" class="goal-completed-head" aria-expanded="${completedOpen}">
          ${completedOpen ? '▾' : '▸'} Completed (${doneGoals.length})
        </button>
        ${completedOpen ? `<div class="goal-list">${doneGoals.map(goalCard).join('')}</div>` : ''}
      </div>` : ''}`;
}

export function render(container) {
  container.addEventListener('click', (ev) => {
    if (ev.target.closest('#new-goal') || ev.target.closest('#new-goal-empty')) {
      openGoalEditor(null);
      return;
    }
    if (ev.target.closest('#toggle-completed')) {
      completedOpen = !completedOpen;
      draw(container);
      return;
    }

    const card = ev.target.closest('.goal-card[data-id]');
    if (!card) return;
    const goal = store.get(card.dataset.id);
    if (!goal) return;

    const action = ev.target.closest('[data-action]')?.dataset.action;
    if (action === 'expand') {
      if (expanded.has(goal.id)) expanded.delete(goal.id);
      else expanded.add(goal.id);
      draw(container);
    } else if (action === 'edit') {
      openGoalEditor(goal);
    } else if (action === 'toggle-done') {
      const next = goal.status === 'done' ? 'todo' : 'done';
      store.update(goal.id, { status: next });
    } else if (action === 'toggle-milestone') {
      const mid = ev.target.closest('[data-mid]')?.dataset.mid;
      const list = (goal.extra?.milestones || []).map((mi) =>
        (mi.id === mid ? { ...mi, done: !mi.done } : mi));
      store.update(goal.id, { extra: { ...goal.extra, milestones: list } });
    }
  });

  draw(container);
}

// ---- goal editor modal (own build; mirrors taskModal structure/classes) ----

let overlay = null;

function onKey(e) {
  if (e.key === 'Escape') closeGoalEditor();
}

function closeGoalEditor() {
  overlay?.remove();
  overlay = null;
  document.removeEventListener('keydown', onKey);
}

function milestoneRow(mi) {
  const row = document.createElement('div');
  row.className = 'goal-ms-row';
  row.dataset.mid = mi.id || uid();
  row.innerHTML = `
    <input type="checkbox" title="Done">
    <input type="text" class="ms-title" placeholder="Milestone…">
    <input type="date" class="ms-date" title="Target date">
    <button type="button" class="icon-btn" title="Remove">✕</button>`;
  row.querySelector('[type=checkbox]').checked = Boolean(mi.done);
  row.querySelector('.ms-title').value = mi.title || '';
  row.querySelector('.ms-date').value = (mi.targetDate || '').slice(0, 10);
  row.querySelector('button').addEventListener('click', () => row.remove());
  return row;
}

function openGoalEditor(entity = null) {
  closeGoalEditor();

  const isNew = !entity;
  const g = entity || { type: 'goal', title: '', notes: '', dueDate: '', extra: {} };
  const milestones = g.extra?.milestones || [];

  overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <span class="modal-type">Goal</span>
        <span class="spacer"></span>
        <button type="button" class="icon-btn" data-close title="Close (Esc)">✕</button>
      </div>
      <div class="modal-body">
        <input id="g-title" placeholder="Goal title" autocomplete="off">
        <textarea id="g-notes" placeholder="Notes…"></textarea>
        <div class="form-grid">
          <label>Target date<input type="date" id="g-date"></label>
        </div>
        <div id="milestones-section">
          <div class="section-label">Milestones</div>
          <div id="milestone-list"></div>
          <button type="button" id="add-milestone" class="ghost-btn">+ Add milestone</button>
        </div>
      </div>
      <div class="modal-foot">
        ${isNew ? '' : '<button type="button" id="g-delete" class="danger-btn">Delete</button>'}
        <span class="spacer"></span>
        <button type="button" class="ghost-btn" data-close>Cancel</button>
        <button type="button" id="g-save" class="primary-btn">${isNew ? 'Add' : 'Save'}</button>
      </div>
    </div>`;

  const $ = (sel) => overlay.querySelector(sel);

  $('#g-title').value = g.title || '';
  $('#g-notes').value = g.notes || '';
  $('#g-date').value = (g.dueDate || '').slice(0, 10);

  const msList = $('#milestone-list');
  for (const mi of milestones) msList.appendChild(milestoneRow(mi));

  $('#add-milestone').addEventListener('click', () => {
    const row = milestoneRow({});
    msList.appendChild(row);
    row.querySelector('.ms-title').focus();
  });

  $('#g-save').addEventListener('click', () => {
    const title = $('#g-title').value.trim();
    if (!title) {
      $('#g-title').classList.add('invalid');
      $('#g-title').focus();
      return;
    }
    const ms = [...msList.children].map((row) => ({
      id: row.dataset.mid,
      title: row.querySelector('.ms-title').value.trim(),
      targetDate: row.querySelector('.ms-date').value || null,
      done: row.querySelector('[type=checkbox]').checked,
    })).filter((mi) => mi.title);

    const patch = {
      type: 'goal',
      title,
      notes: $('#g-notes').value.trim(),
      dueDate: $('#g-date').value || null,
      extra: { ...(entity?.extra || {}), milestones: ms },
    };
    if (isNew) {
      patch.status = 'todo';
      store.add(patch);
    } else {
      store.update(entity.id, patch);
    }
    closeGoalEditor();
  });

  if (!isNew) {
    $('#g-delete').addEventListener('click', () => {
      const removed = store.remove(entity.id);
      closeGoalEditor();
      if (removed) {
        showToast(`Deleted "${removed.title}"`, {
          actionLabel: 'Undo',
          onAction: () => store.restore(removed),
        });
      }
    });
  }

  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) closeGoalEditor();
    if (ev.target.closest('[data-close]')) closeGoalEditor();
  });
  document.addEventListener('keydown', onKey);

  document.getElementById('modal-root').appendChild(overlay);
  $('#g-title').focus();
}
