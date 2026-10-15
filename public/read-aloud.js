import { createSpeechController } from './speech.js';

const speakerIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
const preferencesKey = 'wordsInBloomReadAloud';
let preferences = { rate: 0.85, accent: 'en-US' };
try {
  const saved = JSON.parse(localStorage.getItem(preferencesKey) || 'null');
  if (saved && Number.isFinite(saved.rate)) preferences.rate = Math.min(1.25, Math.max(0.5, saved.rate));
  if (saved && ['en-US', 'en-GB'].includes(saved.accent)) preferences.accent = saved.accent;
} catch { /* Reading still works when browser storage is unavailable. */ }

const launcher = document.createElement('button');
launcher.className = 'read-launcher';
launcher.type = 'button';
launcher.id = 'readLauncher';
launcher.setAttribute('aria-expanded', 'false');
launcher.setAttribute('aria-controls', 'readPanel');
launcher.setAttribute('aria-label', '打开点读设置');
launcher.innerHTML = `${speakerIcon}<span>点读</span><i class="read-dot" aria-hidden="true"></i>`;

const panel = document.createElement('section');
panel.className = 'read-panel';
panel.id = 'readPanel';
panel.hidden = true;
panel.setAttribute('aria-labelledby', 'readTitle');
panel.innerHTML = `
  <div class="read-panel-head"><h2 id="readTitle">让单词，读给你听</h2><button type="button" class="read-close" aria-label="关闭点读设置">×</button></div>
  <p class="read-description">点击单词、例句或搭配，听见它的声音。</p>
  <div class="read-setting"><label class="read-setting-title" for="readAccent">发音口音</label><select id="readAccent"><option value="en-US">美式英语 · American</option><option value="en-GB">英式英语 · British</option></select></div>
  <div class="read-setting"><label class="read-setting-title" for="readRate"><span>朗读语速</span><output id="readRateValue" for="readRate">0.85×</output></label><input id="readRate" type="range" min="0.5" max="1.25" step="0.05" value="0.85" aria-label="朗读语速" /></div>
  <div class="read-status" role="status" aria-live="polite" id="readStatus">轻点任意英文单词，开始点读。</div>
  <div class="read-panel-actions"><button type="button" class="pill primary" id="readReplay">试听发音</button><button type="button" class="pill" id="readStop" disabled>停止朗读</button></div>
  <p class="read-footnote">优先使用系统英语语音；未安装时为公开词库提供在线发音，需要网络并将所选词库文本发送至 Google 语音服务。设置会自动保存。</p>`;
const toast = document.createElement('div');
toast.className = 'read-toast';
toast.hidden = true;
toast.setAttribute('role', 'alert');
document.body.append(launcher, panel, toast);

const status = panel.querySelector('#readStatus');
const rateControl = panel.querySelector('#readRate');
const rateValue = panel.querySelector('#readRateValue');
const accentControl = panel.querySelector('#readAccent');
const replay = panel.querySelector('#readReplay');
const stop = panel.querySelector('#readStop');
let activeElement = null;
let lastText = '';
let toastTimer;

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
}

const speech = createSpeechController({
  onStateChange(state) {
    launcher.dataset.speaking = String(state.speaking);
    launcher.querySelector('span').textContent = state.speaking ? '正在点读' : '点读';
    stop.disabled = !state.speaking;
    replay.disabled = !state.supported;
    if (state.speaking) status.textContent = `正在朗读 · ${state.text}`;
    else if (state.error) status.textContent = state.error.message;
    else if (!state.supported) status.textContent = '当前浏览器不支持语音，请使用新版 Chrome、Edge 或 Safari。';
    else status.textContent = lastText ? `上次点读 · ${lastText}` : '轻点任意英文单词，开始点读。';
    if (!state.speaking && activeElement) {
      activeElement.classList.remove('read-active');
      activeElement.removeAttribute('aria-busy');
      activeElement = null;
    }
  },
  onError: ({ message }) => showToast(message),
});
speech.setRate(preferences.rate);
speech.setAccent(preferences.accent);
rateControl.value = String(preferences.rate);
rateValue.value = `${preferences.rate.toFixed(2)}×`;
accentControl.value = preferences.accent;

function savePreferences() {
  try { localStorage.setItem(preferencesKey, JSON.stringify(preferences)); } catch { /* Non-persistent mode remains usable. */ }
}
function read(text, element) {
  if (activeElement) {
    activeElement.classList.remove('read-active');
    activeElement.removeAttribute('aria-busy');
  }
  activeElement = element || null;
  lastText = text;
  replay.textContent = '再读一遍';
  activeElement?.classList.add('read-active');
  activeElement?.setAttribute('aria-busy', 'true');
  speech.speak(text);
}
function setPanelOpen(open) {
  panel.hidden = !open;
  launcher.setAttribute('aria-expanded', String(open));
  launcher.setAttribute('aria-label', open ? '关闭点读设置' : '打开点读设置');
  if (open) panel.querySelector('.read-close').focus();
}
launcher.addEventListener('click', () => setPanelOpen(panel.hidden));
panel.querySelector('.read-close').addEventListener('click', () => { setPanelOpen(false); launcher.focus(); });
stop.addEventListener('click', () => speech.stop());
replay.addEventListener('click', () => read(lastText || 'ambition'));
rateControl.addEventListener('input', () => {
  preferences.rate = speech.setRate(Number(rateControl.value));
  rateValue.value = `${preferences.rate.toFixed(2)}×`;
  savePreferences();
});
accentControl.addEventListener('change', () => {
  preferences.accent = speech.setAccent(accentControl.value);
  savePreferences();
});

function makeReadButton(text, className) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.dataset.readText = text;
  button.setAttribute('aria-label', `朗读 ${text}`);
  button.title = `点击朗读：${text}`;
  return button;
}
function decorate() {
  document.querySelectorAll('.flip-card .face').forEach(face => {
    face.inert = face.getAttribute('aria-hidden') === 'true';
  });
  document.querySelectorAll('.main .word:not([data-read-ready]), .main .study-word:not([data-read-ready])').forEach(element => {
    element.dataset.readReady = 'true';
    const text = element.textContent.trim();
    if (!/[a-z]/i.test(text)) return;
    const word = makeReadButton(text, 'read-word-button');
    word.textContent = text;
    const speaker = makeReadButton(text, 'read-speaker');
    speaker.innerHTML = speakerIcon;
    element.replaceChildren(word, speaker);
  });
  document.querySelectorAll('.main .sentence:not([data-read-ready])').forEach(element => {
    element.dataset.readReady = 'true';
    const text = element.textContent.trim();
    if (!/[a-z]/i.test(text)) return;
    element.dataset.readText = text;
    element.classList.add('read-sentence');
    element.tabIndex = 0;
    element.setAttribute('role', 'button');
    element.setAttribute('aria-label', `朗读例句：${text}`);
    element.title = '点击朗读例句';
  });
  document.querySelectorAll('.main .collocation-phrase:not([data-read-ready])').forEach(element => {
    element.dataset.readReady = 'true';
    const text = element.textContent.trim();
    if (!/[a-z]/i.test(text)) return;
    const phrase = makeReadButton(text, 'read-phrase-button');
    phrase.textContent = text;
    element.replaceChildren(phrase);
  });
  if (activeElement && (!activeElement.isConnected || !activeElement.closest('.page.active'))) speech.stop();
}

// Capture before the original card/navigation handlers, so point reading does
// not flip a flashcard, navigate to a word, or submit a quiz answer.
document.addEventListener('click', event => {
  const target = event.target.closest?.('[data-read-text]');
  if (target) {
    event.preventDefault();
    event.stopImmediatePropagation();
    read(target.dataset.readText, target);
  } else if (event.target.closest?.('[data-page], [data-study-step], [data-flash-step], [data-grade], [data-step], [data-quiz-study-word]')) {
    speech.stop();
  } else if (!panel.hidden && !panel.contains(event.target) && !launcher.contains(event.target)) {
    setPanelOpen(false);
  }
}, true);
document.addEventListener('keydown', event => {
  const target = event.target.closest?.('[data-read-text]');
  if (target && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    event.stopImmediatePropagation();
    read(target.dataset.readText, target);
  }
  if (event.key === 'Escape') {
    speech.stop();
    if (!panel.hidden) { setPanelOpen(false); launcher.focus(); }
  }
}, true);

let decorationQueued = false;
const observer = new MutationObserver(() => {
  if (decorationQueued) return;
  decorationQueued = true;
  queueMicrotask(() => { decorationQueued = false; decorate(); });
});
observer.observe(document.querySelector('.main'), { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-hidden'] });
decorate();
document.addEventListener('visibilitychange', () => { if (document.hidden) speech.stop(); });
window.addEventListener('pagehide', () => { observer.disconnect(); speech.destroy(); });
window.addEventListener('pageshow', event => {
  // A fresh load is required after restoring from the back/forward cache,
  // because the previous pagehide released its speech controller.
  if (event.persisted) location.reload();
});
