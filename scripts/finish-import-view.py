from pathlib import Path

p=Path(__file__).resolve().parent.parent/'public/reading/import-view.js'
s=p.read_text(encoding='utf-8')
s=s.replace("const d={mode:'images',text:'',title:'',source:null,images:[],previews:[],warnings:[],busy:false,status:'',progress:0,error:'',controller:null,revision:0,request:0,selected:new Set()};", "const d={mode:'images',text:'',title:'',source:null,images:[],previews:[],warnings:[],ocrWarnings:[],previousDraft:null,busy:false,status:'',progress:0,error:'',controller:null,revision:0,request:0,selected:new Set(),aiStatus:{}};")
start=s.index('  try { const old=')
end=s.index('  function invalidate()',start)
s=s[:start]+'''  try {
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
  const onImport=()=>location.hash.replace(/^#\\/?/,'').split('/')[0]==='import';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const bodyText=p=>p.paragraphs.map(para=>para.map(s=>s.en).join(' ')).join('\\n\\n');
  function draftValue(){return {text:d.text,title:d.title,source:d.source,previews:copy(d.previews),selected:[...d.selected],warnings:[...d.warnings],ocrWarnings:[...d.ocrWarnings]};}
  function preserveDraft(){if(d.text||d.previews.length)d.previousDraft=draftValue();}
  let storageNotice=false;
  function remember(){try{sessionStorage.setItem(draftKey,JSON.stringify({version:2,...draftValue(),previousDraft:d.previousDraft}));}catch{if(!storageNotice){storageNotice=true;toast('浏览器暂时无法保存导入草稿，请先导出当前文字或整理后的 JSON。');}}}
''' + s[end:]
s=s.replace("${d.text?btn('导出当前文字','export-import-text',busy):''}","${d.text?btn('导出当前文字','export-import-text',busy):''}${d.previousDraft?btn('恢复上一次校对稿','restore-import-draft',busy):''}")
s=s.replace('<article class="preview-passage" data-preview-index="${i}"><div', '<article class="preview-passage" data-preview-index="${i}"><fieldset class="preview-fields" ${d.busy?\'disabled\':\'\'}><div')
s=s.replace("${e(p.paragraphs.map(para=>para.map(s=>s.en).join(' ')).join('\\n\\n'))}","${e(p._bodyDraft??bodyText(p))}")
s=s.replace('<p class="ai-status" id="ai-status-${i}"></p></article>', '<p class="ai-status" id="ai-status-${i}">${e(d.aiStatus[i]||\'\')}</p></fieldset></article>')

def replace_function(start_marker,end_marker,new):
    global s
    a=s.index(start_marker);b=s.index(end_marker,a)
    s=s[:a]+new+'\n'+s[b:]

replace_function('  function parse(){','  async function addImages(','''  function parse(){
    if(d.busy)return;
    d.previews=[];d.selected.clear();d.error='';
    try{
      const parsed=parseReadingCollection(d.text,d.title);d.previews=parsed.passages;d.warnings=[...new Set([...(parsed.warnings||[]),...d.ocrWarnings])];
      for(const p of d.previews){
        if(d.source)Object.assign(p,{source:d.source.source,sourceUrl:d.source.sourceUrl,sourceType:'web'});
        if(d.ocrWarnings.length){p.warnings=[...new Set([...(p.warnings||[]),...d.ocrWarnings])];p.incomplete=true;p.answerStatus='unverified';}
      }
      d.previews.forEach((_,i)=>d.selected.add(i));remember();render();document.querySelector('#import-preview')?.scrollIntoView({behavior:'smooth',block:'start'});
    }catch(err){remember();render();fail(err);}
  }''')
s=s.replace("!/^image\\/(jpeg|png|webp|bmp|x-ms-bmp)$/.test(f.type||'')", "(f.type&&!/^image\\/(jpeg|png|webp|bmp|x-ms-bmp)$/.test(f.type))")
s=s.replace("d.mode='images';d.error='';d.status=", "d.revision++;d.mode='images';d.error='';d.status=")
replace_function('  async function recognize(','  async function textFile(','''  async function recognize(onlyId=null){
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
          d.text=d.images.filter(x=>x.result?.text).map(x=>x.result.text.trim()).join('\\n\\n');d.source=null;d.revision++;
          d.ocrWarnings=missing.length?[`图片未完整识别：${missing.map(x=>x.file.name).join('、')}。请补充或重试这些页；当前篇目可能缺页。`]:[];
          if(cancelled)d.ocrWarnings.push('本批识别已取消，当前只保留已完成页面，请核对页数。');
          if(d.previousDraft)d.status+=' 上一次校对稿已保留，可随时恢复。';
          d.previews=[];d.selected.clear();
        }
        remember();
        if(onImport()){render();if(changed)parse();}
      }
    }
  }''')
replace_function('  async function textFile(','  async function fetchSource(','''  async function textFile(file){
    if(!file||d.busy)return;
    const request=++d.request,revision=d.revision;
    try{
      if(!/\\.(txt|md|json)$/i.test(file.name))throw new Error('请选择 TXT、Markdown 或 JSON 文件。');
      if(file.size>1000000)throw new Error('文本文件超过 1 MB，请分批导入。');
      const bytes=await file.arrayBuffer();
      if(request!==d.request||revision!==d.revision){toast('材料已修改，文件结果未覆盖当前草稿。');return;}
      let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('文件不是 UTF-8 编码，请另存为 UTF-8 后导入。');}
      if(text.length>100000)throw new Error('文字超过 10 万字符，请分批导入。');
      preserveDraft();d.text=text.replace(/^\\uFEFF/,'');d.title='';d.source=null;d.ocrWarnings=[];d.mode='text';invalidate();parse();
    }catch(err){if(request===d.request)fail(err);}
  }''')
s=s.replace("invalidate();d.text=`Passage:","preserveDraft();d.ocrWarnings=[];invalidate();d.text=`Passage:")
replace_function('  function snapshot(){','  async function analyze(','''  function snapshot(indices=null){
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
          p.paragraphs=normalizePassage({...p,questions:[],paragraphs:p._bodyDraft.split(/\\n\\s*\\n/).filter(x=>x.trim())}).paragraphs;
          p.analysisMode='rules';p.answerStatus='unverified';
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
    return passages.map(original=>{const p=copy(original);if(p._bodyDraft!==undefined&&p._bodyDraft!==bodyText(p)){p.paragraphs=p._bodyDraft.split(/\\n\\s*\\n/).filter(x=>x.trim());p.analysisMode='rules';p.answerStatus='unverified';}delete p._bodyDraft;for(const q of p.questions){q.incomplete=!q.stem.trim()||q.options.some(o=>!o.trim());if(q.incomplete)q.answer=null;}return p;});
  }''')
s=s.replace("try{snapshot();const p=d.previews[index];", "try{snapshot([index]);const p=d.previews[index];")
s=s.replace("d.busy=true;el.disabled=true;const status=document.querySelector('#ai-status-'+index);status.textContent='正在生成本篇解析，约需一分钟。当前内容仍会保留。';", "d.busy=true;d.aiStatus[index]='正在生成本篇解析，约需一分钟。当前内容仍会保留。';render();")
s=s.replace("}catch(err){fail(err);}finally{d.busy=false;if(onImport())render();}", "}catch(err){d.aiStatus[index]=message(err);fail(err);}finally{d.busy=false;remember();if(onImport())render();}")
s=s.replace("'export-import-text','fetch-url'", "'export-import-text','restore-import-draft','fetch-url'")
s=s.replace("if(action==='import-mode'){d.mode=el.dataset.mode;render();}", "if(action==='import-mode'){d.mode=el.dataset.mode;d.revision++;remember();render();}")
s=s.replace("else if(action==='edit-import'){snapshot();d.previews=[];d.selected.clear();render();document.querySelector('#import-text').focus();}", "else if(action==='edit-import'){preserveDraft();d.text=JSON.stringify({passages:editorPassages()},null,2);d.title='';d.previews=[];d.selected.clear();d.revision++;remember();render();document.querySelector('#import-text').focus();}")
s=s.replace("else if(action==='save-import'){snapshot();const picked=d.previews.filter((_,i)=>d.selected.has(i));if(!picked.length)throw new Error('请至少选择一篇材料。');const saved=savePassages(picked.map(normalizePassage),fingerprint);if(!saved)return true;d.previews=[];d.text='';d.title='';d.source=null;remember();startReading(saved.id);toast(saved.notice||'材料已导入，可以开始精读与朗读。');}", "else if(action==='save-import'){const indices=[...d.selected];if(!indices.length)throw new Error('请至少选择一篇材料。');snapshot(indices);const picked=d.previews.filter((_,i)=>d.selected.has(i));const saved=savePassages(picked.map(normalizePassage),fingerprint);if(!saved)return true;d.previews=d.previews.filter((_,i)=>!d.selected.has(i));d.selected=new Set(d.previews.map((_,i)=>i));d.text=d.previews.length?JSON.stringify({passages:editorPassages()},null,2):'';d.title='';d.source=null;d.previousDraft=null;if(!d.previews.length){d.warnings=[];d.ocrWarnings=[];}remember();startReading(saved.id);toast((saved.notice||'材料已导入，可以开始精读与朗读。')+(d.previews.length?` 另有 ${d.previews.length} 篇校对稿保留在导入页。`:''));}")
s=s.replace("else if(action==='export-import-json'){snapshot();downloadJSON('reading-import-materials.json',{passages:d.previews.filter((_,i)=>d.selected.has(i))});}", "else if(action==='export-import-json'){if(!d.selected.size)throw new Error('请至少选择一篇材料。');snapshot([...d.selected]);downloadJSON('reading-import-materials.json',{passages:d.previews.filter((_,i)=>d.selected.has(i))});}")
s=s.replace("else if(action==='export-import-text'){", "else if(action==='restore-import-draft'){if(d.previousDraft){const previous=d.previousDraft,current=draftValue();Object.assign(d,{text:previous.text,title:previous.title,source:previous.source,previews:previous.previews,warnings:previous.warnings,ocrWarnings:previous.ocrWarnings,selected:new Set(previous.selected),previousDraft:current});d.revision++;remember();render();toast('已恢复上一次校对稿。');}}\n      else if(action==='export-import-text'){")
s=s.replace("if(el.matches('.preview-select')){el.checked?d.selected.add(Number(el.dataset.index)):d.selected.delete(Number(el.dataset.index));return true;}", "if(el.matches('.preview-select')){el.checked?d.selected.add(Number(el.dataset.index)):d.selected.delete(Number(el.dataset.index));remember();return true;}")
replace_function('  function handleInput(el){',"  document.addEventListener('dragover'",'''  function captureInput(el,persist=true){
    if(el.matches('[data-import-field]')){
      const p=d.previews[Number(el.dataset.passage)];if(!p)return;const q=p.questions[Number(el.dataset.question)];
      if(el.dataset.importField==='title')p.title=el.value;
      else if(el.dataset.importField==='body')p._bodyDraft=el.value;
      else if(el.dataset.importField==='stem'){if(q.stem!==el.value)p.answerStatus='unverified';q.stem=el.value;}
      else if(el.dataset.importField==='option'){const i=Number(el.dataset.option);if(q.options[i]!==el.value)p.answerStatus='unverified';q.options[i]=el.value;}
    }else if(el.matches('.preview-answer')){const p=d.previews[Number(el.dataset.passage)];if(p)p.questions[Number(el.dataset.index)].answer=el.value||null;}
    else if(el.matches('.confirm-answers')){const p=d.previews[Number(el.dataset.index)];if(p)p.answerStatus=el.checked&&p.questions.some(q=>q.answer)?'verified':'unverified';}
    else return;
    if(persist){d.revision++;remember();}
  }
  function handleInput(el){
    if(d.busy)return;
    if(el.id==='import-text'){d.text=el.value;invalidate();}
    else if(el.id==='import-title'){d.title=el.value;invalidate();}
    else captureInput(el);
  }
''')
p.write_text(s,encoding='utf-8')

css=p.with_name('import.css')
style=css.read_text(encoding='utf-8')
style+='\n.preview-fields{border:0;padding:0;margin:0;min-width:0}.preview-fields:disabled{opacity:.65}\n'
css.write_text(style,encoding='utf-8')
print('Import draft protection updated')
