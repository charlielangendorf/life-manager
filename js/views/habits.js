// Habits view: CRUD via own modal, daily/weekly check-off, streaks, last-7-day
// strip, per-day notes, and an expandable per-habit stats area.
import { store } from '../store.js';
import { escapeHtml, todayKey, addDays, startOfWeekKey, WEEKDAYS, fmtDate } from '../utils.js';
import { showToast } from '../toast.js';
import {
  frequencyOf, weeklyTargetOf, isDayDone, dayNote, toggleLog, setLogNote,
  currentStreak, longestStreak, completionRate, needsToday, weekDoneCount,
} from '../habits-logic.js';

// UI state that must survive re-renders (no store change): which habit's stats
// panel is open, and which day's note editor is showing.
const ui = { expanded: null, noteFor: null };

// ---- store helpers (keep extra immutably-ish) ----

function writeLog(habit, newLog) {
  store.update(habit.id, { extra: { ...habit.extra, log: newLog } });
}

function toggleDay(habit, dayKey) {
  writeLog(habit, toggleLog(habit.extra?.log || {}, dayKey));
}

function saveNote(habit, dayKey, note) {
  writeLog(habit, setLogNote(habit.extra?.log || {}, dayKey, note));
}

// ---- rendering ----

function sevenDayStrip(habit) {
  const today = todayKey();
  const dots = [];
  for (let i = 6; i >= 0; i -= 1) {
    const day = addDays(today, -i);
    const done = isDayDone(habit, day);
    const label = i === 0 ? 'Today' : WEEKDAYS[new Date(day + 'T00:00').getDay()];
    const hasNote = Boolean(dayNote(habit, day));
    dots.push(`
      <button class="habit-dot ${done ? 'on' : ''} ${i === 0 ? 'is-today' : ''}"
              data-action="toggle-day" data-day="${day}"
              title="${escapeHtml(label)} ${fmtDate(day)}${done ? ' — done' : ''}"
              aria-label="${escapeHtml(label)} ${done ? 'done' : 'not done'}">
        <span class="habit-dot-day">${escapeHtml(label[0])}</span>
        ${hasNote ? '<span class="habit-dot-note" aria-hidden="true">•</span>' : ''}
      </button>`);
  }
  return `<div class="habit-strip">${dots.join('')}</div>`;
}

function statsPanel(habit) {
  const cur = currentStreak(habit);
  const longest = longestStreak(habit);
  const rate = completionRate(habit);
  const freq = frequencyOf(habit);
  const windowLabel = freq === 'weekly' ? 'last 12 weeks' : 'last 30 days';
  return `
    <div class="habit-stats">
      <div class="habit-stat"><span class="habit-stat-n">${cur}</span><span class="habit-stat-l">Current streak</span></div>
      <div class="habit-stat"><span class="habit-stat-n">${longest}</span><span class="habit-stat-l">Longest streak</span></div>
      <div class="habit-stat"><span class="habit-stat-n">${rate.pct}%</span><span class="habit-stat-l">Completion (${windowLabel})</span></div>
      <div class="habit-stat"><span class="habit-stat-n">${rate.done}/${rate.expected}</span><span class="habit-stat-l">${freq === 'weekly' ? 'Weeks met' : 'Days done'}</span></div>
    </div>`;
}

function noteEditor(habit, dayKey) {
  const existing = dayNote(habit, dayKey);
  return `
    <div class="habit-note-edit" data-note-day="${dayKey}">
      <input class="habit-note-input" type="text" maxlength="140"
             placeholder="Note for ${escapeHtml(fmtDate(dayKey))}…"
             value="${escapeHtml(existing)}" autocomplete="off">
      <button class="ghost-btn" data-action="note-save">Save</button>
      <button class="icon-btn" data-action="note-cancel" title="Close">✕</button>
    </div>`;
}

function habitCard(habit) {
  const today = todayKey();
  const freq = frequencyOf(habit);
  const cur = currentStreak(habit);
  const doneToday = isDayDone(habit, today);
  const expanded = ui.expanded === habit.id;

  const badges = [];
  if (freq === 'weekly') {
    const target = weeklyTargetOf(habit);
    const wk = weekDoneCount(habit, startOfWeekKey(today));
    badges.push(`<span class="badge">Weekly · ${wk}/${target}</span>`);
  } else {
    badges.push('<span class="badge">Daily</span>');
  }
  badges.push(`<span class="badge habit-streak" title="Current streak">🔥 ${cur}</span>`);
  for (const t of habit.tags || []) badges.push(`<span class="badge badge-tag">#${escapeHtml(t)}</span>`);
  const linkedGoal = (habit.linkedTo || []).map((id) => store.get(id)).find((g) => g && g.type === 'goal');
  if (linkedGoal) badges.push(`<span class="badge badge-project">🎯 ${escapeHtml(linkedGoal.title)}</span>`);

  // For weekly habits "check today" still logs the current day toward target.
  const checkLabel = freq === 'weekly'
    ? (doneToday ? 'Logged today' : 'Log today')
    : (doneToday ? 'Done today' : 'Check off');

  return `
    <div class="habit-card" data-id="${habit.id}">
      <div class="habit-top">
        <button class="habit-check ${doneToday ? 'on' : ''}" data-action="check-today"
                aria-label="${doneToday ? 'Uncheck today' : 'Check off today'}">
          <span class="habit-check-mark">✓</span>
        </button>
        <div class="habit-body">
          <div class="habit-title">${escapeHtml(habit.title)}</div>
          ${habit.notes ? `<div class="habit-notes">${escapeHtml(habit.notes)}</div>` : ''}
          <div class="habit-meta">${badges.join('')}</div>
        </div>
        <div class="habit-actions">
          ${doneToday ? '<button class="icon-btn" data-action="add-note" title="Note for today">📝</button>' : ''}
          <button class="icon-btn ${expanded ? 'on' : ''}" data-action="stats" aria-expanded="${expanded}" title="Stats">📊</button>
          <button class="icon-btn" data-action="edit" title="Edit habit">✏️</button>
        </div>
      </div>
      <div class="habit-lower">
        ${sevenDayStrip(habit)}
        <span class="habit-check-text ${doneToday ? 'muted' : ''}">${escapeHtml(checkLabel)}</span>
      </div>
      ${ui.noteFor === habit.id ? noteEditor(habit, today) : ''}
      ${expanded ? statsPanel(habit) : ''}
    </div>`;
}

function draw(container) {
  const habits = store.all('habit');

  if (!habits.length) {
    container.innerHTML = `
      <div class="view-head">
        <h1>Habits</h1>
        <span class="spacer"></span>
        <button id="new-habit" class="primary-btn">+ New habit</button>
      </div>
      <section class="card">
        <div class="empty habit-empty">
          <div class="habit-empty-icon">🌱</div>
          <p>No habits yet. Build a routine — check it off each day and watch the streak grow.</p>
          <button id="new-habit-2" class="primary-btn">+ New habit</button>
        </div>
      </section>`;
    return;
  }

  const sorted = [...habits].sort((a, b) => {
    // Habits still needing attention today float to the top.
    const an = needsToday(a) ? 0 : 1;
    const bn = needsToday(b) ? 0 : 1;
    return an - bn || a.title.localeCompare(b.title);
  });

  container.innerHTML = `
    <div class="view-head">
      <h1>Habits</h1>
      <span class="spacer"></span>
      <button id="new-habit" class="primary-btn">+ New habit</button>
    </div>
    <div class="habit-list">
      ${sorted.map(habitCard).join('')}
    </div>`;
}

// ---- event wiring (delegated on the fresh container) ----

export function render(container) {
  container.addEventListener('click', (ev) => {
    if (ev.target.closest('#new-habit') || ev.target.closest('#new-habit-2')) {
      openHabitModal(null);
      return;
    }

    const card = ev.target.closest('.habit-card[data-id]');
    if (!card) return;
    const habit = store.get(card.dataset.id);
    if (!habit) return;

    const action = ev.target.closest('[data-action]')?.dataset.action;

    if (action === 'check-today') {
      toggleDay(habit, todayKey());
    } else if (action === 'toggle-day') {
      const day = ev.target.closest('[data-day]').dataset.day;
      toggleDay(habit, day);
    } else if (action === 'edit') {
      openHabitModal(habit);
    } else if (action === 'stats') {
      ui.expanded = ui.expanded === habit.id ? null : habit.id;
      draw(container);
    } else if (action === 'add-note' || action === 'note-open') {
      ui.noteFor = habit.id;
      draw(container);
      container.querySelector('.habit-note-input')?.focus();
    } else if (action === 'note-save') {
      const input = card.querySelector('.habit-note-input');
      saveNote(habit, todayKey(), input.value.trim());
      ui.noteFor = null;
      // store.update re-renders the whole view; state var already cleared.
    } else if (action === 'note-cancel') {
      ui.noteFor = null;
      draw(container);
    }
  });

  // Enter in the note input saves; Escape cancels.
  container.addEventListener('keydown', (ev) => {
    if (!ev.target.classList?.contains('habit-note-input')) return;
    const card = ev.target.closest('.habit-card[data-id]');
    const habit = card && store.get(card.dataset.id);
    if (ev.key === 'Enter' && habit) {
      ev.preventDefault();
      saveNote(habit, todayKey(), ev.target.value.trim());
      ui.noteFor = null;
    } else if (ev.key === 'Escape') {
      ui.noteFor = null;
      draw(container);
    }
  });

  draw(container);
}

// ===================================================================
// Habit modal — mirrors taskModal.js structure/classes.
// ===================================================================

let modalOverlay = null;

function onModalKey(e) {
  if (e.key === 'Escape') closeHabitModal();
}

function closeHabitModal() {
  modalOverlay?.remove();
  modalOverlay = null;
  document.removeEventListener('keydown', onModalKey);
}

export function openHabitModal(entity = null) {
  closeHabitModal();

  const isNew = !entity;
  const h = entity || { type: 'habit', title: '', notes: '', tags: [], linkedTo: [], extra: {} };
  const freq = frequencyOf(h);
  const weeklyTarget = weeklyTargetOf(h);
  const goals = store.all('goal');
  const linkedGoalId = (h.linkedTo || []).find((id) => {
    const g = store.get(id);
    return g && g.type === 'goal';
  }) || '';

  modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  modalOverlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <span class="modal-type">${isNew ? 'New habit' : 'Edit habit'}</span>
        <span class="spacer"></span>
        <button type="button" class="icon-btn" data-close title="Close (Esc)">✕</button>
      </div>
      <div class="modal-body">
        <input id="h-title" placeholder="Habit title" autocomplete="off">
        <textarea id="h-notes" placeholder="Notes…"></textarea>
        <div class="form-grid">
          <label>Frequency
            <select id="h-freq">
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>
          <label id="h-target-wrap">Times per week
            <input type="number" id="h-target" min="1" max="7" value="${weeklyTarget}">
          </label>
          <label class="full">Tags<input id="h-tags" placeholder="comma, separated"></label>
          <label class="full">Goal
            <select id="h-goal">
              <option value="">${goals.length ? 'No linked goal' : 'No goals yet'}</option>
              ${goals.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.title)}</option>`).join('')}
            </select>
          </label>
        </div>
      </div>
      <div class="modal-foot">
        ${isNew ? '' : '<button type="button" id="h-delete" class="danger-btn">Delete</button>'}
        <span class="spacer"></span>
        <button type="button" class="ghost-btn" data-close>Cancel</button>
        <button type="button" id="h-save" class="primary-btn">${isNew ? 'Add' : 'Save'}</button>
      </div>
    </div>`;

  const $ = (sel) => modalOverlay.querySelector(sel);

  $('#h-title').value = h.title || '';
  $('#h-notes').value = h.notes || '';
  $('#h-freq').value = freq;
  $('#h-target').value = weeklyTarget;
  $('#h-tags').value = (h.tags || []).join(', ');
  $('#h-goal').value = linkedGoalId;

  const applyFreq = () => {
    $('#h-target-wrap').hidden = $('#h-freq').value !== 'weekly';
  };
  applyFreq();
  $('#h-freq').addEventListener('change', applyFreq);

  $('#h-save').addEventListener('click', () => {
    const title = $('#h-title').value.trim();
    if (!title) {
      $('#h-title').classList.add('invalid');
      $('#h-title').focus();
      return;
    }
    const frequency = $('#h-freq').value === 'weekly' ? 'weekly' : 'daily';
    const goalId = $('#h-goal').value;

    const extra = { ...(entity?.extra || {}) };
    extra.frequency = frequency;
    extra.log = entity?.extra?.log || {};
    if (frequency === 'weekly') {
      extra.weeklyTarget = Math.min(7, Math.max(1, parseInt($('#h-target').value, 10) || 1));
    } else {
      delete extra.weeklyTarget;
    }

    const patch = {
      type: 'habit',
      title,
      notes: $('#h-notes').value.trim(),
      tags: $('#h-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
      linkedTo: goalId ? [goalId] : [],
      extra,
    };

    if (isNew) store.add(patch);
    else store.update(entity.id, patch);
    closeHabitModal();
  });

  if (!isNew) {
    $('#h-delete').addEventListener('click', () => {
      const removed = store.remove(entity.id);
      closeHabitModal();
      if (removed) {
        showToast(`Deleted "${removed.title}"`, {
          actionLabel: 'Undo',
          onAction: () => store.restore(removed),
        });
      }
    });
  }

  modalOverlay.addEventListener('click', (ev) => {
    if (ev.target === modalOverlay) closeHabitModal();
    if (ev.target.closest('[data-close]')) closeHabitModal();
  });
  document.addEventListener('keydown', onModalKey);

  document.getElementById('modal-root').appendChild(modalOverlay);
  $('#h-title').focus();
}
