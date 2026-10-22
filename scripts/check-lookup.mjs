import assert from 'node:assert/strict';
import { createReadingAPI } from '../worker/reading-api.js';

const request=(word,extra={})=>new Request('https://reading.test/api/reading/lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({word,...extra})});
const dictionary=(word='dignity')=>[{word,phonetic:'/test/',meanings:[{partOfSpeech:'noun',definitions:[{definition:'The state of being worthy of respect.',example:'Treat people with dignity.'}]}]}];
const bing=(word='dignity',definition='尊严；庄严')=>`<div class="qdef"><div class="hd_area"><div class="hd_div" id="headword"><h1><strong>${word}</strong></h1></div><div class="hd_prUS b_primtxt">美&#160;[test]</div></div><ul><li><span class="pos">n.</span><span class="def b_regtxt"><a>${definition}</a></span></li><li><span class="pos">网络</span><span class="def">不应作为核心词义</span></li></ul></div>`;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const oldFetch=globalThis.fetch;
let passed=0;
async function test(name,fn){try{await fn();passed++;}catch(error){error.message=name+': '+error.message;throw error;}}

try{
  await test('real Chinese dictionary definitions take priority over rate-limited translation',async()=>{
    let translations=0;
    globalThis.fetch=async(url,options)=>{assert.equal(options?.headers?.Authorization,undefined);assert.equal(options?.headers?.Cookie,undefined);if(String(url).includes('dictionaryapi'))return json(dictionary());if(String(url).includes('cn.bing.com'))return new Response(bing());translations++;return json({responseStatus:429},429);};
    const response=await createReadingAPI().fetch(request('dignity'));assert.equal(response.status,200);const data=await response.json();assert.match(data.entry.core,/尊严/);assert.doesNotMatch(data.entry.core,/不应作为/);assert.equal(data.entry.meaningLanguage,'zh-CN');assert.match(data.entry.source,/必应词典/);assert.equal(translations,0);
  });
  await test('English-only response contains a real meaning and an explicit notice',async()=>{
    globalThis.fetch=async url=>String(url).includes('dictionaryapi')?json(dictionary()):json({responseStatus:429,responseData:{translatedText:'MYMEMORY WARNING: QUOTA'}},429);
    const response=await createReadingAPI().fetch(request('dignity'));assert.equal(response.status,200);const data=await response.json();assert.equal(data.entry.core,'The state of being worthy of respect.');assert.equal(data.entry.meaningLanguage,'en');assert.match(data.notice,/中文.*暂不可用/);assert.doesNotMatch(data.entry.meaning,/请结合下面/);
  });
  await test('inflected word preserves the clicked form and reports its verified base form',async()=>{
    globalThis.fetch=async url=>{url=String(url);if(url.endsWith('/technology'))return json(dictionary('technology'));if(url.includes('cn.bing.com')&&new URL(url).searchParams.get('q')==='technology')return new Response(bing('technology','技术'));return json({},404);};
    const response=await createReadingAPI().fetch(request('technologies'));const data=await response.json();assert.equal(response.status,200);assert.equal(data.entry.word,'technologies');assert.equal(data.entry.lemma,'technology');assert.match(data.entry.core,/技术/);assert.match(data.entry.usage,/原文词形：technologies/);
  });
  await test('an unusable model key degrades to the no-key dictionary',async()=>{
    globalThis.fetch=async url=>String(url).includes('chat/completions')?json({error:'no'},401):String(url).includes('dictionaryapi')?json(dictionary()):new Response(bing());
    const response=await createReadingAPI().fetch(request('dignity',{apiKey:'test-only-invalid-key'}));const data=await response.json();assert.equal(response.status,200);assert.match(data.entry.meaning,/尊严/);assert.match(data.notice,/已改用无需密钥/);assert.ok(!JSON.stringify(data).includes('test-only-invalid-key'));
  });
  await test('invalid translation and a search result for another word are not saved as a meaning',async()=>{
    globalThis.fetch=async url=>String(url).includes('cn.bing.com')?new Response(bing('unrelated')):String(url).includes('mymemory')?json({responseStatus:200,responseData:{translatedText:'dignity'}}):json({},404);
    const response=await createReadingAPI().fetch(request('dignity'));const data=await response.json();assert.equal(response.status,502);assert.equal(data.code,'dictionary_unavailable');assert.equal(data.entry,undefined);
  });
  await test('all unavailable providers report a retryable error without invented data',async()=>{
    globalThis.fetch=async()=>{throw new TypeError('network');};const response=await createReadingAPI().fetch(request('dignity'));assert.equal(response.status,502);const data=await response.json();assert.equal(data.code,'dictionary_unavailable');assert.match(data.error,/稍后重试/);
  });
  await test('short public dictionary results can be cached without a user context or key',async()=>{
    let calls=0;globalThis.fetch=async url=>{calls++;return String(url).includes('dictionaryapi')?json(dictionary()):new Response(bing());};const api=createReadingAPI();await api.fetch(request('dignity',{context:'First sentence.'}));const before=calls;const response=await api.fetch(request('Dignity',{context:'A different sentence.'}));const data=await response.json();assert.equal(calls,before);assert.equal(data.cached,true);assert.equal(data.entry.word,'Dignity');assert.ok(!JSON.stringify(data).includes('First sentence.'));
  });
  await test('request validation rejects phrases and routes remain self contained in the built factory',async()=>{
    globalThis.fetch=async()=>{throw new Error('must not fetch');};assert.equal((await createReadingAPI().fetch(request('one/two'))).status,400);const restored=(0,eval)('('+createReadingAPI.toString()+')')();assert.equal((await restored.fetch(request('<script>'))).status,400);
  });
}finally{globalThis.fetch=oldFetch;}
console.log(`Lookup checks passed: ${passed} scenarios for Chinese fallback, real English definitions, inflections, model fallback, provider failures, cache and validation.`);

if(process.argv.includes('--live')){
  const http=await import('node:http');
  if(typeof http.setGlobalProxyFromEnv==='function'){
    if(process.platform==='win32'&&!process.env.HTTPS_PROXY&&!process.env.https_proxy){const {spawnSync}=await import('node:child_process');const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[System.Net.WebRequest]::DefaultWebProxy.GetProxy([uri]'https://cn.bing.com').AbsoluteUri"],{encoding:'utf8',windowsHide:true,timeout:3000});const proxy=result.stdout?.trim();if(proxy&&/^https?:\/\//.test(proxy)&&new URL(proxy).origin!=='https://cn.bing.com')process.env.HTTPS_PROXY=proxy;}
    http.setGlobalProxyFromEnv();
  }
  const api=createReadingAPI();
  for(const word of ['dignity','technologies','broadcasting','unfamiliar']){
    const response=await api.fetch(request(word));const data=await response.json();assert.equal(response.status,200,`${word}: ${data.error}`);assert.equal(data.entry.meaningLanguage,'zh-CN',`${word}: missing Chinese definition`);assert.match(data.entry.core,/[\u3400-\u9fff]/);console.log(JSON.stringify({word,lemma:data.entry.lemma,meaning:data.entry.core,source:data.entry.source}));
  }
  console.log('Live dictionary verification passed for four words without a model key.');
}
