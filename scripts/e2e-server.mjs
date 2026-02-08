import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', 'web');
const port = Number(process.env.PORT || process.argv[2] || 4173);

const rewrites = new Map([
  ['/login', '/login.html'],
  ['/signup', '/signup.html'],
  ['/reset-password', '/reset-password.html'],
  ['/account', '/account.html'],
  ['/pricing', '/pricing.html'],
  ['/upgrade', '/pricing.html'],
  ['/planner', '/planner.html'],
  ['/privacy', '/privacy.html'],
  ['/terms', '/terms.html'],
  ['/strategy', '/strategy.html']
]);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

function safeResolve(urlPath) {
  const sanitized = path.normalize(urlPath).replace(/^\.\.[/\\]/, '');
  return path.join(rootDir, sanitized);
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

const server = http.createServer((req, res) => {
  try {
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    let pathname = decodeURIComponent(reqUrl.pathname);

    if (pathname === '/') pathname = '/index.html';
    if (rewrites.has(pathname)) pathname = rewrites.get(pathname);

    let filePath = safeResolve(pathname);
    if (pathname.endsWith('/')) filePath = path.join(filePath, 'index.html');

    if (!filePath.startsWith(rootDir)) {
      send(res, 403, 'Forbidden');
      return;
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      const fallback404 = path.join(rootDir, '404.html');
      if (fs.existsSync(fallback404)) {
        const body = fs.readFileSync(fallback404);
        send(res, 404, body, 'text/html; charset=utf-8');
      } else {
        send(res, 404, 'Not Found');
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = contentTypes[ext] || 'application/octet-stream';
    const body = fs.readFileSync(filePath);
    send(res, 200, body, type);
  } catch (err) {
    send(res, 500, `Server error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`E2E server running on http://127.0.0.1:${port}`);
});
