import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createSiteHandler } from '../worker/index.js';
import worker from '../dist/server/index.js';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const builtSource = await readFile(new URL('../dist/server/index.js', import.meta.url), 'utf8');
const remoteAssets = JSON.parse(builtSource.match(/^const remoteAssets = (.+);$/m)?.[1] || '{}');
assert.equal(Object.keys(remoteAssets).length, 4, 'Exactly four pinned OCR resources are remotely distributed');
assert.ok(gzipSync(builtSource, { level: 9 }).length < 10_000_000, 'Worker must remain within the compressed script budget');
const originalFetch = globalThis.fetch;
const originalCaches = globalThis.caches;
const remoteBytes = new Map();
const networkCalls = [];
const stored = new Map();
const cacheStats = { matches: 0, puts: 0 };
for (const [assetPath, asset] of Object.entries(remoteAssets)) {
  assert.ok(asset.url.startsWith('https://'));
  remoteBytes.set(asset.url, await readFile(path.join(root, assetPath)));
}
globalThis.fetch = async (input, options) => {
  const url = String(input);
  networkCalls.push({ url, options });
  assert.ok(remoteBytes.has(url), `Unpinned upstream URL: ${url}`);
  assert.equal(options.method, 'GET');
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers, undefined, 'Visitor cookies or Authorization must not reach the public resource host');
  return new Response(remoteBytes.get(url), { headers: { 'Content-Type': 'application/octet-stream' } });
};
globalThis.caches = { default: {
  async match(request) { cacheStats.matches++; return stored.get(request.url)?.clone(); },
  async put(request, response) { cacheStats.puts++; stored.set(request.url, response.clone()); },
} };
let assets = 0;
async function checkDirectory(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}/${entry.name}`;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await checkDirectory(filename, relative);
    else {
      const response = await worker.fetch(new Request(`https://test.local${relative}`));
      assert.equal(response.status, 200, relative);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(filename), relative);
      assets++;
    }
  }
}
try {
await checkDirectory(root);
assert.equal(networkCalls.length, 4, 'Each of the four pinned OCR assets is fetched once');
assert.equal(cacheStats.puts, 4, 'Only validated public bytes enter the cache');
const [assetPath, asset] = Object.entries(remoteAssets)[0];
const previousCalls = networkCalls.length;
const cached = await worker.fetch(new Request(`https://test.local${assetPath}`, { headers: { Cookie: 'private-cookie', Authorization: 'Bearer private-key' } }));
assert.equal(cached.status, 200);
assert.equal(cached.headers.get('ETag'), `"${asset.sha256}"`);
assert.equal(networkCalls.length, previousCalls, 'Repeated resource reads use the validated cache');
const head = await worker.fetch(new Request(`https://test.local${assetPath}`, { method: 'HEAD' }));
assert.equal(head.status, 200);
assert.equal((await head.arrayBuffer()).byteLength, 0);
assert.equal(head.headers.get('Content-Length'), String(asset.size));
assert.equal(networkCalls.length, previousCalls);
const firstUncached = await worker.fetch(new Request(`https://uncached.local${assetPath}`, { headers: { Cookie: 'private-cookie', Authorization: 'Bearer private-key' } }));
assert.equal(firstUncached.status, 200);
assert.equal(networkCalls.length, previousCalls + 1);
const badHashHandler = createSiteHandler({}, [], null, { [assetPath]: { ...asset, sha256: '0'.repeat(64) } });
const badHash = await badHashHandler.fetch(new Request(`https://test.local${assetPath}`));
assert.equal(badHash.status, 503, 'An altered upstream resource must not be served as executable code');
assert.equal(badHash.headers.get('Cache-Control'), 'no-store');
assert.equal(badHash.headers.get('Retry-After'), '5');
const beforeRejected = networkCalls.length;
const tooLargeHandler = createSiteHandler({}, [], null, { [assetPath]: { ...asset, size: 8 * 1024 * 1024 + 1 } });
assert.equal((await tooLargeHandler.fetch(new Request(`https://test.local${assetPath}`))).status, 503);
const insecureHandler = createSiteHandler({}, [], null, { [assetPath]: { ...asset, url: 'http://untrusted.example/resource.js' } });
assert.equal((await insecureHandler.fetch(new Request(`https://test.local${assetPath}`))).status, 503);
assert.equal((await worker.fetch(new Request('https://test.local/vendor/ocr/core/unknown.js?url=https://untrusted.example/'))).status, 404);
assert.equal((await worker.fetch(new Request(`https://test.local${assetPath}`, { method: 'POST', body: 'private-image' }))).status, 405);
assert.equal(networkCalls.length, beforeRejected, 'Unknown, insecure, oversize and non-GET requests never proxy');
globalThis.fetch = async () => new Response('redirected', { status: 302 });
assert.equal((await createSiteHandler({}, [], null, { [assetPath]: asset }).fetch(new Request(`https://redirect.local${assetPath}`))).status, 503);
globalThis.fetch = async () => { throw new Error('network unavailable'); };
assert.equal((await createSiteHandler({}, [], null, { [assetPath]: asset }).fetch(new Request(`https://offline.local${assetPath}`))).status, 503);
for (const [query, expected] of [
  ['entry=0&text=private-input', 400],
  ['entry=9999999', 404],
  ['entry=-1', 400],
  ['entry=0&lang=unknown', 400],
  ['entry=0&chunk=99999', 404],
  ['entry=http://example.com', 400],
]) {
  const response = await worker.fetch(new Request(`https://test.local/api/tts?${query}`));
  assert.equal(response.status, expected, query);
}
assert.equal((await worker.fetch(new Request('https://test.local/api/tts?entry=0', { method: 'POST', body: 'private-input' }))).status, 405);
assert.equal((await worker.fetch(new Request('https://test.local/missing'))).status, 404);
console.log(`通过：发布 Worker 的 ${assets} 项资源与源文件逐字节一致；4个同源OCR资源固定HTTPS/长度/SHA256校验、缓存与HEAD、503重试；不转发用户请求头，拒绝未知路径/POST/超限/重定向；gzip脚本小于10MB。语音接口拒绝任意文本、URL、越界及无效参数。`);
} finally {
  globalThis.fetch = originalFetch;
  if (originalCaches === undefined) delete globalThis.caches;
  else globalThis.caches = originalCaches;
}
