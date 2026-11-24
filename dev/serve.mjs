// Petit serveur statique pour l'aperçu du panneau : npm run preview
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** Sert le dépôt sur 127.0.0.1 (port 0 = un port libre). Renvoie le serveur et son adresse. */
export function startServer(port = 5178) {
  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/') {
      res.writeHead(302, { Location: '/dev/preview.html' });
      return res.end();
    }
    const file = resolve(root, `.${decodeURIComponent(pathname)}`);
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403);
      return res.end();
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('Introuvable');
    }
  });
  return new Promise((done) => {
    server.listen(port, '127.0.0.1', () => done({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { url } = await startServer(Number(process.env.PORT) || 5178);
  console.log(`Aperçu : ${url}/dev/preview.html`);
}
