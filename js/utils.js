// Shared helpers. Dates are handled as local time throughout; entities store
// dates as 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm' strings.

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export const pad = (n) => String(n).padStart(2, '0');

export function dateKey(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const todayKey = () => dateKey(new Date());

export function parseDate(s) {
  if (!s) return null;
  const [datePart, timePart = ''] = String(s).split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return null;
  const [hh = 0, mm = 0] = timePart.split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0);
}

export const timeOf = (s) => (s && s.includes('T') ? s.slice(11, 16) : '');

export function addDays(key, n) {
  const d = parseDate(key.slice(0, 10));
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

export function addMonths(key, n) {
  const [y, m, day] = key.slice(0, 10).split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const lastDay = new Date(ny, nm + 1, 0).getDate();
  return `${ny}-${pad(nm + 1)}-${pad(Math.min(day, lastDay))}`;
}

export function startOfWeekKey(key) {
  const d = parseDate(key);
  d.setDate(d.getDate() - d.getDay());
  return dateKey(d);
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function fmtDate(key) {
  const d = parseDate(key);
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
}

export function fmtDateFull(key) {
  const d = parseDate(key);
  return d
    ? d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : '';
}

export function fmtMonthYear(key) {
  const d = parseDate(key);
  return d ? d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '';
}

export function fmtTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m)
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function relativeDue(key) {
  if (!key) return '';
  const today = todayKey();
  const day = key.slice(0, 10);
  if (day === today) return 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  const diff = Math.round((parseDate(day) - parseDate(today)) / 86400000);
  if (diff < 0) return `${-diff}d overdue`;
  if (diff < 7) return parseDate(day).toLocaleDateString(undefined, { weekday: 'short' });
  return fmtDate(day);
}

export function download(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
