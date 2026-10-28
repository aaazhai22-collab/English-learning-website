import { normalizePassage, parseReadingCollection, flatten, wordsCount, escapeHTML as e } from './core.js';
import { generatePassageAnalysis, hasCompleteAnalysis } from './analysis-client.js';

const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp,.bmp,image/jpeg,image/png,image/webp,image/bmp';
const btn = (text, action, attrs = '', kind = 'ghost') => `<button type="button" class="btn ${kind}" data-action="${action}" ${attrs}>${text}</button>`;
const fingerprint = p => JSON.stringify([flatten(p).map(s=>s.en.replace(/\s+/g,' ').trim()),p.questions.map(q=>[q.stem,q.options])]);
const message = err => err?.name === 'AbortError' ? '已取消处理，当前校对稿与旧资料仍保留，可以重试。' : err?.name === 'TimeoutError' ? '处理超时，当前材料已保留，请稍后重试。' : err?.message || '这一步没有完成，请重试。';

export function createImportController({ shell, footer, toast, api, getProfile, getAI, savePassages, startReading, template, downloadJSON }) {
  const draftKey='reading-lab-import-draft-v1';
  const d={mode:'images',text:'',title:'',source:null,images:[],previews:[],warnings:[],ocrWarnings:[],previousDraft:null,busy:false,status:'',progress:0,error:'',controller:null,revision:0,request:0,selected:new Set(),aiStatus:{},task:''};
  try {
    const old=JSON.parse(sessionStorage.getItem(draftKey)||'null');
    if(old&&typeof old.text==='string'){
      d.text=old.text.slice(0,100000);d.title=String(old.title||'').slice(0,250);d.source=old.source||null;d.mode='text';
      if(old.version===2&&Array.isArray(old.previews)){
        d.previews=old.previews.filter(p=>p&&Array.isArray(p.paragraphs)&&Array.isArray(p.questions));
        d.selected=new Set((old.selected||[]).filter(i=>Number.isInteger(i)&&d.previews[i]));
        d.warnings=Array.isArray(old.warnings)?old.warnings:[];d.ocrWarnings=Array.isArray(old.ocrWarnings)?old.ocrWarnings:[];
        d.previousDraft=old.previousDraft||null;
      }
    }
  } catch {}
  const onImport=()=>location.hash.replace(/^#\/?/,'').split('/')[0]==='import';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const bodyText=p=>p.paragraphs.map(para=>para.map(s=>s.en).join(' ')).join('\n\n');
  function draftValue(){return {text:d.text,title:d.title,source:d.source,previews:copy(d.previews),selected:[...d.selected],warnings:[...d.warnings],ocrWarnings:[...d.ocrWarnings]};}
  function preserveDraft(){if(d.text||d.previews.length)d.previousDraft=draftValue();}
  let storageNotice=false;
  function remember(){try{sessionStorage.setItem(draftKey,JSON.stringify({version:2,...draftValue(),previousDraft:d.previousDraft}));}catch{if(!storageNotice){storageNotice=true;toast('浏览器暂时无法保存导入草稿，请先导出当前文字或整理后的 JSON。');}}}
  function invalidate(){d.revision++;d.previews=[];d.selected.clear();d.warnings=[];d.error='';remember();document.querySelector('#import-preview')?.remove();}
  function status(){const s=document.querySelector('#ocr-status');if(s)s.textContent=d.status;const p=document.querySelector('#ocr-progress');if(p)p.value=d.progress;}
  function fail(err){d.error=message(err);const target=document.querySelector('#import-error');if(target)target.textContent=d.error;else toast(d.error);}
  function render(){
    const busy=d.busy?'disabled':'';
    shell(`<div class="page import-page"><div class="page-heading"><div><div class="eyebrow">BRING YOUR OWN READING</div><h1>把材料，变成练习。</h1><p>上传照片或截图，识别文字、整理篇目与题目，校对后直接开始学习。</p></div><span class="heading-index">IMPORT / READING LAB.</span></div><ol class="import-steps" aria-label="导入步骤"><li><span>01</span> 选择材料</li><li><span>02</span> 识别与整理</li><li><span>03</span> 校对并导入</li></ol><div class="pill-tabs" role="tablist" aria-label="导入方式">${[['images','图片识别'],['text','文字 / 文件'],['web','网页链接']].map(([mode,label])=>`<button type="button" role="tab" id="import-mode-${mode}" data-action="import-mode" data-mode="${mode}" aria-selected="${d.mode===mode}" class="${d.mode===mode?'active':''}" ${busy}>${label}</button>`).join('')}</div><div class="import-workspace"><section class="import-main">${d.mode==='images'?imagePanel():d.mode==='web'?webPanel():`<div class="import-file-row"><div><h2>导入文字文件</h2><p class="hint">TXT、Markdown、JSON，最多 1 MB、10 万字符。JSON 支持单篇或多篇数组。</p></div>${btn('选择文本文件','choose-text',busy)}<input type="file" id="import-file" accept=".txt,.md,.json,text/plain,text/markdown,application/json" hidden></div>`}<div class="surface import-editor"><div class="form-field"><label for="import-title">材料标题 <span class="muted small">选填，多篇材料将保留各自标题</span></label><input class="field" id="import-title" value="${e(d.title)}" maxlength="250" placeholder="例如：2025 年英语二阅读" ${busy}></div><div class="form-field"><label for="import-text">${d.mode==='images'?'识别文字，可对照原图修改':'英文文章与题目'}</label><textarea class="field editor" id="import-text" spellcheck="false" ${busy} placeholder="Passage: Your reading title&#10;&#10;English paragraphs…&#10;&#10;21. Question?&#10;[A] Option A&#10;[B] Option B&#10;[C] Option C&#10;[D] Option D">${e(d.text)}</textarea><p class="hint">支持多篇 Text 1 / Text 2、完形填空与 A—D 选项。保留原题号；没有答案也可以精读，不自动计分。</p>${d.source?`<p class="hint">来源：${e(d.source.source||d.source.sourceUrl||'网页导入')}</p>`:''}</div><div class="form-actions">${btn('整理并校对 →','parse-import',busy,'primary')}${btn('下载格式示例','download-template',busy)}${d.text?btn('导出当前文字','export-import-text',busy):''}${d.previousDraft?btn('恢复上一次校对稿','restore-import-draft',busy):''}</div><div id="import-error" class="error" role="alert">${e(d.error)}</div></div>${d.previews.length?preview():''}</section><aside class="import-guide"><div class="eyebrow">A SMALL GUIDE</div><h3>先看清，再开始。</h3><ol><li>多页图片按阅读顺序排列，题目跨页会一起整理。</li><li>图片识别在本浏览器完成，无需密钥。首次加载引擎和语言包可能稍慢。</li><li>对照原图核对专有名词、题号和选项；识别置信度只作提醒。</li><li>缺页或缺选项会保留并提示，不自动补写答案。</li><li>默认免费联网生成逐句翻译、自动语法和提取式全文要点后保存，无需密钥。复杂句请结合原文核对。</li></ol><a class="text-link" href="#/profile">设置讲解深度与免费解析 ↗</a></aside></div>${footer()}</div>`,'import');
  }
  function imagePanel(){return `<section class="image-import"><div id="image-drop" class="image-drop"><span class="eyebrow">IMAGES TO READING</span><h2>把试卷放进来。</h2><p>选择、拖入或粘贴图片；支持 JPG、PNG、WebP、BMP。</p><p class="hint">最多 10 张，每张 12 MB。按页码上传，识别前可以排序或旋转。</p>${btn('＋ 选择图片','choose-images',d.busy?'disabled':'','primary')}<input id="import-images" type="file" multiple accept="${IMAGE_ACCEPT}" hidden></div>${d.images.length?`<ol id="ocr-pages" class="ocr-pages">${d.images.map((item,i)=>`<li data-image-id="${item.id}" data-rotation="${item.rotation}"><a href="${item.url}" target="_blank" rel="noopener" aria-label="查看原图 ${e(item.file.name)}"><img src="${item.url}" style="transform:rotate(${item.rotation}deg)" alt="第 ${i+1} 页 ${e(item.file.name)}"></a><div class="ocr-page-info"><strong>${String(i+1).padStart(2,'0')} / ${e(item.file.name)}</strong><span>${(item.file.size/1024/1024).toFixed(1)} MB${item.result?` · ${item.result.error?'识别失败':`置信度 ${Math.round(item.result.confidence||0)}%`}`:''}</span>${item.result?.error?`<span class="error">${e(item.result.error)}</span>`:''}</div><div class="ocr-page-actions">${btn('↑','ocr-move',`data-id="${item.id}" data-delta="-1" aria-label="上移第 ${i+1} 页" ${d.busy||i===0?'disabled':''}`,'small ghost')}${btn('↓','ocr-move',`data-id="${item.id}" data-delta="1" aria-label="下移第 ${i+1} 页" ${d.busy||i===d.images.length-1?'disabled':''}`,'small ghost')}${btn('旋转','ocr-rotate',`data-id="${item.id}" aria-label="顺时针旋转第 ${i+1} 页" ${d.busy?'disabled':''}`,'small ghost')}${btn('移除','ocr-remove',`data-id="${item.id}" aria-label="移除第 ${i+1} 页" ${d.busy?'disabled':''}`,'small ghost')}${item.result?.error?btn('重试','ocr-retry',`data-id="${item.id}" ${d.busy?'disabled':''}`,'small ghost'):''}</div></li>`).join('')}</ol><div class="form-actions">${btn(d.busy?'正在识别…':'识别图片并整理 →','ocr-start',d.busy?'disabled':'','primary')}${d.busy?btn('取消识别','ocr-cancel'):btn('清空图片','ocr-clear')}</div>`:''}<div class="ocr-progress-row" aria-live="polite"><p id="ocr-status" role="status">${e(d.status||'原图仅用于本次识别，不会上传到模型或写入学习备份。')}</p><progress id="ocr-progress" value="${d.progress}" max="1" aria-label="图片文字识别进度" ${d.busy?'':'hidden'}></progress></div></section>`;}
  function webPanel(){return `<section class="surface import-web"><div class="form-field"><label for="source-url">公开网页链接</label><div class="toolbar"><input class="field" id="source-url" type="url" placeholder="https://learnenglish.britishcouncil.org/…">${btn('读取网页','fetch-url',d.busy?'disabled':'')}</div><p class="hint">支持 British Council、中国教育在线、Cambridge English 的公开 HTTPS 页面。网页中的图片题可切换到图片识别补充。</p></div></section>`;}
  function preview(){return `<section class="import-preview" id="import-preview"><div class="section-heading"><h2>03 / 校对并导入</h2><span class="hint">${d.previews.length} 篇材料 · ${d.previews.reduce((n,p)=>n+p.questions.length,0)} 道题</span></div>${d.warnings.length?`<div class="notice warning"><strong>请留意</strong><ul>${d.warnings.map(w=>`<li>${e(w)}</li>`).join('')}</ul></div>`:''}${d.previews.map((p,i)=>`<article class="preview-passage" data-preview-index="${i}"><fieldset class="preview-fields" ${d.busy?'disabled':''}><div class="preview-heading"><label class="check-label"><input type="checkbox" class="preview-select" data-index="${i}" ${d.selected.has(i)?'checked':''}>导入第 ${i+1} 篇</label><span class="tag">${p.questions.length} 道题 / ${wordsCount(p)} 词</span></div><label class="form-field"><span>篇目标题</span><input class="field preview-title" data-import-field="title" data-passage="${i}" value="${e(p.title)}"></label><label class="form-field"><span>英文正文</span><textarea class="field preview-body" data-import-field="body" data-passage="${i}" spellcheck="false">${e(p._bodyDraft??bodyText(p))}</textarea></label>${p.incomplete?'<p class="error">这篇材料可能缺页或包含不完整题目，请核对原图。可以先保存精读；缺选项的题目不参与作答。</p>':''}${p.questions.map((q,j)=>`<details class="preview-question" ${q.incomplete?'open':''}><summary><strong>Q${q.number||j+1}</strong> <span>${e(q.stem)}</span>${q.incomplete?'<span class="tag red">待补全</span>':''}</summary><label class="form-field"><span>题干</span><textarea class="field" data-import-field="stem" data-passage="${i}" data-question="${j}" spellcheck="false">${e(q.stem)}</textarea></label><div class="preview-options">${q.options.map((option,k)=>`<label><span>[${'ABCD'[k]}]</span><input class="field" data-import-field="option" data-passage="${i}" data-question="${j}" data-option="${k}" value="${e(option)}" placeholder="${option?'':'此选项缺失，请对照原图补充'}"></label>`).join('')}</div><label class="preview-answer-label">参考答案 <select class="preview-answer" data-passage="${i}" data-index="${j}" aria-label="第${q.number||j+1}题参考答案"><option value="">未提供</option>${[...'ABCD'].map(a=>`<option value="${a}" ${q.answer===a?'selected':''}>${a}</option>`).join('')}</select></label></details>`).join('')}${p.questions.length?`<label class="check-label answer-confirm"><input type="checkbox" class="confirm-answers" data-index="${i}" ${p.answerStatus==='verified'?'checked':''}>我已对照来源核实本篇已填写的参考答案</label><p class="hint">未填写或未核实的答案不计正确率。</p>`:'<p class="hint">这篇没有识别到题目，可保存后直接精读。</p>'}<div class="form-actions">${btn(hasCompleteAnalysis(p)?'重新生成免费自动解析':'免费生成本篇完整解析','ai-analyze',`data-index="${i}" ${d.busy?'disabled':''}`,'small ghost')}</div><p class="ai-status" role="status" aria-live="polite" id="ai-status-${i}">${e(d.aiStatus[i]||'')}</p></fieldset></article>`).join('')}<div class="import-save-row"><p class="hint">默认免费联网生成逐句翻译、自动语法、全文要点和词汇，预计 1—3 分钟。正文会发送到免费翻译服务。复杂句请核对；参考答案仍待核实。</p><div class="form-actions">${btn(d.busy&&d.task==='analysis'?'正在免费联网解析…':'免费解析并保存阅读','save-import',d.busy?'disabled':'','primary')}${d.busy&&d.task==='analysis'?btn('取消解析，保留草稿','analysis-cancel'):btn('仅保存原文，稍后解析','save-import-plain')}${btn('导出整理后的 JSON','export-import-json',d.busy?'disabled':'')}${btn('返回修改','edit-import',d.busy?'disabled':'')}</div></div></section>`;}
  function parse(){
    if(d.busy)return;
    d.previews=[];d.selected.clear();d.error='';
    try{
      const parsed=parseReadingCollection(d.text,d.title);d.previews=parsed.passages;d.warnings=[...new Set([...(parsed.warnings||[]),...d.ocrWarnings])];
      for(const p of d.previews){
        p.answerStatus='unverified';
        if(d.source)Object.assign(p,{source:d.source.source,sourceUrl:d.source.sourceUrl,sourceType:'web'});
        if(d.ocrWarnings.length){p.warnings=[...new Set([...(p.warnings||[]),...d.ocrWarnings])];p.incomplete=true;p.answerStatus='unverified';}
      }
      d.previews.forEach((_,i)=>d.selected.add(i));remember();render();document.querySelector('#import-preview')?.scrollIntoView({behavior:'smooth',block:'start'});
    }catch(err){remember();render();fail(err);}
  }
  async function addImages(files){
    if(d.busy)return;
    try{const {OCR_LIMITS}=await import('./ocr.js');const incoming=[...files];if(incoming.length+d.images.length>OCR_LIMITS.maxFiles)throw new Error(`最多选择 ${OCR_LIMITS.maxFiles} 张图片，请分批导入。`);for(const f of incoming){if(!/\.(jpe?g|png|webp|bmp)$/i.test(f.name)||(f.type&&!/^image\/(jpeg|png|webp|bmp|x-ms-bmp)$/.test(f.type)))throw new Error(`${f.name} 不是支持的图片，请使用 JPG、PNG、WebP 或 BMP。`);if(!f.size||f.size>OCR_LIMITS.maxFileBytes)throw new Error(`${f.name} 为空或超过 12 MB，请压缩后重试。`);}for(const file of incoming){if(d.images.some(x=>x.file.name===file.name&&x.file.size===file.size&&x.file.lastModified===file.lastModified))continue;d.images.push({id:crypto.randomUUID(),file,rotation:0,url:URL.createObjectURL(file),result:null});}d.revision++;d.mode='images';d.error='';d.status=`已选择 ${d.images.length} 页，确认顺序后开始识别。`;render();}catch(err){fail(err);}
  }
  async function recognize(onlyId=null){
    if(d.busy)return;
    const items=onlyId?d.images.filter(x=>x.id===onlyId):d.images;
    if(!items.length){fail(new Error('请先选择图片。'));return;}
    preserveDraft();items.forEach(item=>item.result=null);
    d.busy=true;d.error='';d.progress=0;d.status='正在准备本地文字识别引擎…';d.controller=new AbortController();const request=++d.request;render();
    let changed=false,cancelled=false;
    const applyPages=pages=>{pages?.forEach((page,i)=>{if(items[i])items[i].result=page;});changed=!!pages?.some(page=>page.text);};
    try{
      const {recognizeImages}=await import('./ocr.js');
      const result=await recognizeImages(items.map(x=>({file:x.file,rotation:x.rotation})),{signal:d.controller.signal,onProgress:p=>{if(request!==d.request)return;d.progress=p.progress;d.status=`第 ${p.pageIndex+1}/${p.totalPages} 页 · ${p.name||''} · ${p.status} ${Math.round(p.progress*100)}%`;status();}});
      if(request!==d.request)return;applyPages(result.pages);
      d.status=`已完成 ${d.images.filter(x=>x.result?.text).length}/${d.images.length} 页识别。请核对文字、篇目和选项。`;
    }catch(err){
      if(request===d.request){applyPages(err.pages);cancelled=err.name==='AbortError';d.status=message(err);d.error=cancelled?'':d.status;}
    }finally{
      if(request===d.request){
        d.busy=false;d.controller=null;d.progress=1;
        const missing=d.images.filter(x=>!x.result?.text);
        if(changed){
          d.text=d.images.filter(x=>x.result?.text).map(x=>x.result.text.trim()).join('\n\n');d.source=null;d.revision++;
          d.ocrWarnings=missing.length?[`图片未完整识别：${missing.map(x=>x.file.name).join('、')}。请补充或重试这些页；当前篇目可能缺页。`]:[];
          if(cancelled)d.ocrWarnings.push('本批识别已取消，当前只保留已完成页面，请核对页数。');
          if(d.previousDraft)d.status+=' 上一次校对稿已保留，可随时恢复。';
          d.previews=[];d.selected.clear();
        }
        remember();
        if(onImport()){render();if(changed)parse();}
      }
    }
  }
  async function textFile(file){
    if(!file||d.busy)return;
    const request=++d.request,revision=d.revision;
    try{
      if(!/\.(txt|md|json)$/i.test(file.name))throw new Error('请选择 TXT、Markdown 或 JSON 文件。');
      if(file.size>1000000)throw new Error('文本文件超过 1 MB，请分批导入。');
      const bytes=await file.arrayBuffer();
      if(request!==d.request||revision!==d.revision){toast('材料已修改，文件结果未覆盖当前草稿。');return;}
      let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('文件不是 UTF-8 编码，请另存为 UTF-8 后导入。');}
      if(text.length>100000)throw new Error('文字超过 10 万字符，请分批导入。');
      preserveDraft();d.text=text.replace(/^\uFEFF/,'');d.title='';d.source=null;d.ocrWarnings=[];d.mode='text';invalidate();parse();
    }catch(err){if(request===d.request)fail(err);}
  }
  async function fetchSource(url,el){
    if(d.busy)return;
    const label=el?.innerHTML;const request=++d.request,revision=d.revision;
    try{if(!url)throw new Error('请填写来源网址。');if(el){el.disabled=true;el.textContent='正在读取…';}const result=await api('fetch',{url});if(request!==d.request||revision!==d.revision){toast('材料已修改，网页结果未覆盖当前内容。');return;}preserveDraft();d.ocrWarnings=[];invalidate();d.text=`Passage: ${result.title}\n\n${result.text}`;d.title=result.title;d.source=result;d.mode='web';remember();if(onImport())render();else location.hash='#/import';toast(result.notice||'网页已读取，请整理并校对。');}catch(err){fail(err);}finally{if(el?.isConnected){el.disabled=false;el.innerHTML=label;}}
  }
  function snapshot(indices=null){
    const selected=indices?new Set(indices):null;
    for(const el of document.querySelectorAll('[data-import-field],.preview-answer,.confirm-answers')){
      const index=Number(el.dataset.passage??el.dataset.index);
      if(!selected||selected.has(index))captureInput(el,false);
    }
    for(let index=0;index<d.previews.length;index++){
      if(selected&&!selected.has(index))continue;
      const p=d.previews[index];
      if(p._bodyDraft!==undefined){
        if(p._bodyDraft!==bodyText(p)){
          p.paragraphs=normalizePassage({...p,questions:[],paragraphs:p._bodyDraft.split(/\n\s*\n/).filter(x=>x.trim())}).paragraphs;
          p.analysisMode='rules';p.answerStatus='unverified';p.summary='';p.structure=[];p.vocabulary=[];
          for(const q of p.questions){q.explanation='';q.evidence=[];q.distractors=[];q.paraphrase=[];}
        }
        delete p._bodyDraft;
      }
      p.title=p.title.trim();
      for(const q of p.questions){q.stem=q.stem.trim();q.options=q.options.map(o=>o.trim());q.incomplete=!q.stem||q.options.some(o=>!o);if(q.incomplete)q.answer=null;}
    }
    remember();
  }
  function editorPassages(passages=d.previews){
    return passages.map(original=>{const p=copy(original);if(p._bodyDraft!==undefined&&p._bodyDraft!==bodyText(p)){p.paragraphs=p._bodyDraft.split(/\n\s*\n/).filter(x=>x.trim());p.analysisMode='rules';p.answerStatus='unverified';}delete p._bodyDraft;for(const q of p.questions){q.incomplete=!q.stem.trim()||q.options.some(o=>!o.trim());if(q.incomplete)q.answer=null;}return p;});
  }
  function analysisProgress(index, progress) {
    d.aiStatus[index]=`${progress.message}（${progress.completed}/${progress.total} 步）`;
    const target=document.querySelector(`#ai-status-${index}`);
    if(target)target.textContent=d.aiStatus[index];
  }
  async function analyzeOne(index,request,revision){
    const original=d.previews[index];
    const value=await generatePassageAnalysis(original,{api,config:getAI(),profile:getProfile(),signal:d.controller.signal,onProgress:progress=>analysisProgress(index,progress)});
    if(request!==d.request||revision!==d.revision||d.previews[index]!==original)throw new Error('材料已经修改，结果未覆盖当前校对稿。');
    d.previews[index]=value;
    d.aiStatus[index]='已完成逐句翻译、自动语法、提取式全文要点和词汇。免费分析不是人工校订，复杂句请核对。';
    remember();
  }
  async function analyze(index){
    if(d.busy)return;
    snapshot([index]);if(!d.previews[index])return;
    const request=++d.request,revision=d.revision;
    d.busy=true;d.task='analysis';d.error='';d.controller=new AbortController();render();
    try{await analyzeOne(index,request,revision);toast('完整解析已生成，请校对后保存。');}
    catch(err){d.aiStatus[index]=message(err);fail(err);}
    finally{d.busy=false;d.task='';d.controller=null;remember();if(onImport())render();}
  }
  async function saveImport(plain=false){
    if(d.busy)return;
    const indices=[...d.selected].sort((a,b)=>a-b);
    if(!indices.length)throw new Error('请至少选择一篇材料。');
    snapshot(indices);preserveDraft();remember();
    const request=++d.request,revision=d.revision;
    d.busy=true;d.task='analysis';d.error='';d.controller=new AbortController();render();
    try{
      if(!plain)for(const index of indices){if(!hasCompleteAnalysis(d.previews[index]))await analyzeOne(index,request,revision);}
      if(d.controller.signal.aborted)throw new DOMException('已取消','AbortError');
      const picked=indices.map(index=>d.previews[index]);
      const saved=savePassages(picked.map(normalizePassage),fingerprint);
      if(!saved)return;
      d.previews=d.previews.filter((_,i)=>!d.selected.has(i));d.selected=new Set(d.previews.map((_,i)=>i));
      d.text=d.previews.length?JSON.stringify({passages:editorPassages()},null,2):'';d.title='';d.source=null;d.previousDraft=null;
      if(!d.previews.length){d.warnings=[];d.ocrWarnings=[];}
      remember();startReading(saved.id);
      toast((saved.notice||(plain?'原文已保存，可在阅读页随时补全解析。':'免费解析与材料已保存。'))+(d.previews.length?` 另有 ${d.previews.length} 篇校对稿保留。`:''));
    }catch(err){fail(err);}
    finally{d.busy=false;d.task='';d.controller=null;remember();if(onImport())render();}
  }
  async function handleAction(action,el){
    const actions=['import-mode','choose-images','choose-text','ocr-start','ocr-cancel','ocr-move','ocr-rotate','ocr-remove','ocr-clear','ocr-retry','parse-import','save-import','save-import-plain','analysis-cancel','edit-import','ai-analyze','download-template','export-import-json','export-import-text','restore-import-draft','fetch-url','fetch-source'];
    if(!actions.includes(action))return false;
    try{
      if(d.busy&&!['ocr-cancel','analysis-cancel'].includes(action)){toast('正在处理材料，请等待完成，或点击取消保留草稿。');return true;}
      if(action==='import-mode'){d.mode=el.dataset.mode;d.revision++;remember();render();}
      else if(action==='choose-images')document.querySelector('#import-images').click();
      else if(action==='choose-text')document.querySelector('#import-file').click();
      else if(action==='ocr-start')await recognize();
      else if(action==='ocr-cancel'){d.controller?.abort();d.status='正在取消…';status();}
      else if(action==='ocr-retry')await recognize(el.dataset.id);
      else if(action==='ocr-clear'){d.images.forEach(x=>URL.revokeObjectURL(x.url));d.images=[];d.status='图片已清空，识别文字仍保留。';render();}
      else if(['ocr-move','ocr-remove','ocr-rotate'].includes(action)){const i=d.images.findIndex(x=>x.id===el.dataset.id);if(i>=0){if(action==='ocr-remove'){URL.revokeObjectURL(d.images[i].url);d.images.splice(i,1);}else if(action==='ocr-rotate'){d.images[i].rotation=(d.images[i].rotation+90)%360;d.images[i].result=null;}else{const j=i+Number(el.dataset.delta);if(j>=0&&j<d.images.length)[d.images[i],d.images[j]]=[d.images[j],d.images[i]];}d.status='图片已调整，请重新识别以更新文字。';render();}}
      else if(action==='parse-import')parse();
      else if(action==='edit-import'){preserveDraft();d.text=JSON.stringify({passages:editorPassages()},null,2);d.title='';d.previews=[];d.selected.clear();d.revision++;remember();render();document.querySelector('#import-text').focus();}
      else if(action==='save-import'||action==='save-import-plain')await saveImport(action==='save-import-plain');
      else if(action==='analysis-cancel'){d.controller?.abort();toast('正在取消解析，当前校对稿仍保留。');}
      else if(action==='download-template')downloadJSON('reading-import-example.json',template());
      else if(action==='export-import-json'){if(!d.selected.size)throw new Error('请至少选择一篇材料。');snapshot([...d.selected]);downloadJSON('reading-import-materials.json',{passages:d.previews.filter((_,i)=>d.selected.has(i))});}
      else if(action==='restore-import-draft'){if(d.previousDraft){const previous=d.previousDraft,current=draftValue();Object.assign(d,{text:previous.text,title:previous.title,source:previous.source,previews:previous.previews,warnings:previous.warnings,ocrWarnings:previous.ocrWarnings,selected:new Set(previous.selected),previousDraft:current});d.revision++;remember();render();toast('已恢复上一次校对稿。');}}
      else if(action==='export-import-text'){const url=URL.createObjectURL(new Blob([d.text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='reading-ocr-text.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
      else if(action==='ai-analyze')await analyze(Number(el.dataset.index||0),el);
      else if(action==='fetch-url')await fetchSource(document.querySelector('#source-url').value.trim(),el);
      else if(action==='fetch-source')await fetchSource(el.dataset.url,el);
    }catch(err){fail(err);}
    return true;
  }
  async function handleChange(el){if(el.id==='import-images'){await addImages(el.files);el.value='';return true;}if(el.id==='import-file'){await textFile(el.files[0]);el.value='';return true;}if(el.matches('.preview-select')){el.checked?d.selected.add(Number(el.dataset.index)):d.selected.delete(Number(el.dataset.index));remember();return true;}return false;}
  function captureInput(el,persist=true){
    if(el.matches('[data-import-field]')){
      const p=d.previews[Number(el.dataset.passage)];if(!p)return;const q=p.questions[Number(el.dataset.question)];
      if(el.dataset.importField==='title')p.title=el.value;
      else if(el.dataset.importField==='body'){if(el.value!==bodyText(p))markEdited(p,Number(el.dataset.passage));p._bodyDraft=el.value;}
      else if(el.dataset.importField==='stem'){if(q.stem!==el.value){markEdited(p,Number(el.dataset.passage),q);q.stemZh='';}q.stem=el.value;}
      else if(el.dataset.importField==='option'){const i=Number(el.dataset.option);if(q.options[i]!==el.value){markEdited(p,Number(el.dataset.passage),q);q.optionsZh=[];}q.options[i]=el.value;}
    }else if(el.matches('.preview-answer')){const p=d.previews[Number(el.dataset.passage)];if(p)p.questions[Number(el.dataset.index)].answer=el.value||null;}
    else if(el.matches('.confirm-answers')){const p=d.previews[Number(el.dataset.index)];if(p)p.answerStatus=el.checked&&p.questions.some(q=>q.answer)?'verified':'unverified';}
    else return;
    if(persist){d.revision++;remember();}
  }
  function markEdited(p,index,q=null){
    p.answerStatus='unverified';
    const checkbox=document.querySelector(`.confirm-answers[data-index="${index}"]`);if(checkbox)checkbox.checked=false;
    if(q){q.explanation='';q.evidence=[];q.distractors=[];q.paraphrase=[];p.analysisMode='rules';}
  }
  function handleInput(el){
    if(d.busy)return;
    if(el.id==='import-text'){d.text=el.value;invalidate();}
    else if(el.id==='import-title'){d.title=el.value;invalidate();}
    else captureInput(el);
  }

  document.addEventListener('dragover',ev=>{if(onImport()&&ev.target.closest('#image-drop,#ocr-pages')){ev.preventDefault();}});
  document.addEventListener('drop',ev=>{if(onImport()&&ev.target.closest('#image-drop,#ocr-pages')){ev.preventDefault();addImages(ev.dataTransfer.files);}});
  document.addEventListener('paste',ev=>{if(!onImport())return;const images=[...(ev.clipboardData?.items||[])].filter(x=>x.kind==='file'&&x.type.startsWith('image/')).map(x=>x.getAsFile()).filter(Boolean);if(images.length){ev.preventDefault();addImages(images);}});
  return {render,handleAction,handleChange,handleInput,fetchSource};
}
