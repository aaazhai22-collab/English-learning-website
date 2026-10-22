// Public, key-free fallback. Only the clicked word is sent to these fixed APIs.
const DEADLINE_MS=7000;
const chinese=value=>/[\u3400-\u9fff]/.test(value||'');
const plain=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const abortError=()=>new DOMException('查询已取消。','AbortError');
const unavailable=()=>Object.assign(new Error('公共词典暂不可用，请稍后重试，或手动补充词义。'),{code:'dictionary_unavailable'});

function wordForms(word){
 const out=[],irregular={went:'go',gone:'go',was:'be',were:'be',been:'be',did:'do',done:'do',had:'have',has:'have',made:'make',took:'take',taken:'take',gave:'give',given:'give',saw:'see',seen:'see',bought:'buy',brought:'bring',thought:'think',found:'find',felt:'feel',left:'leave',said:'say',told:'tell',wrote:'write',written:'write',ran:'run',men:'man',women:'woman',children:'child',people:'person',feet:'foot',teeth:'tooth',mice:'mouse',better:'good',best:'good'};
 if(irregular[word])out.push(irregular[word]);
 if(/ies$/.test(word)&&word.length>4)out.push(word.slice(0,-3)+'y');
 if(/(?:ches|shes|xes|zes|sses)$/.test(word))out.push(word.slice(0,-2));
 if(/ing$/.test(word)&&word.length>5){const stem=word.slice(0,-3);out.push(stem,stem+'e');if(/([b-df-hj-np-tv-z])\1$/.test(stem))out.push(stem.slice(0,-1));}
 if(/ied$/.test(word)&&word.length>4)out.push(word.slice(0,-3)+'y');
 else if(/ed$/.test(word)&&word.length>4){const stem=word.slice(0,-2);out.push(stem,word.slice(0,-1));if(/([b-df-hj-np-tv-z])\1$/.test(stem))out.push(stem.slice(0,-1));}
 if(/s$/.test(word)&&word.length>3&&!/(?:ss|us|is|ous)$/.test(word))out.push(word.slice(0,-1));
 return [...new Set(out)].filter(value=>value!==word&&value.length>1).slice(0,3);
}

async function jsonRequest(url,fetcher,signal){
 const target=new URL(url);
 const allowed=target.protocol==='https:'&&!target.username&&!target.password&&!target.port&&(
  target.hostname==='api.dictionaryapi.dev'&&/^\/api\/v2\/entries\/en\/[A-Za-z'%\-]+$/.test(target.pathname)||
  target.hostname==='api.mymemory.translated.net'&&target.pathname==='/get'
 );
 if(!allowed)throw unavailable();
 const controller=new AbortController();let timer,onAbort;
 const deadline=new Promise((_,reject)=>{
  timer=setTimeout(()=>{controller.abort();reject(new DOMException('词典查询超时。','TimeoutError'));},DEADLINE_MS);
  onAbort=()=>{controller.abort();reject(abortError());};
  if(signal?.aborted)onAbort();else signal?.addEventListener('abort',onAbort,{once:true});
 });
 const request=(async()=>{
  if(signal?.aborted)throw abortError();
  const response=await fetcher(target.href,{method:'GET',mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:controller.signal});
  if(!response.ok||response.type==='opaque')throw unavailable();
  // The deadline covers downloading and parsing the body as well as connecting.
  const reader=response.body?.getReader();let text='';
  if(reader){const decoder=new TextDecoder();let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>200000){await reader.cancel();throw unavailable();}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}}
  else text=await response.text();
  if(text.length>200000)throw unavailable();
  return JSON.parse(text);
 })();
 try{return await Promise.race([request,deadline]);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);controller.abort();}
}

async function english(word,fetcher,signal){
 try{
  const data=await jsonRequest(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,fetcher,signal);
  const item=Array.isArray(data)?data.find(value=>value&&String(value.word||'').toLowerCase()===word&&Array.isArray(value.meanings)):null;
  if(!item)return null;
  const definitions=item.meanings.flatMap(m=>Array.isArray(m?.definitions)?m.definitions.filter(d=>typeof d?.definition==='string'&&plain(d.definition)&&plain(d.definition).length<1500).slice(0,2).map(d=>({pos:plain(m.partOfSpeech).slice(0,80),text:plain(d.definition),example:typeof d.example==='string'?plain(d.example):''})):[]).slice(0,4);
  if(!definitions.length)return null;
  return {definitions,phonetic:plain(item.phonetic||item.phonetics?.find(value=>typeof value?.text==='string')?.text).slice(0,150)};
 }catch{return null;}
}

async function translation(word,fetcher,signal){
 try{
  const data=await jsonRequest(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en%7Czh-CN`,fetcher,signal);
  const text=plain(data?.responseData?.translatedText);
  return Number(data?.responseStatus)===200&&chinese(text)&&text.length<1500&&!/MYMEMORY WARNING|USAGE LIMIT|QUERY LENGTH|INVALID LANGUAGE|YOU USED ALL|PLEASE SELECT/i.test(text)?text:'';
 }catch{return '';}
}

async function query(word,fetcher,signal){
 const controller=new AbortController(),abort=()=>controller.abort();
 if(signal?.aborted)throw abortError();
 signal?.addEventListener('abort',abort,{once:true});
 const dictionary=english(word,fetcher,controller.signal);
 try{
  const zh=await translation(word,fetcher,controller.signal);
  if(signal?.aborted)throw abortError();
  // Do not make a usable Chinese result wait for an unreachable English API.
  if(zh)return {lemma:word,zh,dictionary:null};
  const en=await dictionary;
  if(signal?.aborted)throw abortError();
  return en?{lemma:word,zh:'',dictionary:en}:null;
 }finally{signal?.removeEventListener('abort',abort);controller.abort();}
}

export async function lookupBrowserDictionary(value,{fetch:fetcher=globalThis.fetch?.bind(globalThis),signal}={}){
 const word=String(value||'').replace(/’/g,"'").trim(),key=word.toLowerCase();
 if(!/^[A-Za-z][A-Za-z'-]{0,69}$/.test(word))throw Object.assign(new Error('联网查询支持单个英文词。'),{code:'invalid_word'});
 if(typeof fetcher!=='function')throw unavailable();
 if(signal?.aborted)throw abortError();
 let found=await query(key,fetcher,signal);
 if(!found){
  const forms=wordForms(key),controller=new AbortController(),abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});
  try{
   found=await Promise.any(forms.map(async lemma=>{const result=await query(lemma,fetcher,controller.signal);if(!result)throw unavailable();return result;}));
  }catch{if(signal?.aborted)throw abortError();throw unavailable();}
  finally{signal?.removeEventListener('abort',abort);controller.abort();}
 }
 if(signal?.aborted)throw abortError();
 const {lemma,zh,dictionary}=found,defs=dictionary?.definitions||[],core=zh||defs[0]?.text;
 if(!core)throw unavailable();
 const usage=[...defs.map(d=>`[${d.pos}] ${d.text}`),lemma!==key?`原文词形：${word}；词典词形：${lemma}。`:''].filter(Boolean).join('\n');
 const examples=defs.map(d=>d.example).filter(text=>text&&text.length<250&&(text.match(/[A-Za-z]+/g)||[]).length<=18).sort((a,b)=>a.length-b.length).slice(0,2).map(en=>({en,zh:''}));
 return {
  entry:{word,lemma,pos:[...new Set(defs.map(d=>d.pos))].filter(Boolean).join(' / '),phonetic:dictionary?.phonetic||'',core,meaning:core,meaningLanguage:zh?'zh-CN':'en',contextMeaning:'',usage,examples,phrases:[],source:zh?'MyMemory 机器翻译（浏览器直连）· 参考义':'DictionaryAPI（浏览器直连）· 参考义',sourceUrl:zh?'https://mymemory.translated.net/':'https://dictionaryapi.dev/'},
  notice:zh?'已通过浏览器直连取得中文机器翻译参考义；请结合原文核对。':'已通过浏览器直连取得英文词典释义，中文参考义暂不可用。'
 };
}
