const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_SOURCE, readSchedule } = require('./schedule-source.cjs');
const root = __dirname;
const files = new Set(['index.html', 'app.js', 'style.css', 'schedule-snapshot.js']);
const port = Number(process.env.PORT || 3000);
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ service: 'ir31-schedule', version: 2 }));
    }
    if (url.pathname === '/api/schedule') {
      const value = url.searchParams.get('url') || DEFAULT_SOURCE;
      const group = url.searchParams.get('group') || 'ІР-31';
      const result = await readSchedule(value, group);
      // Successful refreshes update the offline copy as well.
      const defaultBook = new URL(DEFAULT_SOURCE).pathname.replace(/\/pubhtml$/, '');
      if (new URL(result.source).pathname.startsWith(defaultBook + '/') && group === 'ІР-31') {
        const table = result.html.match(/<table\b[\s\S]*?<\/table>/i)[0];
        const snapshot = { savedAt: Date.now(), html: table, source: result.source, sheet: result.sheet };
        try {
          fs.writeFileSync(path.join(root, 'schedule-snapshot.js'), 'window.SCHEDULE_SNAPSHOT = ' + JSON.stringify(snapshot) + ';');
        } catch (error) { console.error('Не вдалося зберегти офлайн-копію:', error.message); }
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(result.html);
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!files.has(file)) { res.writeHead(404); return res.end('Not found'); }
    const mime = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html';
    res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
    res.end(fs.readFileSync(path.join(root, file)));
  } catch (error) {
    console.error(error.message);
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Не вдалося оновити онлайн-розклад.');
  }
});
if (require.main === module) server.listen(port, '127.0.0.1', () => console.log(`Розклад: http://127.0.0.1:${port}`));
module.exports = server;
