const DEFAULT_SOURCE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQa-DLjav3nUZLx4XUhxeNqmmHilX_FGV2_qTEetS4XryhlcNyrIgha_kjESlClKoVcqA9B88c8ZEek/pubhtml#gid=377907326';
function workbookURL(value = DEFAULT_SOURCE) {
  const source = new URL(value);
  if (source.protocol !== 'https:' || source.hostname !== 'docs.google.com' || source.username || source.password || source.port) throw new Error('Вставте посилання на опубліковану Google Таблицю.');
  const book = source.pathname.match(/^\/spreadsheets\/d\/(?:e\/)?[\w-]+/);
  if (!book) throw new Error('Неправильне посилання на розклад.');
  const gid = source.searchParams.get('gid') || new URLSearchParams(source.hash.slice(1)).get('gid');
  return { url: new URL(book[0] + '/pubhtml', source.origin), gid };
}
function publishedSheets(html) {
  return [...html.matchAll(/items\.push\(\{\s*name:\s*("(?:\\.|[^"\\])*"),[\s\S]*?\bgid:\s*"(-?\d+)"/g)]
    .map(m => ({ name: JSON.parse(m[1]), gid: m[2] }));
}
function selectSheet(sheets, requestedGid, group = 'ІР-31') {
  const department = group.split('-')[0].trim().toLocaleUpperCase('uk-UA');
  const named = sheets.filter(sheet => sheet.name.split(/[,\s]+/).some(word => word.toLocaleUpperCase('uk-UA') === department));
  // Prefer the current semester tab over archived weekly tabs, even for an old gid.
  const current = named.filter(sheet => !/(тижд|архів|копія|\d)/i.test(sheet.name));
  return current.find(sheet => sheet.gid === requestedGid) || current[0] || sheets.find(sheet => sheet.gid === requestedGid);
}
async function fetchText(url) {
  url = new URL(url);
  url.searchParams.set('_', Date.now().toString());
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw new Error('Google HTTP ' + response.status);
  return response.text();
}
async function readSchedule(value, group = 'ІР-31', read = fetchText) {
  const book = workbookURL(value);
  const index = await read(book.url);
  const sheets = publishedSheets(index);
  if (!sheets.length && /<table[\s>]/i.test(index)) return { html: index, source: book.url.href, sheet: '' };
  const selected = selectSheet(sheets, book.gid, group);
  if (!selected) throw new Error('Не знайдено аркуш групи у книзі розкладу.');
  const source = new URL(book.url);
  source.pathname += '/sheet';
  source.searchParams.set('headers', 'false');
  source.searchParams.set('gid', selected.gid);
  const html = await read(source);
  if (!/<table[\s>]/i.test(html)) throw new Error('Google не повернув таблицю розкладу.');
  return { html, source: source.href, sheet: selected.name };
}
module.exports = { DEFAULT_SOURCE, workbookURL, publishedSheets, selectSheet, readSchedule };
