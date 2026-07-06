// App shell: hash routing, global search, sync wiring, theme, shortcuts.
import { store } from './store.js';
import { sync } from './github.js';
import { applyTheme, toggleTheme } from './theme.js';
import { openEditor } from './taskModal.js';
import { escapeHtml } from './utils.js';
import * as dashboard from './views/dashboard.js';
import * as tasks from './views/tasks.js';
import * as calendar from './views/calendar.js';
import * as habits from './views/habits.js';
import * as goals from './views/goals.js';
import * as journal from './views/journal.js';
import * as focus from './views/focus.js';
import * as contacts from './views/contacts.js';
import * as reading from './views/reading.js';
import * as finance from './views/finance.js';
import * as bookmarks from './views/bookmarks.js';
import * as trips from './views/trips.js';
import * as settings from './views/settings.js';

const routes = {
  dashboard, tasks, calendar, habits, goals, journal, focus,
  contacts, reading, finance, bookmarks, trips, settings,
};

// Where a non-task entity "lives" — search results navigate there instead of
// opening the task editor.
const TYPE_ROUTE = {
  habit: 'habits', goal: 'goals', journal: 'journal', contact: 'contacts',
  reading: 'reading', finance: 'finance', bookmark: 'bookmarks', trip: 'trips',
};
const main = document.getElementById('view');
let current = 'dashboard';

// Every render gets a fresh root node so views can attach delegated listeners
// without stacking duplicates across re-renders.
function render() {
  main.replaceChildren();
  const root = document.createElement('div');
  root.className = 'view-root';
  main.appendChild(root);
  routes[current].render(root);
}

function route() {
  const name = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0];
  current = routes[name] ? name : 'dashboard';
  document.querySelectorAll('.sidebar nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === current);
  });
  render();
}

store.subscribe((change) => {
  if (change.verb !== 'merge') sync.noteChange(change);
  render();
});

// ---- sync status indicator ----
const statusEl = document.getElementById('sync-status');
const STATUS_LABEL = {
  local: 'local only',
  saved: 'saved',
  syncing: 'syncing…',
  offline: 'offline — will retry',
  error: 'sync error',
};
sync.onStatus((status, detail) => {
  statusEl.dataset.status = status;
  statusEl.textContent = STATUS_LABEL[status] || status;
  statusEl.title = detail || 'Sync status — click for settings';
});
statusEl.addEventListener('click', () => { location.hash = '#/settings'; });

// ---- theme ----
applyTheme();
document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

// ---- quick add / focus mode ----
document.getElementById('quick-add-btn').addEventListener('click', () => openEditor(null));
document.getElementById('focus-btn').addEventListener('click', () => { location.hash = '#/focus'; });

// ---- global search ----
const searchInput = document.getElementById('global-search');
const resultsEl = document.getElementById('search-results');

function renderSearch() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) {
    resultsEl.hidden = true;
    resultsEl.innerHTML = '';
    return;
  }
  const matches = store.entities.filter((e) =>
    (e.title || '').toLowerCase().includes(q)
    || (e.notes || '').toLowerCase().includes(q)
    || (e.project || '').toLowerCase().includes(q)
    || (e.tags || []).some((t) => t.toLowerCase().includes(q))).slice(0, 15);
  resultsEl.innerHTML = matches.length
    ? matches.map((e) => `
        <div class="search-item" data-id="${e.id}">
          <span class="search-type">${e.type}</span>
          <span class="${e.status === 'done' ? 'done-text' : ''}">${escapeHtml(e.title)}</span>
        </div>`).join('')
    : '<div class="search-empty">No matches</div>';
  resultsEl.hidden = false;
}

searchInput.addEventListener('input', renderSearch);
searchInput.addEventListener('focus', renderSearch);
resultsEl.addEventListener('click', (ev) => {
  const item = ev.target.closest('[data-id]');
  if (!item) return;
  const entity = store.get(item.dataset.id);
  resultsEl.hidden = true;
  searchInput.value = '';
  if (!entity) return;
  if (entity.type === 'task' || entity.type === 'event') openEditor(entity);
  else location.hash = '#/' + (TYPE_ROUTE[entity.type] || 'dashboard');
});
document.addEventListener('click', (ev) => {
  if (!ev.target.closest('.search-wrap')) resultsEl.hidden = true;
});

// ---- keyboard shortcuts ----
const NAV_KEYS = {
  1: 'dashboard', 2: 'tasks', 3: 'calendar', 4: 'habits', 5: 'goals', 6: 'journal',
};
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  const modalOpen = Boolean(document.querySelector('.modal-overlay'));
  if (e.key === '/') {
    e.preventDefault();
    searchInput.focus();
  } else if (e.key.toLowerCase() === 'n' && !modalOpen) {
    e.preventDefault();
    openEditor(null);
  } else if (e.key.toLowerCase() === 'f' && !modalOpen) {
    e.preventDefault();
    location.hash = '#/focus';
  } else if (NAV_KEYS[e.key] && !modalOpen) {
    e.preventDefault();
    location.hash = '#/' + NAV_KEYS[e.key];
  }
});

// Unsent changes are also recovered on next load: startup pull() merges and
// detects that local is ahead, then pushes.
window.addEventListener('beforeunload', () => {
  if (sync.dirty) sync.flush();
});

// ---- boot ----
window.addEventListener('hashchange', route);
route();
if (sync.configured()) sync.pull();

// PWA: installable app shell with offline fallback (sw.js is same-origin
// network-first, so GitHub API calls are never intercepted).
if ('serviceWorker' in navigator
  && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
