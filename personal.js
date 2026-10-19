const PERSONAL_LESSONS_KEY = 'ir31_personal_lessons_v1';
function readPersonalLessons() {
  try {
    const value = JSON.parse(localStorage.getItem(PERSONAL_LESSONS_KEY) || '[]');
    return Array.isArray(value) ? value.filter(l => l && typeof l.id === 'string' && typeof l.title === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(l.date) && /^\d{2}:\d{2}$/.test(l.start) && /^\d{2}:\d{2}$/.test(l.end) && l.end > l.start) : [];
  } catch (_) { return []; }
}
function initPersonalLessons() {
  const dialog = el('lesson-dialog'), form = el('lesson-form');
  function open(id) {
    form.reset();
    const lesson = readPersonalLessons().find(l => l.id === id);
    el('lesson-id').value = lesson?.id || '';
    el('lesson-title').value = lesson?.title || '';
    el('lesson-date').value = lesson?.date || el('date-pick').value;
    el('lesson-start').value = lesson?.start || '15:10';
    el('lesson-end').value = lesson?.end || '16:30';
    el('lesson-type').value = lesson?.type || 'consult';
    el('lesson-prof').value = lesson?.prof || '';
    el('lesson-link').value = lesson?.link || '';
    el('lesson-note').value = lesson?.note || '';
    el('lesson-error').textContent = '';
    el('lesson-dialog-title').textContent = lesson ? 'Редагувати пару' : 'Додаткова пара';
    el('delete-lesson').classList.toggle('hidden', !lesson);
    dialog.showModal();
    el('lesson-title').focus();
  }
  function save(lessons) {
    try { localStorage.setItem(PERSONAL_LESSONS_KEY, JSON.stringify(lessons)); return true; }
    catch (_) { el('lesson-error').textContent = 'Браузер не дозволив зберегти пару. Перевірте налаштування сховища.'; return false; }
  }
  el('add-lesson').onclick = () => open();
  el('close-lesson').onclick = () => dialog.close();
  el('main-list').addEventListener('click', event => { const button = event.target.closest('[data-edit]'); if (button) open(button.dataset.edit); });
  el('day-summary').addEventListener('click', event => {
    const button = event.target.closest('[data-slot]');
    if (button) document.getElementById(button.dataset.slot)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const start = el('lesson-start').value, end = el('lesson-end').value;
    const title = el('lesson-title').value.trim(), link = el('lesson-link').value.trim();
    if (!title) { el('lesson-error').textContent = 'Вкажіть назву предмета.'; return; }
    if (end <= start) { el('lesson-error').textContent = 'Кінець пари має бути пізніше за початок.'; return; }
    if (link && !safeLink(link)) { el('lesson-error').textContent = 'Посилання має починатися з https:// або http://.'; return; }
    const id = el('lesson-id').value || (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
    const lesson = { id, title, date: el('lesson-date').value, start, end, type: el('lesson-type').value, prof: el('lesson-prof').value.trim(), link, note: el('lesson-note').value.trim() };
    const lessons = readPersonalLessons().filter(l => l.id !== id);
    lessons.push(lesson);
    if (!save(lessons)) return;
    el('date-pick').value = lesson.date;
    dialog.close(); render();
  });
  el('delete-lesson').onclick = () => {
    if (save(readPersonalLessons().filter(l => l.id !== el('lesson-id').value))) { dialog.close(); render(); }
  };
  window.addEventListener('storage', event => { if (event.key === PERSONAL_LESSONS_KEY) render(); });
}
