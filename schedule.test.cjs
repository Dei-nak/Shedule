const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const { workbookURL, publishedSheets, selectSheet, readSchedule, DEFAULT_SOURCE } = require('./schedule-source.cjs');
const elements = new Map();
const sandbox = {
  localStorage: { getItem: () => null },
  document: { getElementById(id) { if (!elements.has(id)) elements.set(id, { value: '', classList: { toggle() {}, add() {}, remove() {} } }); return elements.get(id); } },
};
vm.createContext(sandbox);
const code = fs.readFileSync('app.js', 'utf8').replace(/\nload\(\);\s*setInterval[\s\S]*$/, '');
vm.runInContext(code + '\nglobalThis.api = { matchesDates, lessonType, checkDate, extractLesson };', sandbox);
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
