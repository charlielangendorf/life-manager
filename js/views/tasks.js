// Full task list, grouped into urgency bands, with filter
// (project/tag/priority/status) and sort controls.
import { store } from '../store.js';
import { escapeHtml, todayKey, addDays } from '../utils.js';
import { entityRow, bindRows } from './shared.js';
import { openEditor } from '../taskModal.js';

const PRI_ORDER = { high: 0, medium: 1, low: 2 };

// Kept at module level so filters survive re-renders within a session.
const state = { project: '', tag: '', priority: '', show: 'open', sort: 'due' };

function sortList(list, sort) {
  const copy = [...list];
  if (sort === 'due') {
    copy.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  } else if (sort === 'priority') {
    copy.sort(
      (a, b) => (PRI_ORDER[a.priority] ?? 3) - (PRI_ORDER[b.priority] ?? 3)
        || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'),
    );
  } else if (sort === 'project') {
    // Project name A→Z; tasks with no project sort last; ties by due date.
    copy.sort((a, b) => {
      const ap = a.project || '';
      const bp = b.project || '';
      if (ap !== bp) {
        if (!ap) return 1;
        if (!bp) return -1;
        return ap.localeCompare(bp);
      }
      return (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
    });
  } else if (sort === 'created') {
    copy.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  } else if (sort === 'title') {
    copy.sort((a, b) => a.title.localeCompare(b.title));
  }
  return copy;
}

// Sort the whole filtered list once, then slot each task into an urgency band.
// A single sorted pass keeps each band internally ordered by the chosen sort.
function bandOf(t) {
  const due = t.dueDate ? t.dueDate.slice(0, 10) : '';
  if (!due) return 'none';
  const today = todayKey();
  if (t.status !== 'done' && due < today) return 'overdue';
  if (due === today) return 'today';
  if (due <= addDays(today, 7)) return 'week';
  return 'later';
}

const BANDS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'later', label: 'Later' },
  { key: 'none', label: 'No date' },
];

function sel(id, label, options, current) {
  return `
    <label class="flt">${label}
      <select id="${id}">
        ${options.map(([v, text]) =>
          `<option value="${escapeHtml(v)}" ${v === current ? 'selected' : ''}>${escapeHtml(text)}</option>`).join('')}
      </select>
    </label>`;
}

function draw(container) {
  const tasks = store.all('task');
  const projects = [...new Set(tasks.map((t) => t.project).filter(Boolean))].sort();
  const tags = [...new Set(tasks.flatMap((t) => t.tags || []))].sort();

  let list = tasks;
  if (state.show === 'open') list = list.filter((t) => t.status !== 'done');
  else if (state.show === 'done') list = list.filter((t) => t.status === 'done');
  if (state.project) list = list.filter((t) => t.project === state.project);
  if (state.tag) list = list.filter((t) => (t.tags || []).includes(state.tag));
  if (state.priority) list = list.filter((t) => t.priority === state.priority);
  list = sortList(list, state.sort);

  // Slot into bands (preserving sorted order within each).
  const banded = { overdue: [], today: [], week: [], later: [], none: [] };
  for (const t of list) banded[bandOf(t)].push(t);

  // The ONE --highlight moment: the single most-pressing open task —
  // first overdue, else first due today. Marked once per screen.
  const heroId = banded.overdue[0]?.id || banded.today.find((t) => t.status !== 'done')?.id || null;

  const sections = BANDS
    .filter((b) => banded[b.key].length)
    .map((b) => {
      const rows = banded[b.key].map((t) => {
        const row = entityRow(t);
        return t.id === heroId ? row.replace('class="row ', 'class="row is-hero ') : row;
      }).join('');
      return `
        <section class="task-band band-${b.key}">
          <h2 class="band-head">${b.label}<span class="band-count">${banded[b.key].length}</span></h2>
          <div class="rows">${rows}</div>
        </section>`;
    }).join('');

  container.innerHTML = `
    <div class="view-head">
      <h1>Tasks</h1>
      <span class="spacer"></span>
      <button id="new-task" class="primary-btn">+ New task</button>
    </div>
    <div class="toolbar task-toolbar">
      ${sel('flt-show', 'Show', [['open', 'Open'], ['done', 'Completed'], ['all', 'All']], state.show)}
      ${sel('flt-project', 'Project', [['', 'All projects'], ...projects.map((p) => [p, p])], state.project)}
      ${sel('flt-tag', 'Tag', [['', 'All tags'], ...tags.map((t) => [t, '#' + t])], state.tag)}
      ${sel('flt-priority', 'Priority', [['', 'Any'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']], state.priority)}
      ${sel('flt-sort', 'Sort by', [['due', 'Due date'], ['priority', 'Priority'], ['project', 'Project'], ['created', 'Newest'], ['title', 'Title']], state.sort)}
    </div>
    ${sections || '<div class="card"><div class="empty">No tasks match these filters.</div></div>'}`;
}

export function render(container) {
  bindRows(container);
  container.addEventListener('click', (ev) => {
    if (ev.target.closest('#new-task')) openEditor(null);
  });
  container.addEventListener('change', (ev) => {
    const map = {
      'flt-show': 'show', 'flt-project': 'project', 'flt-tag': 'tag',
      'flt-priority': 'priority', 'flt-sort': 'sort',
    };
    const key = map[ev.target.id];
    if (!key) return;
    state[key] = ev.target.value;
    draw(container);
  });
  draw(container);
}
