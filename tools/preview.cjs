'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
function serve(directory, port = 0) {
  const root = path.resolve(directory);
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.xml': 'application/xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
  const server = http.createServer((req, res) => {
    let file;
    try { file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname)); } catch { res.writeHead(400).end(); return; }
    if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end('Not found'); return; }
    const ext = path.extname(file);
    const headers = { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
    let data = fs.readFileSync(file);
    if (/html|css|js|xml|json|svg/.test(ext) && /gzip/.test(req.headers['accept-encoding'] || '')) { data = zlib.gzipSync(data); headers['Content-Encoding'] = 'gzip'; }
    res.writeHead(200, headers); res.end(data);
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}
module.exports = { serve };
if (require.main === module) serve(process.argv[2] || 'public', Number(process.argv[3] || 4000)).then(s => console.log(`Preview: http://127.0.0.1:${s.address().port} (static pages; API services require deployment)`));
