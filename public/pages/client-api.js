// The Pages export runs the same teaching engine in the visitor's browser.
// The build copies these shared factories; no server keys are bundled.
import { createReadingAPI } from './reading-api-core.js';
import { createFreeReadingAnalyzer } from './free-analysis.js';
import { lookupBrowserDictionary } from '../reading/browser-dictionary.js';

const engine = createReadingAPI(createFreeReadingAnalyzer());
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: {'Content-Type':'application/json; charset=utf-8'}
});

export async function requestReadingAPI(path, options = {}) {
  if (options.signal?.aborted) throw options.signal.reason || new DOMException('已取消', 'AbortError');
  const url = new URL(path, 'https://reading-lab.invalid/api/reading/');
  if (url.origin !== 'https://reading-lab.invalid' || !url.pathname.startsWith('/api/reading/')) {
    return json({error:'请求地址无效。',code:'invalid_path'},400);
  }
  const action = url.pathname.slice('/api/reading/'.length);
  if (action === 'discover') return json({
    error:'GitHub Pages 无法代为读取其他网站的目录。请使用下方原站入口选择文章，再复制正文和题目到“导入材料”；图片也可直接识别导入。',
    code:'static_source_restricted'
  },503);
  let body;
  if (options.body) {
    try { body = JSON.parse(options.body); }
    catch { return json({error:'请求内容格式不正确。',code:'invalid_json'},400); }
  }
  if (action === 'lookup' && !(['openai','deepseek'].includes(body?.provider) && body?.apiKey)) {
    try { return json(await lookupBrowserDictionary(body?.word,{signal:options.signal})); }
    catch(error) {
      if(options.signal?.aborted) throw error;
      return json({error:error.message || '在线词典暂不可用。',code:error.code || 'dictionary_unavailable'},502);
    }
  }
  const task = engine.fetch(new Request(url, options), {});
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(options.signal.reason || new DOMException('已取消', 'AbortError'));
    options.signal?.addEventListener('abort', abort, {once:true});
    if(options.signal?.aborted) abort();
  });
  try {
    const response = await Promise.race([task, cancelled]);
    if(action === 'status' && response.ok) {
      const status = await response.json();
      return json({...status,notice:'GitHub Pages 版：翻译和查词由浏览器直接连接公共服务；学习进度保存在当前浏览器。网页采集受来源网站的跨域限制。'});
    }
    if(action === 'fetch' && !response.ok) return json({
      error:'来源网站暂不可读，或不允许浏览器跨域读取。请打开原文，复制文章和题目后粘贴导入；图片可直接识别。',
      code:'static_source_restricted'
    },response.status);
    return response;
  } finally { options.signal?.removeEventListener('abort',abort); }
}
