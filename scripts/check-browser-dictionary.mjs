import assert from 'node:assert/strict';
import {lookupBrowserDictionary} from '../public/reading/browser-dictionary.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const en=word=>json([{word,phonetic:'/test/',meanings:[{partOfSpeech:'noun',definitions:[{definition:'The state of being worthy of respect.',example:'Treat people with dignity.'}]}]}]);
const zh=text=>json({responseStatus:200,responseData:{translatedText:text}});
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS',name);}

await test('Chinese fallback is usable when the English service is blocked by CORS',async()=>{
 const seen=[];const result=await lookupBrowserDictionary('Dignity',{fetch:async(url,options)=>{seen.push(url);assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.method,'GET');assert.equal(options.mode,'cors');assert.equal(options.headers,undefined);assert.equal(options.body,undefined);assert.ok(options.signal instanceof AbortSignal);const u=new URL(url);assert.equal(u.protocol,'https:');assert.ok(['api.dictionaryapi.dev','api.mymemory.translated.net'].includes(u.hostname));if(u.hostname==='api.dictionaryapi.dev')throw new TypeError('CORS');assert.deepEqual([...u.searchParams.keys()],['q','langpair']);return zh('尊严');}});
 assert.equal(seen.length,2);assert.equal(result.entry.word,'Dignity');assert.equal(result.entry.meaningLanguage,'zh-CN');assert.equal(result.entry.core,'尊严');assert.match(result.entry.source,/机器翻译/);assert.match(result.notice,/参考义/);
});
await test('a successful Chinese result returns promptly and cancels stalled dictionary work',async()=>{
 let dictionarySignal;const start=Date.now();const result=await lookupBrowserDictionary('dignity',{fetch:async(url,options)=>{if(url.includes('dictionaryapi')){dictionarySignal=options.signal;return new Promise(()=>{});}return zh('尊严');}});
 assert.equal(result.entry.core,'尊严');assert.ok(Date.now()-start<500);assert.equal(dictionarySignal.aborted,true);
});
await test('English-only results require a real definition and display the missing Chinese notice',async()=>{
 const result=await lookupBrowserDictionary('dignity',{fetch:async url=>url.includes('dictionaryapi')?en('dignity'):json({responseStatus:429,responseData:{translatedText:'MYMEMORY WARNING 限额'}},429)});
 assert.equal(result.entry.meaningLanguage,'en');assert.equal(result.entry.core,'The state of being worthy of respect.');assert.match(result.notice,/中文.*暂不可用/);assert.equal(result.entry.examples[0].en,'Treat people with dignity.');
});
await test('invalid and quota responses never become fake meanings',async()=>{
 await assert.rejects(lookupBrowserDictionary('dignity',{fetch:async url=>url.includes('dictionaryapi')?json([{word:'different',meanings:[{definitions:[{definition:'Wrong word.'}]}]}]):json({responseStatus:200,responseData:{translatedText:'MYMEMORY WARNING 配额不足'}})}),e=>e.code==='dictionary_unavailable');
});
await test('bounded word-form retries preserve the clicked form',async()=>{
 const requests=[];const result=await lookupBrowserDictionary('technologies',{fetch:async url=>{requests.push(url);const u=new URL(url);return u.hostname==='api.mymemory.translated.net'&&u.searchParams.get('q')==='technology'?zh('技术'):json({},404);}});
 assert.equal(result.entry.word,'technologies');assert.equal(result.entry.lemma,'technology');assert.equal(result.entry.core,'技术');assert.match(result.entry.usage,/原文词形：technologies/);assert.ok(requests.length<=8);
});
await test('invalid input and an aborted query do not contact public services',async()=>{
 let calls=0;const fetch=async()=>{calls++;throw Error('unexpected');};
 await assert.rejects(lookupBrowserDictionary('https://evil.test',{fetch}),e=>e.code==='invalid_word');
 const controller=new AbortController();controller.abort();await assert.rejects(lookupBrowserDictionary('dignity',{fetch,signal:controller.signal}),{name:'AbortError'});assert.equal(calls,0);
});
await test('cancelling a running query aborts both providers',async()=>{
 const controller=new AbortController(),signals=[];
 const promise=lookupBrowserDictionary('dignity',{signal:controller.signal,fetch:async(url,options)=>{signals.push(options.signal);return new Promise(()=>{});}});
 controller.abort();await assert.rejects(promise,{name:'AbortError'});assert.equal(signals.length,2);assert.ok(signals.every(signal=>signal.aborted));
});
await test('the deadline includes a stalled response body and uses portable abort timers',async()=>{
 const originalTimer=globalThis.setTimeout,nativeTimeout=AbortSignal.timeout;let calls=0;
 globalThis.setTimeout=(fn,ms,...args)=>originalTimer(fn,ms===7000?15:ms,...args);AbortSignal.timeout=undefined;
 try{await assert.rejects(lookupBrowserDictionary('dignity',{fetch:async()=>{calls++;return new Response(new ReadableStream({start(){}}));}}),e=>e.code==='dictionary_unavailable');assert.equal(calls,2);}
 finally{globalThis.setTimeout=originalTimer;AbortSignal.timeout=nativeTimeout;}
});
await test('redirects and HTML responses are rejected without a fabricated definition',async()=>{
 let calls=0;await assert.rejects(lookupBrowserDictionary('dignity',{fetch:async(url,options)=>{calls++;assert.equal(options.redirect,'error');return new Response(null,{status:302,headers:{location:'https://evil.test'}});}}),e=>e.code==='dictionary_unavailable');assert.equal(calls,2);
 await assert.rejects(lookupBrowserDictionary('dignity',{fetch:async()=>new Response('<html>blocked</html>')}),e=>e.code==='dictionary_unavailable');
});
console.log(`Browser dictionary checks passed: ${passed} scenarios.`);
