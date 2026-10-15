import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import worker from '../dist/server/index.js';

const root = fileURLToPath(new URL('../public/', import.meta.url));
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
await checkDirectory(root);
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
console.log(`通过：发布 Worker 的 ${assets} 项资源与源文件逐字节一致；语音接口拒绝任意文本、URL、越界及无效参数。`);
