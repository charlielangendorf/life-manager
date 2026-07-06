// Reading library — a book ledger in three bands: to read / reading /
// finished. Advancing status is a one-tap text button; finishing asks for a
// one-line takeaway on the spot (stored with the status change in a single
// update). Finished rows show the takeaway as a serif-italic margin quote.
// The currently-in-progress title carries the screen's one marker swipe.
import { store } from '../store.js';
import { escapeHtml } from '../utils.js';
import { showToast } from '../toast.js';

// UI state that survives re-renders: which entity is mid-"finish" (awaiting
// its takeaway line).
const ui = { finishing: null };

// ---- pure helpers (exported for headless tests) ----

// Split reading entities into ordered bands.
export function bandsFor(entities) {
  const by = (s) => entities.filter((e) => e.status === s)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return { reading: by('in-progress'), todo: by('todo'), done: by('done') };
}

// The single marker swipe: the most recently touched in-progress title.
export function pickSwipe(entities) {
  const { reading } = bandsFor(entities);
  return reading.length ? reading[0].id : null;
}

// ---- pieces ----

function metaLine(e) {
  const bits = [];
  if (e.extra?.author) bits.push(e.extra.author);
  if (e.extra?.source) bits.push(e.extra.source);
  for (const t of e.tags || []) bits.push(`#${t}`);
  if (!bits.length) return '';
  return `<div class="read-sub"><span class="read-meta-line">${escapeHtml(bits.join(' · '))}</span></div>`;
}

function takeawayEditor(e) {
  return `
    <div class="read-finish-edit">
      <input class="read-takeaway-input" type="text" maxlength="200"
             placeholder="one line worth keeping…" autocomplete="off"
             value="${escapeHtml(e.extra?.takeaway || '')}">
      <button class="ghost-btn" data-action="finish-save">Save</button>
      <button class="icon-btn" data-action="finish-cancel" title="Cancel">✕</button>
    </div>`;
}

function bookLine(e, swipeId) {
  const actions = [];
  if (e.status === 'todo') actions.push('<button class="read-txt-btn" data-action="start">start</button>');
  if (e.status === 'in-progress') actions.push('<button class="read-txt-btn" data-action="finish">finish</button>');
  if (e.status === 'done') actions.push('<button class="read-txt-btn" data-action="reopen">reread</button>');
  actions.push('<button class="read-txt-btn" data-action="edit">edit</button>');

  const swiped = e.id === swipeId;
  return `
    <div class="read-line ${e.status === 'done' ? 'is-done' : ''}" data-id="${e.id}">
      <div class="read-line-top">
        <span class="read-title ${swiped ? 'swipe' : ''}">${escapeHtml(e.title)}</span>
        <span class="spacer"></span>
        <span class="read-line-actions">${actions.join('')}</span>
      </div>
      ${metaLine(e)}
      ${e.status === 'done' && e.extra?.takeaway
    ? `<div class="read-takeaway">“${escapeHtml(e.extra.takeaway)}”</div>` : ''}
      ${ui.finishing === e.id ? takeawayEditor(e) : ''}
    </div>`;
}

function band(label, items, swipeId) {
  if (!items.length) return '';
  return `
    <section class="card">
      <h2>${label} · ${items.length}</h2>
      <div class="read-lines rows">${items.map((e) => bookLine(e, swipeId)).join('')}</div>
    </section>`;
}

function draw(container) {
  const entities = store.all('reading');
  const head = `
    <div class="view-head">
      <h1>Reading</h1>
      <span class="spacer"></span>
      <button id="new-reading" class="primary-btn">+ Add a book</button>
    </div>`;

  if (!entities.length) {
    container.innerHTML = `
      ${head}
      <section class="card">
        <div class="empty read-empty">
          <p class="read-empty-line">Nothing on the list. Write down the book,
          paper, or article you keep meaning to get to — future you will thank you.</p>
          <button id="new-reading-2" class="primary-btn">+ Add a book</button>
        </div>
      </section>`;
    return;
  }

  const bands = bandsFor(entities);
  const swipeId = pickSwipe(entities);
  container.innerHTML = `
    ${head}
    ${band('reading', bands.reading, swipeId)}
    ${band('to read', bands.todo, swipeId)}
    ${band('finished', bands.done, swipeId)}`;
}

function finishSave(entity, input) {
  store.update(entity.id, {
    status: 'done',
    extra: { ...entity.extra, takeaway: input.value.trim() },
  });
  ui.finishing = null;
}

export function render(container) {
  container.addEventListener('click', (ev) => {
    if (ev.target.closest('#new-reading') || ev.target.closest('#new-reading-2')) {
      openReadingModal(null);
      return;
    }
    const line = ev.target.closest('.read-line[data-id]');
    if (!line) return;
    const entity = store.get(line.dataset.id);
    if (!entity) return;

    const action = ev.target.closest('[data-action]')?.dataset.action;
    if (action === 'start') {
      store.update(entity.id, { status: 'in-progress' });
    } else if (action === 'finish') {
      ui.finishing = entity.id;
      draw(container);
      container.querySelector('.read-takeaway-input')?.focus();
    } else if (action === 'finish-save') {
      finishSave(entity, line.querySelector('.read-takeaway-input'));
    } else if (action === 'finish-cancel') {
      ui.finishing = null;
      draw(container);
    } else if (action === 'reopen') {
      store.update(entity.id, { status: 'in-progress' });
    } else if (action === 'edit') {
      openReadingModal(entity);
    }
  });

  container.addEventListener('keydown', (ev) => {
    if (!ev.target.classList?.contains('read-takeaway-input')) return;
    const line = ev.target.closest('.read-line[data-id]');
    const entity = line && store.get(line.dataset.id);
    if (ev.key === 'Enter' && entity) {
      ev.preventDefault();
      finishSave(entity, ev.target);
    } else if (ev.key === 'Escape') {
      ui.finishing = null;
      draw(container);
    }
  });

  draw(container);
}

// ===================================================================
// Reading modal — index-card CRUD.
// ===================================================================

let modalOverlay = null;

function onModalKey(e) {
  if (e.key === 'Escape') closeReadingModal();
}

function closeReadingModal() {
  modalOverlay?.remove();
  modalOverlay = null;
  document.removeEventListener('keydown', onModalKey);
}

function openReadingModal(entity = null) {
  closeReadingModal();
  const isNew = !entity;
  const e = entity || { title: '', notes: '', tags: [], status: 'todo', extra: {} };

  modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  modalOverlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <span class="modal-type">${isNew ? 'New book' : 'Edit book'}</span>
        <span class="spacer"></span>
        <button type="button" class="icon-btn" data-close title="Close (Esc)">✕</button>
      </div>
      <div class="modal-body">
        <input id="r-title" placeholder="Title" autocomplete="off">
        <div class="form-grid">
          <label>Author<input id="r-author" autocomplete="off"></label>
          <label>Source<input id="r-source" placeholder="book, paper, link…" autocomplete="off"></label>
          <label>Status
            <select id="r-status">
              <option value="todo">to read</option>
              <option value="in-progress">reading</option>
              <option value="done">finished</option>
            </select>
          </label>
          <label>Tags<input id="r-tags" placeholder="comma, separated" autocomplete="off"></label>
          <label class="full">Takeaway<input id="r-takeaway" placeholder="one line worth keeping" autocomplete="off"></label>
        </div>
        <textarea id="r-notes" placeholder="Notes…"></textarea>
      </div>
      <div class="modal-foot">
        ${isNew ? '' : '<button type="button" id="r-delete" class="danger-btn">Delete</button>'}
        <span class="spacer"></span>
        <button type="button" class="ghost-btn" data-close>Cancel</button>
        <button type="button" id="r-save" class="primary-btn">${isNew ? 'Add' : 'Save'}</button>
      </div>
    </div>`;

  const $ = (sel) => modalOverlay.querySelector(sel);
  $('#r-title').value = e.title || '';
  $('#r-author').value = e.extra?.author || '';
  $('#r-source').value = e.extra?.source || '';
  $('#r-status').value = e.status || 'todo';
  $('#r-tags').value = (e.tags || []).join(', ');
  $('#r-takeaway').value = e.extra?.takeaway || '';
  $('#r-notes').value = e.notes || '';

  $('#r-save').addEventListener('click', () => {
    const title = $('#r-title').value.trim();
    if (!title) {
      $('#r-title').classList.add('invalid');
      $('#r-title').focus();
      return;
    }
    const patch = {
      type: 'reading',
      title,
      notes: $('#r-notes').value.trim(),
      status: $('#r-status').value,
      tags: $('#r-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
      extra: {
        ...(entity?.extra || {}),
        author: $('#r-author').value.trim(),
        source: $('#r-source').value.trim(),
        takeaway: $('#r-takeaway').value.trim(),
      },
    };
    if (isNew) store.add(patch);
    else store.update(entity.id, patch);
    closeReadingModal();
  });

  if (!isNew) {
    $('#r-delete').addEventListener('click', () => {
      const removed = store.remove(entity.id);
      closeReadingModal();
      if (removed) {
        showToast(`Deleted "${removed.title}"`, {
          actionLabel: 'Undo',
          onAction: () => store.restore(removed),
        });
      }
    });
  }

  modalOverlay.addEventListener('click', (ev) => {
    if (ev.target === modalOverlay || ev.target.closest('[data-close]')) closeReadingModal();
  });
  document.addEventListener('keydown', onModalKey);
  document.getElementById('modal-root').appendChild(modalOverlay);
  $('#r-title').focus();
}
