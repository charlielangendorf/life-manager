// GitHub connection, appearance, and data import/export.
import { store, loadSettings, saveSettings } from '../store.js';
import { sync } from '../github.js';
import { escapeHtml, download, todayKey } from '../utils.js';
import { setTheme } from '../theme.js';
import { showToast } from '../toast.js';

function toCsv(entities) {
  const cols = ['id', 'type', 'title', 'notes', 'project', 'tags', 'priority', 'status', 'date', 'dueDate', 'createdAt', 'updatedAt', 'extra'];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = entities.map((e) => cols.map((c) => {
    if (c === 'tags') return esc((e.tags || []).join('; '));
    if (c === 'extra') return esc(JSON.stringify(e.extra || {}));
    return esc(e[c]);
  }).join(','));
  return [cols.join(','), ...rows].join('\n');
}

export function render(container) {
  const s = loadSettings();
  container.innerHTML = `
    <div class="view-head"><h1>Settings</h1></div>

    <section class="card">
      <h2>GitHub sync</h2>
      <p class="hint">
        Your data is stored as a JSON file in a <b>private</b> GitHub repo via the Contents API,
        and every change becomes a commit — the repo history is your changelog.
        Create a <b>fine-grained personal access token</b> scoped to <i>only</i> that repo with
        <b>Contents: read &amp; write</b> permission (GitHub → Settings → Developer settings →
        Fine-grained tokens). The token lives in this browser's localStorage only — it is never
        committed or sent anywhere except api.github.com.
      </p>
      <div class="form-grid">
        <label>Owner<input id="s-owner" value="${escapeHtml(s.owner || '')}" placeholder="your-github-username" autocomplete="off"></label>
        <label>Data repo (private)<input id="s-repo" value="${escapeHtml(s.repo || '')}" placeholder="life-data" autocomplete="off"></label>
        <label>Branch<input id="s-branch" value="${escapeHtml(s.branch || '')}" placeholder="main (default branch if blank)" autocomplete="off"></label>
        <label>File path<input id="s-path" value="${escapeHtml(s.path || 'data.json')}" autocomplete="off"></label>
        <label class="full">Token<input id="s-token" type="password" value="${escapeHtml(s.token || '')}" placeholder="github_pat_…" autocomplete="off"></label>
      </div>
      <div class="btn-row">
        <button id="s-save" class="primary-btn">Save &amp; connect</button>
        <span id="s-msg" class="hint"></span>
      </div>
    </section>

    <section class="card">
      <h2>Appearance</h2>
      <div class="toolbar">
        <label>Theme
          <select id="s-theme">
            <option value="system" ${(s.theme || 'system') === 'system' ? 'selected' : ''}>System</option>
            <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Light</option>
            <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Dark</option>
          </select>
        </label>
      </div>
    </section>

    <section class="card">
      <h2>Data</h2>
      <p class="hint">${store.entities.length} items stored locally.</p>
      <div class="btn-row">
        <button id="s-export-json" class="ghost-btn">Export JSON</button>
        <button id="s-export-csv" class="ghost-btn">Export CSV</button>
        <label class="ghost-btn file-btn">Import JSON<input type="file" id="s-import" accept=".json,application/json" hidden></label>
        <button id="s-clear" class="danger-btn">Clear local cache</button>
      </div>
      <p class="hint">
        Exports are independent of the sync backend. "Clear local cache" wipes this browser's
        copy only — if GitHub sync is connected, data is re-pulled from the repo afterwards.
      </p>
    </section>
  `;

  const $ = (sel) => container.querySelector(sel);

  $('#s-save').addEventListener('click', async () => {
    saveSettings({
      owner: $('#s-owner').value.trim(),
      repo: $('#s-repo').value.trim(),
      branch: $('#s-branch').value.trim(),
      path: $('#s-path').value.trim() || 'data.json',
      token: $('#s-token').value.trim(),
    });
    sync.resetConnection();
    if (!sync.configured()) {
      $('#s-msg').textContent = 'Saved. Fill owner, repo, and token to enable sync.';
      return;
    }
    $('#s-msg').textContent = 'Connecting…';
    const ok = await sync.pull();
    $('#s-msg').textContent = ok
      ? 'Connected ✓ — data synced.'
      : `Connection failed: ${sync.statusDetail || 'unknown error'}`;
  });

  $('#s-theme').addEventListener('change', (ev) => setTheme(ev.target.value));

  $('#s-export-json').addEventListener('click', () => {
    download(`life-manager-${todayKey()}.json`, JSON.stringify(store.exportDoc(), null, 2));
  });

  $('#s-export-csv').addEventListener('click', () => {
    download(`life-manager-${todayKey()}.csv`, toCsv(store.entities), 'text/csv');
  });

  $('#s-import').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const doc = JSON.parse(await file.text());
      if (!Array.isArray(doc.entities)) throw new Error('missing "entities" array');
      const before = store.entities.length;
      store.mergeRemote(doc);
      sync.markDirty('Import data');
      showToast(`Imported — ${store.entities.length - before} new items merged.`);
    } catch (err) {
      showToast(`Import failed: ${err.message}`);
    }
  });

  $('#s-clear').addEventListener('click', async () => {
    if (!confirm('Clear this browser\'s local copy of all data? If GitHub sync is connected it will be re-pulled; otherwise this erases everything.')) return;
    store.clearLocal();
    if (sync.configured()) {
      sync.resetConnection();
      await sync.pull();
      showToast('Local cache cleared — data re-pulled from GitHub.');
    } else {
      showToast('Local data cleared.');
    }
  });
}
