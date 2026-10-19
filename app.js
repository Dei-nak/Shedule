// ==== НАЛАШТУВАННЯ ЗА ЗАМОВЧУВАННЯМ ====
// Use the ordinary online schedule URL. The server discovers the current sheet.
const DEFAULT_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQa-DLjav3nUZLx4XUhxeNqmmHilX_FGV2_qTEetS4XryhlcNyrIgha_kjESlClKoVcqA9B88c8ZEek/pubhtml#gid=377907326";
const TARGET_GROUP = "ІР-31";
const FETCH_TIMEOUT_MS = 30000;
const AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 хв

const CACHE_KEY_RAW = "schedule_cache_raw_v3_" + TARGET_GROUP;
const CACHE_KEY_TIME = "schedule_cache_time_v3_" + TARGET_GROUP;
const CACHE_KEY_URL = "scheduleURL";

let currentURL = localStorage.getItem(CACHE_KEY_URL) || DEFAULT_URL;
// Migrate the original, incorrect default without replacing custom sources.
if (currentURL.includes("gid=1325481207")) currentURL = DEFAULT_URL;
let raw = [];
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
el("url-input").value = currentURL;

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
el("btn-save-url").onclick = () => {
  const val = el("url-input").value.trim();
  if (!val) return;
  localStorage.setItem(CACHE_KEY_URL, val);
  currentURL = val;
  el("settings-screen").classList.add("hidden");
  load(true);
};

// ---- Завантаження з тайм-аутом ----
async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    // Додаємо "cache-buster", бо Google CDN інколи довго віддає стару CSV-версію
    const bust = (url.includes("?") ? "&" : "?") + "_=" + Date.now();
    const res = await fetch(url + bust, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
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

async function load(manual) {
  const listEl = el("main-list");
  if (manual || !raw.length) {
    el("top-date").innerText = "Оновлення…";
  }
  try {
    usingCache = false;
    let text;
    try {
      text = await fetchWithTimeout(location.protocol.startsWith("http")
        ? "/api/schedule?url=" + encodeURIComponent(currentURL) + "&group=" + encodeURIComponent(TARGET_GROUP) : sourceURL(currentURL), FETCH_TIMEOUT_MS);
    } catch (error) {
      const requested = new URL(sourceURL(currentURL));
      const bundled = new URL(sourceURL(DEFAULT_URL));
      if (!window.SCHEDULE_SNAPSHOT || requested.pathname !== bundled.pathname || requested.searchParams.get("gid") !== bundled.searchParams.get("gid")) throw error;
      if (localStorage.getItem(CACHE_KEY_RAW) && Number(localStorage.getItem(CACHE_KEY_TIME)) > window.SCHEDULE_SNAPSHOT.savedAt) throw error;
      text = window.SCHEDULE_SNAPSHOT.html;
      usingCache = true;
    }
    const parsed = /<table[\s>]/i.test(text) ? parsePublishedSheet(text) : Papa.parse(text).data;

    const found = findGroupColumn(parsed, TARGET_GROUP);
    if (!found) {
      throw new Error("NOT_FOUND");
    }

    raw = parsed;
    myC = found.col;
    hasSubgroups = found.hasSubgroups;
    myC2 = hasSubgroups ? myC + 2 : -1;
    el("sub-filter").classList.toggle("hidden", !hasSubgroups);

    el("stale-badge").classList.toggle("hidden", !usingCache);
    localStorage.setItem(CACHE_KEY_RAW, JSON.stringify(parsed));
    localStorage.setItem(CACHE_KEY_TIME, usingCache ? String(window.SCHEDULE_SNAPSHOT.savedAt) : Date.now().toString());
    updateSourceStatus();
    updateLastUpdateText();
    render();
  } catch (e) {
    console.error("Помилка завантаження розкладу:", e);
    // Спроба показати останню збережену копію замість нескінченного "Оновлення…"
    const cachedRaw = localStorage.getItem(CACHE_KEY_RAW);
    if (cachedRaw) {
      try {
        const parsed = JSON.parse(cachedRaw);
        const found = findGroupColumn(parsed, TARGET_GROUP);
        if (found) {
          raw = parsed;
          myC = found.col;
          hasSubgroups = found.hasSubgroups;
          myC2 = hasSubgroups ? myC + 2 : -1;
          el("sub-filter").classList.toggle("hidden", !hasSubgroups);
          usingCache = true;
          el("stale-badge").classList.remove("hidden");
          updateSourceStatus();
          updateLastUpdateText();
          render();
          return;
        }
      } catch (e2) { /* ігноруємо биту кеш-копію */ }
    }
    showLoadError(e.message === "NOT_FOUND"
      ? `Групу «${TARGET_GROUP}» не знайдено у цій таблиці. Перевірте посилання в ⚙ Налаштуваннях.`
      : "Не вдалося завантажити розклад. Перевірте інтернет-з'єднання або посилання.");
  }
}

function updateLastUpdateText() {
  const t = localStorage.getItem(CACHE_KEY_TIME);
  if (!t) return;
  const d = new Date(parseInt(t, 10));
  el("last-update-text").innerText = "Востаннє оновлено: " + d.toLocaleString("uk-UA");
}

function updateSourceStatus() {
  const saved = new Date(Number(localStorage.getItem(CACHE_KEY_TIME)));
  el("stale-badge").textContent = `Збережена копія від ${saved.toLocaleString("uk-UA")}`;
  const notice = el("source-notice");
  notice.classList.toggle("hidden", !usingCache);
  notice.textContent = usingCache
    ? (location.protocol === "file:" ? "Для автоматичного оновлення відкрийте файл «Запустити розклад.cmd» у папці розкладу. Зараз показано збережену копію."
      : "Не вдалося оновити онлайн-розклад. Показано останню збережену копію; наступна спроба — автоматично.") : "";
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

// ---- Рендер ----
function render() {
  if (!raw.length || myC < 0) return;
  const selD = new Date(el("date-pick").value + "T12:00:00");
  if (Number.isNaN(selD.getTime())) return;
  const list = el("main-list");
  const filter = hasSubgroups ? el("sub-filter").value : "all";
  list.innerHTML = "";
  el("top-date").innerText = selD.toLocaleDateString("uk-UA", { weekday: "long", day: "numeric", month: "long" });

  const days = view === "today" ? [selD] : Array.from({ length: 7 }, (_, i) => {
    const d = new Date(selD); d.setDate(d.getDate() + i); return d;
  });

  let foundAny = false;
  // Each course has its own merged time/day columns; their row heights differ.
  const columns = Array.from({ length: myC }, (_, i) => myC - i - 1);
  const timeColumn = columns.find(c => raw.some(r => /^\d{1,2}:\d{2}\s*[-–—]/.test(r[c] || ""))) ?? 1;
  const dayColumn = columns.find(c => raw.some(r => D_NAMES.includes((r[c] || "").toLowerCase().trim()))) ?? 0;

  days.forEach(targetDate => {
    const dayName = D_NAMES[targetDate.getDay() === 0 ? 6 : targetDate.getDay() - 1];
    let dayHtml = "", curDay = "";

    raw.forEach((row, i) => {
      const f = row[dayColumn]?.toLowerCase().replace(/['']/g, "").trim() || "";
      if (D_NAMES.some(d => f.includes(d.replace(/['']/g, "")))) curDay = f;
      const sameDay = curDay.includes(dayName.replace(/['']/g, ""));
      if (!sameDay && targetDate.getDay() !== 6) return;

      const time = row[timeColumn];
      if (!time || !/^\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}$/.test(time)) return;
      let end = i + 1;
      while (end < raw.length && !/^\d{1,2}:\d{2}/.test(raw[end]?.[timeColumn] || "") && !D_NAMES.includes(raw[end]?.[dayColumn])) end++;

      let l1 = null, l2 = null;
      const lessons1 = [], lessons2 = [];
      for (let s = 0; i + s < end; s++) {
        const first = extractLesson(raw, i, s, myC, targetDate, sameDay, end);
        const second = hasSubgroups && extractLesson(raw, i, s, myC2, targetDate, sameDay, end);
        if (first) lessons1.push(first);
        if (second) lessons2.push(second);
      }
      l1 = lessons1.length ? lessons1 : null;
      l2 = lessons2.length ? lessons2 : null;

      if (!l1 && !l2) return;
      if (hasSubgroups) {
        if (filter === "2") l1 = null;
        if (filter === "1") l2 = null;
      }

      const active = isNow(time, targetDate);
      let content = "";
      const isShared = hasSubgroups && l1 && !l2;

      const lessonCardHtml = (lessons) => lessons.map(lesson => {
        const t = lessonType(lesson.title);
        const cleanTitle = lesson.title.replace(LESSON_MARKER, "").trim();
        // Позначки аудиторії/корпусу в розкладі означають очне заняття.
        const placeText = `${lesson.title} ${lesson.room}`.toLowerCase();
        const isOffline = /(ауд|аудитор|корп|кабін|офлайн|університет)/.test(placeText);
        return `
        <div class="card type-${t.key}">
          <div class="card-top">
            <div>
              <span class="type-chip"><i class="fas ${t.icon}"></i>${t.label}</span>
              ${isOffline ? `<span class="delivery-indicator" title="Очне заняття"><i class="fas fa-building-columns"></i>Офлайн</span>` : ""}
            </div>
            ${lesson.link
              ? `<a href="${escapeHtml(lesson.link)}" target="_blank" rel="noopener" class="join-btn" title="Приєднатись онлайн"><i class="fas fa-video"></i></a>`
              : `<span class="join-btn is-unavailable" title="Посилання на пару ще не додано"><i class="fas fa-video"></i></span>`}
          </div>
          <span class="title">${escapeHtml(cleanTitle)}</span>
          <div class="prof"><i class="fas fa-user-tie"></i> ${escapeHtml(lesson.prof)}</div>
          ${lesson.room ? `<div class="room"><i class="fas fa-location-dot"></i> ${escapeHtml(lesson.room)}</div>` : ""}
        </div>`;
      }).join("");

      if (!hasSubgroups) {
        content = `<div class="sub-column">${l1 ? lessonCardHtml(l1) : `<div class="empty-slot">вільно</div>`}</div>`;
      } else if (isShared) {
        content = `<div class="sub-column"><span class="group-tag">Спільне</span>${lessonCardHtml(l1)}</div>`;
      } else {
        if (filter === "all" || filter === "1") {
          content += `<div class="sub-column"><span class="group-tag">Підгрупа 1</span>${l1 ? lessonCardHtml(l1) : `<div class="empty-slot">вільно</div>`}</div>`;
        }
        if (filter === "all" || filter === "2") {
          content += `<div class="sub-column"><span class="group-tag">Підгрупа 2</span>${l2 ? lessonCardHtml(l2) : `<div class="empty-slot">вільно</div>`}</div>`;
        }
      }

      dayHtml += `<div class="lesson-row ${active ? "is-now" : ""}">
        <div class="time-rail">
          <div class="time-dot">${active ? '<span class="pulse"></span>' : ""}</div>
          <div class="time-text"><span class="t-start">${time.split("-")[0]}</span><span class="t-end">${time.split("-")[1]}</span></div>
        </div>
        <div class="lesson-content">${active ? '<div class="now-badge">ЗАРАЗ</div>' : ""}${content}</div>
      </div>`;
      foundAny = true;
    });

    if (dayHtml) {
      if (view === "week") list.innerHTML += `<div class="day-label">${targetDate.toLocaleDateString("uk-UA", { weekday: "long", day: "numeric" })}</div>`;
      list.innerHTML += `<div class="day-block">${dayHtml}</div>`;
    } else if (view === "week") {
      list.innerHTML += `<div class="day-label">${targetDate.toLocaleDateString("uk-UA", { weekday: "long", day: "numeric" })}</div>`;
      list.innerHTML += `<div class="no-lessons"><div class="coffee-animation">☕</div>Пар не знайдено</div>`;
    }
  });

  if (!foundAny) list.innerHTML = `<div class="no-lessons"><div class="coffee-animation">☕</div>Пар не знайдено</div>`;
}

load();
setInterval(() => load(false), AUTO_REFRESH_MS);
setInterval(render, 30000); // оновлення бейджа "ЗАРАЗ" без нового завантаження
