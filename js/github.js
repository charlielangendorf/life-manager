// GitHub Contents API sync. The whole data doc lives as one JSON file in a
// private repo. Reads fetch content + sha; writes PUT with the last-known sha
// so concurrent edits are detected (409/422), merged, and retried. Writes are
// debounced so rapid edits produce one commit, and each commit message
// summarizes the pending changes — the repo history doubles as a changelog.
import { store, loadSettings } from './store.js';
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
    this.sha = null;
    this.dirty = false;
    this.pushing = false;
    this.queueAgain = false;
    this.pendingChanges = [];
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

  config() {
    const s = loadSettings();
    return {
      token: s.token || '',
      owner: s.owner || '',
      repo: s.repo || '',
      branch: s.branch || '',
      path: s.path || 'data.json',
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

  fileUrl(withRef = true) {
    const { owner, repo, branch, path } = this.config();
    const encPath = path.split('/').map(encodeURIComponent).join('/');
    let url = `${API}/repos/${owner}/${repo}/contents/${encPath}`;
    if (withRef && branch) url += `?ref=${encodeURIComponent(branch)}`;
    return url;
  }

  resetConnection() {
    this.sha = null;
    this.dirty = false;
    this.pendingChanges = [];
    this.setStatus(this.configured() ? 'syncing' : 'local');
  }

  // Called (via app.js) for every store change that should be committed.
  noteChange({ verb, entity }) {
    const verbWord = { add: 'Add', update: 'Update', delete: 'Delete', restore: 'Restore' }[verb] || 'Change';
    const title = (entity?.title || '').slice(0, 40);
    this.markDirty(`${verbWord} ${entity?.type || 'item'}${title ? ` "${title}"` : ''}`);
  }

  markDirty(label) {
    if (!this.configured()) return;
    this.pendingChanges.push(label);
    this.dirty = true;
    this.setStatus('syncing');
    this.pushDebounced();
  }

  commitMessage() {
    const c = this.pendingChanges;
    if (!c.length) return 'Update data';
    if (c.length === 1) return c[0];
    const head = c.slice(0, 3).join('; ');
    return `${c.length} changes: ${head}${c.length > 3 ? '…' : ''}`;
  }

  async pull() {
    if (!this.configured()) {
      this.setStatus('local');
      return false;
    }
    this.setStatus('syncing');
    let res;
    try {
      res = await fetch(this.fileUrl(), { headers: this.headers() });
    } catch {
      this.setStatus(navigator.onLine ? 'error' : 'offline', 'Network error reaching GitHub');
      return false;
    }
    if (res.status === 401 || res.status === 403) {
      this.setStatus('error', 'Token was rejected — check it in Settings');
      return false;
    }
    if (res.status === 404) {
      // Either the data file doesn't exist yet (fine — first push creates it)
      // or the repo/token is wrong. Check the repo to tell them apart.
      const { owner, repo } = this.config();
      const repoRes = await fetch(`${API}/repos/${owner}/${repo}`, { headers: this.headers() }).catch(() => null);
      if (!repoRes || !repoRes.ok) {
        this.setStatus('error', 'Repo not found — check owner/repo, and that the token can access it');
        return false;
      }
      this.sha = null;
      if (store.entities.length) {
        this.dirty = true;
        this.pendingChanges.push('Initialize data file');
        this.pushDebounced();
      } else {
        this.setStatus('saved');
      }
      this.lastSyncAt = new Date();
      return true;
    }
    if (!res.ok) {
      this.setStatus('error', `GitHub API error ${res.status}`);
      return false;
    }

    const json = await res.json();
    this.sha = json.sha;
    let doc;
    try {
      doc = JSON.parse(decodeBase64(json.content));
    } catch {
      this.setStatus('error', 'Remote data file is not valid JSON');
      return false;
    }
    store.mergeRemote(doc);
    this.lastSyncAt = new Date();
    if (store.docEquals(doc)) {
      this.dirty = false;
      this.setStatus('saved');
    } else {
      // Local has changes the remote doesn't (e.g. edits made offline).
      this.dirty = true;
      this.pendingChanges.push('Sync local changes');
      this.pushDebounced();
    }
    return true;
  }

  async push(isRetry = false) {
    if (!this.configured()) return;
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
      const body = {
        message: this.commitMessage(),
        content: encodeBase64(JSON.stringify(store.exportDoc(), null, 2)),
      };
      if (this.sha) body.sha = this.sha;
      if (branch) body.branch = branch;

      const res = await fetch(this.fileUrl(false), {
        method: 'PUT',
        headers: this.headers(),
        body: JSON.stringify(body),
      });

      if ((res.status === 409 || res.status === 422) && !isRetry) {
        // Someone committed since our last read — pull + merge, then retry once.
        this.pushing = false;
        const ok = await this.pull();
        if (ok && this.dirty) await this.push(true);
        return;
      }
      if (!res.ok) {
        const msg = await res.json().then((j) => j.message).catch(() => '');
        throw new Error(msg || `GitHub API error ${res.status}`);
      }

      const json = await res.json();
      this.sha = json.content.sha;
      this.dirty = false;
      this.pendingChanges = [];
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
