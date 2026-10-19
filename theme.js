(() => {
  const key = 'ir31_theme';
  const system = matchMedia('(prefers-color-scheme: dark)');
  let selected;
  try { selected = localStorage.getItem(key); } catch (_) { }
  const root = document.documentElement;
  function apply(theme) {
    root.dataset.theme = theme;
    const button = document.getElementById('theme-toggle');
    if (button) {
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      button.setAttribute('aria-label', theme === 'dark' ? 'Увімкнути світлу тему' : 'Увімкнути темну тему');
      button.title = button.getAttribute('aria-label');
    }
  }
  apply(['light', 'dark'].includes(selected) ? selected : system.matches ? 'dark' : 'light');
  function init() {
    const button = document.getElementById('theme-toggle');
    if (!button) return;
    apply(root.dataset.theme);
    button.addEventListener('click', () => {
      selected = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(key, selected); } catch (_) { }
      apply(selected);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  system.addEventListener('change', () => { if (!['light','dark'].includes(selected)) apply(system.matches ? 'dark' : 'light'); });
  window.addEventListener('storage', event => {
    if (event.key !== key) return;
    selected = event.newValue;
    apply(['light','dark'].includes(selected) ? selected : system.matches ? 'dark' : 'light');
  });
})();
