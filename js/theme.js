import { loadSettings, saveSettings } from './store.js';

export function applyTheme() {
  const pref = loadSettings().theme || 'system';
  const dark = pref === 'dark' ||
    (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function setTheme(pref) {
  saveSettings({ theme: pref });
  applyTheme();
}

export function toggleTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  setTheme(dark ? 'light' : 'dark');
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((loadSettings().theme || 'system') === 'system') applyTheme();
});
