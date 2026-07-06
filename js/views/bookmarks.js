// Links vault — bookmarks grouped by project, kept like clippings in a file.
// A bare quick-add line sits at top (paste a URL, optionally name it). Only
// http/https URLs ever render as anchors; anything else stays plain text.
import { store } from '../store.js';
import { escapeHtml } from '../utils.js';
import { projectClass } from './shared.js';
import { showToast } from '../toast.js';

// ---- pure helpers (exported for headless tests) ----

// Returns a safe absolute http(s) URL string, or null. Bare domains get
// https:// prefixed; anything with another scheme (javascript:, data:, …)
// is rejected.
export function safeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(candidate);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    return null;
  } catch {
    return null;
  }
}

export function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Group bookmarks by project name ('' = unfiled last), alphabetical inside.
export function groupByProject(entities) {
  const groups = new Map();
  for (const e of entities) {
    const key = e.project || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  }
  return [...groups.entries()].sort((a, b) => {
    if (!a[0]) return 1;
    if (!b[0]) return -1;
    return a[0].localeCompare(b[0]);
  });
}

// ---- pieces ----

function linkLine(e) {
  const url = safeUrl(e.extra?.url);
  const host = url ? hostnameOf(url) : '';
  const title = url
    ? `<a class="bm-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(e.title)}</a>`
    : `<span class="bm-link is-plain">${escapeHtml(e.title)}${e.extra?.url ? ` <span class="bm-bad-url">(${escapeHtml(e.extra.url)})</span>` : ''}</span>`;
  const tags = (e.tags || []).map((t) => `#${escapeHtml(t)}`).join(' ');
  return `
    <div class="bm-line" data-id="${e.id}">
      ${title}
      ${host ? `<span class="bm-host">${escapeHtml(host)}</span>` : ''}
      ${tags ? `<span class="bm-tags">${tags}</span>` : ''}
      <span class="spacer"></span>
      <button class="bm-txt-btn" data-action="edit">edit</button>
    </div>`;
}

function draw(container) {
  const entities = store.all('bookmark');
  const head = `
    <div class="view-head">
      <h1>Links</h1>
    </div>
    <form id="bm-quick" class="bm-quick">
      <input id="bm-url" placeholder="paste a link…" autocomplete="off">
      <input id="bm-title" placeholder="name it (optional)" autocomplete="off">
      <button type="submit" class="ghost-btn">file it</button>
    </form>`;

  if (!entities.length) {
    container.innerHTML = `
      ${head}
      <section class="card">
        <div class="empty bm-empty">
          <p class="bm-empty-line">An empty clippings file. Paste the forms,
          program pages, and sources you keep hunting for — filed by project.</p>
        </div>
      </section>`;
    return;
  }

  const groups = groupByProject(entities);
  container.innerHTML = `
    ${head}
    ${groups.map(([project, list]) => `
      <section class="card">
        <h2 class="${project ? projectClass(project) : ''}">${project ? escapeHtml(project) : 'unfiled'} · ${list.length}</h2>
        <div class="bm-lines rows">${list.map(linkLine).join('')}</div>
      </section>`).join('')}`;
}

export function render(container) {
  container.addEventListener('click', (ev) => {
    if (ev.target.closest('a.bm-link')) return; // let real links be links
    const line = ev.target.closest('.bm-line[data-id]');
    if (!line) return;
    const entity = store.get(line.dataset.id);
    if (!entity) return;
    if (ev.target.closest('[data-action="edit"]')) openBookmarkModal(entity);
  });

  container.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const urlInput = container.querySelector('#bm-url');
    const titleInput = container.querySelector('#bm-title');
    const url = safeUrl(urlInput.value);
    if (!url) {
      urlInput.classList.add('invalid');
      urlInput.focus();
      return;
    }
    const title = titleInput.value.trim() || hostnameOf(url);
    store.add({ type: 'bookmark', title, extra: { url } });
    document.getElementById('bm-url')?.focus();
  });

  draw(container);
}

// ===================================================================
// Bookmark modal — index-card CRUD.
// ===================================================================

let modalOverlay = null;

function onModalKey(e) {
  if (e.key === 'Escape') closeBookmarkModal();
}

function closeBookmarkModal() {
  modalOverlay?.remove();
  modalOverlay = null;
  document.removeEventListener('keydown', onModalKey);
}

function openBookmarkModal(entity) {
  closeBookmarkModal();
  modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  modalOverlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <span class="modal-type">Edit link</span>
        <span class="spacer"></span>
        <button type="button" class="icon-btn" data-close title="Close (Esc)">✕</button>
      </div>
      <div class="modal-body">
        <input id="b-title" placeholder="Name" autocomplete="off">
        <div class="form-grid">
          <label class="full">URL<input id="b-url" placeholder="https://…" autocomplete="off"></label>
          <label>Project<input id="b-project" list="project-list" autocomplete="off"></label>
          <label>Tags<input id="b-tags" placeholder="comma, separated" autocomplete="off"></label>
        </div>
        <textarea id="b-notes" placeholder="Notes…"></textarea>
      </div>
      <div class="modal-foot">
        <button type="button" id="b-delete" class="danger-btn">Delete</button>
        <span class="spacer"></span>
        <button type="button" class="ghost-btn" data-close>Cancel</button>
        <button type="button" id="b-save" class="primary-btn">Save</button>
      </div>
    </div>`;

  const $ = (sel) => modalOverlay.querySelector(sel);
  $('#b-title').value = entity.title || '';
  $('#b-url').value = entity.extra?.url || '';
  $('#b-project').value = entity.project || '';
  $('#b-tags').value = (entity.tags || []).join(', ');
  $('#b-notes').value = entity.notes || '';

  $('#b-save').addEventListener('click', () => {
    const title = $('#b-title').value.trim();
    const url = safeUrl($('#b-url').value);
    if (!title) {
      $('#b-title').classList.add('invalid');
      $('#b-title').focus();
      return;
    }
    if (!url) {
      $('#b-url').classList.add('invalid');
      $('#b-url').focus();
      return;
    }
    store.update(entity.id, {
      title,
      notes: $('#b-notes').value.trim(),
      project: $('#b-project').value.trim() || null,
      tags: $('#b-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
      extra: { ...entity.extra, url },
    });
    closeBookmarkModal();
  });

  $('#b-delete').addEventListener('click', () => {
    const removed = store.remove(entity.id);
    closeBookmarkModal();
    if (removed) {
      showToast(`Deleted "${removed.title}"`, {
        actionLabel: 'Undo',
        onAction: () => store.restore(removed),
      });
    }
  });

  modalOverlay.addEventListener('click', (ev) => {
    if (ev.target === modalOverlay || ev.target.closest('[data-close]')) closeBookmarkModal();
  });
  document.addEventListener('keydown', onModalKey);
  document.getElementById('modal-root').appendChild(modalOverlay);
  $('#b-title').focus();
}
