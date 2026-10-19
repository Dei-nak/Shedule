// ==== НАЛАШТУВАННЯ ЗА ЗАМОВЧУВАННЯМ ====
// GitHub Actions discovers the current sheet and publishes the static feed.
const DEFAULT_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQa-DLjav3nUZLx4XUhxeNqmmHilX_FGV2_qTEetS4XryhlcNyrIgha_kjESlClKoVcqA9B88c8ZEek/pubhtml#gid=377907326";
const TARGET_GROUP = "ІР-31";
const FETCH_TIMEOUT_MS = 30000;
const AUTO_REFRESH_MS = 60 * 1000; // Check the published feed every minute.

const CACHE_KEY_RAW = "schedule_cache_raw_v3_" + TARGET_GROUP;
const CACHE_KEY_TIME = "schedule_cache_time_v3_" + TARGET_GROUP;

let currentURL = DEFAULT_URL;
let raw = [];
let loading = false;
let lastVerified = 0;
let feedRevision = '';
let connectionMode = 'published';
let lastSyncError = '';
let view = "today";
let myC = -1;      // колонка групи (перша підгрупа або єдина колонка)
let myC2 = -1;      // колонка другої підгрупи (якщо є поділ на підгрупи)
let hasSubgroups = false;
let usingCache = false;

const D_NAMES = ["понеділок", "вівторок", "середа", "четвер", "п'ятниця", "субота", "неділя"];

const el = (id) => document.getElementById(id);
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const LESSON_MARKER = /\(\s*(л(?:аб)?|лек|пр|пз|п|с(?:ем)?|конс)\s*\.?\s*\)/i;

el("date-pick").value = localDate(new Date());
el("source-link").href = currentURL;

// ---- Навігація по вкладках ----
el("btn-today").onclick = () => setView("today");
el("btn-week").onclick = () => setView("week");
function setView(v) {
  view = v;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.id === "btn-" + v));
  render();
}
el("date-pick").onchange = render;
el("sub-filter").onchange = render;

// ---- Екран налаштувань ----
el("btn-settings").onclick = () => el("settings-screen").classList.remove("hidden");
el("btn-settings-back").onclick = () => el("settings-screen").classList.add("hidden");
el("row-refresh").onclick = () => load(true);

// ---- Завантаження з тайм-аутом ----
async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    // Додаємо "cache-buster", бо Google CDN інколи довго віддає стару CSV-версію
    const bust = (url.includes("?") ? "&" : "?") + "_=" + Date.now();
    const res = await fetch(url + bust, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) { const error = new Error("HTTP " + res.status); error.status = res.status; throw error; }
    return await res.text();
  } finally {
    clearTimeout(id);
  }
}

function findGroupColumn(rows, groupName) {
  // Шукаємо по всій таблиці (а не лише перших N рядках) — заголовок групи
  // може знаходитись глибше, якщо на аркуші кілька курсів одне під одним.
  const norm = (s) => (s || "").toString().replace(/\s+/g, "").toLowerCase();
  const targetNorm = norm(groupName);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    for (let j = 0; j < row.length; j++) {
      if (norm(row[j]).includes(targetNorm)) {
        // Перевіряємо, чи наступний рядок містить "підгрупа" — ознака поділу
        const sub1 = norm(rows[i + 1]?.[j]);
        const sub2 = norm(rows[i + 1]?.[j + 1]);
        const splitDetected = sub1.includes("підгрупа") || sub2.includes("підгрупа");
        return { col: j, hasSubgroups: splitDetected };
      }
    }
  }
  return null;
}

function applySchedule(rows, savedAt, cached) {
  const found = findGroupColumn(rows, TARGET_GROUP);
  if (!found) throw new Error("NOT_FOUND");
  raw = rows; myC = found.col; hasSubgroups = found.hasSubgroups;
  myC2 = hasSubgroups ? myC + 2 : -1;
  usingCache = cached || Date.now() - savedAt > 20 * 60 * 1000;
  lastVerified = savedAt;
  el("sub-filter").classList.toggle("hidden", !hasSubgroups);
  updateSourceStatus(); render();
}

function isLocalPreview() {
  return location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
}

async function locateFeed() {
  const bases = [new URL('.', document.baseURI)];
  if (isLocalPreview() && bases[0].origin !== 'http://127.0.0.1:4173') bases.push(new URL('http://127.0.0.1:4173/'));
  let published = null;
  for (const base of bases) {
    try {
      const meta = JSON.parse(await fetchWithTimeout(new URL('schedule-meta.json', base).href, FETCH_TIMEOUT_MS));
      if (meta.group !== TARGET_GROUP || !Number.isFinite(meta.savedAt) || typeof meta.revision !== 'string') throw new Error('INVALID_META');
      if (isLocalPreview() && meta.mode !== 'live' && bases.length > 1 && base === bases[0]) {
        published = { base, meta };
        continue;
      }
      return { base, meta };
    } catch (_) { /* A VS Code Live Server can use the local live-preview task. */ }
  }
  if (published) return published;
  throw new Error(isLocalPreview() ? 'LOCAL_PREVIEW_NOT_RUNNING' : 'PUBLISHED_FEED_UNAVAILABLE');
}

async function load(manual) {
  if (loading) return;
  loading = true;
  el("sync-status").classList.add("is-checking");
  try {
    const { base, meta } = await locateFeed();
    connectionMode = meta.mode === 'live' ? 'live' : 'published';
    lastSyncError = '';
    if (raw.length && meta.revision === feedRevision) {
      applySchedule(raw, meta.savedAt, false);
      localStorage.setItem(CACHE_KEY_TIME, String(meta.savedAt));
      return;
    }
    const feed = JSON.parse(await fetchWithTimeout(new URL("schedule-data.json", base).href, FETCH_TIMEOUT_MS));
    if (feed.group !== TARGET_GROUP || !Number.isFinite(feed.savedAt) || !feed.html) throw new Error("INVALID_FEED");
    if (feed.revision !== meta.revision) throw new Error("DEPLOY_IN_PROGRESS");
    const parsed = parsePublishedSheet(feed.html);
    applySchedule(parsed, feed.savedAt, false);
    feedRevision = feed.revision;
    localStorage.setItem(CACHE_KEY_RAW, JSON.stringify(parsed));
    localStorage.setItem(CACHE_KEY_TIME, String(feed.savedAt));
    if (feed.source) el("source-link").href = sourceURL(feed.source);
  } catch (error) {
    lastSyncError = error.message;
    if (raw.length) { usingCache = true; updateSourceStatus(); }
    else {
      try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY_RAW) || "null");
        const savedAt = Number(localStorage.getItem(CACHE_KEY_TIME));
        const snapshot = window.SCHEDULE_SNAPSHOT;
        if (cached && (!snapshot || savedAt > snapshot.savedAt)) applySchedule(cached, savedAt, true);
        else if (snapshot) applySchedule(parsePublishedSheet(snapshot.html), snapshot.savedAt, true);
        else throw error;
      } catch (_) { showLoadError("Не вдалося отримати розклад. Спробуйте оновити сторінку пізніше."); renderPersonalOnly(); }
    }
  } finally {
    loading = false;
    el("sync-status").classList.remove("is-checking");
  }
}

function updateSourceStatus() {
  const date = new Date(lastVerified);
  const caption = lastVerified ? date.toLocaleString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "ще не оновлено";
  el("stale-badge").classList.toggle("hidden", !usingCache);
  el("stale-badge").textContent = "Збережена копія · " + caption;
  el("sync-status").textContent = (usingCache ? "Копія від " : connectionMode === 'live' ? "Онлайн · перевірено " : "Таблицю перевірено · ") + caption;
  el("sync-status").title = "Нові опубліковані дані перевіряються щохвилини";
  el("last-update-text").textContent = "Таблицю перевірено: " + caption;
  el("source-notice").classList.toggle("hidden", !usingCache);
  el("source-notice").textContent = !usingCache ? '' : lastSyncError === 'LOCAL_PREVIEW_NOT_RUNNING'
    ? 'Live Server не отримує дані Google. У VS Code виберіть «Термінал → Виконати завдання → Розклад: живий перегляд». Після запуску сторінка підключиться автоматично.'
    : lastSyncError === 'PUBLISHED_FEED_UNAVAILABLE'
      ? 'Файл оновлень ще не опублікований. Потрібна успішна збірка «Update schedule and deploy Pages» у GitHub Actions.'
      : 'Показано останню перевірену версію. Підключення до джерела перевіряється автоматично.';
}

function showLoadError(msg) {
  el("top-date").innerText = "Помилка оновлення";
  el("main-list").innerHTML = `
    <div class="load-error">
      <i class="fas fa-triangle-exclamation"></i>
      ${msg}
      <div><button class="retry-btn" onclick="load(true)">Спробувати знову</button></div>
    </div>`;
}

// ---- Допоміжні функції парсингу дат/пар ----
function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sourceURL(value) {
  const url = new URL(value);
  if (url.hostname === "docs.google.com" && url.pathname.includes("/spreadsheets/d/e/")) {
    url.searchParams.set("gid", url.searchParams.get("gid") || new URLSearchParams(url.hash.slice(1)).get("gid") || "377907326");
    url.pathname = url.pathname.replace(/\/pub(?:html(?:\/sheet)?)?$/, "/pubhtml/sheet");
    url.searchParams.delete("output");
    url.searchParams.set("headers", "false");
    url.hash = "";
  }
  return url.href;
}

// Preserve merged-column positions, red date runs and actual hyperlink targets.
function parsePublishedSheet(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table.waffle") || doc.querySelector("table");
  if (!table) throw new Error("TABLE_NOT_FOUND");
  const rows = [], occupied = [];
  Array.from(table.rows).filter(r => r.querySelector("td")).forEach((tr, r) => {
    rows[r] = [];
    occupied[r] ||= [];
    let c = 0;
    for (const td of tr.querySelectorAll(":scope > td")) {
      while (occupied[r][c]) c++;
      const copy = td.cloneNode(true);
      for (const span of copy.querySelectorAll('[style]')) {
        if (/^(#f00|#ff0000|red|rgb\(255,\s*0,\s*0\))$/i.test(span.style.color)) {
          span.textContent = span.textContent.replace(/\d{1,2}\.\d{1,2}(?:\.\d{4})?/g, date => `§${date}§`);
        }
      }
      const a = copy.querySelector("a[href]");
      let text = copy.textContent.replace(/\s+/g, " ").trim();
      if (a) {
        const url = new URL(a.getAttribute("href"), "https://docs.google.com");
        text += "\n" + (url.hostname === "www.google.com" ? url.searchParams.get("q") || url.href : url.href);
      }
      for (let dy = 0; dy < td.rowSpan; dy++) {
        occupied[r + dy] ||= [];
        for (let dx = 0; dx < td.colSpan; dx++) occupied[r + dy][c + dx] = true;
      }
      for (let dx = 0; dx < td.colSpan; dx++) rows[r][c + dx] = text;
      c += td.colSpan;
    }
  });
  return rows;
}

function matchesDates(expression, target) {
  const current = (target.getMonth() + 1) * 100 + target.getDate();
  const num = s => { const [d, m] = s.split(/[.,]/).map(Number); return d >= 1 && d <= 31 && m >= 1 && m <= 12 ? m * 100 + d : NaN; };
  // The source contains both 19,10 and an accidental extra suffix: 28.09.10.
  // Keep four-digit years intact and preserve the intended range boundaries.
  expression = expression.replace(/(\d{1,2}\.\d{1,2})\.\d{1,2}(?!\d)/g, "$1");
  const tokens = expression.match(/\d{1,2}[.,]\s*\d{1,2}(?:\.\d{4})?(?:\s*[-–—]\s*\d{1,2}[.,]\s*\d{1,2}(?:\.\d{4})?)?/g) || [];
  return tokens.some(token => {
    const range = token.split(/\s*[-–—]\s*/).map(num);
    return range.length === 1 ? current === range[0] : range[0] <= range[1]
      ? current >= range[0] && current <= range[1] : current >= range[0] || current <= range[1];
  });
}

function checkDate(cell, target, sameDay = true) {
  if (!cell) return false;
  const term = (raw[0]?.[myC] || "").match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s*[-–—]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (term) {
    const start = new Date(+term[3], +term[2] - 1, +term[1]);
    const end = new Date(+term[6], +term[5] - 1, +term[4], 23, 59, 59);
    if (target < start || target > end) return false;
  }
  const extra = [...cell.matchAll(/§([^§]+)§/g)].map(m => m[1]).join(",");
  if (target.getDay() === 6 && matchesDates(extra, target)) return true;
  if (!sameDay) return false;
  const regular = cell.replace(/§[^§]+§/g, "");
  const brackets = [...regular.matchAll(/\[([^\]]*)\]/g)];
  if (brackets.length) return brackets.some(m => matchesDates(m[1], target));
  // Some entries have a bare date instead of brackets. A week count is not a date.
  const bareDates = regular.match(/\d{1,2}\.\d{1,2}(?:\s*[-–—]\s*\d{1,2}\.\d{1,2})?/g);
  return bareDates ? matchesDates(bareDates.join(","), target) : true;
}

function isNow(timeStr, targetDate) {
  const now = new Date();
  if (targetDate.toDateString() !== now.toDateString()) return false;
  try {
    const [start, end] = timeStr.split("-").map(t => {
      const [h, m] = t.trim().split(":").map(Number);
      return h * 60 + m;
    });
    const current = now.getHours() * 60 + now.getMinutes();
    return current >= start && current < end;
  } catch (e) { return false; }
}

function extractLesson(rows, rowIdx, stepIdx, col, targetDate, sameDay = true, end = rowIdx + 8) {
  const cell = rows[rowIdx + stepIdx]?.[col];
  if (!cell || !LESSON_MARKER.test(cell) || !checkDate(cell, targetDate, sameDay)) return null;
  let prof = "", link = "", room = "";
  for (let j = 1; rowIdx + stepIdx + j < end; j++) {
    const v = rows[rowIdx + stepIdx + j]?.[col];
    if (!v) continue;
    if (LESSON_MARKER.test(v)) break;
    const low = v.toLowerCase();
    if (low.includes("http")) {
      link = v.match(/https?:\/\/\S+/)?.[0] || "";
      const caption = v.split("\n")[0].trim();
      if (/(проф|доц|ас\.|[А-ЯІЇЄҐ]\.[\s]*[А-ЯІЇЄҐ]\.)/i.test(caption)) prof = caption;
    }
    else if (low.includes("ауд") && !room) room = v.trim();
    else if (!prof && v.trim().length > 2) prof = v.trim();
  }
  return { title: cell.replace(/§[^§]+§/g, "").split("[")[0].replace(/\s*\d+\s*т\s*\+?.*$/i, "").trim(), prof: prof || "Викладач", link, room };
}

// Визначаємо тип пари за позначкою в дужках наприкінці назви — (Л)/(ПЗ)/(Лаб)/(Сем)
// Це не декоративна вигадка: тип пари справді закодований у джерелі і корисний для сканування ока.
function lessonType(title) {
  const m = title.match(LESSON_MARKER);
  const code = (m ? m[1] : "").toLowerCase();
  if (code.startsWith("л") && !code.startsWith("лаб")) return { key: "lecture", label: "Лекція", icon: "fa-book-open" };
  if (code.startsWith("лаб")) return { key: "lab", label: "Лабораторна", icon: "fa-flask" };
  if (code.startsWith("п")) return { key: "practice", label: "Практична", icon: "fa-pen-ruler" };
  if (code.startsWith("с")) return { key: "seminar", label: "Семінар", icon: "fa-comments" };
  if (code.startsWith("конс")) return { key: "consult", label: "Консультація", icon: "fa-circle-question" };
  return { key: "other", label: "Заняття", icon: "fa-graduation-cap" };
}

// ---- Розклад дня: офіційні та особисті заняття ----
function minutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}
function lessonState(time, date) {
  const [start, end] = time.split(/[-–—]/).map(t => minutes(t.trim()));
  const now = new Date();
  const day = localDate(date), today = localDate(now);
  if (day < today) return 'done';
  if (day > today) return 'upcoming';
  const current = now.getHours() * 60 + now.getMinutes();
  return current >= end ? 'done' : current >= start ? 'now' : 'upcoming';
}
function collectDaySlots(targetDate) {
  const slots = new Map();
  const put = (time, lessons) => {
    if (!lessons.length) return;
    const normalized = time.replace(/[–—]/g, '-').replace(/\s/g, '');
    if (!slots.has(normalized)) slots.set(normalized, { time: normalized, lessons: [] });
    slots.get(normalized).lessons.push(...lessons);
  };
  if (raw.length && myC >= 0) {
    const columns = Array.from({ length: myC }, (_, i) => myC - i - 1);
    const timeColumn = columns.find(c => raw.some(r => /^\d{1,2}:\d{2}\s*[-–—]/.test(r[c] || ''))) ?? 1;
    const dayColumn = columns.find(c => raw.some(r => D_NAMES.includes((r[c] || '').toLowerCase().trim()))) ?? 0;
    const dayName = D_NAMES[(targetDate.getDay() + 6) % 7].replace(/['’]/g, '');
    const filter = hasSubgroups ? el('sub-filter').value : 'all';
    let curDay = '';
    raw.forEach((row, i) => {
      const f = (row[dayColumn] || '').toLowerCase().replace(/['’]/g, '').trim();
      if (D_NAMES.some(d => f === d.replace(/['’]/g, ''))) curDay = f;
      const sameDay = curDay === dayName;
      if (!sameDay && targetDate.getDay() !== 6) return;
      const time = row[timeColumn];
      if (!/^\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}$/.test(time || '')) return;
      let end = i + 1;
      while (end < raw.length && !/^\d{1,2}:\d{2}/.test(raw[end]?.[timeColumn] || '') && !D_NAMES.includes(raw[end]?.[dayColumn])) end++;
      const first = [], second = [];
      for (let s = 0; i + s < end; s++) {
        const l1 = extractLesson(raw, i, s, myC, targetDate, sameDay, end);
        const l2 = hasSubgroups && extractLesson(raw, i, s, myC2, targetDate, sameDay, end);
        if (l1) first.push(l1);
        if (l2) second.push(l2);
      }
      const shared = !hasSubgroups || JSON.stringify(first) === JSON.stringify(second);
      const lessons = [];
      if (shared) lessons.push(...first.map(l => ({ ...l, group: '' })));
      else {
        if (filter !== '2') lessons.push(...first.map(l => ({ ...l, group: 'Підгрупа 1' })));
        if (filter !== '1') lessons.push(...second.map(l => ({ ...l, group: 'Підгрупа 2' })));
      }
      put(time, lessons);
    });
  }
  for (const lesson of readPersonalLessons().filter(l => l.date === localDate(targetDate))) {
    put(lesson.start + '-' + lesson.end, [{ ...lesson, personal: true, room: lesson.note, group: 'Додаткова пара' }]);
  }
  return [...slots.values()].sort((a, b) => minutes(a.time.split('-')[0]) - minutes(b.time.split('-')[0]) || minutes(a.time.split('-')[1]) - minutes(b.time.split('-')[1]));
}
function typeInfo(lesson) {
  if (!lesson.personal) return lessonType(lesson.title);
  return {
    lecture: { key: 'lecture', label: 'Лекція', icon: 'fa-book-open' },
    lab: { key: 'lab', label: 'Лабораторна', icon: 'fa-flask' },
    practice: { key: 'practice', label: 'Практична', icon: 'fa-pen-ruler' },
    seminar: { key: 'seminar', label: 'Семінар', icon: 'fa-comments' },
    consult: { key: 'consult', label: 'Консультація', icon: 'fa-circle-question' },
    other: { key: 'other', label: 'Заняття', icon: 'fa-graduation-cap' },
  }[lesson.type] || { key: 'other', label: 'Заняття', icon: 'fa-graduation-cap' };
}
function safeLink(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch (_) { return ''; }
}
function lessonCardHtml(lesson) {
  const type = typeInfo(lesson);
  const cleanTitle = lesson.personal ? lesson.title : lesson.title.replace(LESSON_MARKER, '').trim();
  const link = safeLink(lesson.link);
  const isOffline = /(ауд|аудитор|корп|кабін|офлайн|університет)/i.test(`${lesson.title} ${lesson.room || ''}`);
  return `<div class="sub-column">${lesson.group ? `<span class="group-tag">${escapeHtml(lesson.group)}</span>` : ''}
    <article class="card type-${type.key}${lesson.personal ? ' personal-card' : ''}">
      <div class="card-top"><div><span class="type-chip"><i class="fas ${type.icon}"></i>${type.label}</span>${isOffline ? '<span class="delivery-indicator"><i class="fas fa-building-columns"></i>Офлайн</span>' : ''}</div>
      <div class="card-actions">${lesson.personal ? `<button class="edit-personal icon-button" data-edit="${escapeHtml(lesson.id)}" aria-label="Редагувати додаткову пару"><i class="fas fa-pen"></i></button>` : ''}
      ${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener" class="join-btn" title="Приєднатись онлайн"><i class="fas fa-video"></i></a>` : '<span class="join-btn is-unavailable" title="Посилання не додано"><i class="fas fa-video"></i></span>'}</div></div>
      <span class="title">${escapeHtml(cleanTitle)}</span>
      ${lesson.prof ? `<div class="prof"><i class="fas fa-user-tie"></i> ${escapeHtml(lesson.prof)}</div>` : ''}
      ${lesson.room ? `<div class="room"><i class="fas fa-location-dot"></i> ${escapeHtml(lesson.room)}</div>` : ''}
    </article></div>`;
}
function rowId(date, index) { return 'slot-' + localDate(date) + '-' + index; }
function daySlotsHtml(slots, date) {
  return slots.map((slot, index) => {
    const state = lessonState(slot.time, date);
    const [start, end] = slot.time.split('-');
    return `<div id="${rowId(date, index)}" class="lesson-row ${state === 'now' ? 'is-now' : ''}" data-state="${state}">
      <div class="time-rail"><div class="time-dot"></div><div class="time-text"><span class="t-start">${start}</span><span class="t-end">${end}</span></div></div>
      <div class="lesson-content">${state === 'now' ? '<div class="now-badge">ЗАРАЗ</div>' : ''}${slot.lessons.map(lessonCardHtml).join('')}</div></div>`;
  }).join('');
}
function render() {
  const date = new Date(el('date-pick').value + 'T12:00:00');
  if (Number.isNaN(date.getTime())) return;
  const days = view === 'today' ? [date] : Array.from({ length: 7 }, (_, i) => { const d = new Date(date); d.setDate(d.getDate() + i); return d; });
  el('top-date').innerText = date.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
  el('main-list').innerHTML = days.map(day => {
    const slots = collectDaySlots(day);
    return (view === 'week' ? `<div class="day-label">${day.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric' })}</div>` : '')
      + (slots.length ? `<div class="day-block">${daySlotsHtml(slots, day)}</div>` : '<div class="no-lessons"><div class="coffee-animation">☕</div>На цей день пар немає</div>');
  }).join('');
  renderDaySummary(view === 'today' ? collectDaySlots(date) : [], date);
}
function renderPersonalOnly() { render(); }
function renderDaySummary(slots, date) {
  const section = el('day-summary');
  section.classList.toggle('hidden', view !== 'today');
  if (view !== 'today') return;
  const lessons = slots.flatMap(s => s.lessons);
  const total = lessons.length;
  const completed = slots.filter(s => lessonState(s.time, date) === 'done').reduce((sum, s) => sum + s.lessons.length, 0);
  const intervals = slots.map(s => s.time.split('-').map(minutes)).sort((a, b) => a[0] - b[0]);
  let duration = 0, lastEnd = 0;
  for (const [start, end] of intervals) { duration += Math.max(0, end - Math.max(start, lastEnd)); lastEnd = Math.max(lastEnd, end); }
  const types = new Map();
  lessons.forEach(l => { const t = typeInfo(l); const item = types.get(t.key) || { ...t, count: 0 }; item.count++; types.set(t.key, item); });
  section.innerHTML = `<div class="summary-heading"><span>Ритм дня</span><span class="summary-date">${date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}</span></div>
    <div class="summary-tickets">${slots.length ? slots.map((slot, i) => `<button type="button" class="summary-ticket ${lessonState(slot.time, date)}" data-slot="${rowId(date, i)}" title="${escapeHtml(slot.lessons.map(l => l.title.replace(LESSON_MARKER, '')).join(' · '))}"><span class="ticket-pin"></span><span>${slot.time.split('-')[0]}</span><i class="fas ${lessonState(slot.time, date) === 'done' ? 'fa-check' : typeInfo(slot.lessons[0]).icon}"></i></button>`).join('') : '<span class="summary-free"><i class="fas fa-mug-hot"></i> День без занять</span>'}</div>
    <div class="summary-bottom"><div class="summary-count"><strong>${completed}<span> / ${total}</span></strong><span>пар завершено</span></div><div class="summary-duration"><strong>${Math.floor(duration / 60)}<small>год</small> ${duration % 60}<small>хв</small></strong><span>навчального часу</span></div><div class="summary-types">${[...types.values()].map(t => `<span title="${t.label}"><i class="fas ${t.icon}"></i>${t.count}</span>`).join('')}</div></div>`;
}

// UI state is independent of source refreshes.
initPersonalLessons();
load();
setInterval(() => { if (!document.hidden) load(false); }, AUTO_REFRESH_MS);
setInterval(() => { if (!document.hidden) render(); }, 15000);
window.addEventListener('online', () => load(false));
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); load(false); } });
