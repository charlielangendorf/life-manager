// GitHub Contents API sync — per-module files.
//
// Remote storage is split into one JSON file per module (tasks.json,
// habits.json, …; see DATA_FILES in store.js). Each file carries its own sha
// so a write only conflicts with concurrent edits to the SAME module, commits
// stay small and legible, and files never grow past what one module holds.
// Writes are debounced, only dirty files are pushed, and each commit message
// summarizes that file's pending changes — history doubles as a changelog.
//
// Migration: a repo still holding a single legacy data.json (v1 layout) is
// read once, merged, and re-pushed as per-module files. The legacy file is
// left in place (ignored) so old clients can't lose data.
import { store, loadSettings, DATA_FILES, LEGACY_FILE } from './store.js';
import { debounce } from './utils.js';

const API = 'https://api.github.com';

function encodeBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function decodeBase64(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

class GitHubSync {
  constructor() {
    this.status = 'local'; // local | syncing | saved | offline | error
    this.statusDetail = '';
    this.statusListeners = new Set();
    this.shas = {};             // file -> sha of last-known remote content
    this.dirtyFiles = new Set();
    this.pendingByFile = {};    // file -> [change labels]
    this.pushing = false;
    this.queueAgain = false;
    this.lastSyncAt = null;
    this.retryTimer = null;
    this.pushDebounced = debounce(() => this.push(), 2500);

    window.addEventListener('online', () => {
      if (this.dirty) this.push();
    });
    window.addEventListener('offline', () => {
      if (this.configured()) this.setStatus('offline', 'Changes are saved locally and will sync when back online');
    });
  }

  // app.js checks sync.dirty on beforeunload.
  get dirty() {
    return this.dirtyFiles.size > 0;
  }

  config() {
    const s = loadSettings();
    // Folder within the repo. Older settings stored a single file path
    // ('data.json' or 'some/dir/data.json') — reuse its directory part.
    let dir = s.dir;
    if (dir === undefined) {
      const legacyPath = s.path || '';
      dir = legacyPath.includes('/') ? legacyPath.slice(0, legacyPath.lastIndexOf('/')) : '';
    }
    return {
      token: s.token || '',
      owner: s.owner || '',
      repo: s.repo || '',
      branch: s.branch || '',
      dir: String(dir || '').replace(/^\/+|\/+$/g, ''),
    };
  }

  configured() {
    const { token, owner, repo } = this.config();
    return Boolean(token && owner && repo);
  }

  onStatus(fn) {
    this.statusListeners.add(fn);
    fn(this.status, this.statusDetail);
    return () => this.statusListeners.delete(fn);
  }

  setStatus(status, detail = '') {
    this.status = status;
    this.statusDetail = detail;
    for (const fn of this.statusListeners) fn(status, detail);
  }

  headers() {
    return {
      Authorization: `Bearer ${this.config().token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  fileUrl(file, withRef = true) {
    const { owner, repo, branch, dir } = this.config();
    const path = dir ? `${dir}/${file}` : file;
    const encPath = path.split('/').map(encodeURIComponent).join('/');
    let url = `${API}/repos/${owner}/${repo}/contents/${encPath}`;
    if (withRef && branch) url += `?ref=${encodeURIComponent(branch)}`;
    return url;
  }

  resetConnection() {
    this.shas = {};
    this.dirtyFiles.clear();
    this.pendingByFile = {};
    this.setStatus(this.configured() ? 'syncing' : 'local');
  }

  // Called (via app.js) for every store change that should be committed.
  noteChange({ verb, entity }) {
    const verbWord = { add: 'Add', update: 'Update', delete: 'Delete', restore: 'Restore' }[verb] || 'Change';
    const title = (entity?.title || '').slice(0, 40);
    const file = store.fileForEntity(entity || {});
    this.markDirty(file, `${verbWord} ${entity?.type || 'item'}${title ? ` "${title}"` : ''}`);
  }

  markDirty(file, label) {
    if (!this.configured()) return;
    (this.pendingByFile[file] ||= []).push(label);
    this.dirtyFiles.add(file);
    this.setStatus('syncing');
    this.pushDebounced();
  }

  // Convenience for callers that touch many modules at once (import, migration).
  markAllDirty(label) {
    for (const file of store.filesWithContent()) this.markDirty(file, label);
  }

  commitMessage(file) {
    const c = this.pendingByFile[file] || [];
    if (!c.length) return 'Update data';
    if (c.length === 1) return c[0];
    const head = c.slice(0, 3).join('; ');
    return `${c.length} changes: ${head}${c.length > 3 ? '…' : ''}`;
  }

  // Fetch one remote file. Returns { status, doc } and records its sha.
  async fetchFile(file) {
    let res;
    try {
      res = await fetch(this.fileUrl(file), { headers: this.headers() });
    } catch {
      return { status: 0, doc: null };
    }
    if (!res.ok) return { status: res.status, doc: null };
    const json = await res.json();
    this.shas[file] = json.sha;
    try {
      return { status: 200, doc: JSON.parse(decodeBase64(json.content)) };
    } catch {
      return { status: -1, doc: null }; // exists but unparsable
    }
  }

  async pull() {
    if (!this.configured()) {
      this.setStatus('local');
      return false;
    }
    this.setStatus('syncing');

    const results = await Promise.all(DATA_FILES.map(async (file) => ({
      file, ...(await this.fetchFile(file)),
    })));

    if (results.some((r) => r.status === 0)) {
      this.setStatus(navigator.onLine ? 'error' : 'offline', 'Network error reaching GitHub');
      return false;
    }
    if (results.some((r) => r.status === 401 || r.status === 403)) {
      this.setStatus('error', 'Token was rejected — check it in Settings');
      return false;
    }
    if (results.some((r) => r.status === -1)) {
      this.setStatus('error', 'A remote data file is not valid JSON');
      return false;
    }

    const found = results.filter((r) => r.status === 200);

    if (!found.length) {
      // No per-module files. Either the repo is wrong, it's empty, or it still
      // holds a single legacy data.json.
      const { owner, repo } = this.config();
      const repoRes = await fetch(`${API}/repos/${owner}/${repo}`, { headers: this.headers() }).catch(() => null);
      if (!repoRes || !repoRes.ok) {
        this.setStatus('error', 'Repo not found — check owner/repo, and that the token can access it');
        return false;
      }
      const legacy = await this.fetchFile(LEGACY_FILE);
      if (legacy.status === 200 && legacy.doc) {
        store.mergeRemote(legacy.doc);
        delete this.shas[LEGACY_FILE]; // never write the legacy file again
        this.markAllDirty('Migrate to per-module data files');
      } else if (store.entities.length) {
        this.markAllDirty('Initialize data files');
      } else {
        this.setStatus('saved');
      }
      this.lastSyncAt = new Date();
      return true;
    }

    // Merge every remote file, then diff per file to catch local-only changes
    // (e.g. edits made offline, or modules that don't exist remotely yet).
    for (const r of found) store.mergeRemote(r.doc);
    const remoteByFile = Object.fromEntries(found.map((r) => [r.file, r.doc]));
    for (const file of store.filesWithContent()) {
      const remote = remoteByFile[file];
      if (!remote || !store.docEqualsFile(file, remote)) {
        this.markDirty(file, 'Sync local changes');
      }
    }
    this.lastSyncAt = new Date();
    if (!this.dirty) this.setStatus('saved');
    return true;
  }

  async push() {
    if (!this.configured() || !this.dirty) return;
    if (this.pushing) {
      this.queueAgain = true;
      return;
    }
    if (!navigator.onLine) {
      this.setStatus('offline', 'Changes are saved locally and will sync when back online');
      return;
    }
    this.pushing = true;
    this.setStatus('syncing');
    try {
      const { branch } = this.config();
      for (const file of [...this.dirtyFiles]) {
        let attempt = 0;
        for (;;) {
          const body = {
            message: this.commitMessage(file),
            content: encodeBase64(JSON.stringify(store.docForFile(file), null, 2)),
          };
          if (this.shas[file]) body.sha = this.shas[file];
          if (branch) body.branch = branch;

          const res = await fetch(this.fileUrl(file, false), {
            method: 'PUT',
            headers: this.headers(),
            body: JSON.stringify(body),
          });

          if ((res.status === 409 || res.status === 422) && attempt === 0) {
            // Someone committed this file since our last read — take theirs,
            // merge, and retry once with the fresh sha.
            attempt += 1;
            const fresh = await this.fetchFile(file);
            if (fresh.status === 200 && fresh.doc) store.mergeRemote(fresh.doc);
            continue;
          }
          if (!res.ok) {
            const msg = await res.json().then((j) => j.message).catch(() => '');
            throw new Error(msg || `GitHub API error ${res.status}`);
          }
          const json = await res.json();
          this.shas[file] = json.content.sha;
          this.dirtyFiles.delete(file);
          delete this.pendingByFile[file];
          break;
        }
      }
      this.lastSyncAt = new Date();
      this.setStatus('saved');
    } catch (err) {
      this.setStatus(navigator.onLine ? 'error' : 'offline', err.message);
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        if (this.dirty) this.push();
      }, 30000);
    } finally {
      this.pushing = false;
      if (this.queueAgain) {
        this.queueAgain = false;
        this.pushDebounced();
      }
    }
  }

  flush() {
    this.pushDebounced.cancel();
    this.push();
  }
}

export const sync = new GitHubSync();
