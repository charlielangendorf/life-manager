// Journal view: daily free-form entries + GTD-style weekly reviews.
// Data shape (per docs/phase2-brief.md):
//   daily:  { type:'journal', title:'Journal — Jul 2', notes: body,
//             date:'YYYY-MM-DD', extra:{ kind:'daily' } }
//   weekly: { type:'journal', title:'Weekly review — week of Jun 28', notes,
//             date, extra:{ kind:'weekly-review',
//                           review:{ wentWell, slipping, nextFocus } } }
import { store } from '../store.js';
import {
  escapeHtml, todayKey, fmtDate, fmtDateFull, fmtMonthYear, startOfWeekKey,
} from '../utils.js';
import { showToast } from '../toast.js';

const PREVIEW_LEN = 200;

// Which entry ids are expanded — module-level so it survives re-renders.
const expanded = new Set();

// ---- pure helpers (DOM-free, headlessly testable) --------------------------

export function dailyTitle(dateStr) {
  return `Journal — ${fmtDate(dateStr)}`;
}

export function weeklyTitle(dateStr) {
  return `Weekly review — week of ${fmtDate(startOfWeekKey(dateStr))}`;
}

// Reverse-chronological by date, newest first. Ties broken by createdAt.
export function sortEntries(list) {
  return [...list].sort((a, b) => {
    const d = (b.date || '').localeCompare(a.date || '');
    if (d !== 0) return d;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
}

// Group sorted entries into [{ key: 'YYYY-MM', label: 'July 2026', items }].
export function groupByMonth(sorted) {
  const groups = [];
  let current = null;
  for (const e of sorted) {
    const key = (e.date || '').slice(0, 7);
    if (!current || current.key !== key) {
      current = { key, label: fmtMonthYear(e.date), items: [] };
      groups.push(current);
    }
    current.items.push(e);
  }
  return groups;
}

// Escape a multiline body and preserve line breaks as <br>.
function bodyHtml(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function needsTruncation(text) {
  return (text || '').length > PREVIEW_LEN;
}

// Is there a weekly review anchored to the current week?
function hasWeeklyThisWeek(entries) {
  const wk = startOfWeekKey(todayKey());
  return entries.some(
    (e) => e.extra?.kind === 'weekly-review' && startOfWeekKey(e.date) === wk,
  );
}

// ---- entry cards -----------------------------------------------------------

function dailyCard(e) {
  const isOpen = expanded.has(e.id);
  const body = e.notes || '';
  const truncated = needsTruncation(body);
  const shown = truncated && !isOpen ? body.slice(0, PREVIEW_LEN).trimEnd() + '…' : body;
  const toggle = truncated
    ? `<button class="jrnl-more" data-action="expand">${isOpen ? 'Show less' : 'Read more'}</button>`
    : '';
  return `
    <article class="jrnl-entry" data-id="${e.id}">
      <div class="jrnl-entry-head">
        <div>
          <span class="jrnl-kind-tag jrnl-kind-daily">Daily</span>
          <span class="jrnl-date">${escapeHtml(fmtDateFull(e.date))}</span>
        </div>
        <div class="jrnl-actions">
          <button class="icon-btn" data-action="edit" title="Edit">✎</button>
          <button class="icon-btn" data-action="delete" title="Delete">✕</button>
        </div>
      </div>
      <div class="jrnl-body${truncated && !isOpen ? ' clamp' : ''}">${body ? bodyHtml(shown) : '<span class="hint">No text.</span>'}</div>
      ${toggle}
    </article>`;
}

function reviewField(label, value) {
  const has = (value || '').trim();
  return `
    <div class="jrnl-review-field">
      <div class="jrnl-review-label">${label}</div>
      <div class="jrnl-review-value">${has ? bodyHtml(value) : '<span class="hint">—</span>'}</div>
    </div>`;
}

function weeklyCard(e) {
  const isOpen = expanded.has(e.id);
  const r = e.extra?.review || {};
  const extraNotes = (e.notes || '').trim();
  const truncated = needsTruncation(extraNotes);
  const shownNotes = truncated && !isOpen
    ? extraNotes.slice(0, PREVIEW_LEN).trimEnd() + '…' : extraNotes;
  const notesBlock = extraNotes
    ? `<div class="jrnl-review-field">
         <div class="jrnl-review-label">Notes</div>
         <div class="jrnl-review-value">${bodyHtml(shownNotes)}</div>
       </div>`
    : '';
  const toggle = truncated
    ? `<button class="jrnl-more" data-action="expand">${isOpen ? 'Show less' : 'Read more'}</button>`
    : '';
  return `
    <article class="jrnl-entry jrnl-review" data-id="${e.id}">
      <div class="jrnl-entry-head">
        <div>
          <span class="jrnl-kind-tag jrnl-kind-weekly">Weekly review</span>
          <span class="jrnl-date">week of ${escapeHtml(fmtDate(startOfWeekKey(e.date)))}</span>
        </div>
        <div class="jrnl-actions">
          <button class="icon-btn" data-action="edit" title="Edit">✎</button>
          <button class="icon-btn" data-action="delete" title="Delete">✕</button>
        </div>
      </div>
      <div class="jrnl-review-grid">
        ${reviewField('What went well?', r.wentWell)}
        ${reviewField("What's slipping?", r.slipping)}
        ${reviewField("Next week's focus", r.nextFocus)}
        ${notesBlock}
      </div>
      ${toggle}
    </article>`;
}

// A thread node wraps each entry: a pen node for daily, a warmer distinct node
// for weekly reviews. `hero` marks the single most-recent entry (--highlight).
function threadItem(e, hero) {
  const weekly = e.extra?.kind === 'weekly-review';
  const card = weekly ? weeklyCard(e) : dailyCard(e);
  const glyph = weekly ? '★' : '✍️';
  return `
    <div class="jrnl-item ${weekly ? 'is-weekly' : 'is-daily'} ${hero ? 'is-hero' : ''}">
      <span class="jrnl-node" aria-hidden="true">${glyph}</span>
      ${card}
    </div>`;
}

function emptyState() {
  return `
    <section class="card jrnl-empty">
      <div class="jrnl-empty-icon">📓</div>
      <h2 class="jrnl-empty-title">Start your journal</h2>
      <p class="jrnl-empty-copy">
        A few lines a day adds up. And a <strong>weekly review</strong> — what went
        well, what's slipping, and where to point next week — is the single habit
        that keeps everything else on track.
      </p>
      <div class="jrnl-empty-actions">
        <button class="primary-btn" data-new-entry>+ New entry</button>
        <button class="ghost-btn" data-new-weekly>Weekly review</button>
      </div>
    </section>`;
}

// ---- render ----------------------------------------------------------------

function draw(container) {
  const entries = store.all('journal');
  const sorted = sortEntries(entries);
  const groups = groupByMonth(sorted);

  // The ONE --highlight moment: if this week has no weekly review yet, the
  // "Weekly review" button is the anchor to nudge toward; otherwise it's the
  // most recent entry's node.
  const needsWeekly = entries.length > 0 && !hasWeeklyThisWeek(entries);
  const heroId = needsWeekly ? null : sorted[0]?.id;

  container.innerHTML = `
    <div class="view-head">
      <h1>Journal</h1>
      <span class="spacer"></span>
      <button class="primary-btn" data-new-entry>+ New entry</button>
      <button class="ghost-btn ${needsWeekly ? 'jrnl-weekly-cta' : ''}" data-new-weekly>Weekly review</button>
    </div>
    ${entries.length === 0 ? emptyState() : groups.map((g) => `
      <section class="jrnl-month">
        <h2 class="jrnl-month-head">${escapeHtml(g.label)}</h2>
        <div class="jrnl-thread">${g.items.map((e) => threadItem(e, e.id === heroId)).join('')}</div>
      </section>`).join('')}
  `;
}

export function render(container) {
  container.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-new-entry]')) { openEntryEditor(null, 'daily'); return; }
    if (ev.target.closest('[data-new-weekly]')) { openEntryEditor(null, 'weekly-review'); return; }

    const card = ev.target.closest('.jrnl-entry[data-id]');
    if (!card) return;
    const id = card.dataset.id;
    const entity = store.get(id);
    if (!entity) return;

    if (ev.target.closest('[data-action="expand"]')) {
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      draw(container);
      return;
    }
    if (ev.target.closest('[data-action="edit"]')) {
      openEntryEditor(entity);
      return;
    }
    if (ev.target.closest('[data-action="delete"]')) {
      const removed = store.remove(id);
      expanded.delete(id);
      if (removed) {
        showToast(`Deleted "${removed.title}"`, {
          actionLabel: 'Undo',
          onAction: () => store.restore(removed),
        });
      }
    }
  });

  draw(container);
}

// ---- editor modal (own modal, taskModal structure/classes) -----------------

let overlay = null;

function onKey(e) {
  if (e.key === 'Escape') closeEntryEditor();
}

function closeEntryEditor() {
  overlay?.remove();
  overlay = null;
  document.removeEventListener('keydown', onKey);
}

// kind: 'daily' | 'weekly-review' — only used when creating a new entry.
function openEntryEditor(entity = null, kind = 'daily') {
  closeEntryEditor();
  const isNew = !entity;
  const entryKind = isNew ? kind : (entity.extra?.kind || 'daily');
  const isWeekly = entryKind === 'weekly-review';
  const dateVal = (entity?.date || todayKey()).slice(0, 10);
  const review = entity?.extra?.review || {};

  overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <strong class="jrnl-modal-kind">${isWeekly ? 'Weekly review' : 'Journal entry'}</strong>
        <span class="spacer"></span>
        <button type="button" class="icon-btn" data-close title="Close (Esc)">✕</button>
      </div>
      <div class="modal-body">
        <label class="jrnl-field">
          <span class="section-label">Date</span>
          <input type="date" id="j-date">
        </label>
        ${isWeekly ? `
          <label class="jrnl-field">
            <span class="section-label">What went well?</span>
            <textarea id="j-well" placeholder="Wins, progress, things that clicked…"></textarea>
          </label>
          <label class="jrnl-field">
            <span class="section-label">What's slipping?</span>
            <textarea id="j-slip" placeholder="Dropped balls, friction, worries…"></textarea>
          </label>
          <label class="jrnl-field">
            <span class="section-label">Next week's focus</span>
            <textarea id="j-focus" placeholder="The one or two things that matter most…"></textarea>
          </label>
          <label class="jrnl-field">
            <span class="section-label">Notes (optional)</span>
            <textarea id="j-notes" placeholder="Anything else…"></textarea>
          </label>
        ` : `
          <label class="jrnl-field">
            <span class="section-label">Entry</span>
            <textarea id="j-notes" class="jrnl-body-input" placeholder="What's on your mind?"></textarea>
          </label>
        `}
      </div>
      <div class="modal-foot">
        ${isNew ? '' : '<button type="button" id="j-delete" class="danger-btn">Delete</button>'}
        <span class="spacer"></span>
        <button type="button" class="ghost-btn" data-close>Cancel</button>
        <button type="button" id="j-save" class="primary-btn">${isNew ? 'Add' : 'Save'}</button>
      </div>
    </div>`;

  const $ = (s) => overlay.querySelector(s);
  $('#j-date').value = dateVal;
  if (isWeekly) {
    $('#j-well').value = review.wentWell || '';
    $('#j-slip').value = review.slipping || '';
    $('#j-focus').value = review.nextFocus || '';
    $('#j-notes').value = entity?.notes || '';
  } else {
    $('#j-notes').value = entity?.notes || '';
  }

  $('#j-save').addEventListener('click', () => {
    const date = $('#j-date').value || todayKey();
    const notes = $('#j-notes').value.trim();

    const patch = {
      type: 'journal',
      date,
      notes,
      title: isWeekly ? weeklyTitle(date) : dailyTitle(date),
      extra: { ...(entity?.extra || {}), kind: entryKind },
    };
    if (isWeekly) {
      patch.extra.review = {
        wentWell: $('#j-well').value.trim(),
        slipping: $('#j-slip').value.trim(),
        nextFocus: $('#j-focus').value.trim(),
      };
    } else {
      delete patch.extra.review;
    }

    if (isNew) store.add(patch);
    else store.update(entity.id, patch);
    closeEntryEditor();
  });

  if (!isNew) {
    $('#j-delete').addEventListener('click', () => {
      const removed = store.remove(entity.id);
      expanded.delete(entity.id);
      closeEntryEditor();
      if (removed) {
        showToast(`Deleted "${removed.title}"`, {
          actionLabel: 'Undo',
          onAction: () => store.restore(removed),
        });
      }
    });
  }

  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay || ev.target.closest('[data-close]')) closeEntryEditor();
  });
  document.addEventListener('keydown', onKey);

  document.getElementById('modal-root').appendChild(overlay);
  (isWeekly ? $('#j-well') : $('#j-notes')).focus();
}
