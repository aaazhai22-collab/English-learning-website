import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { seedPassages } from '../public/reading/content.js';
import { normalizePassage,parseReadingText,flatten,emptyState,statistics,validateState,escapeHTML,safeURL } from '../public/reading/core.js';
import { scheduleReview,isDue } from '../public/reading/review.js';
import { createReadingAPI } from '../worker/reading-api.js';
for(const path of ['public/reading/app.js','public/reading/core.js','public/reading/content.js','public/reading/basics.js','public/reading/review.js','worker/reading-api.js','worker/index.js','server.mjs']){
 const result=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
}
for(const p of seedPassages){const n=normalizePassage(p);assert.equal(n.questions.length,5);for(const q of n.questions){assert.match(q.answer,/^[A-D]$/);assert.ok(q.evidence.every(i=>i>0&&i<=flatten(n).length));}}
assert.equal(flatten(seedPassages[0]).length,17);
assert.equal(seedPassages[0].questions.map(q=>q.answer).join(''),'BCABC');
const original=seedPassages[0];
const text=`Passage: ${original.title}\n\n${original.paragraphs.map(p=>p.map(s=>s.en).join(' ')).join('\n\n')}\n\n${original.questions.map((q,i)=>`${i+1}. ${q.stem}\n${q.options.map((o,j)=>'ABCD'[j]+'. '+o).join('\n')}`).join('\n\n')}\n\n答案：1.B 2.C 3.A 4.B 5.C`;
const parsed=parseReadingText(text);assert.equal(parsed.questions.length,5);assert.equal(parsed.questions.map(q=>q.answer).join(''),'BCABC');assert.equal(flatten(parsed).length,17);assert.equal(parsed.paragraphs.length,5);
assert.equal(flatten(parsed).map(s=>s.en).join(' '),flatten(original).map(s=>s.en).join(' '));
assert.throws(()=>parseReadingText('Passage: Hello\nNot enough words.'));
assert.throws(()=>normalizePassage({paragraphs:[[{en:'A sentence.'}]],questions:[{stem:'Question?',options:['a','b']}] }));
assert.equal(safeURL('javascript:alert(1)'), '');assert.equal(safeURL('https://user:pass@example.com/'),'');assert.ok(escapeHTML('<script>').includes('&lt;'));
let state=emptyState();state.attempts.p=[{id:'1',mode:'learn',helped:true,answers:{q1:{correct:false,skill:'logic'}}},{id:'2',mode:'exam',helped:false,answers:{q1:{correct:true,skill:'logic'},q2:{correct:null,skill:'logic'}}},{id:'3',mode:'exam',helped:false,answers:{q1:{correct:false,skill:'logic'}}}];let st=statistics(state);assert.equal(st.accuracy,100);assert.equal(st.total,1);assert.equal(st.completed,1);assert.equal(st.skills.logic.wrong,1);
assert.throws(()=>validateState({version:5}));
const now=new Date('2026-10-16T01:00:00Z'),r=scheduleReview(null,'again',now);assert.ok(new Date(r.due)>now);assert.equal(isDue(null,now),true);assert.ok(scheduleReview(JSON.parse(JSON.stringify(r)),'good',new Date(now.getTime()+60000)).reps===2);
const api=createReadingAPI();const make=(path,data,origin)=>new Request('https://example.chatgpt.site/api/reading/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(data)});
assert.equal(await api.fetch(new Request('https://example.chatgpt.site/index.html')),null);
let response=await api.fetch(new Request('https://example.chatgpt.site/api/reading/status'));let status=await response.json();assert.equal(status.configured,true);assert.equal(status.provider,'free');assert.equal(status.modelConfigured,false);assert.equal(status.providers.free.configured,true);assert.equal(response.status,200);
for(const url of ['http://localhost/','https://127.0.0.1/','https://kaoyan.eol.cn.evil.example/','https://user:pass@kaoyan.eol.cn/','https://kaoyan.eol.cn:444/'])assert.equal((await api.fetch(make('fetch',{url}))).status,400);
assert.equal((await api.fetch(make('fetch',{url:'https://kaoyan.eol.cn/'},'https://evil.example'))).status,403);
response=await api.fetch(make('analyze',{text:'A'.repeat(120),provider:'deepseek'}));assert.equal(response.status,503);assert.equal((await response.json()).code,'model_not_configured');
assert.equal((await api.fetch(make('lookup',{word:'a/b/c'}))).status,400);
// Validate the built factory does not depend on imported closures.
const restored=(0,eval)('('+createReadingAPI.toString()+')')();assert.equal((await restored.fetch(new Request('https://x.test/api/reading/status'))).status,200);
const fetchBefore=globalThis.fetch;
try {
 let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response('',{status:302,headers:{location:'https://127.0.0.1/private'}});};
 assert.equal((await api.fetch(make('fetch',{url:'https://kaoyan.eol.cn/article'}))).status,400);assert.equal(calls,1);
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(options.headers.Authorization,'Bearer test-only-sentinel');return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(seedPassages[0])}}]}),{headers:{'content-type':'application/json'}});};
 response=await api.fetch(make('analyze',{text,provider:'deepseek',apiKey:'test-only-sentinel',profile:{level:'beginner',depth:'detailed'}}));assert.equal(response.status,200);const ai=await response.json();assert.equal(ai.passage.answerStatus,'unverified');assert.equal(ai.passage.questions.length,5);assert.ok(!JSON.stringify(ai).includes('test-only-sentinel'));
 globalThis.fetch=async()=>new Response('Sensitive upstream details test-only-sentinel',{status:401});response=await api.fetch(make('analyze',{text,provider:'deepseek',apiKey:'test-only-sentinel'}));assert.equal(response.status,401);assert.ok(!(await response.text()).includes('test-only-sentinel'));
} finally { globalThis.fetch=fetchBefore; }
console.log('Reading checks passed: 3 bilingual passages / 15 questions; parser, first independent scoring, JSON recovery, FSRS, URL controls, API state and standalone Worker factory.');
