// Finance view — a paper account book. Three ledgers under one type
// (extra.kind): net-worth snapshots (one per date), recurring bills, and a
// monthly budget. Net worth reads as dated rows with mono amounts; the latest
// total carries the screen's ONE marker swipe, and a small inline-SVG spark-
// line (currentColor ink) charts the totals over time. Bills list mono amounts
// with "due the Nth". Budget is a planned-vs-actual table; over-budget lines
// get a red-pencil serif-italic annotation. Amounts are stored as numbers and
// rendered via toLocaleString; inputs are parsed with parseFloat (never eval)
// and guarded against NaN.
import { store } from '../store.js';
import { uid, escapeHtml, todayKey, fmtDate, fmtMonthYear, addMonths, parseDate } from '../utils.js';
import { showToast } from '../toast.js';

// UI state that must survive store-triggered re-renders.
const ui = { budgetMonth: null };

// ---- pure computation (DOM-free, headlessly testable) ----

// Sum a snapshot's account amounts into its total. Guards non-number values.
export function snapshotTotal(entity) {
  const accounts = entity?.extra?.accounts || [];
  return accounts.reduce((sum, a) => {
    const n = Number(a?.amount);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

// Net-worth series: every 'networth' snapshot as { date, total }, sorted oldest
// → newest. Feeds both the dated ledger and the spark-line.
export function networthSeries(entities) {
  return (entities || [])
    .filter((e) => e.type === 'finance' && e.extra?.kind === 'networth')
    .map((e) => ({ id: e.id, date: (e.date || '').slice(0, 10), total: snapshotTotal(e) }))
    .filter((s) => s.date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Budget totals for one entity: summed planned vs actual, and whether the whole
// month is over. Per-line over-budget is computed at render time.
export function budgetTotals(entity) {
  const lines = entity?.extra?.lines || [];
  let planned = 0;
  let actual = 0;
  for (const l of lines) {
    const p = Number(l?.planned);
    const a = Number(l?.actual);
    if (Number.isFinite(p)) planned += p;
    if (Number.isFinite(a)) actual += a;
  }
  return { planned, actual, over: actual > planned };
}

// ---- formatting ----

// Money as a plain ledger figure. toLocaleString keeps grouping/decimals sane
// without hard-coding a currency symbol into stored data.
function money(n) {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function ordinal(n) {
  const d = Number(n);
  if (!Number.isFinite(d)) return '';
  const t = d % 100;
  if (t >= 11 && t <= 13) return `${d}th`;
  return `${d}${({ 1: 'st', 2: 'nd', 3: 'rd' }[d % 10] || 'th')}`;
}

// ---- spark-line (inline SVG, currentColor only) ----

// A tiny ink spark-line of net-worth totals over time. Pure geometry; strokes
// use currentColor so it inherits the surrounding ink and works in dark mode.
function sparkline(series) {
  if (series.length < 2) return '';
  const W = 120;
  const H = 30;
  const P = 3;
  const totals = series.map((s) => s.total);
  const min = Math.min(...totals);
  const max = Math.max(...totals);
  const span = max - min || 1;
  const stepX = (W - P * 2) / (series.length - 1);
  const pts = series.map((s, i) => {
    const x = P + i * stepX;
    const y = P + (H - P * 2) * (1 - (s.total - min) / span);
    return [x, y];
  });
  const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  return `
    <svg class="fin-spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
         role="img" aria-label="Net worth trend">
      <path d="${d}" fill="none" stroke="currentColor" stroke-width="1.4"
            stroke-linecap="round" stroke-linejoin="round" opacity="0.75"/>
      <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.2" fill="currentColor"/>
    </svg>`;
}

// ---- net-worth section ----

function networthSection() {
  const series = networthSeries(store.entities);
  const snapshots = store.all('finance')
    .filter((e) => e.extra?.kind === 'networth' && (e.date || ''))
    .sort((a, b) => ((a.date || '') > (b.date || '') ? -1 : 1)); // newest first

  const header = `
    <div class="fin-sec-head">
      <h2 class="fin-sec-title">Net worth</h2>
      ${series.length >= 2 ? `<span class="fin-spark-wrap">${sparkline(series)}</span>` : ''}
      <span class="spacer"></span>
      <button class="fin-txt-btn" data-action="add-snapshot">+ snapshot</button>
    </div>`;

  if (!snapshots.length) {
    return `
      <section class="fin-section">
        ${header}
        <div class="empty fin-empty">No snapshots yet. Record what your accounts
        total today, then again next month — the line will tell the story.</div>
      </section>`;
  }

  const latestId = snapshots[0].id; // newest = the swiped total
  const rows = snapshots.map((s) => {
    const total = snapshotTotal(s);
    const isLatest = s.id === latestId;
    const accounts = s.extra?.accounts || [];
    const accStr = accounts.map((a) => escapeHtml(a.name || 'account')).join(' · ');
    return `
      <div class="fin-nw-row" data-id="${escapeHtml(s.id)}">
        <span class="fin-nw-date">${escapeHtml(fmtDate(s.date))}</span>
        <span class="fin-nw-accounts">${accStr}</span>
        <span class="fin-nw-dash"></span>
        <span class="fin-nw-total ${isLatest ? 'swipe' : ''}">${money(total)}</span>
        <button class="fin-txt-btn fin-nw-edit" data-action="edit-snapshot">edit</button>
      </div>`;
  }).join('');

  return `
    <section class="fin-section">
      ${header}
      <div class="fin-nw-ledger">${rows}</div>
    </section>`;
}

// ---- bills section ----

function billsSection() {
  const bills = store.all('finance')
    .filter((e) => e.extra?.kind === 'bill')
    .sort((a, b) => (a.extra?.dueDay || 0) - (b.extra?.dueDay || 0) || a.title.localeCompare(b.title));

  const header = `
    <div class="fin-sec-head">
      <h2 class="fin-sec-title">Bills</h2>
      <span class="spacer"></span>
      <button class="fin-txt-btn" data-action="add-bill">+ bill</button>
    </div>`;

  if (!bills.length) {
    return `
      <section class="fin-section">
        ${header}
        <div class="empty fin-empty">No recurring bills tracked. Add the ones you
        pay on a schedule so nothing slips.</div>
      </section>`;
  }

  const rows = bills.map((b) => {
    const amount = Number(b.extra?.amount);
    const cadence = b.extra?.cadence === 'yearly' ? 'yearly' : 'monthly';
    const dueDay = b.extra?.dueDay;
    const dueStr = dueDay ? `due the ${ordinal(dueDay)}` : '';
    return `
      <div class="fin-bill-row" data-id="${escapeHtml(b.id)}">
        <span class="fin-bill-name">${escapeHtml(b.title)}</span>
        <span class="fin-bill-meta">${escapeHtml(cadence)}${dueStr ? ' · ' + dueStr : ''}</span>
        <span class="fin-bill-dash"></span>
        <span class="fin-bill-amount">${money(amount)}</span>
        <button class="fin-txt-btn fin-bill-edit" data-action="edit-bill">edit</button>
      </div>`;
  }).join('');

  return `
    <section class="fin-section">
      ${header}
      <div class="fin-bills">${rows}</div>
    </section>`;
}

// ---- budget section ----

// Newest budget month present, or the current month if none.
function defaultBudgetMonth() {
  const budgets = store.all('finance').filter((e) => e.extra?.kind === 'budget');
  if (!budgets.length) return todayKey().slice(0, 7);
  return budgets
    .map((b) => b.extra?.month || '')
    .filter(Boolean)
    .sort()
    .pop() || todayKey().slice(0, 7);
}

function budgetForMonth(month) {
  return store.all('finance').find((e) => e.extra?.kind === 'budget' && e.extra?.month === month) || null;
}

function budgetSection() {
  const month = ui.budgetMonth || defaultBudgetMonth();
  const entity = budgetForMonth(month);
  const monthKey = month + '-01';

  const header = `
    <div class="fin-sec-head">
      <h2 class="fin-sec-title">Budget</h2>
      <span class="fin-month-picker">
        <button class="fin-month-nav" data-action="budget-prev" aria-label="Previous month">‹</button>
        <span class="fin-month-label">${escapeHtml(fmtMonthYear(monthKey))}</span>
        <button class="fin-month-nav" data-action="budget-next" aria-label="Next month">›</button>
      </span>
      <span class="spacer"></span>
      <button class="fin-txt-btn" data-action="edit-budget">${entity ? 'edit' : '+ set budget'}</button>
    </div>`;

  if (!entity || !(entity.extra?.lines || []).length) {
    return `
      <section class="fin-section">
        ${header}
        <div class="empty fin-empty">No budget set for ${escapeHtml(fmtMonthYear(monthKey))}.
        Lay out categories with a planned amount, then fill in the actuals as they land.</div>
      </section>`;
  }

  const lines = entity.extra.lines;
  const totals = budgetTotals(entity);

  const body = lines.map((l) => {
    const planned = Number(l.planned);
    const actual = Number(l.actual);
    const over = Number.isFinite(actual) && Number.isFinite(planned) && actual > planned;
    const overBy = over ? actual - planned : 0;
    return `
      <div class="fin-budget-row ${over ? 'is-over' : ''}">
        <span class="fin-budget-cat">${escapeHtml(l.category || 'category')}</span>
        <span class="fin-budget-planned">${money(planned)}</span>
        <span class="fin-budget-actual">${money(actual)}</span>
        ${over ? `<span class="fin-budget-over">over by ${money(overBy)}</span>` : '<span class="fin-budget-over"></span>'}
      </div>`;
  }).join('');

  return `
    <section class="fin-section">
      ${header}
      <div class="fin-budget">
        <div class="fin-budget-row fin-budget-headrow">
          <span class="fin-budget-cat">category</span>
          <span class="fin-budget-planned">planned</span>
          <span class="fin-budget-actual">actual</span>
          <span class="fin-budget-over"></span>
        </div>
        ${body}
        <div class="fin-budget-row fin-budget-totalrow ${totals.over ? 'is-over' : ''}">
          <span class="fin-budget-cat">total</span>
          <span class="fin-budget-planned">${money(totals.planned)}</span>
          <span class="fin-budget-actual">${money(totals.actual)}</span>
          ${totals.over ? `<span class="fin-budget-over">${money(totals.actual - totals.planned)} over plan</span>` : '<span class="fin-budget-over"></span>'}
        </div>
      </div>
    </section>`;
}

// ---- draw + wiring ----

function draw(container) {
  container.innerHTML = `
    <div class="view-head">
      <h1>Finance</h1>
      <span class="spacer"></span>
    </div>
    <div class="fin-sections">
      ${networthSection()}
      ${billsSection()}
      ${budgetSection()}
    </div>`;
}

export function render(container) {
  container.addEventListener('click', (ev) => {
    const action = ev.target.closest('[data-action]')?.dataset.action;
    if (!action) return;

    if (action === 'add-snapshot') { openSnapshotModal(null); return; }
    if (action === 'edit-snapshot') {
      const id = ev.target.closest('[data-id]')?.dataset.id;
      const e = id && store.get(id);
      if (e) openSnapshotModal(e);
      return;
    }
    if (action === 'add-bill') { openBillModal(null); return; }
    if (action === 'edit-bill') {
      const id = ev.target.closest('[data-id]')?.dataset.id;
      const e = id && store.get(id);
      if (e) openBillModal(e);
      return;
    }
    if (action === 'budget-prev' || action === 'budget-next') {
      const cur = ui.budgetMonth || defaultBudgetMonth();
      ui.budgetMonth = addMonths(cur + '-01', action === 'budget-next' ? 1 : -1).slice(0, 7);
      draw(container);
      return;
    }
    if (action === 'edit-budget') {
      const month = ui.budgetMonth || defaultBudgetMonth();
      openBudgetModal(budgetForMonth(month), month);
    }
  });

  draw(container);
}

// ===================================================================
// Modals — own builds, mirroring taskModal.js structure/classes.
// ===================================================================

let overlay = null;

function onKey(e) {
  if (e.key === 'Escape') closeModal();
}

function closeModal() {
  overlay?.remove();
  overlay = null;
  document.removeEventListener('keydown', onKey);
}

function mountModal(html, focusSel) {
  closeModal();
  overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = html;
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) closeModal();
    if (ev.target.closest('[data-close]')) closeModal();
  });
  document.addEventListener('keydown', onKey);
  document.getElementById('modal-root').appendChild(overlay);
  const el = focusSel && overlay.querySelector(focusSel);
  el?.focus();
  return (sel) => overlay.querySelector(sel);
}

function deleteWithUndo(entity) {
  const removed = store.remove(entity.id);
  closeModal();
  if (removed) {
    showToast(`Deleted "${removed.title}"`, {
      actionLabel: 'Undo',
      onAction: () => store.restore(removed),
    });
  }
}

// ---- net-worth snapshot modal (dynamic account rows: name + amount) ----

function accountRow(a = {}) {
  const row = document.createElement('div');
  row.className = 'fin-acct-row';
  row.dataset.aid = a.id || uid();
  row.innerHTML = `
    <input type="text" class="fin-acct-name" placeholder="Account…" autocomplete="off">
    <input type="text" class="fin-acct-amount" inputmode="decimal" placeholder="0" autocomplete="off">
    <button type="button" class="icon-btn" title="Remove">✕</button>`;
  row.querySelector('.fin-acct-name').value = a.name || '';
  row.querySelector('.fin-acct-amount').value = a.amount != null ? String(a.amount) : '';
  row.querySelector('button').addEventListener('click', () => row.remove());
  return row;
}

function openSnapshotModal(entity = null) {
  const isNew = !entity;
  const e = entity || { type: 'finance', title: '', date: todayKey(), extra: { kind: 'networth', accounts: [] } };
  const accounts = e.extra?.accounts || [];

  const $ = mountModal(`
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <span class="modal-type">${isNew ? 'New snapshot' : 'Edit snapshot'}</span>
        <span class="spacer"></span>
        <button type="button" class="icon-btn" data-close title="Close (Esc)">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <label>Date<input type="date" id="s-date"></label>
        </div>
        <div id="accounts-section">
          <div class="section-label">Accounts</div>
          <div id="account-list"></div>
          <button type="button" id="add-account" class="ghost-btn">+ Add account</button>
        </div>
        <div class="fin-modal-total">total <span id="s-total">0</span></div>
      </div>
      <div class="modal-foot">
        ${isNew ? '' : '<button type="button" id="s-delete" class="danger-btn">Delete</button>'}
        <span class="spacer"></span>
        <button type="button" class="ghost-btn" data-close>Cancel</button>
        <button type="button" id="s-save" class="primary-btn">${isNew ? 'Add' : 'Save'}</button>
      </div>
    </div>`, '#s-date');

  $('#s-date').value = (e.date || todayKey()).slice(0, 10);

  const list = $('#account-list');
  const recomputeTotal = () => {
    let sum = 0;
    for (const row of list.children) {
      const n = parseFloat(row.querySelector('.fin-acct-amount').value);
      if (Number.isFinite(n)) sum += n;
    }
    $('#s-total').textContent = money(sum);
  };
  list.addEventListener('input', recomputeTotal);
  list.addEventListener('click', recomputeTotal);

  if (accounts.length) {
    for (const a of accounts) list.appendChild(accountRow(a));
  } else {
    list.appendChild(accountRow({}));
  }
  recomputeTotal();

  $('#add-account').addEventListener('click', () => {
    const row = accountRow({});
    list.appendChild(row);
    row.querySelector('.fin-acct-name').focus();
    recomputeTotal();
  });

  $('#s-save').addEventListener('click', () => {
    const date = $('#s-date').value || todayKey();
    const accts = [...list.children].map((row) => {
      const name = row.querySelector('.fin-acct-name').value.trim();
      const raw = parseFloat(row.querySelector('.fin-acct-amount').value);
      return { id: row.dataset.aid, name, amount: Number.isFinite(raw) ? raw : 0 };
    }).filter((a) => a.name || a.amount);

    const patch = {
      type: 'finance',
      title: `Net worth ${date}`,
      date,
      extra: { ...(entity?.extra || {}), kind: 'networth', accounts: accts },
    };
    if (isNew) store.add(patch);
    else store.update(entity.id, patch);
    closeModal();
  });

  if (!isNew) $('#s-delete').addEventListener('click', () => deleteWithUndo(entity));
}

// ---- bill modal ----

function openBillModal(entity = null) {
  const isNew = !entity;
  const e = entity || { type: 'finance', title: '', extra: { kind: 'bill', amount: 0, cadence: 'monthly', dueDay: 1 } };

  const $ = mountModal(`
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <span class="modal-type">${isNew ? 'New bill' : 'Edit bill'}</span>
        <span class="spacer"></span>
        <button type="button" class="icon-btn" data-close title="Close (Esc)">✕</button>
      </div>
      <div class="modal-body">
        <input id="b-title" placeholder="Bill name" autocomplete="off">
        <div class="form-grid">
          <label>Amount<input type="text" id="b-amount" inputmode="decimal" placeholder="0"></label>
          <label>Cadence
            <select id="b-cadence">
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
          <label>Due day (1–31)<input type="number" id="b-dueday" min="1" max="31" value="1"></label>
        </div>
      </div>
      <div class="modal-foot">
        ${isNew ? '' : '<button type="button" id="b-delete" class="danger-btn">Delete</button>'}
        <span class="spacer"></span>
        <button type="button" class="ghost-btn" data-close>Cancel</button>
        <button type="button" id="b-save" class="primary-btn">${isNew ? 'Add' : 'Save'}</button>
      </div>
    </div>`, '#b-title');

  $('#b-title').value = e.title || '';
  $('#b-amount').value = e.extra?.amount != null ? String(e.extra.amount) : '';
  $('#b-cadence').value = e.extra?.cadence === 'yearly' ? 'yearly' : 'monthly';
  $('#b-dueday').value = e.extra?.dueDay || 1;

  $('#b-save').addEventListener('click', () => {
    const title = $('#b-title').value.trim();
    if (!title) {
      $('#b-title').classList.add('invalid');
      $('#b-title').focus();
      return;
    }
    const rawAmount = parseFloat($('#b-amount').value);
    const rawDue = parseInt($('#b-dueday').value, 10);
    const patch = {
      type: 'finance',
      title,
      extra: {
        ...(entity?.extra || {}),
        kind: 'bill',
        amount: Number.isFinite(rawAmount) ? rawAmount : 0,
        cadence: $('#b-cadence').value === 'yearly' ? 'yearly' : 'monthly',
        dueDay: Number.isFinite(rawDue) ? Math.min(31, Math.max(1, rawDue)) : 1,
      },
    };
    if (isNew) store.add(patch);
    else store.update(entity.id, patch);
    closeModal();
  });

  if (!isNew) $('#b-delete').addEventListener('click', () => deleteWithUndo(entity));
}

// ---- budget modal (dynamic category lines: category + planned + actual) ----

function budgetLineRow(l = {}) {
  const row = document.createElement('div');
  row.className = 'fin-bl-row';
  row.dataset.lid = l.id || uid();
  row.innerHTML = `
    <input type="text" class="fin-bl-cat" placeholder="Category…" autocomplete="off">
    <input type="text" class="fin-bl-planned" inputmode="decimal" placeholder="planned" autocomplete="off">
    <input type="text" class="fin-bl-actual" inputmode="decimal" placeholder="actual" autocomplete="off">
    <button type="button" class="icon-btn" title="Remove">✕</button>`;
  row.querySelector('.fin-bl-cat').value = l.category || '';
  row.querySelector('.fin-bl-planned').value = l.planned != null ? String(l.planned) : '';
  row.querySelector('.fin-bl-actual').value = l.actual != null ? String(l.actual) : '';
  row.querySelector('button').addEventListener('click', () => row.remove());
  return row;
}

function openBudgetModal(entity, month) {
  const isNew = !entity;
  const e = entity || { type: 'finance', title: '', extra: { kind: 'budget', month, lines: [] } };
  const lines = e.extra?.lines || [];
  const m = e.extra?.month || month;

  const $ = mountModal(`
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <span class="modal-type">Budget — ${escapeHtml(fmtMonthYear(m + '-01'))}</span>
        <span class="spacer"></span>
        <button type="button" class="icon-btn" data-close title="Close (Esc)">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <label>Month<input type="month" id="bg-month"></label>
        </div>
        <div id="lines-section">
          <div class="section-label">Categories — planned vs actual</div>
          <div id="line-list"></div>
          <button type="button" id="add-line" class="ghost-btn">+ Add category</button>
        </div>
      </div>
      <div class="modal-foot">
        ${isNew ? '' : '<button type="button" id="bg-delete" class="danger-btn">Delete</button>'}
        <span class="spacer"></span>
        <button type="button" class="ghost-btn" data-close>Cancel</button>
        <button type="button" id="bg-save" class="primary-btn">${isNew ? 'Add' : 'Save'}</button>
      </div>
    </div>`, '#bg-month');

  $('#bg-month').value = m;

  const list = $('#line-list');
  if (lines.length) {
    for (const l of lines) list.appendChild(budgetLineRow(l));
  } else {
    list.appendChild(budgetLineRow({}));
  }

  $('#add-line').addEventListener('click', () => {
    const row = budgetLineRow({});
    list.appendChild(row);
    row.querySelector('.fin-bl-cat').focus();
  });

  $('#bg-save').addEventListener('click', () => {
    const pickedMonth = $('#bg-month').value || m;
    const outLines = [...list.children].map((row) => {
      const category = row.querySelector('.fin-bl-cat').value.trim();
      const p = parseFloat(row.querySelector('.fin-bl-planned').value);
      const a = parseFloat(row.querySelector('.fin-bl-actual').value);
      return {
        id: row.dataset.lid,
        category,
        planned: Number.isFinite(p) ? p : 0,
        actual: Number.isFinite(a) ? a : 0,
      };
    }).filter((l) => l.category);

    // Only one budget per month: if the month moved onto an existing budget,
    // merge into that entity rather than creating a duplicate.
    const collision = store.all('finance')
      .find((x) => x.extra?.kind === 'budget' && x.extra?.month === pickedMonth && x.id !== entity?.id);

    const patch = {
      type: 'finance',
      title: `Budget ${pickedMonth}`,
      extra: { ...(entity?.extra || {}), kind: 'budget', month: pickedMonth, lines: outLines },
    };

    if (collision) {
      store.update(collision.id, patch);
      if (entity && entity.id !== collision.id) store.remove(entity.id);
    } else if (isNew) {
      store.add(patch);
    } else {
      store.update(entity.id, patch);
    }
    ui.budgetMonth = pickedMonth;
    closeModal();
  });

  if (!isNew) $('#bg-delete').addEventListener('click', () => deleteWithUndo(entity));
}
