// Trips — itineraries kept like packing lists in a planner. Upcoming trips
// are sections (serif destination, mono date-range stamp); the next trip
// carries a red-pencil "in N days" annotation. Each trip has a checklist in
// the square-check language. Past trips collapse into a quiet group.
import { store } from '../store.js';
import { uid, escapeHtml, todayKey, fmtDate, parseDate } from '../utils.js';
import { showToast } from '../toast.js';

// UI state that survives re-renders.
const ui = { pastOpen: false, addingFor: null };

// ---- pure helpers (exported for headless tests) ----

// Split trips into upcoming (end >= today, soonest first) and past (newest
// first). Undated trips count as upcoming, listed after dated ones.
export function tripsSplit(entities, today) {
  const endOf = (t) => (t.dueDate || t.date || '').slice(0, 10);
  const upcoming = [];
  const past = [];
  for (const t of entities) {
    const end = endOf(t);
    if (!end || end >= today) upcoming.push(t);
    else past.push(t);
  }
  upcoming.sort((a, b) => {
    const av = (a.date || '9999');
    const bv = (b.date || '9999');
    return av < bv ? -1 : av > bv ? 1 : a.title.localeCompare(b.title);
  });
  past.sort((a, b) => (endOf(b) < endOf(a) ? -1 : 1));
  return { upcoming, past };
}

export function daysUntil(dateKey, today) {
  if (!dateKey) return null;
  const a = parseDate(today);
  const b = parseDate(dateKey.slice(0, 10));
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}

// ---- pieces ----

function rangeStamp(t) {
  const start = t.date ? fmtDate(t.date) : '';
  const end = t.dueDate ? fmtDate(t.dueDate) : '';
  if (start && end && start !== end) return `${start} – ${end}`.toUpperCase();
  return (start || end || 'undated').toUpperCase();
}

function checklist(t) {
  const items = t.extra?.checklist || [];
  const done = items.filter((i) => i.done).length;
  const rows = items.map((i) => `
    <div class="trip-check-row" data-cid="${escapeHtml(i.id)}">
      <button class="check ${i.done ? 'checked' : ''}" data-action="check-item" aria-label="Toggle item"></button>
      <span class="trip-check-title ${i.done ? 'is-done' : ''}">${escapeHtml(i.title)}</span>
      <button class="trip-txt-btn trip-check-remove" data-action="remove-item" aria-label="Remove item">✕</button>
    </div>`).join('');
  const adder = ui.addingFor === t.id
    ? `<div class="trip-add-row">
         <input class="trip-add-input" placeholder="pack / book / do…" autocomplete="off">
         <button class="ghost-btn" data-action="add-save">Add</button>
       </div>`
    : `<button class="trip-txt-btn" data-action="add-item">+ add to the list</button>`;
  return `
    <div class="trip-checklist">
      ${items.length ? `<div class="trip-check-count">${done}/${items.length} packed &amp; prepped</div>` : ''}
      ${rows}
      ${adder}
    </div>`;
}

function tripSection(t, today, isNext) {
  const days = daysUntil(t.date, today);
  const note = isNext && days !== null && days >= 0
    ? `<span class="trip-soon">${days === 0 ? 'today!' : days === 1 ? 'tomorrow!' : `in ${days} days`}</span>`
    : '';
  return `
    <section class="trip-sec" data-id="${t.id}">
      <div class="trip-head">
        <span class="trip-name">${escapeHtml(t.title)}</span>
        <span class="trip-stamp">${escapeHtml(rangeStamp(t))}</span>
        ${note}
        <span class="spacer"></span>
        <button class="trip-txt-btn" data-action="edit">edit</button>
      </div>
      ${t.notes ? `<div class="trip-notes">${escapeHtml(t.notes)}</div>` : ''}
      ${checklist(t)}
    </section>`;
}

function draw(container) {
  const trips = store.all('trip');
  const today = todayKey();
  const head = `
    <div class="view-head">
      <h1>Trips</h1>
      <span class="spacer"></span>
      <button id="new-trip" class="primary-btn">+ New trip</button>
    </div>`;

  if (!trips.length) {
    container.innerHTML = `
      ${head}
      <section class="card">
        <div class="empty trip-empty">
          <p class="trip-empty-line">Nowhere on the books. Name the next trip and
          start the packing list — half the joy is the planning.</p>
          <button id="new-trip-2" class="primary-btn">+ New trip</button>
        </div>
      </section>`;
    return;
  }

  const { upcoming, past } = tripsSplit(trips, today);
  container.innerHTML = `
    ${head}
    ${upcoming.map((t, i) => tripSection(t, today, i === 0)).join('')
      || '<section class="card"><div class="empty">Nothing coming up.</div></section>'}
    ${past.length ? `
      <div class="trip-past">
        <button id="trip-past-toggle" class="trip-past-head" aria-expanded="${ui.pastOpen}">
          ${ui.pastOpen ? '▾' : '▸'} past trips · ${past.length}
        </button>
        ${ui.pastOpen ? past.map((t) => tripSection(t, today, false)).join('') : ''}
      </div>` : ''}`;
}

// ---- checklist store writes (immutable extra spread) ----

function writeChecklist(trip, items) {
  store.update(trip.id, { extra: { ...trip.extra, checklist: items } });
}

function addItem(trip, title) {
  if (!title) return;
  writeChecklist(trip, [...(trip.extra?.checklist || []), { id: uid(), title, done: false }]);
  ui.addingFor = trip.id; // keep the adder open for rapid entry
}

export function render(container) {
  container.addEventListener('click', (ev) => {
    if (ev.target.closest('#new-trip') || ev.target.closest('#new-trip-2')) {
      openTripModal(null);
      return;
    }
    if (ev.target.closest('#trip-past-toggle')) {
      ui.pastOpen = !ui.pastOpen;
      draw(container);
      return;
    }

    const sec = ev.target.closest('.trip-sec[data-id]');
    if (!sec) return;
    const trip = store.get(sec.dataset.id);
    if (!trip) return;

    const action = ev.target.closest('[data-action]')?.dataset.action;
    if (action === 'edit') {
      openTripModal(trip);
    } else if (action === 'check-item') {
      const cid = ev.target.closest('[data-cid]')?.dataset.cid;
      writeChecklist(trip, (trip.extra?.checklist || []).map((i) => (i.id === cid ? { ...i, done: !i.done } : i)));
    } else if (action === 'remove-item') {
      const cid = ev.target.closest('[data-cid]')?.dataset.cid;
      writeChecklist(trip, (trip.extra?.checklist || []).filter((i) => i.id !== cid));
    } else if (action === 'add-item') {
      ui.addingFor = trip.id;
      draw(container);
      container.querySelector('.trip-add-input')?.focus();
    } else if (action === 'add-save') {
      const input = sec.querySelector('.trip-add-input');
      addItem(trip, input.value.trim());
      // store.update re-rendered; refocus the fresh input.
      document.querySelector('.trip-add-input')?.focus();
    }
  });

  container.addEventListener('keydown', (ev) => {
    if (!ev.target.classList?.contains('trip-add-input')) return;
    const sec = ev.target.closest('.trip-sec[data-id]');
    const trip = sec && store.get(sec.dataset.id);
    if (ev.key === 'Enter' && trip) {
      ev.preventDefault();
      addItem(trip, ev.target.value.trim());
      document.querySelector('.trip-add-input')?.focus();
    } else if (ev.key === 'Escape') {
      ui.addingFor = null;
      draw(container);
    }
  });

  draw(container);
}

// ===================================================================
// Trip modal — index-card CRUD with a checklist editor.
// ===================================================================

let modalOverlay = null;

function onModalKey(e) {
  if (e.key === 'Escape') closeTripModal();
}

function closeTripModal() {
  modalOverlay?.remove();
  modalOverlay = null;
  document.removeEventListener('keydown', onModalKey);
}

function checkRow(item) {
  const row = document.createElement('div');
  row.className = 'subtask-row';
  row.dataset.cid = item.id || uid();
  row.innerHTML = `
    <input type="checkbox">
    <input type="text" class="subtask-title" placeholder="Item…">
    <button type="button" class="icon-btn" title="Remove">✕</button>`;
  row.querySelector('[type=checkbox]').checked = Boolean(item.done);
  row.querySelector('.subtask-title').value = item.title || '';
  row.querySelector('button').addEventListener('click', () => row.remove());
  return row;
}

function openTripModal(entity = null) {
  closeTripModal();
  const isNew = !entity;
  const t = entity || { title: '', notes: '', date: '', dueDate: '', extra: {} };

  modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  modalOverlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <span class="modal-type">${isNew ? 'New trip' : 'Edit trip'}</span>
        <span class="spacer"></span>
        <button type="button" class="icon-btn" data-close title="Close (Esc)">✕</button>
      </div>
      <div class="modal-body">
        <input id="t-title" placeholder="Where to?" autocomplete="off">
        <div class="form-grid">
          <label>Start<input type="date" id="t-start"></label>
          <label>End<input type="date" id="t-end"></label>
        </div>
        <textarea id="t-notes" placeholder="Notes…"></textarea>
        <div>
          <div class="section-label">Checklist</div>
          <div id="t-checklist"></div>
          <button type="button" id="t-add-item" class="ghost-btn">+ Add item</button>
        </div>
      </div>
      <div class="modal-foot">
        ${isNew ? '' : '<button type="button" id="t-delete" class="danger-btn">Delete</button>'}
        <span class="spacer"></span>
        <button type="button" class="ghost-btn" data-close>Cancel</button>
        <button type="button" id="t-save" class="primary-btn">${isNew ? 'Add' : 'Save'}</button>
      </div>
    </div>`;

  const $ = (sel) => modalOverlay.querySelector(sel);
  $('#t-title').value = t.title || '';
  $('#t-start').value = (t.date || '').slice(0, 10);
  $('#t-end').value = (t.dueDate || '').slice(0, 10);
  $('#t-notes').value = t.notes || '';

  const list = $('#t-checklist');
  for (const item of t.extra?.checklist || []) list.appendChild(checkRow(item));
  $('#t-add-item').addEventListener('click', () => {
    const row = checkRow({});
    list.appendChild(row);
    row.querySelector('.subtask-title').focus();
  });

  $('#t-save').addEventListener('click', () => {
    const title = $('#t-title').value.trim();
    if (!title) {
      $('#t-title').classList.add('invalid');
      $('#t-title').focus();
      return;
    }
    const start = $('#t-start').value || null;
    let end = $('#t-end').value || null;
    if (start && end && end < start) end = start;
    const items = [...list.children].map((row) => ({
      id: row.dataset.cid,
      title: row.querySelector('.subtask-title').value.trim(),
      done: row.querySelector('[type=checkbox]').checked,
    })).filter((i) => i.title);

    const patch = {
      type: 'trip',
      title,
      notes: $('#t-notes').value.trim(),
      date: start,
      dueDate: end,
      extra: { ...(entity?.extra || {}), checklist: items },
    };
    if (isNew) store.add(patch);
    else store.update(entity.id, patch);
    closeTripModal();
  });

  if (!isNew) {
    $('#t-delete').addEventListener('click', () => {
      const removed = store.remove(entity.id);
      closeTripModal();
      if (removed) {
        showToast(`Deleted "${removed.title}"`, {
          actionLabel: 'Undo',
          onAction: () => store.restore(removed),
        });
      }
    });
  }

  modalOverlay.addEventListener('click', (ev) => {
    if (ev.target === modalOverlay || ev.target.closest('[data-close]')) closeTripModal();
  });
  document.addEventListener('keydown', onModalKey);
  document.getElementById('modal-root').appendChild(modalOverlay);
  $('#t-title').focus();
}
