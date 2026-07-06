// Contacts view — a people ledger kept by hand. Follow-ups that have come due
// float to the top with a red-pencil serif-italic annotation ("follow up —
// 3d over"); below them, the whole address book as ruled lines: serif name,
// a mono "last touched <relative>" note in the margin, and a one-tap
// "touched today" stamp per row. The single most-overdue name carries the
// screen's one marker swipe. Contacts have no status; everything type-specific
// lives in extra (lastContacted, nextFollowUp, email, phone). No emoji.
import { store } from '../store.js';
import { escapeHtml, todayKey, parseDate } from '../utils.js';
import { showToast } from '../toast.js';

// ---- pure helpers (exported for headless tests) ----

// Whole days from `dateKey` to `today` (positive = in the past). Null-safe.
export function daysBetween(dateKey, today) {
  if (!dateKey) return null;
  const a = parseDate(dateKey);
  const b = parseDate(today);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}

// A relative-past phrase for the margin: "today", "yesterday", "3 days ago",
// "in 2 days" (future), or "never". Reads as pencil marginalia.
export function relativePast(dateKey, today) {
  if (!dateKey) return 'never';
  const diff = daysBetween(dateKey, today);
  if (diff === null) return 'never';
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff > 1) return `${diff} days ago`;
  if (diff === -1) return 'tomorrow';
  return `in ${-diff} days`;
}

// Contacts whose nextFollowUp is on or before `today`, most overdue first.
export function followUpsDue(entities, today) {
  return entities
    .filter((c) => c.extra?.nextFollowUp && c.extra.nextFollowUp <= today)
    .sort((a, b) => {
      const av = a.extra.nextFollowUp;
      const bv = b.extra.nextFollowUp;
      return av < bv ? -1 : av > bv ? 1 : a.title.localeCompare(b.title);
    });
}

// Ledger ordering: alphabetical by name, blanks last.
export function ledgerOrder(entities) {
  return [...entities].sort((a, b) =>
    (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));
}

// The single marker swipe: the most-overdue follow-up (id), or null.
export function pickSwipe(entities, today) {
  const due = followUpsDue(entities, today);
  return due.length ? due[0].id : null;
}

// A short red-pencil annotation for a due follow-up.
function overdueNote(followUpKey, today) {
  const diff = daysBetween(followUpKey, today);
  if (diff === null) return '';
  if (diff <= 0) return 'follow up — today';
  return `follow up — ${diff}d over`;
}

// ---- store helpers (immutable extra spread) ----

function touchToday(contact) {
  store.update(contact.id, {
    extra: { ...contact.extra, lastContacted: todayKey() },
  });
}

// ---- pieces ----

function contactMeta(contact) {
  const bits = [];
  if (contact.extra?.email) bits.push(escapeHtml(contact.extra.email));
  if (contact.extra?.phone) bits.push(escapeHtml(contact.extra.phone));
  for (const t of contact.tags || []) bits.push(`#${escapeHtml(t)}`);
  if (!bits.length) return '';
  return `<span class="contact-meta-line">${bits.join(' · ')}</span>`;
}

// A due follow-up line: name, red-pencil annotation, one-tap touch + edit.
function dueLine(contact, today, swiped) {
  const note = overdueNote(contact.extra.nextFollowUp, today);
  return `
    <div class="contact-line contact-due" data-id="${contact.id}">
      <div class="contact-line-top">
        <span class="contact-name ${swiped ? 'swipe' : ''}">${escapeHtml(contact.title)}</span>
        <span class="contact-followup">${escapeHtml(note)}</span>
        <span class="spacer"></span>
        <span class="contact-line-actions">
          <button class="contact-txt-btn" data-action="touch">touched today</button>
          <button class="contact-txt-btn" data-action="edit">edit</button>
        </span>
      </div>
      ${contactMeta(contact)}
      ${contact.notes ? `<div class="contact-sub">${escapeHtml(contact.notes)}</div>` : ''}
    </div>`;
}

// A ledger line: name, mono "last touched <relative>" note, touch + edit.
function ledgerLine(contact, today) {
  const last = contact.extra?.lastContacted;
  const rel = relativePast(last, today);
  const touchedClass = !last ? 'contact-touched never' : 'contact-touched';
  return `
    <div class="contact-line" data-id="${contact.id}">
      <div class="contact-line-top">
        <span class="contact-name">${escapeHtml(contact.title)}</span>
        <span class="${touchedClass}">last touched ${escapeHtml(rel)}</span>
        <span class="spacer"></span>
        <span class="contact-line-actions">
          <button class="contact-txt-btn" data-action="touch">touched today</button>
          <button class="contact-txt-btn" data-action="edit">edit</button>
        </span>
      </div>
      ${contactMeta(contact)}
      ${contact.notes ? `<div class="contact-sub">${escapeHtml(contact.notes)}</div>` : ''}
    </div>`;
}

function headBar() {
  return `
    <div class="view-head">
      <h1>Contacts</h1>
      <span class="spacer"></span>
      <button id="new-contact" class="primary-btn">+ New contact</button>
    </div>`;
}

function draw(container) {
  const contacts = store.all('contact');
  const today = todayKey();

  if (!contacts.length) {
    container.innerHTML = `
      ${headBar()}
      <section class="card">
        <div class="empty contact-empty">
          <p class="contact-empty-line">No one written down yet. The people who
          matter are worth a line — add the first, and note when you last spoke.</p>
          <button id="new-contact-2" class="primary-btn">+ New contact</button>
        </div>
      </section>`;
    return;
  }

  const due = followUpsDue(contacts, today);
  const swipeId = due.length ? due[0].id : null;
  const ledger = ledgerOrder(contacts);

  const dueSection = due.length
    ? `<section class="card overdue contact-due-section">
         <h2>follow-ups due</h2>
         <div class="contact-lines rows">
           ${due.map((c) => dueLine(c, today, c.id === swipeId)).join('')}
         </div>
       </section>`
    : '';

  container.innerHTML = `
    ${headBar()}
    ${dueSection}
    <section class="card contact-ledger-section">
      <h2>the people (${ledger.length})</h2>
      <div class="contact-lines rows">
        ${ledger.map((c) => ledgerLine(c, today)).join('')}
      </div>
    </section>`;
}

// ---- event wiring (delegated on the fresh container) ----

export function render(container) {
  container.addEventListener('click', (ev) => {
    if (ev.target.closest('#new-contact') || ev.target.closest('#new-contact-2')) {
      openContactModal(null);
      return;
    }

    const line = ev.target.closest('.contact-line[data-id]');
    if (!line) return;
    const contact = store.get(line.dataset.id);
    if (!contact) return;

    const action = ev.target.closest('[data-action]')?.dataset.action;
    if (action === 'touch') {
      touchToday(contact); // store.update re-renders the whole view
    } else if (action === 'edit') {
      openContactModal(contact);
    }
  });

  draw(container);
}

// ===================================================================
// Contact modal — index-card CRUD (mirrors taskModal/habits structure).
// ===================================================================

let modalOverlay = null;

function onModalKey(e) {
  if (e.key === 'Escape') closeContactModal();
}

function closeContactModal() {
  modalOverlay?.remove();
  modalOverlay = null;
  document.removeEventListener('keydown', onModalKey);
}

export function openContactModal(entity = null) {
  closeContactModal();

  const isNew = !entity;
  const c = entity || { type: 'contact', title: '', notes: '', tags: [], extra: {} };
  const ex = c.extra || {};

  modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  modalOverlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <span class="modal-type">${isNew ? 'New contact' : 'Edit contact'}</span>
        <span class="spacer"></span>
        <button type="button" class="icon-btn" data-close title="Close (Esc)">✕</button>
      </div>
      <div class="modal-body">
        <input id="c-title" placeholder="Name" autocomplete="off">
        <div class="form-grid">
          <label class="full">Email<input id="c-email" type="email" placeholder="name@example.com" autocomplete="off"></label>
          <label class="full">Phone<input id="c-phone" type="tel" placeholder="phone" autocomplete="off"></label>
          <label>Last contacted<input id="c-last" type="date"></label>
          <label>Next follow-up<input id="c-follow" type="date"></label>
          <label class="full">Tags<input id="c-tags" placeholder="comma, separated"></label>
        </div>
        <textarea id="c-notes" placeholder="Notes…"></textarea>
      </div>
      <div class="modal-foot">
        ${isNew ? '' : '<button type="button" id="c-delete" class="danger-btn">Delete</button>'}
        <span class="spacer"></span>
        <button type="button" class="ghost-btn" data-close>Cancel</button>
        <button type="button" id="c-save" class="primary-btn">${isNew ? 'Add' : 'Save'}</button>
      </div>
    </div>`;

  const $ = (sel) => modalOverlay.querySelector(sel);

  $('#c-title').value = c.title || '';
  $('#c-email').value = ex.email || '';
  $('#c-phone').value = ex.phone || '';
  $('#c-last').value = ex.lastContacted || '';
  $('#c-follow').value = ex.nextFollowUp || '';
  $('#c-tags').value = (c.tags || []).join(', ');
  $('#c-notes').value = c.notes || '';

  $('#c-save').addEventListener('click', () => {
    const title = $('#c-title').value.trim();
    if (!title) {
      $('#c-title').classList.add('invalid');
      $('#c-title').focus();
      return;
    }
    const extra = {
      ...(entity?.extra || {}),
      email: $('#c-email').value.trim(),
      phone: $('#c-phone').value.trim(),
      lastContacted: $('#c-last').value || null,
      nextFollowUp: $('#c-follow').value || null,
    };
    const patch = {
      type: 'contact',
      title,
      notes: $('#c-notes').value.trim(),
      tags: $('#c-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
      extra,
    };
    if (isNew) store.add(patch);
    else store.update(entity.id, patch);
    closeContactModal();
  });

  if (!isNew) {
    $('#c-delete').addEventListener('click', () => {
      const removed = store.remove(entity.id);
      closeContactModal();
      if (removed) {
        showToast(`Deleted "${removed.title}"`, {
          actionLabel: 'Undo',
          onAction: () => store.restore(removed),
        });
      }
    });
  }

  modalOverlay.addEventListener('click', (ev) => {
    if (ev.target === modalOverlay) closeContactModal();
    if (ev.target.closest('[data-close]')) closeContactModal();
  });
  document.addEventListener('keydown', onModalKey);

  document.getElementById('modal-root').appendChild(modalOverlay);
  $('#c-title').focus();
}
