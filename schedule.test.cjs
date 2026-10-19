const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const { workbookURL, publishedSheets, selectSheet, readSchedule, DEFAULT_SOURCE } = require('./schedule-source.cjs');
const elements = new Map();
const storage = new Map();
const sandbox = {
  URL,
  AbortController, setTimeout, clearTimeout,
  localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
  document: { getElementById(id) { if (!elements.has(id)) elements.set(id, { value: '', classList: { toggle() {}, add() {}, remove() {} } }); return elements.get(id); } },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('personal.js', 'utf8'), sandbox);
const code = fs.readFileSync('app.js', 'utf8').split('// UI state is independent')[0];
vm.runInContext(code + '\nglobalThis.api = { matchesDates, lessonType, checkDate, extractLesson, collectDaySlots, safeLink, readPersonalLessons, locateFeed };', sandbox);
const { matchesDates, lessonType, checkDate } = sandbox.api;
const monday = new Date('2026-10-19T12:00:00');

test('Monday: whitespace in type, comma dates, accidental date suffix', () => {
  assert.equal(lessonType('ТАУ (Л )6т').key, 'lecture');
  assert.equal(matchesDates('12,10, 19,10, 26.10, 2.11', monday), true);
  assert.equal(checkDate('ТАУ (Л )6т [12,10, 19,10, 26.10, 2.11]', monday), true);
  assert.equal(matchesDates('28.09.10-26.10', monday), true);
  assert.equal(matchesDates('28.09.10-26.10', new Date('2026-11-02T12:00:00')), false);
  assert.equal(matchesDates('14.09, 21.09, 28.09', monday), false);
});
test('regular lessons, alternative dates and Saturday extras stay distinct', () => {
  assert.equal(checkDate('Мова (лаб) 10т+§26.09§, §31.10§', new Date('2026-10-21T12:00:00')), true);
  assert.equal(checkDate('А (лаб) [§31.10§, 4.11–18.11]', new Date('2026-10-31T12:00:00'), false), true);
  assert.equal(checkDate('А (лаб) [§31.10§, 4.11–18.11]', new Date('2026-10-28T12:00:00')), false);
  assert.equal(checkDate('А (лаб) [16.09,23.09]', monday), false);
  assert.equal(lessonType('Предмет ( Пр ) 10т').key, 'practice');
  assert.equal(lessonType('Предмет ( С )').key, 'seminar');
  assert.equal(lessonType('Предмет( лаб )4т').key, 'lab');
});
test('ordinary, CSV and changed gid links resolve through the workbook', async () => {
  const menu = 'items.push({name: "ВЕБ, ІР, ІРма", pageUrl: "unused", gid: "98765"});items.push({name: "1 тиждень ВЕБ, ІР, ІРма", pageUrl: "unused", gid: "377907326"});';
  assert.equal(selectSheet(publishedSheets(menu), '377907326').gid, '98765');
  assert.equal(workbookURL(DEFAULT_SOURCE).gid, '377907326');
  const requests = [];
  const result = await readSchedule(DEFAULT_SOURCE, 'ІР-31', async url => {
    requests.push(url.href);
    return requests.length === 1 ? menu : '<table><tr><td>ІР-31</td></tr></table>';
  });
  assert.equal(new URL(result.source).searchParams.get('gid'), '98765');
  assert.equal(requests.length, 2);
  assert(!requests[0].includes('gid='));
  const csv = DEFAULT_SOURCE.replace('/pubhtml#gid=', '/pub?output=csv&gid=');
  assert.equal(workbookURL(csv).url.pathname, workbookURL(DEFAULT_SOURCE).url.pathname);
  assert.throws(() => workbookURL('http://127.0.0.1/private'));
});
test('personal lessons survive source refreshes, sort by time, and stay on their date', () => {
  const personal = [{ id: 'one', title: 'Перездача', date: '2026-10-19', start: '16:00', end: '17:00', type: 'lab' }, { id: 'two', title: 'Консультація', date: '2026-10-19', start: '08:00', end: '08:40', type: 'consult' }, { id: 'other', title: 'Завтра', date: '2026-10-20', start: '10:00', end: '11:00' }];
  storage.set('ir31_personal_lessons_v1', JSON.stringify(personal));
  assert.deepEqual(Array.from(sandbox.api.collectDaySlots(monday), s => s.time), ['08:00-08:40', '16:00-17:00']);
  assert.equal(sandbox.api.collectDaySlots(monday)[0].lessons[0].personal, true);
  assert.equal(sandbox.api.safeLink('javascript:alert(1)'), '');
  assert.equal(sandbox.api.safeLink('https://example.com'), 'https://example.com/');
  storage.set('ir31_personal_lessons_v1', 'broken json');
  assert.equal(sandbox.api.readPersonalLessons().length, 0);
  storage.clear();
});
test('static feed includes group, revision and source-check time', async () => {
  const { createFeed, feedMeta } = require('./build-pages.cjs');
  const feed = await createFeed({ source: DEFAULT_SOURCE, group: 'ІР-31' }, async () => ({ html: '<html><table><tr><td>ІР-<b>31</b></td></tr></table></html>', source: DEFAULT_SOURCE, sheet: 'ВЕБ, ІР, ІРма' }));
  assert.equal(feed.group, 'ІР-31'); assert.equal(feed.revision.length, 64); assert(Number.isFinite(feed.savedAt));
  assert(!Object.hasOwn(feedMeta(feed), 'html'));
  await assert.rejects(createFeed({ source: DEFAULT_SOURCE, group: 'ІР-31' }, async () => ({ html: '<table><tr><td>ІР-11</td></tr></table>' })));
});
test('VS Code Live Server connects to the live task when static metadata is absent', async () => {
  sandbox.location = { protocol: 'http:', hostname: '127.0.0.1', origin: 'http://127.0.0.1:5500' };
  sandbox.document.baseURI = 'http://127.0.0.1:5500/index.html';
  const requests = [];
  sandbox.fetch = async url => {
    requests.push(url);
    return url.startsWith('http://127.0.0.1:4173/')
      ? { ok: true, text: async () => JSON.stringify({ group: 'ІР-31', savedAt: Date.now(), revision: 'live', mode: 'live' }) }
      : { ok: false, status: 404 };
  };
  const result = await sandbox.api.locateFeed();
  assert.equal(result.base.origin, 'http://127.0.0.1:4173');
  assert.equal(result.meta.mode, 'live'); assert.equal(requests.length, 2);
});
test('published sites never attempt to connect to a visitor localhost', async () => {
  sandbox.location = { protocol: 'https:', hostname: 'dei-nak.github.io', origin: 'https://dei-nak.github.io' };
  sandbox.document.baseURI = 'https://dei-nak.github.io/Shedule/';
  const requests = [];
  sandbox.fetch = async url => { requests.push(url); return { ok: false, status: 404 }; };
  await assert.rejects(sandbox.api.locateFeed(), /PUBLISHED_FEED_UNAVAILABLE/);
  assert.equal(requests.length, 1); assert(requests[0].startsWith('https://dei-nak.github.io/Shedule/'));
});
test('a built static copy in Live Server does not take priority over the live task', async () => {
  sandbox.location = { protocol: 'http:', hostname: 'localhost', origin: 'http://localhost:5500' };
  sandbox.document.baseURI = 'http://localhost:5500/dist/';
  sandbox.fetch = async url => ({ ok: true, text: async () => JSON.stringify({ group: 'ІР-31', savedAt: Date.now(), revision: url.includes(':4173') ? 'live-new' : 'static-old', mode: url.includes(':4173') ? 'live' : 'published' }) });
  const result = await sandbox.api.locateFeed();
  assert.equal(result.meta.revision, 'live-new');
});
