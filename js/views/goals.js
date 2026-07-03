// Goals view: a card per goal with milestone progress and its "feeders"
// (tasks/habits whose linkedTo points at the goal). Own create/edit modal with
// a dynamic milestones editor. Deletes are undoable. See docs/redesign-brief.md.
//
// Layout (redesign): milestones become a mini vertical TIMELINE inside each goal
// (connecting line + nodes; done nodes filled warm, the next undone node
// emphasized) rather than a flat checkbox list. Goal cards carry hierarchy — the
// most urgent open goal (nearest target / most complete) is a HERO card with
// more visual weight; the rest are quieter. The screen's single saturated
// (--highlight) moment is the "Next up" banner: the one next milestone across
// all goals. Feeders stay as quiet supporting detail with iconFor glyphs.
import { store } from '../store.js';
import { uid, escapeHtml, relativeDue, parseDate, todayKey } from '../utils.js';
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

// ---- internal helpers (not exported; ordering + "next milestone" logic) ----

// The first not-yet-done milestone in a goal (timeline order), or null.
function nextMilestone(goal) {
  return (goal?.extra?.milestones || []).find((mi) => !mi.done) || null;
}

// Rank open goals so one hero rises to the top. A goal is "hotter" when it has a
// nearer target date; goals without a date fall back to completion. We combine
// both into a single score (lower = more urgent → sorts first).
function urgencyScore(goal) {
  const stats = milestoneStats(goal);
  if (goal.dueDate) {
    const days = Math.round((parseDate(goal.dueDate) - parseDate(todayKey())) / 86400000);
    // Overdue and near-term goals score lowest; completion nudges ties.
    return days - stats.pct / 100;
  }
  // No date: use "least complete but started" — closer to done pulls it up a bit,
  // but a dated goal always outranks an undated one (large offset keeps it back).
  return 10000 - stats.pct;
}

// Choose the goal to feature + the single next milestone across all open goals
// (the one saturated moment). We prefer the hero's own next milestone; if the
// hero has none, we take the earliest next milestone from any open goal.
function pickHighlight(openGoals) {
  for (const g of openGoals) {
    const mi = nextMilestone(g);
    if (mi) return { goal: g, milestone: mi };
  }
  return null;
}

// ---- rendering ----

function progressBar(pct) {
  return `
    <div class="goal-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
      <span style="width:${pct}%"></span>
    </div>`;
}

// Field notes: no glyphs — typography carries the hierarchy.
function goalGlyph() {
  return '';
}

// Quiet feeder summary: small counts with a tinted icon, supporting detail only.
function feederSummary(f) {
  const bits = [];
  if (f.openTasks.length) bits.push(`<span class="goal-feed-chip">${f.openTasks.length} open task${f.openTasks.length === 1 ? '' : 's'}</span>`);
  if (f.doneTasks.length) bits.push(`<span class="goal-feed-chip is-quiet">${f.doneTasks.length} done</span>`);
  if (f.habits.length) bits.push(`<span class="goal-feed-chip">↻ ${f.habits.length} habit${f.habits.length === 1 ? '' : 's'}</span>`);
  if (!bits.length) return '';
  return `<div class="goal-feeders">${bits.join('')}</div>`;
}

// Milestones as a mini vertical timeline. Done nodes are filled warm; the first
// undone node is emphasized (the goal's own "next" marker). Toggling is
// unchanged: data-action="toggle-milestone" + data-mid.
function milestoneTimeline(goal) {
  const list = goal.extra?.milestones || [];
  if (!list.length) return '<div class="empty">No milestones yet.</div>';
  const nextId = nextMilestone(goal)?.id;
  return `
    <ol class="goal-timeline">
      ${list.map((mi) => {
        const isNext = mi.id === nextId;
        return `
        <li class="goal-tl-item ${mi.done ? 'is-done' : ''} ${isNext ? 'is-next' : ''}">
          <button class="goal-tl-node" data-action="toggle-milestone"
            data-mid="${escapeHtml(mi.id)}"
            aria-pressed="${mi.done}" aria-label="Toggle milestone ${escapeHtml(mi.title)}"></button>
          <div class="goal-tl-body">
            <span class="goal-tl-title">${escapeHtml(mi.title)}</span>
            ${mi.targetDate ? `<span class="badge badge-due">${escapeHtml(relativeDue(mi.targetDate))}</span>` : ''}
          </div>
        </li>`;
      }).join('')}
    </ol>`;
}

function feederDetail(f) {
  const li = (e) => `<li><span class="goal-link-glyph" aria-hidden="true">·</span>${escapeHtml(e.title)}</li>`;
  const section = (label, items) => (items.length
    ? `<div class="goal-feeder-group">
         <div class="section-label">${label}</div>
         <ul class="goal-links">${items.map(li).join('')}</ul>
       </div>`
    : '');
  return `
    ${section(`Open tasks (${f.openTasks.length})`, f.openTasks)}
    ${section(`Habits (${f.habits.length})`, f.habits)}
    ${(!f.openTasks.length && !f.habits.length)
      ? '<div class="empty">Nothing links to this goal yet.</div>' : ''}`;
}

// A goal card. `hero` gives it more visual weight (accent rail, larger serif
// title, glyph); quiet cards are lighter. Behavior is identical across both.
function goalCard(goal, hero = false) {
  const done = goal.status === 'done';
  const stats = milestoneStats(goal);
  const f = feedersFor(goal.id);
  const isOpen = expanded.has(goal.id);
  const next = nextMilestone(goal);

  const meta = [];
  if (goal.dueDate) meta.push(`<span class="badge badge-due">${escapeHtml(relativeDue(goal.dueDate))}</span>`);
  if (stats.total) meta.push(`<span class="badge">${stats.done}/${stats.total} milestones</span>`);

  const cls = ['card', 'goal-card'];
  if (hero) cls.push('is-hero');
  if (done) cls.push('goal-done');

  return `
    <section class="${cls.join(' ')}" data-id="${escapeHtml(goal.id)}">
      <div class="goal-head">
        <button class="goal-expand" data-action="expand" aria-expanded="${isOpen}"
          aria-label="Toggle details">${isOpen ? '▾' : '▸'}</button>
        ${goalGlyph(goal, hero)}
        <div class="goal-headmain">
          <div class="goal-title">${escapeHtml(goal.title)}</div>
          ${meta.length ? `<div class="row-meta">${meta.join('')}</div>` : ''}
        </div>
        <span class="spacer"></span>
        <div class="goal-head-actions">
          <button class="goal-txt-btn" data-action="edit" aria-label="Edit goal">edit</button>
          <button class="ghost-btn goal-done-btn" data-action="toggle-done">${done ? 'Reopen' : 'Mark done'}</button>
        </div>
      </div>
      ${goal.notes ? `<div class="goal-notes">${escapeHtml(goal.notes)}</div>` : ''}
      ${stats.total ? `
        <div class="goal-progress">
          ${progressBar(stats.pct)}
          <span class="goal-progress-pct">${stats.pct}%</span>
        </div>` : ''}
      ${(!isOpen && !done && next) ? `
        <div class="goal-nextline">
          <span class="goal-nextline-label">Next</span>
          <span class="goal-nextline-title">${escapeHtml(next.title)}</span>
          ${next.targetDate ? `<span class="badge badge-due">${escapeHtml(relativeDue(next.targetDate))}</span>` : ''}
        </div>` : ''}
      ${feederSummary(f)}
      ${isOpen ? `
        <div class="goal-detail">
          <div class="section-label">Milestones</div>
          ${milestoneTimeline(goal)}
          ${feederDetail(f)}
        </div>` : ''}
    </section>`;
}

// The one saturated moment: a "Next up" banner spotlighting the single next
// milestone across all open goals. Uses --highlight exactly once on this screen.
function nextUpBanner(hl) {
  const { goal, milestone } = hl;
  return `
    <div class="goal-nextup" data-id="${escapeHtml(goal.id)}">
      <span class="goal-nextup-kicker">Next up</span>
      <div class="goal-nextup-main">
        <div class="goal-nextup-title">${escapeHtml(milestone.title)}</div>
        <div class="goal-nextup-sub">
          toward <strong>${escapeHtml(goal.title)}</strong>${milestone.targetDate
            ? ` · <span class="goal-nextup-due">${escapeHtml(relativeDue(milestone.targetDate))}</span>` : ''}
        </div>
      </div>
      <button class="goal-nextup-check" data-action="toggle-milestone" data-mid="${escapeHtml(milestone.id)}"
        aria-label="Complete milestone ${escapeHtml(milestone.title)}">Done</button>
    </div>`;
}

function emptyState() {
  return `
    <section class="card goal-empty">
      <div class="empty">
        <h2>No goals yet</h2>
        <p>Goals are the bigger outcomes you're working toward. Break each
          one into milestones, then link tasks and habits to it from their editors —
          they'll show up here as feeders so you can see what's actually moving the
          goal forward.</p>
        <button id="new-goal-empty" class="primary-btn">+ New goal</button>
      </div>
    </section>`;
}

function draw(container) {
  const goals = store.all('goal');
  const open = goals
    .filter((g) => g.status !== 'done')
    .sort((a, b) => urgencyScore(a) - urgencyScore(b) || a.title.localeCompare(b.title));
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

  const highlight = pickHighlight(open);
  // The hero is the top-ranked open goal; the rest render quieter.
  const heroGoal = open[0] || null;
  const rest = open.slice(1);

  container.innerHTML = `
    <div class="view-head">
      <h1>Goals</h1>
      <span class="spacer"></span>
      <button id="new-goal" class="primary-btn">+ New goal</button>
    </div>
    ${highlight ? nextUpBanner(highlight) : ''}
    ${open.length ? `
      <div class="goal-list">
        ${heroGoal ? goalCard(heroGoal, true) : ''}
        ${rest.map((g) => goalCard(g, false)).join('')}
      </div>`
      : '<div class="empty">No active goals — nice work.</div>'}
    ${doneGoals.length ? `
      <div class="goal-completed">
        <button id="toggle-completed" class="goal-completed-head" aria-expanded="${completedOpen}">
          ${completedOpen ? '▾' : '▸'} Completed (${doneGoals.length})
        </button>
        ${completedOpen ? `<div class="goal-list">${doneGoals.map((g) => goalCard(g, false)).join('')}</div>` : ''}
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

    // The "Next up" banner shares the toggle-milestone action but isn't a card.
    const banner = ev.target.closest('.goal-nextup[data-id]');
    if (banner && ev.target.closest('[data-action="toggle-milestone"]')) {
      const goal = store.get(banner.dataset.id);
      const mid = ev.target.closest('[data-mid]')?.dataset.mid;
      if (goal && mid) toggleMilestone(goal, mid);
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
      toggleMilestone(goal, mid);
    }
  });

  draw(container);
}

// Flip a single milestone's done flag, writing back the full milestones array
// (identical data shape to before).
function toggleMilestone(goal, mid) {
  if (!mid) return;
  const list = (goal.extra?.milestones || []).map((mi) =>
    (mi.id === mid ? { ...mi, done: !mi.done } : mi));
  store.update(goal.id, { extra: { ...goal.extra, milestones: list } });
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
