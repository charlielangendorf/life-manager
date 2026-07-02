# Redesign Brief — "warm, flowing, hierarchy-driven"

Contract for the redesign agents. Same rules as Phase 2: exclusive file
ownership, no git commits/pushes, no servers or preview tools — the
administrator integrates, tests, and ships. **This is a restyle + re-layout
pass: all existing functionality, data shapes, store calls, and exported pure
function signatures must keep working exactly as they do now.** The headless
test suite runs against those exports after you finish.

## The design direction (from the owner — binding)

Warm and personal, not sterile or corporate. Minimal in spirit (breathing
room, no clutter) but cozy in tone (rounded shapes, warm color, human touches).

- **Color:** warm palette — terracotta, amber, a touch of pink — on muted,
  low-saturation surfaces. **ONE saturated color moment per screen** (the thing
  that matters most right now), not five equally-loud elements. Thin accents
  (left border, icon tint) beat filled blocks. Color marks meaning, never
  decoration.
- **Layout (matters most):** avoid rows of identical, equally-sized boxes.
  One hero element, then supporting detail. Prefer **flow/sequence over static
  grids** for anything time-based — a vertical timeline with a connecting line
  and nodes feels alive where a flat list feels dead. Lead with a big human
  headline ("3 things left today"), not a wall of numeric stat cards — stats
  support the headline. Represent streaks/progress visually (scannable dot
  rows beat a bare number in a box). Asymmetry is fine and often better.
- **Icons should match what content IS** — use `iconFor(entity)` from
  `js/icons.js` (returns an emoji or `null`; on `null`, use your view's own
  fallback marker: a node, a dot, a tinted first letter).
- **Avoid:** uniform card grids, numbers-in-boxes as the lead visual, color
  as uniform decoration, sterile all-gray minimalism.

Reinterpret per view — views must share the instinct, not the same layout.

## Foundation already in place (administrator-owned — build on it, don't edit it)

- `css/styles.css` tokens are now warm: `--bg` (paper), `--surface`,
  `--surface-2`, `--border`, `--text`, `--text-dim`, `--accent` (terracotta),
  `--accent-soft`, **`--highlight`** (the one saturated moment — use it exactly
  once per screen), `--amber`, `--pink`, `--danger`, `--green` (olive),
  `--radius` (14px), `--font-serif` (warm serif for headlines/hero text).
  Both themes are done; use tokens only and dark mode is automatic.
- Buttons are now pill-shaped; `h1`s are serif. Shared chrome (sidebar,
  topbar, modal, toast, badges) is already restyled.
- `js/icons.js` → `iconFor(entity)`.

A ready-to-adapt timeline pattern (copy into your own css file and adjust):

```css
.timeline { position: relative; padding-left: 30px; }
.timeline::before { content: ''; position: absolute; left: 10px; top: 8px; bottom: 8px;
  width: 2px; background: var(--border); border-radius: 2px; }
.tl-item { position: relative; padding: 10px 0; }
.tl-item::before { content: ''; position: absolute; left: -26px; top: 14px;
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--surface); border: 2px solid var(--accent); }
```

## Assignments (exclusive ownership)

| Agent | Owns |
|---|---|
| **Dashboard + Focus** | `js/views/dashboard.js`, `css/dashboard.css`, `js/views/focus.js`, `css/focus.css` |
| **Habits + Goals** | `js/views/habits.js`, `css/habits.css`, `js/views/goals.js`, `css/goals.css` |
| **Tasks + Calendar + Journal** | `js/views/tasks.js`, `css/tasks.css`, `js/views/calendar.js`, `css/calendar.css`, `js/views/journal.js`, `css/journal.css`, `js/views/shared.js` |

Everything else is off-limits (index.html, app.js, styles.css, store/models/
utils/theme/toast/taskModal, settings view, icons.js, tests, docs).

Notes:
- The dashboard agent should render its **own row markup** (timeline nodes
  etc.) rather than importing `entityRow` from shared.js — that function is
  being restyled concurrently by the tasks agent. Keep using
  `js/habits-logic.js` functions for the dashboard habit card's logic.
- The tasks agent owns `shared.js` (`entityRow`/`bindRows`): keep both export
  names and the `data-id` / `data-action="toggle"` contract — other views
  (calendar day view) call them.
- Old rules for your view in `css/styles.css` stay put (other views share some
  classes). Your stylesheet loads after it, so introduce your own class names
  for new markup and override freely; don't rename shared classes you keep.

## Hard functional invariants (checked at integration)

1. Every handler keeps working: check-offs, modals, undo toasts, filters,
   calendar navigation, quick-adds, expand/collapse.
2. All user content still passes through `escapeHtml`.
3. Pure exports keep their exact names/signatures (habits-logic, goals'
   `milestoneStats`/`feedersFor`, journal's title/sort/group helpers).
4. Zero-data first-run states still look intentional — warmer now.
5. Mobile (≤760px) still works; test your layouts mentally at ~380px width.
6. No new dependencies, no web fonts (the serif stack is system-based).

## Definition of done

Files in your assignment restyled per the direction, nothing else touched,
report back: files written, your "one saturated moment" choice per screen,
any layout decisions worth flagging, anything the administrator should check.
