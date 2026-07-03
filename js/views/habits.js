// Habits view: CRUD via own modal, daily/weekly check-off, streaks, last-7-day
// strip, per-day notes, and an expandable per-habit stats area.
//
// Layout (redesign): one HERO habit at top — the still-active habit with the
// best current streak — rendered large with a saturated streak band (the single
// --highlight moment). Remaining habits are quieter, compact rows below. The
// 7-day strip is the primary streak visual (filled = done, hollow = missed,
// today ringed); the streak number is secondary support.
import { store } from '../store.js';
import { escapeHtml, todayKey, addDays, startOfWeekKey, WEEKDAYS, fmtDate } from '../utils.js';
import { showToast } from '../toast.js';
import { iconFor } from '../icons.js';
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

// ---- small shared pieces ----

// Icon glyph or a tinted first-letter chip fallback, sized by variant.
function habitGlyph(habit, variant) {
  const icon = iconFor(habit);
  const cls = variant === 'hero' ? 'habit-glyph is-hero' : 'habit-glyph';
  if (icon) return `<span class="${cls}" aria-hidden="true">${icon}</span>`;
  const letter = (habit.title || '?').trim().charAt(0).toUpperCase() || '?';
  return `<span class="${cls} is-letter" aria-hidden="true">${escapeHtml(letter)}</span>`;
}

// The 7-day strip: warm filled marks for done days, hollow for missed, today
// ringed. This is the primary streak visual — scannable marks over a number.
function sevenDayStrip(habit, variant) {
  const today = todayKey();
  const marks = [];
  for (let i = 6; i >= 0; i -= 1) {
    const day = addDays(today, -i);
    const done = isDayDone(habit, day);
    const label = i === 0 ? 'Today' : WEEKDAYS[new Date(day + 'T00:00').getDay()];
    const hasNote = Boolean(dayNote(habit, day));
    marks.push(`
      <button class="habit-mark ${done ? 'on' : 'off'} ${i === 0 ? 'is-today' : ''}"
              data-action="toggle-day" data-day="${day}"
              title="${escapeHtml(label)} ${fmtDate(day)}${done ? ' — done' : ' — missed'}"
              aria-label="${escapeHtml(label)} ${done ? 'done' : 'not done'}">
        <span class="habit-mark-fill" aria-hidden="true"></span>
        <span class="habit-mark-day">${escapeHtml(label[0])}</span>
        ${hasNote ? '<span class="habit-mark-note" aria-hidden="true">·</span>' : ''}
      </button>`);
  }
  const cls = variant === 'hero' ? 'habit-strip is-hero' : 'habit-strip';
  return `<div class="${cls}">${marks.join('')}</div>`;
}

// Meta badges shared by hero + rows (frequency/weekly progress, tags, goal).
// The streak is rendered separately (as the hero band or a compact chip), so it
// is intentionally NOT included here.
function metaBadges(habit) {
  const today = todayKey();
  const freq = frequencyOf(habit);
  const badges = [];
  if (freq === 'weekly') {
    const target = weeklyTargetOf(habit);
    const wk = weekDoneCount(habit, startOfWeekKey(today));
    badges.push(`<span class="badge">Weekly · ${wk}/${target}</span>`);
  } else {
    badges.push('<span class="badge">Daily</span>');
  }
  for (const t of habit.tags || []) badges.push(`<span class="badge badge-tag">#${escapeHtml(t)}</span>`);
  const linkedGoal = (habit.linkedTo || []).map((id) => store.get(id)).find((g) => g && g.type === 'goal');
  if (linkedGoal) badges.push(`<span class="badge badge-project">🎯 ${escapeHtml(linkedGoal.title)}</span>`);
  return badges.join('');
}

function checkLabelFor(habit) {
  const freq = frequencyOf(habit);
  const doneToday = isDayDone(habit, todayKey());
  return freq === 'weekly'
    ? (doneToday ? 'Logged today' : 'Log today')
    : (doneToday ? 'Done today' : 'Check off');
}

// Completion as a small warm arc with the numbers as supporting text — an
// asymmetric arrangement, not four identical tiles.
function statsPanel(habit) {
  const cur = currentStreak(habit);
  const longest = longestStreak(habit);
  const rate = completionRate(habit);
  const freq = frequencyOf(habit);
  const windowLabel = freq === 'weekly' ? 'last 12 weeks' : 'last 30 days';
  const unitLabel = freq === 'weekly' ? 'weeks met' : 'days done';
  // SVG donut arc: circumference for r=26 is ~163.36; fill dashoffset by pct.
  const r = 26;
  const circ = 2 * Math.PI * r;
  const dash = (rate.pct / 100) * circ;
  return `
    <div class="habit-stats">
      <div class="habit-arc">
        <svg viewBox="0 0 64 64" class="habit-arc-svg" aria-hidden="true">
          <circle class="habit-arc-track" cx="32" cy="32" r="${r}"></circle>
          <circle class="habit-arc-fill" cx="32" cy="32" r="${r}"
                  stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}"></circle>
        </svg>
        <div class="habit-arc-label">
          <span class="habit-arc-pct">${rate.pct}<small>%</small></span>
          <span class="habit-arc-sub">${escapeHtml(windowLabel)}</span>
        </div>
      </div>
      <div class="habit-stat-facts">
        <div class="habit-fact"><span class="habit-fact-n">${cur}</span><span class="habit-fact-l">current streak</span></div>
        <div class="habit-fact"><span class="habit-fact-n">${longest}</span><span class="habit-fact-l">longest streak</span></div>
        <div class="habit-fact"><span class="habit-fact-n">${rate.done}<span class="habit-fact-slash">/${rate.expected}</span></span><span class="habit-fact-l">${escapeHtml(unitLabel)}</span></div>
      </div>
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

function actionButtons(habit, doneToday, expanded) {
  return `
    <div class="habit-actions">
      ${doneToday ? '<button class="icon-btn" data-action="add-note" title="Note for today">📝</button>' : ''}
      <button class="icon-btn ${expanded ? 'on' : ''}" data-action="stats" aria-expanded="${expanded}" title="Stats">📊</button>
      <button class="icon-btn" data-action="edit" title="Edit habit">✏️</button>
    </div>`;
}

// ---- HERO card: the still-active habit with the best current streak. Its
// streak is the screen's one saturated (--highlight) moment. ----

function heroCard(habit) {
  const today = todayKey();
  const cur = currentStreak(habit);
  const freq = frequencyOf(habit);
  const doneToday = isDayDone(habit, today);
  const expanded = ui.expanded === habit.id;
  const unit = freq === 'weekly' ? 'week' : 'day';
  const streakWord = cur === 1 ? unit : `${unit}s`;

  return `
    <div class="habit-hero" data-id="${habit.id}">
      <div class="habit-hero-band">
        <span class="habit-hero-flame" aria-hidden="true">🔥</span>
        <span class="habit-hero-streak-n">${cur}</span>
        <span class="habit-hero-streak-l">${escapeHtml(streakWord)}<br>on a roll</span>
      </div>
      <div class="habit-hero-body">
        <div class="habit-hero-top">
          <button class="habit-check is-hero ${doneToday ? 'on' : ''}" data-action="check-today"
                  aria-label="${doneToday ? 'Uncheck today' : 'Check off today'}">
            <span class="habit-check-mark">✓</span>
          </button>
          <div class="habit-hero-main">
            <div class="habit-hero-title">${habitGlyph(habit, 'hero')}<span>${escapeHtml(habit.title)}</span></div>
            ${habit.notes ? `<div class="habit-notes">${escapeHtml(habit.notes)}</div>` : ''}
            <div class="habit-meta">${metaBadges(habit)}</div>
          </div>
          ${actionButtons(habit, doneToday, expanded)}
        </div>
        <div class="habit-hero-lower">
          ${sevenDayStrip(habit, 'hero')}
          <span class="habit-check-text ${doneToday ? 'muted' : ''}">${escapeHtml(checkLabelFor(habit))}</span>
        </div>
        ${ui.noteFor === habit.id ? noteEditor(habit, today) : ''}
        ${expanded ? statsPanel(habit) : ''}
      </div>
    </div>`;
}

// ---- quieter compact row for the remaining habits ----

function habitRow(habit) {
  const today = todayKey();
  const cur = currentStreak(habit);
  const doneToday = isDayDone(habit, today);
  const expanded = ui.expanded === habit.id;

  return `
    <div class="habit-row ${doneToday ? 'is-done' : ''}" data-id="${habit.id}">
      <div class="habit-row-top">
        <button class="habit-check ${doneToday ? 'on' : ''}" data-action="check-today"
                aria-label="${doneToday ? 'Uncheck today' : 'Check off today'}">
          <span class="habit-check-mark">✓</span>
        </button>
        <div class="habit-row-main">
          <div class="habit-row-title">${habitGlyph(habit)}<span>${escapeHtml(habit.title)}</span>
            ${cur > 0 ? `<span class="habit-streak-chip" title="Current streak">🔥 ${cur}</span>` : ''}
          </div>
          <div class="habit-meta">${metaBadges(habit)}</div>
        </div>
        ${sevenDayStrip(habit)}
        ${actionButtons(habit, doneToday, expanded)}
      </div>
      ${ui.noteFor === habit.id ? noteEditor(habit, today) : ''}
      ${expanded ? statsPanel(habit) : ''}
    </div>`;
}

// Pick the hero: the still-active (streak > 0) habit with the best current
// streak. Ties break toward one that still needs attention today, then title.
function pickHero(habits) {
  const withStreak = habits
    .map((h) => ({ h, s: currentStreak(h) }))
    .filter((x) => x.s > 0);
  if (!withStreak.length) return null;
  withStreak.sort((a, b) =>
    b.s - a.s
    || (needsToday(a.h) ? 0 : 1) - (needsToday(b.h) ? 0 : 1)
    || a.h.title.localeCompare(b.h.title));
  return withStreak[0].h;
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
          <h2 class="habit-empty-head">Plant your first habit</h2>
          <p>Small, steady, yours. Check it off each day and watch the streak grow — one warm mark at a time.</p>
          <button id="new-habit-2" class="primary-btn">+ New habit</button>
        </div>
      </section>`;
    return;
  }

  const hero = pickHero(habits);

  const rest = [...habits].filter((h) => h !== hero).sort((a, b) => {
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
    ${hero ? heroCard(hero) : ''}
    ${rest.length ? `
      ${hero ? '<div class="habit-rest-label">Also keeping up</div>' : ''}
      <div class="habit-rows">${rest.map(habitRow).join('')}</div>
    ` : ''}`;
}

// ---- event wiring (delegated on the fresh container) ----

export function render(container) {
  container.addEventListener('click', (ev) => {
    if (ev.target.closest('#new-habit') || ev.target.closest('#new-habit-2')) {
      openHabitModal(null);
      return;
    }

    const card = ev.target.closest('[data-id]');
    if (!card || !(card.classList.contains('habit-hero') || card.classList.contains('habit-row'))) return;
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
    const card = ev.target.closest('[data-id]');
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
