const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readSchedule } = require('./schedule-source.cjs');
async function createFeed(config, read = readSchedule) {
  const result = await read(config.source, config.group);
  const table = result.html.match(/<table\b[\s\S]*?<\/table>/i)?.[0];
  if (!table || !table.replace(/<[^>]*>/g, '').replace(/\s/g, '').includes(config.group.replace(/\s/g, ''))) throw new Error('У завантаженій таблиці не знайдено групу ' + config.group);
  return { group: config.group, savedAt: Date.now(), revision: crypto.createHash('sha256').update(table).digest('hex'), html: table, source: result.source, sheet: result.sheet };
}
function feedMeta(feed) { const { html, ...meta } = feed; return meta; }
async function build() {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'schedule-config.json'), 'utf8'));
  let feed;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { feed = await createFeed(config); break; }
    catch (error) { if (attempt === 2) throw error; await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); }
  }
  const out = path.join(__dirname, 'dist');
  fs.mkdirSync(out, { recursive: true });
  for (const name of ['index.html', 'app.js', 'style.css', 'personal.js', 'particles.js', 'theme.js']) fs.copyFileSync(path.join(__dirname, name), path.join(out, name));
  fs.writeFileSync(path.join(out, 'schedule-data.json'), JSON.stringify(feed));
  fs.writeFileSync(path.join(out, 'schedule-meta.json'), JSON.stringify(feedMeta(feed)));
  fs.writeFileSync(path.join(out, 'schedule-snapshot.js'), 'window.SCHEDULE_SNAPSHOT = ' + JSON.stringify(feed) + ';');
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
  console.log('Built GitHub Pages: ' + feed.sheet + ' / ' + feed.group + ' at ' + new Date(feed.savedAt).toISOString());
}
if (require.main === module) build().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { createFeed, feedMeta };
