import assert from 'node:assert/strict';
import { createReadingAPI } from '../worker/reading-api.js';
import { createFreeReadingAnalyzer } from '../worker/free-analysis.js';

const originalFetch=globalThis.fetch;
const examples=[
  'U. S. customers historically tipped the people they assumed were earning most of their income via tips, such as restaurant serves earning less than the minimum wage.',
  'In the early 2010s, a wide range of businesses started processing purchases with iPads and other digital payment systems.',
  'As digital technologies become increasingly integrated into everyday life, the design of interactive systems has become an important research topic.'
];
const fixture={id:'existing-reading',title:'Digital reading',paragraphs:examples.map(en=>[{en}]),questions:[{id:'q1',number:26,stem:'What changed?',options:['Payment','Weather','Transport','Food'],answer:'A'},{id:'q2',number:27,stem:'Incomplete source question?',options:['One existing choice','','',''],answer:null,incomplete:true}],answerStatus:'verified',sourceType:'import'};
const make=(path,body)=>new Request('https://reading.test/api/reading/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const fresh=()=>createReadingAPI(createFreeReadingAnalyzer());
const calls=[];
const translated=q=>/^[A-Za-z'-]+$/.test(q)?'单词参考义：'+q:'这段原文的中文参考译文：'+q;
function translationFetch(url,options={}){
  const u=new URL(url);calls.push({url:u,options});
  assert.ok(!/deepseek|openai/.test(u.hostname),'Free mode must never call a paid model');
  assert.equal(options.redirect,'manual');
  assert.ok(!options.headers?.Authorization,'Translation requests must not contain API keys');
  const q=u.searchParams.get('q');
  if(u.hostname==='translate.googleapis.com')return Promise.resolve(new Response(JSON.stringify([[[translated(q),q,null,null,1]],null,'en']),{headers:{'Content-Type':'application/json'}}));
  if(u.hostname==='api.mymemory.translated.net')return Promise.resolve(new Response(JSON.stringify({responseStatus:200,responseData:{translatedText:translated(q)}})));
  throw new Error('Unexpected endpoint '+u.origin);
}
async function request(api,path,body,expected=200){const response=await api.fetch(make(path,body));const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;}
try{
  globalThis.fetch=translationFetch;
  let api=fresh();
  const status=await (await api.fetch(new Request('https://reading.test/api/reading/status'))).json();
  assert.equal(status.defaultProvider,'free');assert.equal(status.modelConfigured,false);assert.equal(status.providers.free.configured,true);
  assert.deepEqual(status.models.deepseek,['deepseek-v4-pro','deepseek-flash']);
  const verification=await request(api,'verify',{provider:'free'});
  assert.ok(verification.ok);assert.match(verification.notice,/已返回中文/);assert.ok(calls.length,'Connection verification really calls translation');

  const result=await request(api,'analyze',{action:'sentences',passage:fixture,sentenceIds:['p1s1','p2s1','p3s1']});
  assert.equal(result.provider,'free');assert.equal(result.analysisMode,'online');
  assert.match(result.notice,/机器翻译/);
  assert.deepEqual(result.sentences.map(s=>s.en),examples,'All source spelling, including the OCR typo serves, stays intact');
  assert.deepEqual(result.sentences.map(s=>s.id),['p1s1','p2s1','p3s1']);
  assert.deepEqual(result.sentences.map(s=>s.number),[1,2,3]);
  for(const s of result.sentences){assert.match(s.zh,/[\u3400-\u9fff]/);assert.ok(s.grammar.length);assert.ok(s.chunks.length);for(const c of s.chunks){assert.ok(s.en.includes(c.en));assert.match(c.zh,/[\u3400-\u9fff]/);}}
  const grammar=result.sentences.map(s=>s.grammar.map(g=>g.label+' '+g.detail).join('\n'));
  assert.ok(result.sentences[0].chunks.some(c=>/were earning.*via tips/.test(c.en)),'Via phrases retain their governing action as translation context');
  assert.ok(!result.sentences[0].chunks.some(c=>/^via\b/i.test(c.en)),'Do not isolate an ambiguous via phrase');
  assert.match(grammar[0],/customers.*tipped.*people/);assert.match(grammar[0],/省略关系词/);assert.match(grammar[0],/they assumed/);assert.match(grammar[0],/were earning/);assert.match(grammar[0],/过去进行时/);assert.match(grammar[0],/via 介词短语/);assert.match(grammar[0],/via tips/);assert.match(grammar[0],/less than/);
  assert.match(grammar[1],/时间状语/);assert.match(grammar[1],/early 2010s/);assert.match(grammar[1],/中心词是“range”/);assert.match(grammar[1],/started processing/);assert.match(grammar[1],/with iPads/);
  assert.match(grammar[2],/As 引导/);assert.match(grammar[2],/现在完成时/);assert.match(grammar[2],/has become/);assert.match(grammar[2],/integrated into/);assert.match(grammar[2],/中心词“design”/);

  // A new server factory has no shared cache: completed sentence translations
  // in the request itself must prevent overview from translating them again.
  api=fresh();calls.length=0;
  const enriched={...fixture,paragraphs:fixture.paragraphs.map((p,i)=>p.map(s=>({...s,zh:result.sentences[i].zh})))};
  const overview=await request(api,'analyze',{mode:'overview',provider:'free',passage:enriched});
  assert.equal(overview.overview.structure.length,3);assert.match(overview.overview.summary,/原文提取/);
  assert.ok(overview.overview.vocabulary.length);assert.ok(overview.overview.vocabulary.every(v=>v.meaning.startsWith('单词参考义：')),'Vocabulary meanings translate the word itself');
  assert.ok(overview.overview.vocabulary.every(v=>/搭配参考译文/.test(v.phrase)));
  assert.ok(!calls.some(c=>examples.includes(c.url.searchParams.get('q'))),'Overview reuses existing bounded Chinese sentence translations');
  assert.equal(overview.overview.questions.length,2);assert.equal(overview.overview.questions[0].number,26);assert.equal(overview.overview.questions[0].answer,'A');assert.equal(overview.overview.questions[1].incomplete,true);assert.deepEqual(overview.overview.questions[1].options,fixture.questions[1].options);
  assert.ok(calls.length<50,'Overview stays within the Worker subrequest budget after sentence batches');
  await request(api,'analyze',{action:'sentences',passage:fixture,sentenceIds:['p1s1','p1s1']},400);
  await request(api,'analyze',{action:'sentences',passage:fixture,sentenceIds:['p4s1']},400);
  await request(api,'analyze',{action:'sentences',passage:fixture,sentenceIds:['p3s1','p1s1']},400);

  const modelSource={id:'model-reading',title:'Simple reading',paragraphs:[[{en:'Students learn by reading useful books every day.'}]],questions:[]};
  const modelSentence={id:'p1s1',paragraph:1,sentence:1,number:1,en:modelSource.paragraphs[0][0].en,zh:'学生通过每天读有用的书来学习。',grammar:[{label:'主谓结构',detail:'Students 是主语，learn 是谓语，by reading说明学习方式。'}],chunks:[{en:'by reading useful books every day',zh:'通过每天阅读有用的书'}]};
  const modelBody={provider:'deepseek',model:'deepseek-flash',apiKey:'test-only-sentinel',passage:modelSource,action:'sentences',sentenceIds:['p1s1']};
  let modelOutput={sentences:[modelSentence]};
  globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.deepseek.com/chat/completions');const body=JSON.parse(options.body);assert.equal(body.model,'deepseek-flash');assert.deepEqual(body.thinking,{type:'disabled'});return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(modelOutput)}}]}));};
  await request(api,'analyze',modelBody);
  for(const bad of [
    {...modelSentence,en:modelSentence.en+' Changed.'},
    {...modelSentence,id:'p1s2'},
    {...modelSentence,zh:''},
    {...modelSentence,grammar:[]},
    {...modelSentence,chunks:[{en:'invented source words',zh:'伪造词块'}]}
  ]){modelOutput={sentences:[bad]};const err=await request(api,'analyze',modelBody,502);assert.equal(err.code,'invalid_model_output');}
  modelOutput={titleZh:'阅读',summary:'学生通过读书学习。',structure:[],vocabulary:[],questions:[]};
  assert.equal((await request(api,'analyze',{...modelBody,action:'overview'},502)).code,'invalid_model_output');
  for(const [upstream,status,code] of [[401,401,'model_auth_failed'],[402,402,'model_balance'],[429,429,'model_rate_limited']]){globalThis.fetch=async()=>new Response('secret upstream details test-only-sentinel',{status:upstream});const error=await request(api,'analyze',modelBody,status);assert.equal(error.code,code);assert.ok(!JSON.stringify(error).includes('test-only-sentinel'));}
  globalThis.fetch=async()=>{throw new DOMException('Aborted','AbortError');};assert.equal((await request(api,'analyze',modelBody,504)).code,'model_timeout');
  assert.equal((await request(api,'analyze',{...modelBody,apiKey:''},503)).code,'model_not_configured');
  assert.equal((await request(api,'analyze',{...modelBody,model:'arbitrary-unapproved'},400)).code,'invalid_model');

  // Fallback uses only bounded requests; explicit quota failure is actionable.
  const fallbackCalls=[];
  globalThis.fetch=async(url,options)=>{const u=new URL(url);assert.equal(options.redirect,'manual');if(u.hostname==='translate.googleapis.com')return new Response('',{status:503});assert.equal(u.hostname,'api.mymemory.translated.net');fallbackCalls.push(u.searchParams.get('q'));assert.ok(new TextEncoder().encode(u.searchParams.get('q')).length<=480);return new Response(JSON.stringify({responseStatus:200,responseData:{translatedText:'已翻译的真实响应片段。'}}));};
  const long='Students learn useful language skills through careful reading and regular practice. '.repeat(12);
  const fallback=await createFreeReadingAnalyzer().sentences([{id:'p1s1',paragraph:1,sentence:1,number:1,en:long}]);assert.ok(fallback[0].zh);assert.ok(fallbackCalls.length>1);
  globalThis.fetch=async url=>new URL(url).hostname==='translate.googleapis.com'?new Response('',{status:503}):new Response(JSON.stringify({responseStatus:429,responseData:{translatedText:'MYMEMORY WARNING: USAGE LIMIT'}}));
  const quota=await request(fresh(),'verify',{provider:'free'},429);assert.equal(quota.code,'free_translation_quota');

  // Build embeds factory source, so no imported lexical closure may be needed.
  globalThis.fetch=translationFetch;
  const embeddedFree=(0,eval)('('+createFreeReadingAnalyzer.toString()+')')();
  const embeddedAPI=(0,eval)('('+createReadingAPI.toString()+')')(embeddedFree);
  assert.equal((await request(embeddedAPI,'verify',{provider:'free'})).ok,true);
  console.log('Analysis checks passed: no-key real-protocol translation, explicit syntax rules, exact sentence identity, overview reuse, original questions, optional-model validation/errors, bounded fallback, quota, and self-contained factories.');
}finally{globalThis.fetch=originalFetch;}
