import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicDirectory = path.join(root, 'public');
const outputDirectory = path.join(root, '_site');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--base-path')) {
  throw new Error('Usage: node scripts/build-pages.mjs [--base-path /repository-name/]');
}
const value = args[1] ?? process.env.PAGES_BASE_PATH ?? '/English-learning-website/';
const basePath = '/' + value.replace(/^\/+|\/+$/g, '') + '/';
const base = basePath === '//' ? '/' : basePath;
if (!/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(base)) {
  throw new Error('The Pages base path must be a root-relative directory path.');
}

// The only recursively removed directory is this checkout's generated _site.
const resolvedRoot = path.resolve(root);
const resolvedOutput = path.resolve(outputDirectory);
if (path.dirname(resolvedOutput) !== resolvedRoot || path.basename(resolvedOutput) !== '_site') {
  throw new Error('Refusing to clean a directory outside the project output.');
}
await rm(resolvedOutput, { recursive: true, force: true });
await mkdir(resolvedOutput, { recursive: true });
await cp(publicDirectory, resolvedOutput, { recursive: true, errorOnExist: true });
await mkdir(path.join(resolvedOutput, 'pages'), { recursive: true });
await cp(path.join(root, 'worker/reading-api.js'), path.join(resolvedOutput, 'pages/reading-api-core.js'));
await cp(path.join(root, 'worker/free-analysis.js'), path.join(resolvedOutput, 'pages/free-analysis.js'));

function localURL(value) {
  if (value.startsWith('/index.html')) return base + 'vocabulary.html' + value.slice('/index.html'.length);
  return base + value.slice(1);
}
function rewriteLocalPaths(source) {
  // Restrict changes to known application URLs. Third-party code, external
  // addresses, protocol-relative URLs and ordinary strings remain unchanged.
  return source
    .replace(/(["'`])(\/(?:reading|vendor|assets|data|pages)\/[^"'`\s<>]*|\/index\.html(?:[?#][^"'`\s<>]*)?|\/reading\.html(?:[?#][^"'`\s<>]*)?)(?=["'`])/g,
      (_, quote, url) => quote + localURL(url))
    .replace(/(\b(?:href|src)\s*=\s*["'])\/(["'])/g, (_, before, after) => before + base + after)
    .replace(/(url\(\s*)(\/(?:reading|vendor|assets|data|pages)\/[^)'"\s]+)(\s*\))/g,
      (_, before, url, after) => before + localURL(url) + after);
}
function addPagesConfig(html) {
  const config = `<script src="${base}pages/config.js"></script>`;
  if (!/<script\b/.test(html)) throw new Error('Cannot locate the application script.');
  return html.replace(/<script\b/, config + '\n<script');
}
let fileCount = 0;
async function transform(directory, relative = '') {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const name = relative ? `${relative}/${item.name}` : item.name;
    const filename = path.join(directory, item.name);
    if (item.isDirectory()) await transform(filename, name);
    else if (item.isFile()) {
      fileCount++;
      if (!name.startsWith('vendor/') && /\.(?:html|css|js|mjs)$/.test(name)) {
        const source = await readFile(filename, 'utf8');
        await writeFile(filename, rewriteLocalPaths(source));
      }
    } else throw new Error(`Only regular assets may be published: ${name}`);
  }
}
await transform(resolvedOutput);
const vocabulary = addPagesConfig(await readFile(path.join(resolvedOutput, 'index.html'), 'utf8'));
const reading = addPagesConfig(await readFile(path.join(resolvedOutput, 'reading.html'), 'utf8'));
await writeFile(path.join(resolvedOutput, 'vocabulary.html'), vocabulary);
await writeFile(path.join(resolvedOutput, 'index.html'), reading);
await writeFile(path.join(resolvedOutput, 'reading.html'), reading);
await writeFile(path.join(resolvedOutput, '.nojekyll'), '');

for (const required of [
  'pages/config.js', 'pages/client-api.js', 'pages/reading-api-core.js', 'pages/free-analysis.js',
  'reading/app.js', 'data/catalog.json', 'vocabulary.html',
  'vendor/ocr/core/tesseract-core-lstm.wasm.js', 'vendor/ocr/core/tesseract-core-simd-lstm.wasm.js',
  'vendor/ocr/lang/eng.traineddata.gz', 'vendor/ocr/lang/chi_sim.traineddata.gz',
]) {
  if (!(await stat(path.join(resolvedOutput, required))).isFile()) throw new Error(`Missing Pages asset: ${required}`);
}
console.log(`Built GitHub Pages: ${resolvedOutput} (${fileCount + 2} files, base ${base}).`);
console.log(`Reading home: ${base} · Vocabulary: ${base}vocabulary.html`);
