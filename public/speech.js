/**
 * Browser speech synthesis with safe interruption and English voice selection.
 * The optional online fallback is restricted to exact public vocabulary entries
 * in the bundled data/catalog.json, copied from the user's public reference site.
 * The same-origin audio endpoint receives only public entry IDs, never caller text.
 *
 * const speech = createSpeechController({
 *   onStateChange: ({ speaking, text }) => updateReadButton(speaking, text),
 *   onError: ({ message }) => showToast(message),
 * });
 * speech.speak('bloom');
 * speech.setAccent('en-GB');
 * speech.setRate(0.75);
 */
const normalizeSpeechText = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
let publicOnlineTexts = null;
let publicCatalogLoading = false;

function loadPublicOnlineAllowlist(browser) {
  if (publicOnlineTexts || publicCatalogLoading || typeof browser.fetch !== 'function') return;
  publicCatalogLoading = true;
  // Fixed, bundled, same-origin public source: never a URL supplied by the caller.
  const catalogUrl = new URL('./data/catalog.json', import.meta.url);
  Promise.resolve(browser.fetch(catalogUrl, { credentials: 'omit', cache: 'force-cache' }))
    .then(response => {
      if (!response.ok) throw new Error('Public vocabulary unavailable');
      return response.json();
    })
    .then(catalog => {
      const allowed = new Map();
      const add = text => {
        if (typeof text !== 'string') return;
        const normalized = normalizeSpeechText(text);
        if (normalized && !allowed.has(normalized)) allowed.set(normalized, allowed.size);
      };
      for (const word of Array.isArray(catalog.words) ? catalog.words : []) {
        add(word.word);
        for (const example of Array.isArray(word.examples) ? word.examples : []) {
          add(example.sentence);
          for (const item of Array.isArray(example.collocations) ? example.collocations : []) add(item.phrase);
        }
        for (const item of Array.isArray(word.collocations) ? word.collocations : []) add(item.phrase);
      }
      publicOnlineTexts = allowed;
    })
    .catch(() => { /* Fail closed: unverified text can only use system speech. */ })
    .finally(() => { publicCatalogLoading = false; });
}

export function createSpeechController({ onStateChange, onError } = {}) {
  const browser = typeof window === 'undefined' ? globalThis : window;
  const synth = browser.speechSynthesis;
  const Utterance = browser.SpeechSynthesisUtterance;
  const AudioConstructor = browser.Audio;
  const nativeSupported = Boolean(synth && typeof synth.speak === 'function' && Utterance);
  const onlineSupported = typeof AudioConstructor === 'function';
  const supported = nativeSupported || onlineSupported;
  let destroyed = false;
  let generation = 0;
  let currentUtterance = null;
  let currentAudio = null;
  let audioLoadTimer = null;
  let voices = [];
  let defaultRate = 0.85;
  let defaultAccent = 'en-US';
  let state = {
    supported,
    speaking: false,
    status: supported ? 'idle' : 'unsupported',
    text: '',
    lang: defaultAccent,
    accent: defaultAccent,
    rate: defaultRate,
    voice: null,
    error: null,
  };

  const emit = (patch = {}) => {
    state = { ...state, ...patch };
    if (!destroyed && typeof onStateChange === 'function') onStateChange({ ...state });
  };

  const fail = (code, message) => {
    const error = { code, message };
    emit({ speaking: false, status: supported ? 'error' : 'unsupported', error });
    if (!destroyed && typeof onError === 'function') onError(error);
    return false;
  };

  const normalizeAccent = (accent) => {
    const value = String(accent || '').trim();
    if (/^(uk|gb|british|en[-_]gb)$/i.test(value)) return 'en-GB';
    if (/^(us|american|en[-_]us)$/i.test(value)) return 'en-US';
    return value.replace('_', '-') || 'en-US';
  };

  const normalizeRate = (rate) => {
    const value = Number(rate);
    return Number.isFinite(value) ? Math.min(2, Math.max(0.5, value)) : defaultRate;
  };

  const readVoices = () => {
    if (!nativeSupported || destroyed) return [];
    try {
      voices = synth.getVoices().slice();
    } catch {
      voices = [];
    }
    return voices.slice();
  };

  const chooseVoice = (lang) => {
    const requested = lang.toLowerCase();
    const language = requested.split('-')[0];
    const scored = voices.map((voice, index) => {
      const voiceLang = String(voice.lang || '').replace('_', '-').toLowerCase();
      let score = voiceLang === requested ? 100 : voiceLang.split('-')[0] === language ? 40 : 0;
      if (!score) return { voice, score: -1, index };
      // Exact accent takes precedence; local voices work without a network connection.
      if (voice.localService) score += 10;
      if (voice.default) score += 2;
      return { voice, score, index };
    });
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    return scored[0]?.score >= 0 ? scored[0].voice : null;
  };

  const releaseAudio = () => {
    clearTimeout(audioLoadTimer);
    audioLoadTimer = null;
    const audio = currentAudio;
    currentAudio = null;
    if (!audio) return;
    audio.onplaying = null;
    audio.onended = null;
    audio.onerror = null;
    try { audio.pause(); } catch { /* The media element may already be detached. */ }
    try {
      audio.removeAttribute('src');
      audio.load();
    } catch { /* Older media implementations may not expose load(). */ }
  };

  const splitOnlineText = (text) => {
    const chunks = [];
    let current = '';
    for (let word of text.split(/\s+/)) {
      if (current && current.length + word.length + 1 > 180) {
        chunks.push(current);
        current = '';
      }
      while (word.length > 180) {
        chunks.push(word.slice(0, 180));
        word = word.slice(180);
      }
      if (word) current = current ? `${current} ${word}` : word;
    }
    if (current) chunks.push(current);
    return chunks;
  };

  const cancelCurrent = () => {
    generation += 1;
    if (currentUtterance) {
      currentUtterance.onstart = null;
      currentUtterance.onend = null;
      currentUtterance.onerror = null;
      currentUtterance = null;
    }
    releaseAudio();
    if (nativeSupported) {
      try { synth.cancel(); } catch { /* Some browser engines throw during teardown. */ }
    }
  };

  const refreshVoices = () => {
    readVoices();
    // Do not change the active voice label while an utterance is in progress.
    if (!state.speaking) emit({ voice: chooseVoice(defaultAccent)?.name || null });
  };

  if (nativeSupported && typeof synth.addEventListener === 'function') {
    synth.addEventListener('voiceschanged', refreshVoices);
  }
  readVoices();
  if (onlineSupported) loadPublicOnlineAllowlist(browser);
  state.voice = chooseVoice(defaultAccent)?.name || null;
  emit();

  return {
    /** Returns true when the utterance has been queued, false on invalid input. */
    speak(text, { lang = defaultAccent, rate = defaultRate, onEnd } = {}) {
      if (destroyed) return false;
      if (!supported) return fail('unsupported', '当前浏览器暂不支持点读，请使用新版 Chrome、Edge 或 Safari。');
      const cleanText = normalizeSpeechText(text);
      if (!cleanText) return fail('empty-text', '没有可朗读的内容。');

      cancelCurrent();
      const token = generation;
      const selectedLang = normalizeAccent(lang);
      const selectedRate = normalizeRate(rate);
      readVoices();
      const selectedVoice = chooseVoice(selectedLang);

      // Authorization is an exact match against public catalog text, before any
      // segmentation. A caller cannot opt in an arbitrary string or extend this set.
      const entryId = publicOnlineTexts?.get(cleanText);
      const canUseOnline = onlineSupported && Number.isInteger(entryId);
      const finish = () => {
        emit({ speaking: false, status: 'idle', error: null });
        if (typeof onEnd === 'function') onEnd({ text: cleanText, lang: selectedLang });
      };
      const playOnline = () => {
        // Check again at the request boundary: unmatched text never leaves the page.
        if (!canUseOnline || publicOnlineTexts?.get(cleanText) !== entryId || destroyed || token !== generation) return false;
        const chunks = splitOnlineText(cleanText);
        let chunkIndex = 0;
        let audio;
        const onlineFailure = (code = 'online-unavailable') => {
          if (destroyed || token !== generation || currentAudio !== audio) return false;
          releaseAudio();
          return fail(code, '在线发音不可用，请安装英语语音包或稍后重试。');
        };
        try {
          audio = new AudioConstructor();
          currentAudio = audio;
          audio.preload = 'auto';
          audio.preservesPitch = true;
          emit({ speaking: true, status: 'starting', voice: '在线英语发音', error: null });
          const isCurrentAudio = () => !destroyed && generation === token && currentAudio === audio;
          audio.onplaying = () => {
            if (!isCurrentAudio()) return;
            clearTimeout(audioLoadTimer);
            audioLoadTimer = null;
            emit({ speaking: true, status: 'speaking' });
          };
          audio.onerror = () => onlineFailure();
          const playChunk = () => {
            if (!isCurrentAudio()) return false;
            // The server independently resolves this public ID; no text is submitted.
            audio.src = `/api/tts?entry=${entryId}&lang=${encodeURIComponent(selectedLang)}&chunk=${chunkIndex}`;
            audio.playbackRate = selectedRate;
            clearTimeout(audioLoadTimer);
            audioLoadTimer = setTimeout(() => onlineFailure('online-timeout'), 15000);
            try {
              // No fetch/await/timer before the first play(): keep click activation.
              // Reusing this element preserves media permission between chunks.
              const playback = audio.play();
              if (playback && typeof playback.catch === 'function') {
                playback.catch(() => { if (isCurrentAudio()) onlineFailure(); });
              }
              return true;
            } catch { return onlineFailure(); }
          };
          audio.onended = () => {
            if (!isCurrentAudio()) return;
            chunkIndex += 1;
            if (chunkIndex < chunks.length) playChunk();
            else { releaseAudio(); finish(); }
          };
          return playChunk();
        } catch {
          if (!destroyed && token === generation) {
            releaseAudio();
            return fail('online-unavailable', '在线发音不可用，请安装英语语音包或稍后重试。');
          }
          return false;
        }
      };

      emit({
        speaking: true,
        status: 'starting',
        text: cleanText,
        lang: selectedLang,
        rate: selectedRate,
        voice: selectedVoice?.name || null,
        error: null,
      });
      if ((!nativeSupported || !selectedVoice) && canUseOnline) return playOnline();
      if (!nativeSupported) {
        return fail(publicCatalogLoading ? 'online-not-ready' : 'online-text-unavailable', publicCatalogLoading
          ? '在线发音词库正在准备，请稍后再次点击。'
          : '当前文本没有可用的英语语音，请安装英语语音包。');
      }
      if (!selectedVoice && onlineSupported && !canUseOnline && typeof onError === 'function') {
        onError({ code: 'system-voice-only', message: publicCatalogLoading
          ? '在线发音词库正在准备，暂时使用系统语音。'
          : '当前文本暂时使用系统语音，建议安装英语语音包。' });
      }
      const utterance = new Utterance(cleanText);
      currentUtterance = utterance; // Keep a strong reference until completion.
      utterance.lang = selectedLang;
      utterance.rate = selectedRate;
      utterance.pitch = 1;
      utterance.volume = 1;
      if (selectedVoice) utterance.voice = selectedVoice;

      const isCurrent = () => !destroyed && generation === token && currentUtterance === utterance;
      utterance.onstart = () => {
        if (isCurrent()) emit({ speaking: true, status: 'speaking' });
      };
      utterance.onend = () => {
        if (!isCurrent()) return;
        currentUtterance = null;
        finish();
      };
      utterance.onerror = (event) => {
        if (!isCurrent()) return;
        currentUtterance = null;
        const code = event.error || 'synthesis-failed';
        if (code === 'canceled' || code === 'interrupted') {
          emit({ speaking: false, status: 'idle', error: null });
          return;
        }
        if (canUseOnline) { playOnline(); return; }
        const messages = {
          'not-allowed': '浏览器阻止了语音播放，请点击点读按钮后重试。',
          'audio-busy': '音频设备正忙，请稍后重试。',
          'audio-hardware': '无法使用音频设备，请检查声音设置。',
          'network': '语音服务连接失败，请检查网络或切换口音后重试。',
          'voice-unavailable': '当前语音不可用，请切换口音后重试。',
          'language-unavailable': '当前浏览器没有可用的英语语音，请安装英语语音包。',
          'text-too-long': '朗读内容过长，请选择较短的句子。',
        };
        fail(code, messages[code] || '朗读暂时失败，请再试一次。');
      };

      try {
        // Keep this synchronous with the click to preserve mobile user activation.
        if (synth.paused) synth.resume();
        synth.speak(utterance);
        return true;
      } catch (error) {
        if (isCurrent()) {
          currentUtterance = null;
          if (canUseOnline) return playOnline();
          return fail('synthesis-failed', '无法开始朗读，请检查浏览器的声音权限后重试。');
        }
        return false;
      }
    },

    stop() {
      if (destroyed) return;
      cancelCurrent();
      emit({ speaking: false, status: supported ? 'idle' : 'unsupported', error: null });
    },

    /** Changes the default for the next utterance; returns the clamped value. */
    setRate(rate) {
      if (destroyed) return defaultRate;
      defaultRate = normalizeRate(rate);
      emit({ rate: defaultRate });
      return defaultRate;
    },

    /** Accepts en-US / en-GB, US / UK, or another BCP 47 language tag. */
    setAccent(accent) {
      if (destroyed) return defaultAccent;
      defaultAccent = normalizeAccent(accent);
      const patch = { accent: defaultAccent };
      if (!state.speaking) Object.assign(patch, { lang: defaultAccent, voice: chooseVoice(defaultAccent)?.name || null });
      emit(patch);
      return defaultAccent;
    },

    getVoices() {
      return readVoices();
    },

    getState() {
      return { ...state };
    },

    destroy() {
      if (destroyed) return;
      cancelCurrent();
      if (nativeSupported && typeof synth.removeEventListener === 'function') {
        synth.removeEventListener('voiceschanged', refreshVoices);
      }
      emit({ speaking: false, status: supported ? 'idle' : 'unsupported' });
      destroyed = true;
      voices = [];
    },
  };
}

export default createSpeechController;
