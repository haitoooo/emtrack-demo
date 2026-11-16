import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT || 4173);
const basePath = '/' + (process.env.BASE_PATH || '').split('/').filter(Boolean).join('/');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (basePath !== '/' && pathname === basePath) {
      res.writeHead(302, { Location: basePath + '/' }); res.end(); return;
    }
    if (basePath !== '/' && !pathname.startsWith(basePath + '/')) throw new Error('not found');
    const route = basePath === '/' ? pathname : pathname.slice(basePath.length);
    const file = path.resolve(root, '.' + (route.endsWith('/') ? route + 'index.html' : route));
    if (!file.startsWith(root) || !statSync(file).isFile()) throw new Error('not found');
    const { size } = statSync(file);
    const headers = { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const start = Number(range[1]), end = range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
      if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
      res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` });
      if (req.method === 'HEAD') res.end(); else createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': size });
      if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
    }
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`Local: http://127.0.0.1:${port}${basePath === '/' ? '/' : basePath + '/'}\n`));
