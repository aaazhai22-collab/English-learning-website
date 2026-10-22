import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {selectBeginnerExample} from '../public/data/beginner-examples.js';
import {buildPublicSpeechEntries} from './catalog-utils.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const base=process.env.QA_BASE||'http://localhost:5173';
const catalog=JSON.parse(await readFile(new URL('../public/data/catalog.json',import.meta.url),'utf8'));
const words=new Map(catalog.words.map(w=>[String(w.id),w]));
const activist=catalog.words.find(w=>w.word==='activist'),basic=selectBeginnerExample(activist);
const oldSet=new Set();
for(const w of catalog.words){oldSet.add(w.word);for(const x of w.examples||[]){oldSet.add(x.sentence);for(const c of x.collocations||[])if(c.phrase)oldSet.add(c.phrase);}for(const c of w.collocations||[])if(c.phrase)oldSet.add(c.phrase);}
const oldTexts=[...oldSet].filter(Boolean).map(t=>t.replace(/\s+/g,' ').trim());
const texts=buildPublicSpeechEntries(catalog);
assert.deepEqual(texts.slice(0,oldTexts.length),oldTexts,'New short sentences must not change any original speech entry ID');
assert.ok(texts.includes(basic.sentence));
for(const word of catalog.words)assert.ok(texts.includes(selectBeginnerExample(word).sentence),`Missing basic speech ID for ${word.word}`);
const initial={catalogIdVersion:40,learningDataVersion:2,words:{[activist.id]:{status:'learning',favorite:true}},history:[],activity:[],dates:[],lastWordId:activist.id,lastIndex:activist.id-1,studyCollectionId:activist.collectionId,motion:false,quizTargetCursor:false};
await mkdir('qa/beginner',{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),report={checks:[],errors:[],originalSpeechEntries:oldTexts.length,totalSpeechEntries:texts.length,basicSentences:catalog.words.length};
function nativeMock(initialState){
  if(location.protocol==='http:'||location.protocol==='https:')localStorage.setItem('wordsInBloomData',JSON.stringify(initialState));
  window.__spoken=[];
  class Utterance{constructor(text){this.text=text;}}
  const synth={speaking:false,paused:false,pending:false,getVoices:()=>[{name:'English',lang:'en-US',default:true,localService:true}],addEventListener(){},removeEventListener(){},cancel(){this.speaking=false;},resume(){},speak(u){this.speaking=true;window.__spoken.push(u.text);u.onstart?.();}};
  Object.defineProperty(window,'speechSynthesis',{value:synth,configurable:true});
  Object.defineProperty(window,'SpeechSynthesisUtterance',{value:Utterance,configurable:true});
}
async function checkExample(page,scope){
  const item=page.locator(scope+' [data-beginner-example]').first();await item.waitFor();
  const id=await item.getAttribute('data-beginner-example'),expected=selectBeginnerExample(words.get(id));
  assert.equal((await item.locator('.sentence').innerText()).trim(),expected.sentence);
  assert.equal((await item.locator('.translation').innerText()).trim(),expected.translation);
  assert.ok(await item.locator('.translation').isVisible());
  assert.equal(await item.evaluate(el=>el.nextElementSibling?.classList.contains('original-examples')),true);
  return {item,id,expected};
}
async function nav(page,name){await page.locator('#topNav [data-page="'+name+'"]:visible, #bottomNav [data-page="'+name+'"]:visible').first().click();await page.locator('#'+name+'.active').waitFor();}
async function scenario(name,fn){try{await fn();report.checks.push({name,passed:true});console.log('PASS',name);}catch(error){report.checks.push({name,passed:false,error:error.message});throw error;}}
try{
  const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await ctx.addInitScript(nativeMock,initial);
  const page=await ctx.newPage();page.on('pageerror',err=>report.errors.push(err.message));
  await page.goto(base+'/index.html',{waitUntil:'networkidle'});await page.locator('#syncStatus[data-state="connected"]').waitFor();
  await scenario('original speech entry IDs are preserved as exact prefix',async()=>assert.ok(oldTexts.length>16000));
  await scenario('library shows a short bilingual example first and retains original senses',async()=>{
    await nav(page,'library');await page.selectOption('#collection','all');await page.fill('#search','activist');
    const card=page.locator('#library [data-card="'+activist.id+'"]');await card.waitFor();
    await card.locator('[data-expand]').click();const {item}=await checkExample(page,'#library');
    assert.equal((await item.locator('.sentence').innerText()).trim(),basic.sentence);
    const original=card.locator('.original-examples');assert.equal(await original.getAttribute('open'),null);
    await original.locator('summary').click();assert.equal(await original.locator('.example-item').count(),activist.examples.length);
    assert.equal((await original.locator('.sentence').first().innerText()).trim(),activist.examples[0].sentence);
    await page.screenshot({path:'qa/beginner/library-desktop.png',fullPage:true});
  });
  await scenario('native point reading reads the displayed basic sentence',async()=>{
    const sentence=page.locator('#library .beginner-example .sentence');await sentence.locator(':scope').getAttribute('data-read-text');
    await page.waitForFunction(()=>document.querySelector('#library .beginner-example .sentence')?.dataset.readText);
    await sentence.click();assert.equal(await page.evaluate(()=>window.__spoken.at(-1)),basic.sentence);
  });
  await scenario('immersive study displays basic Chinese sentence and retains saved word state',async()=>{
    await page.locator('#library [data-card="'+activist.id+'"] .meaning').click();await page.locator('#study.active').waitFor();
    const {expected}=await checkExample(page,'#study');assert.equal(expected.sentence,basic.sentence);
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('wordsInBloomData')));
    assert.equal(saved.words[activist.id].favorite,true);assert.equal(saved.words[activist.id].status,'learning');
    await page.reload({waitUntil:'networkidle'});await page.locator('#syncStatus[data-state="connected"]').waitFor();
    const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('wordsInBloomData')));assert.equal(after.words[activist.id].favorite,true);assert.equal(after.words[activist.id].status,'learning');
  });
  await scenario('flashcards reveal short bilingual example first',async()=>{
    await nav(page,'flash');const card=page.locator('#flash .flip-card');await card.waitFor();
    if((await card.getAttribute('aria-pressed'))!=='true')await card.click({position:{x:20,y:20}});
    await checkExample(page,'#flash .face.back');
  });
  await page.setViewportSize({width:390,height:844});
  await scenario('mobile examples fit viewport and original examples remain expandable',async()=>{
    await checkExample(page,'#flash .face.back');const originals=page.locator('#flash .face.back .original-examples');await originals.locator('summary').click();assert.equal(await originals.evaluate(el=>el.open),true);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await originals.locator('summary').click();
    await page.screenshot({path:'qa/beginner/flash-mobile.png',fullPage:true});
  });
  await ctx.close();
  const online=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  await online.addInitScript(value=>{if(location.protocol==='http:'||location.protocol==='https:')localStorage.setItem('wordsInBloomData',JSON.stringify(value));Object.defineProperty(window,'speechSynthesis',{value:undefined,configurable:true});Object.defineProperty(window,'SpeechSynthesisUtterance',{value:undefined,configurable:true});window.__audioURLs=[];class AudioDouble{constructor(){this.onplaying=null;this.paused=true;}play(){this.paused=false;window.__audioURLs.push(this.src);this.onplaying?.();return Promise.resolve();}pause(){this.paused=true;}load(){}removeAttribute(){}}Object.defineProperty(window,'Audio',{value:AudioDouble,configurable:true});},initial);
  const op=await online.newPage();op.on('pageerror',err=>report.errors.push(err.message));
  await op.goto(base+'/index.html',{waitUntil:'networkidle'});await op.locator('#syncStatus[data-state="connected"]').waitFor();
  await scenario('online fallback resolves displayed basic sentence through its public ID',async()=>{
    await nav(op,'study');const {item,expected}=await checkExample(op,'#study');
    await op.waitForFunction(()=>document.querySelector('#study .beginner-example .sentence')?.dataset.readText);
    await item.locator('.sentence').click();await op.waitForFunction(()=>window.__audioURLs.length);
    const uri=await op.evaluate(()=>window.__audioURLs.at(-1)),url=new URL(uri,base);assert.equal(url.pathname,'/api/tts');assert.equal(url.searchParams.has('text'),false);
    assert.equal(texts[Number(url.searchParams.get('entry'))],expected.sentence);assert.equal(url.searchParams.get('chunk'),'0');
  });
  await online.close();assert.deepEqual(report.errors,[]);
}finally{await writeFile('qa/beginner/report.json',JSON.stringify(report,null,2));await browser.close();}
