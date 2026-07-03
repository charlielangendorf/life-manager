// "Today" landing page: a warm, human daily brief.
// A big serif headline computed from real state leads; a single saturated
// "up next" chip is the one loud moment; today's timed items + due-today tasks
// flow down a vertical timeline; overdue sits above as a quiet urgent strip;
// habits become one-tap pills; the next 7 days are a light supporting list.
//
// We render our OWN row/timeline markup here (not shared.js entityRow) and
// delegate clicks on the freshly-rendered container each render.
import { store } from '../store.js';
import {
  todayKey, addDays, fmtDateFull, escapeHtml, startOfWeekKey,
  timeOf, fmtTime, relativeDue,
} from '../utils.js';
import { openEditor } from '../taskModal.js';
import { iconFor } from '../icons.js';
import {
  needsToday, frequencyOf, weeklyTargetOf, weekDoneCount, toggleLog,
} from '../habits-logic.js';

const byDue = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
const byWhen = (a, b) => (a.date || '').localeCompare(b.date || '');

// ---- headline: a human sentence about the shape of the day ----
function headline({ overdue, dueToday, events, upcoming, habitsDue }) {
  if (overdue.length) {
    const n = overdue.length;
    return `${n} overdue ${n === 1 ? 'thing needs' : 'things need'} attention first`;
  }
  const left = dueToday.length + events.length;
  if (left > 0) {
    return `${left} ${left === 1 ? 'thing' : 'things'} left today`;
  }
  if (habitsDue) return 'Just your habits left today';
  if (upcoming.length) return 'All clear today — a calm one ahead';
  return 'All clear — enjoy the day';
}

// ---- the ONE saturated moment: a single "up next" hero chip ----
// Priority: first overdue → next timed event/task → first due-today task.
function upNext({ overdue, timed, dueToday }) {
  if (overdue.length) return { entity: overdue[0], label: 'Overdue' };
  if (timed.length) {
    const e = timed[0];
    const t = timeOf(e.type === 'event' ? e.date : e.dueDate);
    return { entity: e, label: t ? `Next · ${fmtTime(t)}` : 'Up next' };
  }
  if (dueToday.length) return { entity: dueToday[0], label: 'Up next' };
  return null;
}

function heroChip(pick) {
  if (!pick) return '';
  const { entity, label } = pick;
  const icon = iconFor(entity);
  const isTask = entity.type === 'task';
  const done = entity.status === 'done';
  return `
    <div class="dash-hero" data-id="${entity.id}" data-kind="${entity.type}">
      ${isTask
        ? `<button class="dash-hero-check ${done ? 'checked' : ''}" data-action="toggle" aria-label="Toggle complete"></button>`
        : `<span class="dash-hero-icon">${icon || '•'}</span>`}
      <div class="dash-hero-main">
        <div class="dash-hero-label">${escapeHtml(label)}</div>
        <div class="dash-hero-title ${done ? 'done' : ''}">${icon && isTask ? icon + ' ' : ''}${escapeHtml(entity.title)}</div>
      </div>
    </div>`;
}

// ---- overdue strip: compact, urgent-but-quiet (thin danger border) ----
function overdueStrip(overdue, heroId) {
  const items = overdue.filter((t) => t.id !== heroId);
  if (!items.length) return '';
  const rows = items.map((t) => {
    const icon = iconFor(t);
    return `
      <div class="dash-od-row" data-id="${t.id}">
        <button class="check ${t.status === 'done' ? 'checked' : ''}" data-action="toggle" aria-label="Toggle complete"></button>
        <span class="dash-od-title">${icon ? icon + ' ' : ''}${escapeHtml(t.title)}</span>
        <span class="dash-od-when">${escapeHtml(relativeDue(t.dueDate))}</span>
      </div>`;
  }).join('');
  const n = items.length;
  return `
    <section class="dash-overdue" aria-label="Overdue">
      <div class="dash-od-head">${n} more overdue</div>
      <div class="dash-od-rows">${rows}</div>
    </section>`;
}

// ---- vertical timeline: timed items (chrono) then untimed due-today tasks ----
function timelineNode(entity, heroId) {
  const isTask = entity.type === 'task';
  const done = entity.status === 'done';
  const when = entity.type === 'event' ? entity.date : entity.dueDate;
  const t = timeOf(when);
  const icon = iconFor(entity);
  const timeLabel = t ? fmtTime(t) : '';
  const isHero = entity.id === heroId;
  // Node marker: a check button for tasks, an icon/dot for events.
  const marker = isTask
    ? `<button class="check tl-check ${done ? 'checked' : ''}" data-action="toggle" aria-label="Toggle complete"></button>`
    : `<span class="tl-node">${icon || ''}</span>`;
  return `
    <div class="tl-item ${done ? 'done' : ''} ${isHero ? 'is-next' : ''}" data-id="${entity.id}">
      <span class="tl-time">${escapeHtml(timeLabel)}</span>
      ${marker}
      <div class="tl-main">
        <span class="tl-title">${icon && isTask ? icon + ' ' : ''}${escapeHtml(entity.title)}</span>
      </div>
    </div>`;
}

function timelineSection(timed, untimed, heroId) {
  if (!timed.length && !untimed.length) return '';
  const nodes = [
    ...timed.map((e) => timelineNode(e, heroId)),
    ...untimed.map((e) => timelineNode(e, heroId)),
  ].join('');
  return `
    <section class="dash-block">
      <h2 class="dash-h2">Today</h2>
      <div class="timeline">${nodes}</div>
    </section>`;
}

// ---- habits: still-to-check cluster, one-tap pills ----
function habitsSection(today) {
  const due = store.all('habit').filter((h) => needsToday(h, today));
  if (!due.length) return '';
  const week = startOfWeekKey(today);
  const pills = due
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((h) => {
      const icon = iconFor(h);
      const mark = icon || (h.title.trim()[0] || '·').toUpperCase();
      let sub = '';
      if (frequencyOf(h) === 'weekly') {
        sub = `${weekDoneCount(h, week)}/${weeklyTargetOf(h)} this week`;
      }
      return `
        <button class="dash-habit-pill" data-habit-id="${h.id}" data-action="habit-check"
                aria-label="Check off ${escapeHtml(h.title)}">
          <span class="dash-habit-mark">${escapeHtml(mark)}</span>
          <span class="dash-habit-body">
            <span class="dash-habit-title">${escapeHtml(h.title)}</span>
            ${sub ? `<span class="dash-habit-sub">${escapeHtml(sub)}</span>` : ''}
          </span>
        </button>`;
    })
    .join('');
  return `
    <section class="dash-block">
      <h2 class="dash-h2">Still to check today</h2>
      <div class="dash-habits">${pills}</div>
    </section>`;
}

// ---- next 7 days: quiet supporting list, lighter than today ----
function upcomingSection(upcoming) {
  if (!upcoming.length) return '';
  const rows = upcoming.map((t) => {
    const icon = iconFor(t);
    return `
      <div class="dash-up-row" data-id="${t.id}">
        <button class="check ${t.status === 'done' ? 'checked' : ''}" data-action="toggle" aria-label="Toggle complete"></button>
        <span class="dash-up-title">${icon ? icon + ' ' : ''}${escapeHtml(t.title)}</span>
        <span class="dash-up-when">${escapeHtml(relativeDue(t.dueDate))}</span>
      </div>`;
  }).join('');
  return `
    <section class="dash-block dash-upcoming">
      <h2 class="dash-h2">Next 7 days</h2>
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
      <h2 class="dash-h2">Completed today · ${doneToday.length}</h2>
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

  // Timed items (events + due-today tasks that carry a time) in chrono order;
  // untimed due-today tasks flow after them on the timeline.
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
  const heroId = pick?.entity.id || null;

  container.innerHTML = `
    <header class="dash-head">
      <h1 class="dash-title">${escapeHtml(headline({ overdue, dueToday, events, upcoming, habitsDue }))}</h1>
      <div class="dash-date">${escapeHtml(fmtDateFull(today))}</div>
    </header>

    <form id="quick-add" class="dash-quick">
      <input id="quick-add-input" placeholder="Add something for today…" autocomplete="off">
    </form>

    ${heroChip(pick)}
    ${overdueStrip(overdue, heroId)}
    ${timelineSection(timed, untimedTasks, heroId)}
    ${habitsSection(today)}
    ${upcomingSection(upcoming)}
    ${completedSection(doneToday)}
    ${allEmpty ? `
      <section class="dash-empty">
        <div class="dash-empty-mark">☀️</div>
        <div class="dash-empty-title">Nothing on the books</div>
        <div class="dash-empty-copy">Your day is wide open. Add a task above whenever you're ready.</div>
      </section>` : ''}
  `;

  // Delegated clicks: check-offs toggle; habit pills write the log; a click
  // anywhere else on a data-id row/node opens the editor (matching old behavior).
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
