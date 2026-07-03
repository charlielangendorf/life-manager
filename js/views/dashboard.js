// "Today" — a day-page in a paper planner. A rotated mono date stamp, a serif
// headline whose count carries the page's single marker swipe, an "up next"
// margin note, a dashed-rail timeline, red-pencil overdue annotations, habit
// tally lines, and a quiet week-ahead list. No emoji, no filled chips.
// Renders its own markup and delegates its own events.
import { store } from '../store.js';
import {
  todayKey, addDays, escapeHtml, startOfWeekKey, parseDate,
  timeOf, fmtTime, relativeDue,
} from '../utils.js';
import { openEditor } from '../taskModal.js';
import {
  needsToday, frequencyOf, weeklyTargetOf, weekDoneCount, toggleLog,
} from '../habits-logic.js';

const byDue = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
const byWhen = (a, b) => (a.date || '').localeCompare(b.date || '');

const swipe = (text) => `<span class="swipe">${escapeHtml(text)}</span>`;

// Serif headline; the leading count phrase gets the page's ONE marker swipe.
function headlineHtml({ overdue, dueToday, events, upcoming, habitsDue }) {
  if (overdue.length) {
    const n = overdue.length;
    return `${swipe(`${n} overdue`)} ${n === 1 ? 'thing needs' : 'things need'} attention first`;
  }
  const left = dueToday.length + events.length;
  if (left > 0) {
    return `${swipe(`${left} ${left === 1 ? 'thing' : 'things'}`)} left today`;
  }
  if (habitsDue) return `${swipe('Just your habits')} left today`;
  if (upcoming.length) return `${swipe('All clear')} today — a calm one ahead`;
  return `${swipe('All clear')} — enjoy the day`;
}

// Mono date stamp, slightly off-axis, like a rubber date stamp.
function dateStamp(today) {
  const d = parseDate(today);
  const dow = d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase();
  const mmdd = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  return `<span class="dash-stamp">${escapeHtml(`${dow} ${mmdd}`)}</span>`;
}

// The most relevant item right now → an italic margin note under the headline.
function upNext({ overdue, timed, dueToday }) {
  if (overdue.length) return { entity: overdue[0], label: 'start here' };
  if (timed.length) {
    const e = timed[0];
    const t = timeOf(e.type === 'event' ? e.date : e.dueDate);
    return { entity: e, label: t ? `up next · ${fmtTime(t)}` : 'up next' };
  }
  if (dueToday.length) return { entity: dueToday[0], label: 'up next' };
  return null;
}

function upNextNote(pick) {
  if (!pick) return '';
  const { entity, label } = pick;
  const isTask = entity.type === 'task';
  const done = entity.status === 'done';
  return `
    <div class="dash-next" data-id="${entity.id}">
      ${isTask ? `<button class="check ${done ? 'checked' : ''}" data-action="toggle" aria-label="Toggle complete"></button>` : '<span class="dash-next-dot"></span>'}
      <span class="dash-next-label">${escapeHtml(label)}</span>
      <span class="dash-next-title ${done ? 'done' : ''}">${escapeHtml(entity.title)}</span>
    </div>`;
}

// Overdue: red-pencil territory — dashed rule, serif-italic annotations.
function overdueStrip(overdue, nextId) {
  const items = overdue.filter((t) => t.id !== nextId);
  if (!items.length) return '';
  const rows = items.map((t) => `
    <div class="dash-od-row" data-id="${t.id}">
      <button class="check ${t.status === 'done' ? 'checked' : ''}" data-action="toggle" aria-label="Toggle complete"></button>
      <span class="dash-od-title">${escapeHtml(t.title)}</span>
      <span class="dash-od-when">${escapeHtml(relativeDue(t.dueDate))}</span>
    </div>`).join('');
  return `
    <section class="dash-overdue" aria-label="Overdue">
      <div class="dash-h2 is-danger">overdue · ${items.length}</div>
      ${rows}
    </section>`;
}

function timelineNode(entity, nextId) {
  const isTask = entity.type === 'task';
  const done = entity.status === 'done';
  const when = entity.type === 'event' ? entity.date : entity.dueDate;
  const t = timeOf(when);
  const isNext = entity.id === nextId;
  const marker = isTask
    ? `<button class="check tl-check ${done ? 'checked' : ''}" data-action="toggle" aria-label="Toggle complete"></button>`
    : '<span class="tl-node"></span>';
  return `
    <div class="tl-item ${done ? 'done' : ''} ${isNext ? 'is-next' : ''}" data-id="${entity.id}">
      <span class="tl-time">${escapeHtml(t ? fmtTime(t) : '')}</span>
      ${marker}
      <div class="tl-main"><span class="tl-title">${escapeHtml(entity.title)}</span></div>
    </div>`;
}

function timelineSection(timed, untimed, nextId) {
  if (!timed.length && !untimed.length) return '';
  const nodes = [
    ...timed.map((e) => timelineNode(e, nextId)),
    ...untimed.map((e) => timelineNode(e, nextId)),
  ].join('');
  return `
    <section class="dash-block">
      <h2 class="dash-h2">today</h2>
      <div class="timeline">${nodes}</div>
    </section>`;
}

// Habits still to check: bare lines with a one-tap square and a mono sub.
function habitsSection(today) {
  const due = store.all('habit').filter((h) => needsToday(h, today));
  if (!due.length) return '';
  const week = startOfWeekKey(today);
  const rows = due
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((h) => {
      let sub = 'daily';
      if (frequencyOf(h) === 'weekly') {
        sub = `${weekDoneCount(h, week)}/${weeklyTargetOf(h)} this week`;
      }
      return `
        <button class="dash-habit-line" data-habit-id="${h.id}" data-action="habit-check"
                aria-label="Check off ${escapeHtml(h.title)}">
          <span class="dash-habit-box" aria-hidden="true"></span>
          <span class="dash-habit-title">${escapeHtml(h.title)}</span>
          <span class="dash-habit-sub">${escapeHtml(sub)}</span>
        </button>`;
    })
    .join('');
  return `
    <section class="dash-block">
      <h2 class="dash-h2">still to check</h2>
      <div class="dash-habits">${rows}</div>
    </section>`;
}

function upcomingSection(upcoming) {
  if (!upcoming.length) return '';
  const rows = upcoming.map((t) => `
    <div class="dash-up-row" data-id="${t.id}">
      <button class="check ${t.status === 'done' ? 'checked' : ''}" data-action="toggle" aria-label="Toggle complete"></button>
      <span class="dash-up-title">${escapeHtml(t.title)}</span>
      <span class="dash-up-when">${escapeHtml(relativeDue(t.dueDate))}</span>
    </div>`).join('');
  return `
    <section class="dash-block dash-upcoming">
      <h2 class="dash-h2">next 7 days</h2>
      <div class="dash-up-rows">${rows}</div>
    </section>`;
}

function completedSection(doneToday) {
  if (!doneToday.length) return '';
  const rows = doneToday.map((t) => `
    <div class="dash-done-row" data-id="${t.id}">
      <button class="check checked" data-action="toggle" aria-label="Toggle complete"></button>
      <span class="dash-done-title">${escapeHtml(t.title)}</span>
    </div>`).join('');
  return `
    <section class="dash-block dash-completed">
      <h2 class="dash-h2">crossed off · ${doneToday.length}</h2>
      <div class="dash-done-rows">${rows}</div>
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
    .sort(byWhen);

  const timedTasks = dueToday.filter((t) => timeOf(t.dueDate));
  const untimedTasks = dueToday.filter((t) => !timeOf(t.dueDate));
  const timed = [...events, ...timedTasks].sort((a, b) => {
    const ta = timeOf(a.type === 'event' ? a.date : a.dueDate);
    const tb = timeOf(b.type === 'event' ? b.date : b.dueDate);
    return ta.localeCompare(tb);
  });

  const habitsDue = store.all('habit').some((h) => needsToday(h, today));
  const allEmpty = !overdue.length && !dueToday.length && !events.length
    && !upcoming.length && !habitsDue && !doneToday.length;

  const pick = upNext({ overdue, timed, dueToday: untimedTasks.length ? untimedTasks : dueToday });
  const nextId = pick?.entity.id || null;

  container.innerHTML = `
    <header class="dash-head">
      ${dateStamp(today)}
      <h1 class="dash-title">${headlineHtml({ overdue, dueToday, events, upcoming, habitsDue })}</h1>
      ${upNextNote(pick)}
    </header>

    <form id="quick-add" class="dash-quick">
      <input id="quick-add-input" placeholder="add something for today…" autocomplete="off">
    </form>

    ${overdueStrip(overdue, nextId)}
    ${timelineSection(timed, untimedTasks, nextId)}
    ${habitsSection(today)}
    ${upcomingSection(upcoming)}
    ${completedSection(doneToday)}
    ${allEmpty ? `
      <section class="dash-empty">
        <svg class="dash-empty-mark" viewBox="0 0 60 24" aria-hidden="true"><path d="M4 16 C 14 8, 24 20, 34 12 C 42 6, 50 14, 56 9" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>
        <div class="dash-empty-title">Nothing on the books</div>
        <div class="dash-empty-copy">A blank page for the day. Add something above whenever you're ready.</div>
      </section>` : ''}
  `;

  // Delegated clicks: check-offs toggle; habit lines write the log; a click
  // anywhere else on a data-id row opens the editor.
  container.addEventListener('click', (ev) => {
    const habitBtn = ev.target.closest('[data-action="habit-check"]');
    if (habitBtn) {
      const habit = store.get(habitBtn.dataset.habitId);
      if (!habit) return;
      const log = toggleLog(habit.extra?.log || {}, today);
      store.update(habit.id, { extra: { ...habit.extra, log } });
      return;
    }

    const toggle = ev.target.closest('[data-action="toggle"]');
    if (toggle) {
      const host = toggle.closest('[data-id]');
      if (host) store.toggleComplete(host.dataset.id);
      return;
    }

    const host = ev.target.closest('[data-id]');
    if (host) {
      const entity = store.get(host.dataset.id);
      if (entity) openEditor(entity);
    }
  });

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
