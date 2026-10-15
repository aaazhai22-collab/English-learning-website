import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createSiteHandler } from './worker/index.js';
import { buildPublicSpeechEntries, splitSpeechText } from './scripts/catalog-utils.mjs';

// Node 24 can use the desktop's existing proxy for the optional online voice.
// This reads system configuration without changing it or printing credentials.
if (typeof http.setGlobalProxyFromEnv === 'function') {
  if (process.platform === 'win32' && !process.env.HTTPS_PROXY && !process.env.https_proxy) {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[System.Net.WebRequest]::DefaultWebProxy.GetProxy([uri]'https://translate.google.com').AbsoluteUri"], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
    const proxy = result.stdout?.trim();
    if (proxy && /^https?:\/\//.test(proxy) && new URL(proxy).origin !== 'https://translate.google.com') process.env.HTTPS_PROXY = proxy;
  }
  http.setGlobalProxyFromEnv();
}

const root = fileURLToPath(new URL('./public/', import.meta.url));
const catalog = JSON.parse(await readFile(path.join(root, 'data/catalog.json'), 'utf8'));
const speechHandler = createSiteHandler({}, buildPublicSpeechEntries(catalog).map(splitSpeechText));
const port = Number(process.env.PORT || 5173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer(async (request, response) => {
  try {
    if (new URL(request.url, 'http://localhost').pathname === '/api/tts') {
      const result = await speechHandler.fetch(new Request(`http://localhost:${port}${request.url}`, { method: request.method }));
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const target = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    if (!(await stat(target)).isFile()) throw new Error('Not a file');
    const content = await readFile(target);
    response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    if (request.method === 'HEAD') response.end();
    else response.end(content);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Local: http://localhost:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
