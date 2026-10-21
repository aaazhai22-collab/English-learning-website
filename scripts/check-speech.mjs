import assert from 'node:assert/strict';
import { createSpeechController } from '../public/speech.js';

// Deterministic browser doubles exercise playback and recovery without a voice
// installation, network access, or real-time delays.
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
let checks = 0;

function harness({ native = true, audio = true, nativeBehavior = 'silent', audioBehavior = 'playing', voices, allowReadingOnline = true, catalog } = {}) {
  let now = 0, nextTimer = 0;
  const timers = new Map(), utterances = [], audioItems = [], errors = [], states = [], listeners = new Map();
  globalThis.setTimeout = (callback, delay = 0) => {
    const id = ++nextTimer;
    timers.set(id, { callback, at: now + delay });
    return id;
  };
  globalThis.clearTimeout = id => timers.delete(id);
  const advance = milliseconds => {
    const target = now + milliseconds;
    for (;;) {
      const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at;
      timers.delete(due[0]);
      due[1].callback();
    }
    now = target;
  };
  class MockUtterance {
    constructor(text) { this.text = text; }
  }
  const synth = {
    cancels: 0,
    paused: false,
    getVoices: () => voices || [
      { name: 'American', lang: 'en-US', localService: true },
      { name: 'British', lang: 'en-GB', localService: true },
    ],
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: name => listeners.delete(name),
    cancel() { this.cancels++; },
    resume() { this.paused = false; },
    speak(utterance) {
      utterances.push(utterance);
      if (nativeBehavior === 'start') utterance.onstart?.();
      if (nativeBehavior === 'error') utterance.onerror?.({ error: 'voice-unavailable' });
      if (nativeBehavior === 'throw') throw new Error('Mock voice failure');
    },
  };
  class MockAudio {
    constructor() { this.playedSources = []; audioItems.push(this); }
    play() {
      this.playedSources.push(this.src);
      if (audioBehavior === 'playing') this.onplaying?.();
      return audioBehavior === 'reject' ? Promise.reject(new Error('Mock audio failure')) : Promise.resolve();
    }
    pause() { this.paused = true; }
    removeAttribute() { this.src = ''; }
    load() { this.loaded = true; }
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    ...(native ? { speechSynthesis: synth, SpeechSynthesisUtterance: MockUtterance } : {}),
    ...(audio ? { Audio: MockAudio } : {}),
    ...(catalog ? { fetch: async () => ({ ok: true, json: async () => catalog }) } : {}),
  } });
  const controller = createSpeechController({ allowReadingOnline, onStateChange: state => states.push(state), onError: error => errors.push(error) });
  return { controller, synth, utterances, audioItems, errors, states, listeners, timers, advance };
}

async function check(name, run) {
  let current;
  try {
    await run(options => (current = harness(options)));
    checks++;
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  } finally {
    current?.controller.destroy();
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
}

await check('Native start, settings and normal completion', make => {
  const h = make({ nativeBehavior: 'start' });
  let ended = 0;
  h.controller.setAccent('UK');
  h.controller.setRate(0.65);
  assert.equal(h.controller.speak('  Hello   world. ', { onEnd: () => ended++ }), true);
  assert.equal(h.utterances[0].text, 'Hello world.');
  assert.equal(h.utterances[0].voice.name, 'British');
  assert.equal(h.utterances[0].lang, 'en-GB');
  assert.equal(h.utterances[0].rate, 0.65);
  assert.equal(h.controller.getState().status, 'speaking');
  assert.equal(h.timers.size, 0, 'onstart must clear the startup timeout');
  h.advance(20000);
  assert.equal(h.audioItems.length, 0, 'A started voice must not fall back');
  h.utterances[0].onend();
  assert.equal(ended, 1);
  assert.equal(h.controller.getState().status, 'idle');
});

await check('Silent native startup falls back and ignores stale events', make => {
  const h = make();
  let ended = 0;
  h.controller.speak('Recover this sentence.', { onEnd: () => ended++ });
  const old = h.utterances[0];
  const stale = [old.onstart, old.onend, () => oldError({ error: 'network' })];
  const oldError = old.onerror;
  h.advance(3999);
  assert.equal(h.audioItems.length, 0);
  h.advance(1);
  assert.equal(h.synth.cancels, 2, 'Timeout must cancel the native utterance before fallback');
  assert.equal(old.onstart, null);
  assert.equal(old.onend, null);
  assert.equal(old.onerror, null);
  assert.equal(h.audioItems.length, 1);
  assert.match(h.audioItems[0].src, /^\/api\/reading\/tts\?/);
  assert.equal(h.controller.getState().status, 'speaking');
  for (const callback of stale) callback();
  assert.equal(ended, 0, 'A stale native end must not advance a full-text sequence');
  assert.equal(h.errors.length, 0);
  assert.equal(h.controller.getState().status, 'speaking');
  h.audioItems[0].onended();
  assert.equal(ended, 1);
});

await check('Silent native startup without fallback reports an actionable error', make => {
  const h = make({ audio: false });
  h.controller.speak('A system-only sentence.');
  h.advance(4000);
  assert.equal(h.controller.getState().speaking, false);
  assert.equal(h.controller.getState().error.code, 'synthesis-timeout');
  assert.equal(h.errors.length, 1);
  assert.equal(h.timers.size, 0);
});

for (const nativeBehavior of ['error', 'throw']) {
  await check(`Native ${nativeBehavior} falls back once`, make => {
    const h = make({ nativeBehavior });
    h.controller.speak('Try the online voice.');
    assert.equal(h.audioItems.length, 1);
    assert.equal(h.controller.getState().status, 'speaking');
    assert.equal(h.timers.size, 0);
    h.advance(20000);
    assert.equal(h.audioItems.length, 1);
  });
}

await check('Missing English voice falls back without queuing native speech', make => {
  const h = make({ voices: [{ name: 'Chinese', lang: 'zh-CN' }] });
  h.controller.speak('English only.');
  assert.equal(h.utterances.length, 0);
  assert.equal(h.audioItems.length, 1);
});

await check('Native interruption, stop and destroy invalidate callbacks and timers', make => {
  const h = make();
  let ended = 0;
  h.controller.speak('First sentence.', { onEnd: () => ended++ });
  const staleEnd = h.utterances[0].onend;
  const staleError = h.utterances[0].onerror;
  h.controller.speak('Second sentence.');
  staleEnd();
  staleError({ error: 'voice-unavailable' });
  assert.equal(h.controller.getState().text, 'Second sentence.');
  assert.equal(h.timers.size, 1);
  h.controller.stop();
  assert.equal(h.timers.size, 0);
  h.advance(20000);
  assert.equal(ended, 0);
  assert.equal(h.audioItems.length, 0);
  assert.equal(h.controller.getState().status, 'idle');
  h.controller.speak('Third sentence.');
  h.controller.destroy();
  assert.equal(h.timers.size, 0);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.controller.speak('After teardown.'), false);
  h.advance(20000);
  assert.equal(h.audioItems.length, 0);
});

await check('Online long text reuses one audio element and finishes only once', make => {
  const h = make({ native: false });
  const text = 'A simple English sentence. '.repeat(25).trim();
  let ended = 0;
  h.controller.speak(text, { lang: 'en-GB', rate: 0.75, onEnd: () => ended++ });
  const audio = h.audioItems[0];
  for (let guard = 0; h.controller.getState().speaking && guard < 20; guard++) audio.onended();
  assert.equal(h.audioItems.length, 1);
  assert.ok(audio.playedSources.length > 1);
  const chunks = audio.playedSources.map(src => {
    const url = new URL(src, 'https://test.local');
    assert.equal(url.searchParams.get('lang'), 'en-GB');
    assert.ok(url.searchParams.get('text').length <= 180);
    return url.searchParams.get('text');
  });
  assert.equal(chunks.join(' '), text);
  assert.equal(audio.playbackRate, 0.75);
  assert.equal(ended, 1);
  assert.equal(h.controller.getState().status, 'idle');
  assert.equal(h.timers.size, 0);
});

await check('Online interruption and stop release media and reject stale callbacks', make => {
  const h = make({ native: false });
  let ended = 0;
  h.controller.speak('First online sentence.', { onEnd: () => ended++ });
  const first = h.audioItems[0], staleEnd = first.onended, staleError = first.onerror;
  h.controller.speak('Second online sentence.');
  assert.equal(first.paused, true);
  assert.equal(first.src, '');
  staleEnd();
  staleError();
  assert.equal(h.controller.getState().text, 'Second online sentence.');
  assert.equal(h.controller.getState().status, 'speaking');
  h.controller.stop();
  assert.equal(h.audioItems[1].paused, true);
  assert.equal(h.audioItems[1].onended, null);
  assert.equal(h.timers.size, 0);
  assert.equal(h.errors.length, 0);
  assert.equal(ended, 0);
});

await check('Online media errors release playback and do not advance the sequence', make => {
  const h = make({ native: false });
  let ended = 0;
  h.controller.speak('Unavailable audio.', { onEnd: () => ended++ });
  h.audioItems[0].onerror();
  assert.equal(h.controller.getState().error.code, 'online-unavailable');
  assert.equal(h.audioItems[0].paused, true);
  assert.equal(h.timers.size, 0);
  assert.equal(ended, 0);
});

await check('Online playback timeout clears the busy state', make => {
  const h = make({ native: false, audioBehavior: 'silent' });
  h.controller.speak('An audio request that never starts.');
  h.advance(15000);
  assert.equal(h.controller.getState().speaking, false);
  assert.equal(h.controller.getState().error.code, 'online-timeout');
  assert.equal(h.audioItems[0].paused, true);
  assert.equal(h.timers.size, 0);
});

await check('Rejected media playback reports an error', async make => {
  const h = make({ native: false, audioBehavior: 'reject' });
  h.controller.speak('Playback denied.');
  await Promise.resolve();
  assert.equal(h.controller.getState().error.code, 'online-unavailable');
  assert.equal(h.controller.getState().speaking, false);
});

await check('Unsupported devices report failure immediately', make => {
  const h = make({ native: false, audio: false });
  assert.equal(h.controller.speak('Hello.'), false);
  assert.equal(h.controller.getState().status, 'unsupported');
  assert.equal(h.errors[0].code, 'unsupported');
});

await check('Public vocabulary fallback accepts exact catalog entries only', async make => {
  const h = make({ native: false, allowReadingOnline: false, catalog: {
    words: [{ word: 'bloom', examples: [{ sentence: 'Flowers bloom.', collocations: [{ phrase: 'in bloom' }] }] }],
  } });
  await new Promise(resolve => realSetTimeout(resolve, 0));
  assert.equal(h.controller.speak('bloom'), true);
  assert.equal(h.audioItems[0].src, '/api/tts?entry=0&lang=en-US&chunk=0');
  h.controller.stop();
  assert.equal(h.controller.speak('Private text outside the catalog.'), false);
  assert.equal(h.audioItems.length, 1, 'Unmatched text must never create an online media request');
  assert.equal(h.controller.getState().error.code, 'online-text-unavailable');
});

console.log(`Speech checks passed: ${checks} deterministic scenarios covering native startup recovery, interruption, settings, online chunking, media failures, teardown and public-text restrictions.`);
