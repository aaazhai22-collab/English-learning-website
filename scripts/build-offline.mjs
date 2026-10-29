import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A self-contained copy of the vocabulary app, for learning when the hosting
// service is inaccessible. It preserves the app's existing local storage keys.
const root = fileURLToPath(new URL('../public/', import.meta.url));
const output = path.resolve(process.argv[2] || '.qa/words-in-bloom-grammar.html');
const read = relative => readFile(path.join(root, relative), 'utf8');
const scriptSafe = text => text.replace(/<\/script/gi, '<\\/script');
const unexport = text => text.replace(/^export default[^;]+;\s*$/gm, '').replace(/^export /gm, '');
const [original, catalog, beginner, speech, readAloud] = await Promise.all([
  read('index.html'), read('data/catalog.json'), read('data/beginner-examples.js'), read('speech.js'), read('read-aloud.js'),
]);
const starter = unexport(beginner);
const voice = unexport(speech).replace(/^import[^\n]+\n/gm, '').replaceAll('import.meta.url', 'document.baseURI');
const controls = readAloud.replace(/^import[^\n]+\n/gm, '');
const moduleBundle = `(()=>{\n${starter}\n${voice}\n${controls}\n})();`;
const starterBundle = `(()=>{${starter}\nwindow.__wordsInBloomSelectBeginnerExample=selectBeginnerExample;})();`;
let html = original.replace(/const examples = await import\('\.\/data\/beginner-examples\.js'\);/, 'const examples = { selectBeginnerExample: window.__wordsInBloomSelectBeginnerExample };');
html = html.replace(/<a\b[^>]*class="reading-link"[^>]*>[\s\S]*?<\/a>/, '<span class="reading-link">语法词库 · 离线学习</span>');

for (const match of [...html.matchAll(/<link\b[^>]*>/g)].filter(match => /\brel="stylesheet"/.test(match[0]))) {
  const href = match[0].match(/\bhref="([^"]+)"/)?.[1];
  if (!href || /^https?:/.test(href)) throw new Error('Offline stylesheet must be local');
  const css = await read(href.replace(/^\//, ''));
  html = html.replace(match[0], () => `<style>\n${css}\n</style>`);
}
for (const match of [...html.matchAll(/<script\b([^>]*?)src="([^"]+)"[^>]*><\/script>/g)]) {
  const code = match[1].includes('type="module"') ? moduleBundle : await read(match[2].replace(/^\//, ''));
  html = html.replace(match[0], () => `<script>\n${scriptSafe(code)}\n</script>`);
}
const asset = async relative => {
  const extension = path.extname(relative).toLowerCase();
  const mime = { '.png':'image/png', '.svg':'image/svg+xml', '.jpg':'image/jpeg', '.webp':'image/webp' }[extension];
  if (!mime) throw new Error(`Unsupported offline asset: ${relative}`);
  return `data:${mime};base64,${(await readFile(path.join(root, relative.replace(/^\//, '')))).toString('base64')}`;
};
for (const match of [...html.matchAll(/(?:src|href)="((?:\/?assets\/)[^"]+)"/g)]) html = html.replaceAll(match[1], await asset(match[1]));
for (const match of [...html.matchAll(/url\(["']?((?:\/?assets\/)[^)'"\s]+)["']?\)/g)]) html = html.replaceAll(match[1], await asset(match[1]));
const bootstrap = `<script id="standaloneCatalog" type="application/json">${scriptSafe(catalog).replaceAll('<', '\\u003c')}</script>\n<script>${scriptSafe(starterBundle)}</script>\n`;
const main = /<script>\s*let beginnerExampleFor\s*=/;
if (!main.test(html)) throw new Error('Cannot identify the vocabulary app bootstrap');
html = html.replace(main, match => bootstrap + match);
if (/<script\b[^>]*\bsrc=/.test(html) || /<link\b[^>]*rel="stylesheet"/.test(html)) throw new Error('External runtime assets remain: '+(html.match(/<(?:script|link)\b[^>]*(?:\bsrc=|rel="stylesheet")[^>]*>/g)||[]).join(', ').slice(0,400));
await mkdir(path.dirname(output), { recursive:true });
await writeFile(output, html, 'utf8');
console.log(`Built self-contained vocabulary app: ${output}`);
