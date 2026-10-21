import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OCR_LIMITS, recognizeImages } from '../public/reading/ocr.js';

const root = new URL('../', import.meta.url);
const checked = spawnSync(process.execPath, ['--check', fileURLToPath(new URL('public/reading/ocr.js', root))], { encoding: 'utf8' });
assert.equal(checked.status, 0, checked.stderr);
assert.equal(OCR_LIMITS.maxFiles, 10);
assert.equal(OCR_LIMITS.maxFileBytes, 12 * 1024 * 1024);
await assert.rejects(recognizeImages([]), { code: 'no_images' });
await assert.rejects(recognizeImages(Array(11).fill(null)), { code: 'too_many_images' });
await assert.rejects(recognizeImages([], { rotation: 45 }), { code: 'invalid_rotation' });
const controller = new AbortController();
controller.abort();
await assert.rejects(recognizeImages([], { signal: controller.signal }), { name: 'AbortError' });

// Checksums identify unmodified files from the pinned official releases.
const hashes = {
  'tesseract.esm.min.js': 'da6267cfe5036ae718a59eece3b5744a4655b0b8faa9f16259362b783d74c9bb',
  'worker.min.js': '38645599043239c0eb6db08a6504a92dcdc292200535f3e9339cd77c4443b842',
  'core/tesseract-core-lstm.wasm.js': '775a35df6f2ae100e02609443e6bd5cafcd07983dd6175454ca4a432a7730687',
  'core/tesseract-core-simd-lstm.wasm.js': '9d7c43fb206dc9f48475228b46bf35f888fa9e6259da2e67d5a75c77049f2dc7',
  'lang/eng.traineddata.gz': '18c1ac52b75e35d44735fb6c2a60acfaf23033524653200738e98f0243edb75b',
  'lang/chi_sim.traineddata.gz': '3aa140069a09796b8cb8d3ccd0c052e8ed67f20cddb24b70ffa3344b3b94346b',
};
for (const [name, expected] of Object.entries(hashes)) {
  const bytes = await readFile(new URL(`public/vendor/ocr/${name}`, root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `Changed OCR asset: ${name}`);
  if (name.endsWith('.gz')) assert.ok(gunzipSync(bytes).length > 1_000_000, `Invalid traineddata: ${name}`);
}
for (const name of ['NOTICE.md', 'LICENSE-tesseract.js.md', 'core/LICENSE', 'lang/LICENSE-tessdata', 'worker.min.js.LICENSE.txt', 'tesseract.min.js.LICENSE.txt']) {
  assert.ok((await readFile(new URL(`public/vendor/ocr/${name}`, root))).length > 100, `Missing license: ${name}`);
}
console.log('OCR checks passed: limits, cancellation contract, local official engine/data checksums, language gzip integrity and licenses.');
