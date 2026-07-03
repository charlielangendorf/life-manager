# Field Notes Brief — the analog bullet-journal redesign

The owner picked the "Field notes" direction: the app should feel like a
well-kept paper planner — human, a little imperfect, warm — not a web app.
Same working rules as always: exclusive file ownership, no git, no servers or
preview tools; the administrator integrates, tests, and ships. **Restyle +
re-layout only: every handler, data shape, and exported pure function keeps
working identically** (the admin test suite verifies).

## The language (foundation already shipped in css/styles.css — build on it)

| Element | Treatment |
|---|---|
| Paper | `--bg` notebook cream; dark mode = paper by lamplight. No shadows (`--shadow: none`), tiny radii (3px) |
| Titles | serif (`--font-serif`) — task titles, headlines, entry bodies |
| Labels/meta | typewriter mono (`--font-mono`), lowercase or uppercase, letterspaced — dates, section headers, counts, stamps |
| Red pencil | `--accent`/`--danger` for annotations: overdue notes in serif ITALIC red, slightly rotated ("3 days late!") — never filled danger boxes |
| Marker swipe | `--highlight` is a LIGHT yellow background. The ONE highlight per screen is a swipe behind key text: `background: linear-gradient(0deg, var(--highlight) 46%, transparent 46%); padding: 0 3px;` — ink text on top, NEVER white text, never a solid filled chip |
| Checkboxes | square, 1.6px ink border, ±1.2° rotation (the shared `.check` is already restyled; reuse it) — checked = red-pencil ✕ |
| Rules | dashed `1px dashed var(--border)` separators, not solid; `.card` is now a dashed-rule section, not a box |
| Buttons | rubber stamps (already styled): mono uppercase, thin ink border |
| Streaks/tallies | text marks: `×××··` in `--green`, or small ink dots — not colored progress bars |
| Stamps | date chips: mono, 1px solid border, 3px radius, `transform: rotate(-1deg)` |
| Rotation | small elements only (checkboxes, stamps, annotations, tape). NEVER rotate text blocks wider than ~120px (subpixel blur). Keep grids straight |
| Icons | **NO EMOJI ANYWHERE.** Remove every emoji glyph from your views (including `iconFor()` usage — stop importing/rendering it; js/icons.js stays but unused). Differentiate by type/annotation instead. Typographic symbols (× ✕ · — ✓ ›) are fine |
| Wobble | for one hand-drawn underline/circle accent, inline SVG paths like `<svg width="44" height="5" viewBox="0 0 44 5"><path d="M1 3 C 11 1.5, 24 4.5, 43 2.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>` |

Chrome already converted by the admin (don't touch): tokens, sidebar (mono
nav + red wobbly underline), buttons, badges (now typewriter marginalia —
overdue is already a red serif-italic annotation), `.check`, `.card`, modal
(index card), toast (paper note), seg control, form inputs, search.

## Assignments (exclusive ownership — same as last round)

| Agent | Owns |
|---|---|
| **Dashboard + Focus** | `js/views/dashboard.js`, `css/dashboard.css`, `js/views/focus.js`, `css/focus.css` |
| **Habits + Goals** | `js/views/habits.js`, `css/habits.css`, `js/views/goals.js`, `css/goals.css` |
| **Tasks + Calendar + Journal** | `js/views/tasks.js`, `css/tasks.css`, `js/views/calendar.js`, `css/calendar.css`, `js/views/journal.js`, `css/journal.css`, `js/views/shared.js` |

Everything else is admin-owned. Rewrite your CSS files fully in the new
language (don't keep the old warm-terracotta rules).

## Hard invariants (test-checked at integration)

1. Handlers identical: check-offs, modals, undo toasts, filters, calendar
   navigation, quick-adds, expand/collapse, habit log writes (immutable).
2. `escapeHtml` on all user content.
3. Pure exports keep exact names/signatures (habits-logic consumers, goals'
   `milestoneStats`/`feedersFor`, journal's title/sort/group helpers,
   `entityRow`/`bindRows` and the `data-id`/`data-action="toggle"` contract).
4. Zero-data first-run states look intentional.
5. Mobile ≤760px works. 6. Tokens only — no raw hex (except `#fff`-class
   values already in the foundation). 7. No new deps, no web fonts.

## Definition of done

Your files restyled to field notes, all emoji gone from them, nothing else
touched. Report: files written, where your screen's single marker swipe went,
anything the admin should check.
