# Life Manager

A personal life-management web app — combined to-do list, calendar, and organizer —
that runs entirely client-side and uses **GitHub itself as the backend**: your data
lives as a JSON file in a private repo, read and written through the GitHub Contents
API. No server, no database, no paid services.

Plain HTML/CSS/JS with ES modules — **no build step**. The folder deploys to GitHub
Pages as-is.

## Phase 1 features (implemented)

- **Tasks** — title, notes, due date + optional time, priority, project, tags,
  subtask checklists, recurring tasks (daily/weekly/monthly, every N)
- **Calendar** — month / week / day views; tasks appear on their due date, events on
  their date; click any day to add an item there
- **Dashboard ("Today")** — overdue, today's schedule, due today, next 7 days,
  completed today, plus a quick-add box
- **Global search** across everything; filter/sort tasks by project, tag, priority,
  due date
- **GitHub sync** — local-first with optimistic updates, debounced background
  commits, sha-checked writes with automatic merge on conflict, offline queue with
  retry, and a live sync-status indicator (saved / syncing… / offline / error)
- **Undo** for deletes, light/dark/system theme, mobile-responsive layout,
  keyboard shortcuts (`n` new item, `/` search), JSON/CSV export

## Setup

### 1. Two repos

GitHub Pages needs a public repo (on the free plan), but your data must stay
private — so use two:

| Repo | Visibility | Contents |
|---|---|---|
| `life-manager` (this code) | public | the app, served by GitHub Pages |
| `life-data` | **private** | one `data.json` file, written by the app |

Create the private data repo empty (a README is fine) — the app creates
`data.json` on first sync.

### 2. Deploy the app

Push this folder to your app repo, then in the repo: **Settings → Pages →
Deploy from a branch → `main` / root**. Your app is at
`https://<you>.github.io/life-manager/`.

### 3. Token

GitHub → **Settings → Developer settings → Fine-grained personal access tokens →
Generate new token**:

- **Repository access:** *Only select repositories* → your data repo, nothing else
- **Permissions:** Contents → **Read and write**

### 4. Connect

Open the app → **Settings** → enter owner, data repo name, and the token →
**Save & connect**. The token is stored in your browser's localStorage only; it is
never committed and never sent anywhere except `api.github.com`.

## Local development

No toolchain needed — serve the folder and open it:

```sh
python3 -m http.server 8000
# then http://localhost:8000
```

Run the logic smoke tests (date math, recurrence, store merge/undo) with Node:

```sh
node test/smoke.mjs
```

## How sync works

- Every edit is applied to the in-memory store and localStorage immediately
  (optimistic), then a debounced background push commits the whole doc to the data
  repo. Commit messages summarize the change, so the repo history doubles as a
  changelog.
- Writes include the file's last-known `sha`; if GitHub rejects it (something else
  committed in between), the app pulls, does an entity-level last-write-wins merge
  (deletes carry timestamped tombstones), and retries once.
- Offline or failed pushes keep the dirty state locally and retry — and the startup
  pull re-detects unsynced local changes, so nothing is lost between sessions.

## Data model

One flexible base entity shape for every module, stored as a single JSON doc:

```js
{
  id, type,          // "task" | "event" | (later: habit, goal, contact, reading,
                     //  journal, bookmark, trip, finance)
  title, notes,
  date, dueDate,     // events use date, tasks use dueDate
  tags: [], project, priority, status,
  linkedTo: [],
  createdAt, updatedAt,
  extra: {}          // type-specific: { recurrence, subtasks, completedAt, ... }
}
```

Later modules (habits, goals, finance…) are filtered views of the same store —
add a view file under `js/views/`, register it in `js/app.js`, done.

## Code layout

```
index.html            app shell
css/styles.css        theme tokens + all styling (light/dark via CSS variables)
js/
  app.js              routing, global search, sync wiring, shortcuts
  store.js            local-first entity store, undo tombstones, merge logic
  github.js           Contents API sync engine (sha handling, debounce, retry)
  models.js           base entity factory + recurrence logic
  taskModal.js        create/edit modal for tasks and events
  theme.js, toast.js, utils.js
  views/              one module per screen: dashboard, tasks, calendar, settings
test/smoke.mjs        Node tests for the DOM-free logic
```

## Roadmap (from the spec)

- **Phase 2:** habits + streaks, goals linked to tasks/habits, journal/weekly
  review, focus mode
- **Phase 3:** contacts, reading library, finance snapshot, links vault, trip
  checklists, natural-language quick-add, drag-and-drop
