import { readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('public/index.html', root), 'utf8');
let scripts = 0;
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (match[1].includes('src=') || match[1].includes('application/json')) continue;
  new vm.Script(match[2]);
  scripts++;
}
for (const file of ['read-aloud.js', 'speech.js']) {
  const result = spawnSync(process.execPath, ['--check', new URL(`public/${file}`, root).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
for (const reference of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  if (/^https?:|^data:/.test(reference[1])) continue;
  await access(new URL(`public/${reference[1]}`, root));
}
const catalog = JSON.parse(await readFile(new URL('public/data/catalog.json', root), 'utf8'));
assert.equal(catalog.collections.filter(collection => collection.id !== 'grammar-handbook').length, 40);
assert.equal(catalog.words.filter(word => word.collectionId !== 'grammar-handbook').length, 2557);
assert.equal(new Set(catalog.words.map(word => word.id)).size, catalog.words.length);
for (const word of catalog.words) {
  assert.ok(word.word && word.meaning && word.examples.length, `Invalid word ${word.id}`);
  assert.ok(catalog.collections.some(collection => collection.id === word.collectionId));
}
assert.ok(!html.includes('fetch("/api/catalog"'));
console.log(`通过：${scripts} 个内联脚本、2 个点读模块、所有页面资源、40 个常规词集及 ${catalog.words.filter(word => word.collectionId === 'grammar-handbook').length} 条语法词条，原有 2557 个单词保留。`);
