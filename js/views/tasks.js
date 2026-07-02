// Full task list with filter (project/tag/priority/status) and sort controls.
import { store } from '../store.js';
import { escapeHtml } from '../utils.js';
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
  } else if (sort === 'created') {
    copy.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  } else if (sort === 'title') {
    copy.sort((a, b) => a.title.localeCompare(b.title));
  }
  return copy;
}

function sel(id, label, options, current) {
  return `
    <label>${label}
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

  container.innerHTML = `
    <div class="view-head">
      <h1>Tasks</h1>
      <span class="spacer"></span>
      <button id="new-task" class="primary-btn">+ New task</button>
    </div>
    <div class="toolbar">
      ${sel('flt-show', 'Show', [['open', 'Open'], ['done', 'Completed'], ['all', 'All']], state.show)}
      ${sel('flt-project', 'Project', [['', 'All projects'], ...projects.map((p) => [p, p])], state.project)}
      ${sel('flt-tag', 'Tag', [['', 'All tags'], ...tags.map((t) => [t, '#' + t])], state.tag)}
      ${sel('flt-priority', 'Priority', [['', 'Any'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']], state.priority)}
      ${sel('flt-sort', 'Sort by', [['due', 'Due date'], ['priority', 'Priority'], ['created', 'Newest'], ['title', 'Title']], state.sort)}
    </div>
    <section class="card">
      <div class="rows">
        ${list.map(entityRow).join('') || '<div class="empty">No tasks match these filters.</div>'}
      </div>
    </section>`;
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
