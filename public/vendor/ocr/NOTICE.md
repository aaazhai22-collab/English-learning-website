# Local OCR assets

The original release files below are bundled locally, without code changes.
Images are recognized inside a browser Web Worker. The application supplies
same-origin worker, core, and language paths; it does not send images to an
OCR service. Local development serves all assets from this directory. In the
published Worker, the four large core/language files are delivered through
fixed same-origin resource paths backed by the pinned official URLs below.
The Worker checks the exact byte length and SHA-256 before caching them.
Only public engine/data bytes are fetched upstream; image data and visitor
request headers are never forwarded. First use therefore requires a network
connection to load these public resources, which the browser can then cache.

## Engine

- **Tesseract.js 6.0.1**, Apache-2.0.
- Official source: https://github.com/naptha/tesseract.js
- Release archive: https://registry.npmjs.org/tesseract.js/-/tesseract.js-6.0.1.tgz
- Files: `tesseract.esm.min.js`, `worker.min.js`, their original source maps,
  and bundled dependency notices (`*.LICENSE.txt`).
- Original license: `LICENSE-tesseract.js.md`.

## WASM core

- **tesseract.js-core 6.0.0**, Apache-2.0.
- Official source: https://github.com/naptha/tesseract.js-core
- Release archive: https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-6.0.0.tgz
- `core/tesseract-core-lstm.wasm.js` and
  `core/tesseract-core-simd-lstm.wasm.js` are the unmodified official builds.
  Both contain their WASM bytes, so separate `.wasm` copies are unnecessary.
- The application fixes OEM to 1 (LSTM_ONLY), with `legacyCore: false`, and
  packages both SIMD and non-SIMD LSTM variants. Legacy OCR is not exposed.
- Original license: `core/LICENSE`.

## Language data

- English (`eng`) and simplified Chinese (`chi_sim`), **Tessdata Fast**.
- Official source: https://github.com/naptha/tessdata
- Pinned commit: `806cd9adc8c6e8abc11c782db1818c990576bebc`.
- Original files:
  - https://raw.githubusercontent.com/naptha/tessdata/806cd9adc8c6e8abc11c782db1818c990576bebc/4.0.0_fast/eng.traineddata.gz
  - https://raw.githubusercontent.com/naptha/tessdata/806cd9adc8c6e8abc11c782db1818c990576bebc/4.0.0_fast/chi_sim.traineddata.gz
- These traineddata files are covered by the upstream Apache-2.0 license,
  preserved in `lang/LICENSE-tessdata`.
- The package metadata of `@tesseract.js-data/*` labels its npm packaging MIT;
  this site uses the pinned upstream fast data above, not the npm best_int data.

Retrieved 2026-10-20. `scripts/check-ocr.mjs` verifies the shipped engine and
language file SHA-256 values. The application adapter is
`../../reading/ocr.js`; OCR output is never presented as a verified transcript.
