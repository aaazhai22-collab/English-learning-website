/** No-key teaching aid. Self-contained for build-time factory embedding. */
export function createFreeReadingAnalyzer() {
  const NOTICE='免费机器翻译 + 自动句法拆解；要点为原文提取，不是模型推理。复杂句法和译文请结合原文核对；不生成或核实试题答案。';
  const cache=new Map(),encoder=new TextEncoder();
  const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
  const quote=s=>`“${norm(s)}”`;
  const chinese=s=>typeof s==='string'&&/[\u3400-\u9fff]/.test(s);
  function failure(message,code='free_translation_unavailable',status=502){const e=new Error(message);e.code=code;e.status=status;throw e;}
  async function deadline(ms,run){const c=new AbortController(),timer=setTimeout(()=>c.abort(),ms);try{return await run(c.signal);}finally{clearTimeout(timer);}}
  async function limitedJSON(response,max=200000){
    if(!response.body)throw new Error('empty response');
    const reader=response.body.getReader(),parts=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new Error('large response');}parts.push(value);}}finally{reader.releaseLock();}
    const data=new Uint8Array(size);let offset=0;for(const p of parts){data.set(p,offset);offset+=p.byteLength;}
    return JSON.parse(new TextDecoder().decode(data));
  }
  function splitBytes(text,max){
    const parts=[];let rest=text;
    while(encoder.encode(rest).length>max){
      let take='',lastSpace=-1;
      for(const char of rest){if(encoder.encode(take+char).length>max)break;take+=char;if(/[\s,;.!?]/.test(char))lastSpace=take.length;}
      const end=lastSpace>take.length/2?lastSpace:take.length;
      parts.push(rest.slice(0,end));rest=rest.slice(end);
    }
    if(rest)parts.push(rest);return parts;
  }
  async function google(text){return deadline(10000,async signal=>{
    const url=new URL('https://translate.googleapis.com/translate_a/single');url.search=new URLSearchParams({client:'gtx',sl:'en',tl:'zh-CN',dt:'t',q:text}).toString();
    const response=await fetch(url,{signal,redirect:'manual',headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error('translation upstream '+response.status);
    const data=await limitedJSON(response),translated=Array.isArray(data?.[0])?data[0].map(part=>Array.isArray(part)&&typeof part[0]==='string'?part[0]:'').join(''):'';
    if(!translated.trim()||/<(?:html|script)\b/i.test(translated))throw new Error('invalid translation');
    return translated.trim();
  });}
  async function myMemory(text){
    const results=[];
    for(const part of splitBytes(text,480))results.push(await deadline(10000,async signal=>{
      const url=new URL('https://api.mymemory.translated.net/get');url.search=new URLSearchParams({q:part,langpair:'en|zh-CN'}).toString();
      const response=await fetch(url,{signal,redirect:'manual'});
      if(response.status===429)failure('免费翻译服务今日额度已用完，请稍后重试；原文和已生成内容仍保留。','free_translation_quota',429);
      if(!response.ok)throw new Error('translation upstream '+response.status);
      const data=await limitedJSON(response),value=data.responseData?.translatedText;
      if(Number(data.responseStatus)===429||/MYMEMORY WARNING|USAGE LIMIT/i.test(String(value||'')))failure('免费翻译服务今日额度已用完，请稍后重试；原文和已生成内容仍保留。','free_translation_quota',429);
      if(Number(data.responseStatus)!==200||typeof value!=='string'||!value.trim()||/QUERY LENGTH|INVALID LANGUAGE|<html/i.test(value))throw new Error('invalid translation');
      return value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').trim();
    }));
    return results.join('');
  }
  async function translate(text){
    const key=norm(text);if(!key)return '';
    const old=cache.get(key);if(old&&old.until>Date.now())return old.value;
    let value;
    try{const parts=splitBytes(key,3500);value=(await Promise.all(parts.map(google))).join('');if(!chinese(value)&&/[A-Za-z]/.test(key))throw new Error('no Chinese translation');}
    catch{try{value=await myMemory(key);}catch(error){if(error.code)throw error;failure('免费在线翻译暂时无法连接，请稍后重试这一批；原文和已生成讲解仍保留。');}}
    if(!chinese(value)){
      // Names and acronyms are sometimes correctly left unchanged by both
      // services. Say so explicitly instead of inventing a Chinese meaning.
      if(/^[A-Z][A-Za-z\d .'-]*$/.test(key))value=`保留原文名称：${value}`;
      else failure('翻译服务未返回有效中文，请重试这一批；原文仍保留。');
    }
    if(cache.size>=800)cache.delete(cache.keys().next().value);
    cache.set(key,{value,until:Date.now()+24*60*60*1000});return value;
  }
  async function mapLimit(values,limit,fn){const out=new Array(values.length);let next=0;await Promise.all(Array.from({length:Math.min(limit,values.length)},async()=>{while(next<values.length){const i=next++;out[i]=await fn(values[i],i);}}));return out;}
  const auxiliaries=new Set('am is are was were be been being have has had do does did can could will would shall should may might must'.split(' '));
  const bases=new Set('tip assume earn start process become learn listen collect read use need help make take give provide include design consider think believe know mean show find work live change develop study explain discuss argue suggest face receive spend pay keep allow offer support create improve increase reduce depend reflect require understand remember want like prefer look say tell see get put build bring choose cause play lead seem remain represent involve focus form hold turn move grow feel reach follow begin try call ask stop continue spend describe address'.split(' '));
  const irregular=new Set('tipped assumed earned started became learnt learned made took gave thought believed knew meant showed found kept paid said told saw got built brought chose felt began began grew went'.split(' '));
  const words=text=>[...text.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)].map(m=>({text:m[0],low:m[0].toLowerCase(),index:m.index,end:m.index+m[0].length}));
  const isVerb=word=>auxiliaries.has(word)||bases.has(word)||irregular.has(word)||bases.has(word.replace(/s$/,''))||bases.has(word.replace(/es$/,''))||/ed$/.test(word);
  const endsParticiple=word=>/(?:ed|en)$/.test(word)||['known','made','given','taken','seen','built','brought','found','shown','paid','written','born','done','gone'].includes(word);
  function mainParts(en){
    let start=0,opening=null;
    const firstComma=en.indexOf(',');
    if(firstComma>=0){const lead=en.slice(0,firstComma);if(/^(?:As|When|While|Although|Though|Because|If|Since|After|Before|Unless)\b/i.test(lead)){opening={text:lead,type:'clause'};start=firstComma+1;}else if(/^(?:In|On|At|During|By|For|From|Since|Over|After|Before|However|Therefore|Nevertheless|Historically)\b/i.test(lead)){opening={text:lead,type:'adverbial'};start=firstComma+1;}}
    while(/\s/.test(en[start]||'')&&start<en.length)start++;
    const tail=en.slice(start),tokens=words(tail);
    let vi=tokens.findIndex((w,i)=>i>0&&isVerb(w.low)&&!['to','of','by','with','without'].includes(tokens[i-1]?.low)&&(auxiliaries.has(w.low)||(!['the','a','an','their','our','your','his','her','its','this','that','these','those'].includes(tokens[i-1]?.low)&&tokens[i+1]?.low!=='of')));
    if(vi<0)return {start,opening,subject:'',predicate:'',object:'',main:tail,tokens};
    const verb=tokens[vi];let verbEnd=verb.end;
    if(auxiliaries.has(verb.low)){
      for(let i=vi+1;i<Math.min(tokens.length,vi+5);i++){
        const w=tokens[i];if(auxiliaries.has(w.low)||w.low==='not'||/ly$/.test(w.low)||endsParticiple(w.low)||/ing$/.test(w.low)||bases.has(w.low)){verbEnd=w.end;}else break;
      }
    }else if(/^(?:start|started|begin|began|continue|continued|stop|stopped|try|tried)$/.test(verb.low)&&/ing$/.test(tokens[vi+1]?.low||''))verbEnd=tokens[vi+1].end;
    const subjectRaw=tail.slice(0,verb.index).trim(),subject=subjectRaw.replace(/\s+\w+ly\s*$/i,'').trim();
    let after=tail.slice(verbEnd).trim().replace(/[.!?]$/,'');
    const boundary=after.search(/\s+(?:(?:they|we|you|he|she|I)\s+(?:assum\w*|believ\w*|thought|think\w*|consider\w*|knew|know\w*)\b|who\b|which\b|that\b|via\b|with\b|such\s+as\b|for\b|by\b|because\b)|[,;]/i);
    if(boundary>=0)after=after.slice(0,boundary).trim();
    return {start,opening,subject,predicate:tail.slice(verb.index,verbEnd),object:after,main:tail,tokens,verb:verb.low,subjectRaw,verbIndex:start+verb.index,verbEnd:start+verbEnd};
  }
  function syntax(en){
    const out=[],add=(label,detail)=>{if(!out.some(g=>g.label===label&&g.detail===detail))out.push({label,detail});},main=mainParts(en);
    if(main.subject&&main.predicate){
      const head=main.subject.split(/\s+of\s+/i)[0],headWord=words(head).at(-1)?.text;
      add('主句主干（自动识别）',`在主句中，${quote(main.subject)}是主语${/\s+of\s+/i.test(main.subject)&&headWord?`，中心词是${quote(headWord)}`:''}；${quote(main.predicate)}是谓语部分${main.object?`；后接${quote(main.object)}，${/\b(?:become|became|is|are|was|were|seem|remain)\b/i.test(main.predicate)?'说明主语的状态或身份（表语）':'承接动作的对象或内容'}`:''}。这里按可识别词形拆解，嵌套从句另见下方。`);
      if(main.subjectRaw!==main.subject){const adverb=main.subjectRaw.slice(main.subject.length).trim();add('频率或时间副词',`${quote(adverb)}位于主语${quote(main.subject)}与谓语${quote(main.predicate)}之间，修饰这一动作；它不属于主语的中心词。`);}
    }
    if(main.opening){
      const lead=main.opening.text,mark=lead.match(/^\w+/)?.[0]||'';
      if(main.opening.type==='clause')add(/^As$/i.test(mark)?'As 引导的时间 / 伴随从句':'句首状语从句',`${quote(lead)}由${quote(mark)}引导，并在逗号处与主句分开。${/^As$/i.test(mark)?'这里可按“随着 / 当……时”理解，描述主句发生的背景；As也有原因等用法，具体取义应对照整句译文。':'它为后面的主句补充时间、条件、原因或让步背景；连接词的准确取义请对照本句译文。'}`);
      else add(/\b(?:\d{3,4}s?|early|late|morning|evening|years?|decades?|century)\b/i.test(lead)?'句首时间状语':'句首背景 / 衔接成分',`${quote(lead)}在逗号前，补充${/\b(?:\d{3,4}s?|early|late|years?|decades?)\b/i.test(lead)?'动作发生的时间':'主句的背景或前后衔接'}；移开这个部分后，主句从${quote(main.subject||main.main.slice(0,60))}开始。`);
    }
    for(const match of en.matchAll(/\b([A-Za-z]+)\s+((?:they|we|you|he|she|I)\s+(?:assum(?:e|ed)|believ(?:e|ed)|think|thought|consider(?:ed)?|know|knew))\s+((?:was|were|is|are|has|have|had)\s+(?:\w+ly\s+)?\w+(?:ing|ed|en))\b/gi)){
      add('省略关系词与嵌套判断',`${quote(match[1])}后面接${quote(match[2]+' '+match[3])}，可按省略 who / that 的关系从句理解。${quote(match[2])}表达“他们 / 某人认为”，是从句中的嵌套判断；${quote(match[3])}描述前面的${quote(match[1])}，不能把它误当作主句的第二个并列谓语。`);
    }
    for(const match of en.matchAll(/\b(was|were|am|is|are)\s+((?:\w+ly\s+)?\w+ing)\b/gi))add(/was|were/i.test(match[1])?'过去进行时':'进行时结构',`${quote(match[0])}由${quote(match[1])}与 -ing 形式${quote(match[2])}组成，表示${/was|were/i.test(match[1])?'过去某时正在持续':'某时正在持续'}的动作；具体主语要回到它所在的主句或从句确定。`);
    for(const match of en.matchAll(/\b(has|have|had)\s+((?:not\s+)?(?:\w+ly\s+)?(?:been\s+)?[A-Za-z]+(?:\s+[A-Za-z]+)?)/gi)){
      const chain=words(match[2]),part=chain.find(w=>endsParticiple(w.low)||['become','been','gone','done'].includes(w.low));if(!part)continue;
      const phrase=match[1]+' '+match[2].slice(0,part.end);
      add(match[1].toLowerCase()==='had'?'过去完成时':'现在完成时',`${quote(phrase)}由助动词${quote(match[1])}与过去分词${quote(part.text)}组成，${match[1].toLowerCase()==='had'?'表示在过去某个参照点之前已经发生':'将过去发生的变化或经历与现在的状态联系起来'}。${main.subject&&main.predicate.startsWith(match[1])?`本句主语是${quote(main.subject)}${/\sof\s/i.test(main.subject)?`，助动词与中心词${quote(words(main.subject.split(/\s+of\s+/i)[0]).at(-1)?.text)}对应，不由of后面的名词决定`:''}。`:''}`);
    }
    for(const match of en.matchAll(/\b(start(?:ed|s)?|beg(?:in|an)|continue(?:d|s)?|stop(?:ped|s)?)\s+([A-Za-z]+ing)(?:\s+([A-Za-z'-]+))?/gi))add('动词后接 -ing 活动',`${quote(match[0])}中，${quote(match[1])}是前面的动词，${quote(match[2])}以 -ing 形式说明开始、继续或停止的活动${match[3]?`，后接${quote(match[3])}`:''}；这不是单独的“be + doing”进行时。`);
    for(const match of en.matchAll(/\b(?:become|becomes|became|be|been|is|are|was|were)\s+(?:[A-Za-z]+ly\s+)?(integrated\s+into)\s+([^,.;!?]+)/gi))add('integrated into 搭配',`${quote(match[0])}里的${quote(match[1])}表示“融入 / 整合进……”，into后的${quote(match[2])}说明融入的范围或环境；integrated是分词形式，不能把into当作不定式to。`);
    for(const match of en.matchAll(/\b(via|with|of|by|into)\s+([^,.;!?]+?)(?=\s+(?:such\s+as|via|with|of|by|into|who|which|that|has|have|had|started|is|are|was|were)\b|[,.;!?]|$)/gi)){
      const full=match[0],prep=match[1].toLowerCase();
      if(full.length>120)continue;
      const meaning=prep==='via'?'via说明途径或方式，可译作“通过 / 经由”':prep==='with'?'with引出随同的事物；在处理、支付等动作后常表示所用工具或系统，具体取义见本句译文':prep==='of'?'of连接名词与其范围、所属或内容，of后的名词不一定是整句主语':prep==='by'?'by说明方式、执行者或时间界限，须结合前面的动词判断':'into说明进入、融入或变化的目标';
      add(`${match[1]} 介词短语`,`${quote(full)}是一个介词短语。${meaning}；这一小块应连起来理解，不把介词后的名词直接当成新的主句主语。`);
    }
    for(const match of en.matchAll(/\bsuch\s+as\s+([^,.;!?]+)/gi))add('such as 举例',`${quote(match[0])}由such as引出具体例子，补充说明前面的类别；它是举例关系，不表示“因此”的因果关系。`);
    for(const match of en.matchAll(/\b([A-Za-z]+s)\s+([A-Za-z]+ing)\s+([^,.;!?]+)/g)){
      if(auxiliaries.has(match[1].toLowerCase())||isVerb(match[1].toLowerCase()))continue;
      add('-ing 后置修饰（候选）',`${quote(match[1]+' '+match[2])}中，名词${quote(match[1])}后直接跟${quote(match[2])}，且两者之间没有be助动词，可按-ing短语修饰前面名词理解：即“正在 / 会${quote(match[2])}的${quote(match[1])}”。这项是词形规则识别，需结合上下文核对。`);
    }
    for(const match of en.matchAll(/\b(less|more|fewer|better|worse)\s+than\s+([^,.;!?]+)/gi))add('than 比较结构',`${quote(match[0])}以${quote(match[1]+' than')}引出比较，than后的${quote(match[2])}是参照标准；${/less|fewer/i.test(match[1])?'表示数量、程度或金额低于这一标准':'表示数量、程度或状态与这一标准的比较'}。`);
    if(!out.length){const ts=words(en);add('原文语序与词形',`本句保留的原文为${quote(en)}。自动规则未能可靠定位全部主谓关系；可确定的词序是${ts.slice(0,8).map(w=>quote(w.text)).join(' → ')}${ts.length>8?'等':''}。下方词块与中文来自在线翻译，未把不确定结构标成确定的语法结论。`);}
    return out.slice(0,12);
  }
  function chunkTexts(en){
    const points=new Set([0,en.length]),main=mainParts(en);
    if(main.opening){points.add(main.opening.text.length);points.add(main.start);}
    if(main.subject&&main.verbIndex>0)points.add(main.verbIndex);
    for(const match of en.matchAll(/[,;:]\s*|\s+(?=(?:such\s+as|less\s+than|more\s+than|with|because|although|whereas)\b)/gi))points.add(match.index+match[0].length);
    const nested=en.search(/\s+(?=(?:they|we|you|he|she|I)\s+(?:assum(?:e|ed)|believ(?:e|ed)|think|thought)\b)/i);if(nested>0)points.add(nested+1);
    let sorted=[...points].sort((a,b)=>a-b),parts=[];
    for(let i=0;i<sorted.length-1;i++){const raw=en.slice(sorted[i],sorted[i+1]).trim();if(raw&&/[A-Za-z]/.test(raw))parts.push(raw);}
    // Keep contiguous source spans and bound network work to six chunks.
    if(parts.length>6)parts=[...parts.slice(0,5),en.slice(en.indexOf(parts[5])).trim()];
    if(parts.length===1&&words(en).length>10){const ws=words(en),mid=ws[Math.ceil(ws.length/2)].index;parts=[en.slice(0,mid).trim(),en.slice(mid).trim()];}
    return parts.length?parts:[en];
  }
  async function sentenceRows(selected){
    const tasks=[...new Set(selected.flatMap(s=>[s.en,...chunkTexts(s.en)]))],translations=await mapLimit(tasks,4,translate),byText=new Map(tasks.map((text,i)=>[text,translations[i]]));
    return selected.map(s=>({...s,zh:byText.get(s.en),grammar:syntax(s.en),chunks:chunkTexts(s.en).map(en=>({en,zh:byText.get(en)}))}));
  }
  const stops=new Set(('the a an this that these those they them their there here who which what when where why how with from into over under than then also most more less some many much such only very just were been being have has had would could should shall will can may might must does did doing done and but for not are was you your its our out about after before because although through between during within without each other another first last both all any one two three in on at as of to by is be it he she we us i or so if no').split(' '));
  function vocabularyCandidates(source){
    const text=source.paragraphs.flat().map(s=>s.en).join(' '),counts=new Map(),original=new Map();
    for(const w of words(text)){if(w.low.length<5||stops.has(w.low)||auxiliaries.has(w.low))continue;counts.set(w.low,(counts.get(w.low)||0)+1);original.set(w.low,w.text);}
    return [...counts].sort((a,b)=>b[1]-a[1]||b[0].length-a[0].length).slice(0,8).map(([low])=>{
      const word=original.get(low),sentence=source.paragraphs.flat().find(s=>words(s.en).some(w=>w.low===low));
      const ts=words(sentence.en),i=ts.findIndex(w=>w.low===low),left=Math.max(0,i-1),right=Math.min(ts.length-1,i+2),phrase=sentence.en.slice(ts[left].index,ts[right].end);
      const pos=/ly$/.test(low)?'adv.（按词形识别）':/ing$/.test(low)?'-ing 形式（词性需结合句子）':/ed$/.test(low)?'过去式 / 分词（需结合句子）':/(?:tion|sion|ment|ness|ity|ism)$/.test(low)?'n.（按词形识别）':/(?:ive|able|ible|ous|ful|less)$/.test(low)?'adj.（按词形识别）':bases.has(low)?'动词 / 名词候选（结合原句）':'原文词语';
      return {word,pos,phrase,context:sentence.en};
    });
  }
  async function overview(source){
    const rows=source.paragraphs.flat(),selected=[rows[0]],last=rows.at(-1);
    if(last&&last.en!==rows[0].en&&rows.length>2)selected.push(last);
    const firsts=source.paragraphs.map(p=>p[0]),vocab=vocabularyCandidates(source);
    if(!vocab.length){const first=words(rows[0].en).find(w=>!stops.has(w.low))||words(rows[0].en)[0];vocab.push({word:first.text,pos:'原文词语',phrase:rows[0].en,context:rows[0].en});}
    const byText=new Map(rows.filter(s=>chinese(s.zh)&&s.zh.length<=6000).map(s=>[s.en,s.zh]));
    const tasks=[...new Set([source.title,...selected.map(s=>s.en),...firsts.map(s=>s.en),...vocab.flatMap(v=>[v.word,v.phrase])])].filter(s=>!byText.has(s));
    const translated=await mapLimit(tasks,4,translate);tasks.forEach((s,i)=>byText.set(s,translated[i]));
    const structure=firsts.map((s,i)=>{
      const marker=s.en.match(/^\s*(However|Nevertheless|But|Yet|Therefore|Thus|Consequently|As a result|For example|For instance|First(?:ly)?|Second(?:ly)?|Finally|In conclusion)\b/i)?.[1];
      const role=marker?/however|nevertheless|but|yet/i.test(marker)?'显式转折衔接':/therefore|thus|consequently|as a result/i.test(marker)?'显式因果衔接':/for example|for instance/i.test(marker)?'显式举例':/conclusion/i.test(marker)?'显式总结衔接':'顺序衔接':'段首内容提要';
      return {paragraph:i+1,label:`第${i+1}段 · ${role}`,description:`${marker?`本段以${quote(marker)}衔接。`:''}段首核心句译文：${byText.get(s.en)}${source.paragraphs[i].length>1?`（本段共${source.paragraphs[i].length}句；此处提取段首内容，不推断未明说的段落意图。）`:''}`};
    });
    return {titleZh:byText.get(source.title),summary:`原文提取要点：${selected.map(s=>byText.get(s.en)).join(' ')}（依据${selected.length>1?'文章首尾句':'文章首句'}，不是对作者意图的模型推断。）`,structure,vocabulary:vocab.map(v=>({word:v.word,pos:v.pos,meaning:byText.get(v.word),phrase:`原文搭配：${v.phrase}；搭配参考译文：${byText.get(v.phrase)}。单词参考义来自机器翻译，请结合原句核对。`})),questions:source.questions.map(q=>({...q}))};
  }
  async function verify(){const zh=await translate('Reading helps us learn.');return {ok:true,provider:'free',model:'free-online',notice:`免费在线翻译已返回中文：${zh}`};}
  return {sentences:sentenceRows,overview,verify,notice:NOTICE};
}
