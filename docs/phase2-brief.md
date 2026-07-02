# Phase 2 Engineering Brief

Contract for the Phase 2 module agents. The administrator owns integration;
each agent owns exactly the files listed in their assignment. **Do not edit any
file outside your assignment. Do not run git commit/push. Do not start servers
or preview tools — the administrator does all runtime QA.**

## The app in 60 seconds

Vanilla-JS ES-module SPA, no build step, deployed to GitHub Pages. All data is
"entities" in one store ([js/store.js](../js/store.js)), persisted to
localStorage and synced to a private GitHub repo as JSON. Every module is a
filtered view over the same entity shape:

```js
{ id, type, title, notes, date, dueDate, tags: [], project, priority,
  status, linkedTo: [], createdAt, updatedAt, extra: {} }
```

## Store API (js/store.js — read-only for agents)

- `store.all(type)` / `store.get(id)` / `store.add(partial)` /
  `store.update(id, patch)` / `store.remove(id)` (returns removed entity for
  undo) / `store.restore(entity)` / `store.toggleComplete(id)`
- Any store change triggers a **full re-render of the active view** via app.js.
  You never subscribe yourself.
- Deletes must offer undo: `showToast('Deleted "…"', { actionLabel: 'Undo',
  onAction: () => store.restore(removed) })` (see js/taskModal.js).

## View contract (see js/views/tasks.js as the reference implementation)

- Export `render(container)`. The container is a **fresh node on every
  render**, so attach delegated listeners directly to it — they never stack.
- Build HTML with template strings; pass **all** user content through
  `escapeHtml()` from js/utils.js.
- Keep filter/sort/UI state in module-level variables so it survives
  re-renders. If only your internal UI state changes (no store change), redraw
  via your own `draw(container)`.
- Modals: build your own in your module file, copying the structure/classes of
  js/taskModal.js (`.modal-overlay`, `.modal`, `.modal-head/body/foot`,
  `.form-grid`, `.primary-btn`, `.ghost-btn`, `.danger-btn`). Append to
  `#modal-root`, close on Esc/backdrop.
- Reuse existing CSS: `.view-head`, `.card`, `.rows`, `.row`, `.badge`,
  `.toolbar`, `.empty`, `.hint`, `.seg`. Module-specific styles go **only** in
  your own CSS file, using the theme tokens (`var(--surface)`, `--border`,
  `--text-dim`, `--accent`, `--accent-soft`, `--green`, `--amber`, `--danger`)
  so dark mode works automatically.
- Dates are local-time strings `YYYY-MM-DD`; helpers in js/utils.js
  (`todayKey`, `addDays`, `startOfWeekKey`, `fmtDate`, `relativeDue`, …).

## Data shape contracts (must match exactly — other modules rely on them)

### habit
```js
{ type: 'habit', title, notes, tags, linkedTo: [goalId?], extra: {
    frequency: 'daily' | 'weekly',
    weeklyTarget: 1..7,            // weekly only, default 1
    log: { 'YYYY-MM-DD': { done: true, note: '' } }  // one key per checked day
} }
```
- Check-off toggles `log[dayKey]` via `store.update(id, { extra: {...} })`.
- Daily streak: consecutive checked days ending today (or yesterday, if today
  is unchecked). Weekly streak: consecutive weeks (Sunday-start,
  `startOfWeekKey`) meeting `weeklyTarget`; the current week counts if already
  met, otherwise streak is measured through last week.
- Completion %: checked/expected over the last 30 days (daily) or last 12
  weeks (weekly).

### goal
```js
{ type: 'goal', title, notes, dueDate,   // dueDate = target date, optional
  status: 'todo' | 'done', extra: {
    milestones: [{ id, title, targetDate, done }]
} }
```
- "Feeders" are entities whose `linkedTo` **contains the goal's id** (tasks and
  habits point at goals — not the other way around).

### journal
```js
{ type: 'journal', title, notes,          // notes = the entry body
  date: 'YYYY-MM-DD', extra: {
    kind: 'daily' | 'weekly-review',
    review?: { wentWell: '', slipping: '', nextFocus: '' }  // weekly-review only
} }
```
- Auto-title entries: `Journal — Jul 2` / `Weekly review — week of Jun 28`.

## Assignments (exclusive file ownership)

| Agent | Owns (create/edit) |
|---|---|
| **Habits** | `js/views/habits.js`, `js/habits-logic.js`, `css/habits.css`, plus **one added section** in `js/views/dashboard.js` (habits to check off today) |
| **Goals** | `js/views/goals.js`, `css/goals.css`, plus small additive edits to `js/taskModal.js` (goal-link select) and `js/views/shared.js` (goal badge on rows) |
| **Journal** | `js/views/journal.js`, `css/journal.css`, `js/views/focus.js`, `css/focus.css` |

Everything else — index.html, app.js, styles.css, store.js, github.js,
models.js, utils.js, theme.js, toast.js, calendar.js, tasks.js, settings.js,
README, tests — is **administrator-owned. Hands off.** Routing and nav for
your view are already wired; your stub file just needs replacing.

## Definition of done (each agent)

1. Files in your assignment implemented, nothing else touched
   (`git status` shows only your files).
2. All user content escaped; all deletes undoable; empty states handled
   (first-run experience with zero entities must look intentional).
3. Pure computation (streaks, percentages) lives in DOM-free functions so the
   administrator can test it headlessly.
4. Report back: files written, data-shape decisions, anything the
   administrator must check during integration.
