# Phase 3 Brief — contacts, reading, finance, bookmarks, trips

Same rules as every round (see docs/fieldnotes-brief.md for the binding design
language — paper/ink/red-pencil/marker, serif titles, mono marginalia, dashed
rules, square checks, NO emoji, tokens only, one marker swipe per screen max):
exclusive file ownership; no git; no servers/preview; restyle-grade quality;
the administrator integrates, tests, ships. Reference implementations:
js/views/habits.js (lines+modal), js/views/journal.js (thread), js/views/goals.js.

Every module is a filtered view over the same store (js/store.js API:
all/get/add/update/remove/restore + undo-toast pattern via js/toast.js).
Routing/nav/CSS links are already wired by the admin; replace your stubs.

## Data shapes (binding — the storage layer keys files off `type`)

### contact
{ type:'contact', title: name, notes, tags, extra: {
    lastContacted: 'YYYY-MM-DD' | null, nextFollowUp: 'YYYY-MM-DD' | null,
    email: '', phone: '' } }
- View: "follow-ups due" section first (nextFollowUp <= today, red-pencil
  annotation), then the ledger of people (serif name, mono last-contacted).
  One-tap "touched today" sets lastContacted = today (immutable extra spread).
  Own modal for CRUD.

### reading
{ type:'reading', title, notes, tags, status: 'todo'|'in-progress'|'done',
  extra: { author: '', source: '', takeaway: '' } }
- View: three bands — "to read" / "reading" / "finished" (mono stamp headers).
  Advancing to done prompts for a one-line takeaway (inline input or modal
  field). Finished entries show the takeaway as a serif-italic margin quote.

### finance (three kinds under one type; keep them simple)
{ type:'finance', title, date, extra: { kind: 'networth',
    accounts: [{ id, name, amount }] } }          // one snapshot per date
{ type:'finance', title, extra: { kind: 'bill', amount, cadence:
    'monthly'|'yearly', dueDay: 1..31 } }         // recurring bills list
{ type:'finance', title, extra: { kind: 'budget', month: 'YYYY-MM',
    lines: [{ id, category, planned, actual }] } }
- View: net-worth ledger (dated rows, mono amounts, latest total swiped — the
  screen's ONE highlight; a small inline SVG spark-line in ink is welcome),
  bills list (mono amounts + "due the Nth"), budget table (planned vs actual,
  over-budget lines annotated in red pencil). Amounts via
  Number.toLocaleString; parse inputs with parseFloat, store numbers.
- Calendar feed for bills is a LATER wave — do not touch calendar.js.

### bookmark
{ type:'bookmark', title, notes, tags, project, extra: { url } }
- View: grouped by project (color via projectClass from js/views/shared.js —
  import it, don't redefine), serif title linking out (target="_blank"
  rel="noopener", href escaped AND validated: only http/https URLs are
  rendered as links, anything else renders as plain text), mono domain
  marginalia. Quick-add line at top (url + title).

### trip
{ type:'trip', title, notes, date: start 'YYYY-MM-DD', dueDate: end
  'YYYY-MM-DD', extra: { checklist: [{ id, title, done }] } }
- View: upcoming trips as sections (serif destination, mono date-range stamp,
  "in N days" annotation), each with a packing/prep checklist reusing the
  square-check language (copy the subtask editor pattern from js/taskModal.js
  into your own modal). Past trips collapse into a quiet "past" group.

## Assignments

| Agent | Owns exactly |
|---|---|
| **Contacts + Reading** | js/views/contacts.js, css/contacts.css, js/views/reading.js, css/reading.css |
| **Finance + Bookmarks + Trips** | js/views/finance.js, css/finance.css, js/views/bookmarks.js, css/bookmarks.css, js/views/trips.js, css/trips.css |

Everything else is off-limits — especially js/taskModal.js, js/views/calendar.js,
css/calendar.css, js/views/dashboard.js (another agent is mid-flight there),
store.js/github.js (admin is restructuring storage concurrently — your store
API calls are stable, the persistence underneath is not your concern).

## Definition of done
Zero-data first-run states intentional; escapeHtml everywhere (URLs doubly);
pure/computational helpers exported for headless tests; mobile ≤760px; report
files written + your one-highlight choice + anything to verify.
