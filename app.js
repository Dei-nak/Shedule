// ==== НАЛАШТУВАННЯ ЗА ЗАМОВЧУВАННЯМ ====
// !! Якщо після відкриття сайту з'явиться повідомлення "групу ІР-31 не знайдено" —
// це означає, що посилання нижче веде не на той аркуш книги (не на "ВЕБ, ІР, ІРма").
// Відкрийте ⚙ Налаштування і вставте правильне CSV-посилання (як його отримати
// описано в README.md).
const DEFAULT_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQa-DLjav3nUZLx4XUhxeNqmmHilX_FGV2_qTEetS4XryhlcNyrIgha_kjESlClKoVcqA9B88c8ZEek/pub?gid=1325481207&single=true&output=csv";
const TARGET_GROUP = "ІР-31";
const FETCH_TIMEOUT_MS = 12000;
const AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 хв

const CACHE_KEY_RAW = "schedule_cache_raw_" + TARGET_GROUP;
const CACHE_KEY_TIME = "schedule_cache_time_" + TARGET_GROUP;
const CACHE_KEY_URL = "scheduleURL";

let currentURL = localStorage.getItem(CACHE_KEY_URL) || DEFAULT_URL;
let raw = [];
let view = "today";
let myC = -1;      // колонка групи (перша підгрупа або єдина колонка)
let myC2 = -1;      // колонка другої підгрупи (якщо є поділ на підгрупи)
let hasSubgroups = false;
let usingCache = false;

const D_NAMES = ["понеділок", "вівторок", "середа", "четвер", "п'ятниця", "субота", "неділя"];

const el = (id) => document.getElementById(id);

el("date-pick").valueAsDate = new Date();
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
    const text = await fetchWithTimeout(currentURL, FETCH_TIMEOUT_MS);
    const parsed = Papa.parse(text).data;

    const found = findGroupColumn(parsed, TARGET_GROUP);
    if (!found) {
      throw new Error("NOT_FOUND");
    }

    raw = parsed;
    myC = found.col;
    hasSubgroups = found.hasSubgroups;
    myC2 = hasSubgroups ? myC + 2 : -1;
    el("sub-filter").classList.toggle("hidden", !hasSubgroups);

    usingCache = false;
    el("stale-badge").classList.add("hidden");
    localStorage.setItem(CACHE_KEY_RAW, JSON.stringify(parsed));
    localStorage.setItem(CACHE_KEY_TIME, Date.now().toString());
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
function checkDate(cell, target) {
  if (!cell || !cell.includes("[")) return false;
  const m = cell.match(/\[(.*?)\]/);
  if (!m) return false;
  const cur = `${String(target.getDate()).padStart(2, "0")}.${String(target.getMonth() + 1).padStart(2, "0")}`;
  return m[1].split(/[,;]/).some(p => {
    p = p.trim();
    if (p.includes("-")) {
      const [s, e] = p.split("-").map(x => {
        const parts = x.trim().split(".");
        return parseInt(parts[1]) * 100 + parseInt(parts[0]);
      });
      const curNum = parseInt(cur.split(".")[1]) * 100 + parseInt(cur.split(".")[0]);
      return curNum >= s && curNum <= e;
    }
    return p === cur;
  });
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

function extractLesson(rows, rowIdx, stepIdx, col, targetDate) {
  const cell = rows[rowIdx + stepIdx]?.[col];
  if (!cell || cell.trim().length <= 3 || !checkDate(cell, targetDate)) return null;
  let prof = "", link = "", room = "";
  for (let j = 1; j < 8; j++) {
    const v = rows[rowIdx + stepIdx + j]?.[col];
    if (!v || v.includes("[")) continue;
    const low = v.toLowerCase();
    if (low.includes("http") || low.includes("zoom") || low.includes("teams")) link = v.trim();
    else if (low.includes("ауд") && !room) room = v.trim();
    else if (!prof && v.trim().length > 2) prof = v.trim();
  }
  return { title: cell.split("[")[0].trim(), prof: prof || "Викладач", link, room };
}

// Визначаємо тип пари за позначкою в дужках наприкінці назви — (Л)/(ПЗ)/(Лаб)/(Сем)
// Це не декоративна вигадка: тип пари справді закодований у джерелі і корисний для сканування ока.
function lessonType(title) {
  const m = title.match(/\(([^)]{1,6})\)\s*$/);
  const code = (m ? m[1] : "").toLowerCase();
  if (code.startsWith("л") && !code.startsWith("лаб")) return { key: "lecture", label: "Лекція", icon: "fa-book-open" };
  if (code.startsWith("лаб")) return { key: "lab", label: "Лабораторна", icon: "fa-flask" };
  if (code.startsWith("пз") || code.startsWith("пр")) return { key: "practice", label: "Практична", icon: "fa-pen-ruler" };
  if (code.startsWith("сем")) return { key: "seminar", label: "Семінар", icon: "fa-comments" };
  if (code.startsWith("конс")) return { key: "consult", label: "Консультація", icon: "fa-circle-question" };
  return { key: "other", label: "Заняття", icon: "fa-graduation-cap" };
}

// ---- Рендер ----
function render() {
  if (!raw.length || myC < 0) return;
  const selD = new Date(el("date-pick").value);
  const list = el("main-list");
  const filter = hasSubgroups ? el("sub-filter").value : "all";
  list.innerHTML = "";
  el("top-date").innerText = selD.toLocaleDateString("uk-UA", { weekday: "long", day: "numeric", month: "long" });

  const days = view === "today" ? [selD] : Array.from({ length: 7 }, (_, i) => {
    const d = new Date(selD); d.setDate(d.getDate() + i); return d;
  });

  let foundAny = false;

  days.forEach(targetDate => {
    if (view === "week" && (targetDate.getDay() === 6 || targetDate.getDay() === 0)) return;

    const dayName = D_NAMES[targetDate.getDay() === 0 ? 6 : targetDate.getDay() - 1];
    let dayHtml = "", curDay = "";

    raw.forEach((row, i) => {
      const f = row[0]?.toLowerCase().replace(/['']/g, "").trim() || "";
      if (D_NAMES.some(d => f.includes(d.replace(/['']/g, "")))) curDay = f;
      if (!curDay.includes(dayName.replace(/['']/g, ""))) return;

      const time = row[1];
      if (!time || !time.includes(":")) return;

      let l1 = null, l2 = null;
      for (let s = 0; s < 8 && (!l1 || (hasSubgroups && !l2)); s++) {
        if (!l1) l1 = extractLesson(raw, i, s, myC, targetDate);
        if (hasSubgroups && !l2) l2 = extractLesson(raw, i, s, myC2, targetDate);
      }

      if (!l1 && !l2) return;
      if (hasSubgroups) {
        if (filter === "2") l1 = null;
        if (filter === "1") l2 = null;
      }

      const active = isNow(time, targetDate);
      let content = "";
      const isShared = hasSubgroups && l1 && !l2;

      const lessonCardHtml = (lesson) => {
        const t = lessonType(lesson.title);
        const cleanTitle = lesson.title.replace(/\s*\([^)]{1,6}\)\s*$/, "");
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
              ? `<a href="${lesson.link}" target="_blank" rel="noopener" class="join-btn" title="Приєднатись онлайн"><i class="fas fa-video"></i></a>`
              : `<span class="join-btn is-unavailable" title="Посилання на пару ще не додано"><i class="fas fa-video"></i></span>`}
          </div>
          <span class="title">${cleanTitle}</span>
          <div class="prof"><i class="fas fa-user-tie"></i> ${lesson.prof}</div>
          ${lesson.room ? `<div class="room"><i class="fas fa-location-dot"></i> ${lesson.room}</div>` : ""}
        </div>`;
      };

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
