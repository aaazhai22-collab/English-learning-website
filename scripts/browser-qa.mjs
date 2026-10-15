import { chromium } from 'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve('.qa');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'] });
const report = { started: new Date().toISOString(), checks: [], errors: [] };
const check = (name, value, details) => { report.checks.push({ name, passed: Boolean(value), details }); if (!value) console.error('FAIL', name, details); };
const base = process.env.QA_BASE || 'http://localhost:5173';

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    window.__speechCalls = [];
    class MockUtterance { constructor(text) { this.text = text; this.lang = ''; this.rate = 1; } }
    const listeners = new Map();
    const synth = {
      speaking: false, pending: false, paused: false,
      getVoices: () => [{ name: 'Mock American English', lang: 'en-US', default: true, localService: true }, { name: 'Mock British English', lang: 'en-GB', default: false, localService: true }],
      addEventListener: (event, listener) => listeners.set(event, listener),
      removeEventListener: event => listeners.delete(event),
      cancel() { this.speaking = false; window.__speechCalls.push({ type: 'cancel' }); },
      resume() { window.__speechCalls.push({ type: 'resume' }); },
      speak(utterance) { this.speaking = true; window.__speechCalls.push({ type: 'speak', text: utterance.text, lang: utterance.lang, rate: utterance.rate, voice: utterance.voice?.lang }); utterance.onstart?.({}); },
    };
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: MockUtterance, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && response.url().startsWith(base)) report.errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('#readLauncher').waitFor();
  await page.screenshot({ path: path.join(output, 'desktop-home.png'), fullPage: true });
  check('homepage loaded', await page.title().then(title => title.includes('Words in Bloom')), await page.title());
  const nav = async name => { await page.locator(`#topNav [data-page="${name}"]`).click(); await page.locator(`#${name}.active`).waitFor(); };
  const speakCount = () => page.evaluate(() => window.__speechCalls.filter(call => call.type === 'speak').length);
  const lastSpeech = () => page.evaluate(() => window.__speechCalls.filter(call => call.type === 'speak').at(-1));
  const clickRead = async locator => { const text = await locator.getAttribute('data-read-text'); const before = await speakCount(); await locator.click(); await page.waitForTimeout(80); check(`point reading: ${text.slice(0, 35)}`, await speakCount() === before + 1 && (await lastSpeech()).text === text, await lastSpeech()); };
  await nav('library');
  await page.locator('#search').fill('bloom');
  await page.waitForTimeout(500);
  check('library search returns matching word', (await page.locator('#library').innerText()).toLowerCase().includes('bloom'));
  await page.locator('#clearFilters').click();
  await page.locator('#library .read-word-button').first().waitFor();
  const word = page.locator('#library .read-word-button').first();
  await clickRead(word);
  check('reading word stays in library', await page.locator('#library').evaluate(element => element.classList.contains('active')));
  const speaker = page.locator('#library .read-speaker').first();
  await clickRead(speaker);
  await page.screenshot({ path: path.join(output, 'desktop-library.png'), fullPage: false });
  await page.locator('#library [data-fav]').first().click();
  const favoriteName = await page.locator('#library .read-word-button').first().textContent();
  await nav('favorites');
  check('favorite appears in favorites', (await page.locator('#favorites').innerText()).includes(favoriteName));
  await nav('study');
  await page.locator('#study .read-word-button').first().waitFor();
  await clickRead(page.locator('#study .read-word-button').first());
  const examplesToggle = page.locator('#study [data-toggle-example]').first();
  if (await examplesToggle.count() && await examplesToggle.isVisible()) await examplesToggle.click();
  const visibleSentence = page.locator('#study .read-sentence:visible').first();
  if (await visibleSentence.count()) await clickRead(visibleSentence); else report.checks.push({ name: 'study sentence available', passed: false, details: await page.locator('#study').innerText() });
  const visiblePhrase = page.locator('#study .read-phrase-button:visible').first();
  if (await visiblePhrase.count()) await clickRead(visiblePhrase);
  const beforeStudy = await page.locator('#study .read-word-button').first().textContent();
  await page.locator('#study [data-study-step="1"]').click();
  await page.waitForFunction(previous => document.querySelector('#study .read-word-button')?.textContent !== previous, beforeStudy, { timeout: 2000 }).catch(() => {});
  check('study next changes word', beforeStudy !== await page.locator('#study .read-word-button').first().textContent());
  check('navigation stops reading', await page.locator('#readLauncher').getAttribute('data-speaking') === 'false');
  await page.screenshot({ path: path.join(output, 'desktop-study.png'), fullPage: true });
  await nav('flash');
  await page.locator('#flash .read-word-button').first().waitFor();
  await clickRead(page.locator('#flash .read-word-button').first());
  check('word click does not flip flashcard', !(await page.locator('#flash [data-flip]').getAttribute('class')).includes('flipped'));
  await page.locator('#flash .read-word-button').first().focus();
  const beforeKeyboard = await speakCount();
  await page.keyboard.press('Space');
  check('Space on reading control speaks without flipping', await speakCount() === beforeKeyboard + 1 && !(await page.locator('#flash [data-flip]').getAttribute('class')).includes('flipped'));
  await page.locator('#flash [data-flip]').click({ position: { x: 20, y: 20 } });
  check('flashcard background still flips', (await page.locator('#flash [data-flip]').getAttribute('class')).includes('flipped'));
  await clickRead(page.locator('#flash .back .read-sentence').first());
  check('sentence click does not reverse flip', (await page.locator('#flash [data-flip]').getAttribute('class')).includes('flipped'));
  await page.screenshot({ path: path.join(output, 'desktop-flash-back.png'), fullPage: true });
  await nav('quiz');
  await page.locator('#quizMode').selectOption('en-cn');
  await page.locator('#startQuiz').click();
  await page.locator('#exitQuiz').waitFor();
  check('quiz starts', await page.locator('#quiz .quiz-top').isVisible());
  await page.screenshot({ path: path.join(output, 'desktop-quiz.png'), fullPage: true });
  const quizRead = page.locator('#quiz [data-read-text]:visible').first();
  if (await quizRead.count()) await clickRead(quizRead);
  const quizOption = page.locator('#quiz [data-answer]').first();
  if (await quizOption.count()) { await quizOption.click(); check('quiz answer works', (await page.locator('#quiz .feedback').innerText()).length > 0); }
  await page.locator('#readLauncher').click();
  await page.locator('#readAccent').selectOption('en-GB');
  await page.locator('#readRate').fill('0.65');
  await page.locator('#readReplay').click();
  const configured = await lastSpeech();
  check('accent and rate passed to speech', configured.lang === 'en-GB' && configured.rate === 0.65, configured);
  const cancels = await page.evaluate(() => window.__speechCalls.filter(call => call.type === 'cancel').length);
  await page.locator('#readStop').click();
  check('stop cancels speech', await page.evaluate(() => window.__speechCalls.filter(call => call.type === 'cancel').length) > cancels && await page.locator('#readStop').isDisabled());
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#readLauncher').click();
  check('settings persist after reload', await page.locator('#readAccent').inputValue() === 'en-GB' && await page.locator('#readRate').inputValue() === '0.65');
  await page.screenshot({ path: path.join(output, 'desktop-reading-settings.png'), fullPage: true });
  await page.keyboard.press('Escape');
  check('Escape closes settings', await page.locator('#readPanel').isHidden());

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const mobilePage = await mobile.newPage();
  mobilePage.on('pageerror', error => report.errors.push(`mobile: ${error.message}`));
  await mobilePage.goto(base, { waitUntil: 'networkidle' });
  await mobilePage.screenshot({ path: path.join(output, 'mobile-home.png'), fullPage: true });
  for (const name of ['home', 'library', 'study', 'flash', 'quiz', 'favorites']) {
    await mobilePage.locator(`#bottomNav [data-page="${name}"]`).click();
    await mobilePage.locator(`#${name}.active`).waitFor();
    const dimensions = await mobilePage.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    check(`mobile ${name} no horizontal overflow`, dimensions.scroll <= dimensions.width + 1, dimensions);
    if (['library', 'study', 'flash'].includes(name)) await mobilePage.screenshot({ path: path.join(output, `mobile-${name}.png`), fullPage: true });
  }
  await mobilePage.locator('#readLauncher').click();
  const panelBox = await mobilePage.locator('#readPanel').boundingBox();
  check('mobile reading panel fits viewport', panelBox.x >= 0 && panelBox.x + panelBox.width <= 391, panelBox);
  await mobilePage.screenshot({ path: path.join(output, 'mobile-reading-settings.png'), fullPage: true });
  await mobile.close();

  const native = await browser.newContext();
  await native.addInitScript(() => {
    window.__nativeAudioEvents = [];
    const observed = new WeakSet();
    const originalPlay = HTMLMediaElement.prototype.play;
    const snapshot = (element, event, extra = {}) => window.__nativeAudioEvents.push({
      event, at: performance.now(), src: element.currentSrc || element.src,
      readyState: element.readyState, networkState: element.networkState,
      duration: Number.isFinite(element.duration) ? element.duration : null,
      paused: element.paused, currentTime: element.currentTime,
      error: element.error ? { code: element.error.code, message: element.error.message } : null,
      ...extra,
    });
    HTMLMediaElement.prototype.play = function (...args) {
      if (!observed.has(this)) {
        observed.add(this);
        for (const event of ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'playing', 'pause', 'ended', 'error', 'stalled', 'waiting']) this.addEventListener(event, () => snapshot(this, event));
      }
      snapshot(this, 'play-call');
      const result = Reflect.apply(originalPlay, this, args);
      result?.then(() => snapshot(this, 'play-resolved'), error => snapshot(this, 'play-rejected', { rejection: { name: error.name, message: error.message } }));
      return result;
    };
  });
  const nativePage = await native.newPage();
  report.nativeAudio = { responses: [], samples: [] };
  nativePage.on('response', response => {
    const contentType = response.headers()['content-type'] || '';
    if (response.url().includes('translate_tts') || response.url().includes('/api/tts') || contentType.startsWith('audio/')) report.nativeAudio.responses.push({ url: response.url(), status: response.status(), contentType });
  });
  nativePage.on('requestfailed', request => {
    if (request.url().includes('translate_tts') || request.url().includes('/api/tts')) report.nativeAudio.responses.push({ url: request.url(), failure: request.failure()?.errorText });
  });
  await nativePage.goto(base, { waitUntil: 'networkidle' });
  report.nativeSpeech = await nativePage.evaluate(async () => {
    if (!('speechSynthesis' in window)) return { supported: false };
    await new Promise(resolve => { if (speechSynthesis.getVoices().length) resolve(); else { speechSynthesis.addEventListener('voiceschanged', resolve, { once: true }); setTimeout(resolve, 1500); } });
    return { supported: typeof SpeechSynthesisUtterance === 'function', voices: speechSynthesis.getVoices().map(voice => ({ name: voice.name, lang: voice.lang, localService: voice.localService })) };
  });
  report.nativeSpeech.note = 'API and installed voice availability only. Mock checks validate dispatch and cancellation, not audible playback.';
  if (!report.nativeSpeech.voices?.some(voice => /^en(?:-|$)/i.test(voice.lang))) {
    await nativePage.locator('#topNav [data-page="study"]').click();
    await nativePage.locator('#study .read-word-button').first().waitFor();
    for (const [kind, selector] of [['word', '#study .read-word-button'], ['sentence', '#study .read-sentence']]) {
      const target = nativePage.locator(selector).first();
      const text = await target.getAttribute('data-read-text');
      const start = await nativePage.evaluate(() => window.__nativeAudioEvents.length);
      await target.click();
      await nativePage.waitForFunction(from => window.__nativeAudioEvents.slice(from).some(event => ['playing', 'play-rejected', 'error'].includes(event.event)), start, { timeout: 20000 }).catch(() => {});
      const events = await nativePage.evaluate(from => window.__nativeAudioEvents.slice(from), start);
      const playing = events.find(event => event.event === 'playing');
      report.nativeAudio.samples.push({ kind, text, events, status: await nativePage.locator('#readStatus').textContent() });
      check(`native online ${kind} audio reaches playing`, Boolean(playing && playing.readyState >= 2), events);
      check(`native online ${kind} audio decoded`, events.some(event => event.duration > 0 && event.readyState >= 1), events);
    }
  } else {
    report.nativeAudio.note = 'An English system voice is available, so online fallback is not expected in this native context.';
  }
  report.nativeAudio.playbackNote = 'Native media calls are pass-through observations. Playing and metadata validate browser decoding/playback state; audible speaker output is not verified.';
  await native.close();
  await context.close();
} catch (error) {
  report.errors.push(error.stack || String(error));
} finally {
  report.finished = new Date().toISOString();
  await writeFile(path.join(output, 'browser-qa.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
process.exitCode = report.errors.length || report.checks.some(check => !check.passed) ? 1 : 0;
