export function showToast(message, { actionLabel, onAction, duration = 6000 } = {}) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);
  if (actionLabel) {
    const btn = document.createElement('button');
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => {
      onAction?.();
      el.remove();
    });
    el.appendChild(btn);
  }
  root.appendChild(el);
  setTimeout(() => el.remove(), duration);
}
