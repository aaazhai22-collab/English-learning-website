/** Real, no-key browser OCR. Requires the existing Playwright test runtime. */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.gz': 'application/gzip' };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Local OCR verification</title>'); return; }
    const filename = path.resolve(publicRoot, `.${pathname}`);
    const relative = path.relative(publicRoot, filename);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !(await stat(filename)).isFile()) throw new Error();
    response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' }).end(await readFile(filename));
  } catch { response.writeHead(404).end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext();
const external = [];
await context.route('**/*', route => {
  const url = route.request().url();
  if (!url.startsWith(origin + '/')) { external.push(url); return route.abort(); }
  return route.continue();
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));

try {
  await page.goto(origin);
  const batch = await page.evaluate(async () => {
    const { recognizeImages } = await import('/reading/ocr.js');
    const NativeWorker = window.Worker;
    window.ocrWorkers = { created: 0, terminated: 0 };
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); window.ocrWorkers.created++; }
      terminate() { window.ocrWorkers.terminated++; return super.terminate(); }
    };
    const canvas = document.createElement('canvas');
    canvas.width = 1400; canvas.height = 800;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000'; context.font = '36px Arial';
    ['Reading practice', 'Practice makes progress.', '21. What helps students learn?', '[A] Reading every day', '[B] Avoiding books', '[C] Ignoring questions', '[D] Stopping practice'].forEach((line, index) => context.fillText(line, 70, 90 + index * 65));
    context.font = '36px Microsoft YaHei'; context.fillText('学习英语，每天阅读。', 70, 620);
    const original = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const rotatedCanvas = document.createElement('canvas');
    rotatedCanvas.width = canvas.height; rotatedCanvas.height = canvas.width;
    const rotatedContext = rotatedCanvas.getContext('2d');
    rotatedContext.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
    rotatedContext.rotate(Math.PI / 2);
    rotatedContext.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    const sideways = await new Promise(resolve => rotatedCanvas.toBlob(resolve, 'image/png'));
    window.ocrTestImage = original;
    const steps = [];
    const result = await recognizeImages([
      { file: new File([original], 'page-1.png', { type: 'image/png' }), rotation: 0 },
      { file: new File(['not an image'], 'broken.png', { type: 'image/png' }), rotation: 0 },
      { file: new File([sideways], 'page-3.png', { type: 'image/png' }), rotation: 270 },
    ], { rotation: 90, onProgress: event => steps.push(event) });
    return { ...result, workers: { ...window.ocrWorkers }, steps };
  });
  assert.equal(batch.pages.length, 3);
  assert.deepEqual(batch.pages.map(item => item.name), ['page-1.png', 'broken.png', 'page-3.png']);
  assert.match(batch.pages[0].text, /Reading practice/i);
  assert.match(batch.pages[2].text, /Practice makes progress/i);
  assert.match(batch.pages[0].text.replace(/\s/g, ''), /学习英语/);
  assert.ok(batch.pages[0].confidence > 50);
  assert.ok(batch.pages[2].confidence > 50);
  assert.ok(batch.pages[1].error);
  assert.equal(batch.pages[1].text, '');
  assert.equal(batch.pages[0].rotation, 0);
  assert.equal(batch.pages[2].rotation, 270);
  assert.equal(batch.workers.created, 1, 'A batch must reuse one worker');
  assert.equal(batch.workers.terminated, 1, 'Finished workers must be released');
  assert.equal(batch.steps.at(-1).progress, 1);
  assert.ok(batch.steps.some(step => step.stage === 'page-error'));
  assert.ok(batch.steps.every((step, index) => !index || step.progress >= batch.steps[index - 1].progress));

  const recovery = await page.evaluate(async () => {
    const { recognizeImages, OCR_LIMITS } = await import('/reading/ocr.js');
    const image = new File([window.ocrTestImage], 'retry.png', { type: 'image/png' });
    const retry = await recognizeImages([image], { language: 'eng' });
    const controller = new AbortController();
    let cancellation;
    try {
      await recognizeImages([image], { signal: controller.signal, language: 'eng', onProgress: event => {
        if (event.stage === 'recognizing' && event.progress > 0.2) controller.abort();
      } });
    } catch (error) { cancellation = error.name; }
    const partialController = new AbortController();
    let retained;
    try {
      await recognizeImages([image, image], { signal: partialController.signal, language: 'eng', onProgress: event => {
        if (event.pageIndex === 1 && event.stage === 'recognizing' && event.progress > 0.65) partialController.abort();
      } });
    } catch (error) { retained = { name: error.name, pages: error.pages }; }
    let failed;
    try { await recognizeImages([new File(['invalid'], 'bad.png', { type: 'image/png' })]); }
    catch (error) { failed = { code: error.code, pages: error.pages }; }
    let oversized;
    try { await recognizeImages([new File([new Uint8Array(OCR_LIMITS.maxFileBytes + 1)], 'large.png', { type: 'image/png' })]); }
    catch (error) { oversized = error.pages?.[0]?.code; }
    return { retry: retry.pages[0], cancellation, retained, failed, oversized, workers: { ...window.ocrWorkers } };
  });
  assert.match(recovery.retry.text, /Reading practice/i);
  assert.equal(recovery.cancellation, 'AbortError');
  assert.equal(recovery.retained.name, 'AbortError');
  assert.equal(recovery.retained.pages.length, 1, 'Cancellation on page two must preserve the completed first page');
  assert.match(recovery.retained.pages[0].text, /Reading practice/i);
  assert.equal(recovery.failed.code, 'no_text_detected');
  assert.equal(recovery.failed.pages.length, 1);
  assert.equal(recovery.oversized, 'image_too_large');
  assert.equal(recovery.workers.created, recovery.workers.terminated, 'Cancellation must release its worker');

  let fixture;
  if (process.env.OCR_FIXTURE_PATH) {
    const bytes = await readFile(process.env.OCR_FIXTURE_PATH);
    fixture = await page.evaluate(async ({ data, name }) => {
      const { recognizeImages } = await import('/reading/ocr.js');
      const file = new File([Uint8Array.from(atob(data), char => char.charCodeAt(0))], name, { type: 'image/jpeg' });
      const result = await recognizeImages([file]);
      return { confidence: result.pages[0].confidence, text: result.text };
    }, { data: bytes.toString('base64'), name: path.basename(process.env.OCR_FIXTURE_PATH) });
    assert.ok(fixture.text.length > 300, 'The real scanned page should produce substantial text');
  }
  assert.deepEqual(external, [], 'OCR must not request an external CDN or upload images');
  assert.deepEqual(errors, [], 'OCR should not leave unhandled browser errors');
  console.log(JSON.stringify({
    result: 'PASS', batch: batch.pages.map(({ name, confidence, error }) => ({ name, confidence, error })),
    workersReleased: recovery.workers, checks: ['real English and Chinese OCR', 'one worker per batch', 'per-page rotation', 'partial failure', 'single-page retry', 'active cancellation', 'completed pages survive cancellation', 'all-failed feedback', '12 MB limit', 'progress', 'same-origin assets only'],
    ...(fixture ? { realPage: { confidence: fixture.confidence, characters: fixture.text.length, excerpt: fixture.text.slice(0, 160) } } : {}),
  }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
