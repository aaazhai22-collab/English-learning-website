# ts-fsrs

- Package: **ts-fsrs 5.4.2**
- Source repository: https://github.com/open-spaced-repetition/ts-fsrs
- Official npm release: https://www.npmjs.com/package/ts-fsrs/v/5.4.2
- Download: https://registry.npmjs.org/ts-fsrs/-/ts-fsrs-5.4.2.tgz
- License: **MIT**; the original copyright and license are preserved in `LICENSE`.
- Retrieved: 2026-10-16
- npm integrity: `sha512-z4qop4pzTcyTzuJ566d9EaX/4bZZzhYfeaPImfVr+xcYT65c5oBgFDijUhCE/D+C78eaolHIhKRZ04/RwF+v2g==`

`index.mjs` and `index.mjs.map` are the unmodified ESM build and source map
from the official npm package's `dist/` directory. The bundled build has no
external runtime imports and can be imported directly in a browser.

The application's adapter is `../../reading/review.js`. It stores the FSRS
card and restores its date fields after JSON persistence. Scheduling uses the
library's default parameters and learning steps, with fuzz disabled for
deterministic review intervals.
