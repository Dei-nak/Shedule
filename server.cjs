// Optional local preview. GitHub Pages uses the workflow-generated JSON files.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createFeed, feedMeta } = require('./build-pages.cjs');
const config = require('./schedule-config.json');
const files = new Set(['index.html', 'app.js', 'style.css', 'personal.js', 'particles.js', 'theme.js', 'hero-light.js', 'schedule-snapshot.js']);
let latest, pending;
async function liveFeed() {
  if (latest && Date.now() - latest.savedAt < 30000) return latest;
  if (!pending) pending = createFeed(config).then(feed => {
    latest = feed;
    try { fs.writeFileSync(path.join(__dirname, 'schedule-snapshot.js'), 'window.SCHEDULE_SNAPSHOT = ' + JSON.stringify(feed) + ';'); } catch (_) { }
    return feed;
  }).finally(() => { pending = null; });
  return pending;
}
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.headers.origin;
  if (origin === 'null' || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin || '')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ service: 'ir31-schedule', version: 5 }));
    }
    if (['/schedule-data.json', '/schedule-meta.json'].includes(url.pathname)) {
      const feed = { ...await liveFeed(), mode: 'live' };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(url.pathname === '/schedule-meta.json' ? feedMeta(feed) : feed));
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!files.has(file)) { res.writeHead(404); return res.end('Not found'); }
    const mime = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html';
    res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, file)));
  } catch (error) {
    console.error(error.message);
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Не вдалося оновити онлайн-розклад.');
  }
});
if (require.main === module) {
  const port = Number(process.env.PORT || 4173);
  server.listen(port, '127.0.0.1', () => console.log(`Розклад: http://127.0.0.1:${port}`));
}
module.exports = server;
