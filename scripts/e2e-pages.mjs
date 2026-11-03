import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)('playwright');
const base=new URL(process.env.QA_BASE||'http://localhost:5175/English-learning-website/');
const report={startedAt:new Date().toISOString(),base:base.href,checks:[],errors:[],missing:[],apiRequests:[],outsidePrefix:[],remoteCalls:[]};
const output='qa/pages';await mkdir(output,{recursive:true});
const catalog=JSON.parse(await readFile(new URL('../public/data/catalog.json',import.meta.url),'utf8'));
const verbs=catalog.words.filter(word=>word.collectionId==='grammar-handbook'&&word.category==='动词');
const target=verbs.find(word=>word.word==='write');
const browser=await chromium.launch({channel:'msedge',headless:true});
const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',acceptDownloads:true});
await ctx.addInitScript(()=>{
 window.__spoken=[];
 class Utterance{constructor(text){this.text=text;}}
 Object.defineProperty(window,'SpeechSynthesisUtterance',{value:Utterance,configurable:true});
 Object.defineProperty(window,'speechSynthesis',{value:{speaking:false,getVoices:()=>[{name:'English',lang:'en-US',default:true,localService:true}],addEventListener(){},removeEventListener(){},cancel(){this.speaking=false;},resume(){},speak(value){window.__spoken.push(value.text);value.onstart?.();}},configurable:true});
});
await ctx.route('https://translate.googleapis.com/**',route=>{
 const query=new URL(route.request().url()).searchParams.get('q');report.remoteCalls.push({provider:'google',query});
 return route.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:JSON.stringify([[[`测试中文翻译：${query}`,query]],null,'en'])});
});
await ctx.route('https://api.mymemory.translated.net/**',route=>{
 report.remoteCalls.push({provider:'mymemory',query:new URL(route.request().url()).searchParams.get('q')});
 return route.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:JSON.stringify({responseStatus:200,responseData:{translatedText:'机缘巧合'}})});
});
await ctx.route('https://api.dictionaryapi.dev/**',route=>route.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:JSON.stringify([{word:'serendipity',phonetic:'/test/',meanings:[{partOfSpeech:'noun',definitions:[{definition:'A happy discovery by chance.',example:'It was serendipity.'}]}]}])}));
const page=await ctx.newPage();
page.on('pageerror',error=>report.errors.push(error.message));
page.on('response',response=>{const url=new URL(response.url());if(url.origin===base.origin&&response.status()>=400)report.missing.push({url:url.pathname,status:response.status()});});
page.on('request',request=>{const url=new URL(request.url());if(url.origin!==base.origin)return;if(url.pathname.includes('/api/'))report.apiRequests.push(url.pathname);if(!url.pathname.startsWith(base.pathname))report.outsidePrefix.push(url.pathname);});
const action=name=>page.locator(`[data-action="${name}"]`).first();
const currentReading=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('readingLab.v1')||'{}'));
const enterText=async value=>{await page.locator('#import-mode-text').click();await page.fill('#import-text',value);await action('parse-import').click();await page.locator('#import-preview').waitFor();};
async function scenario(name,fn){
 console.log('START',name);const start=Date.now();
 try{await fn();report.checks.push({name,passed:true,milliseconds:Date.now()-start});console.log('PASS',name);}
 catch(error){report.checks.push({name,passed:false,error:error.stack});await page.screenshot({path:output+'/failure.png',fullPage:true}).catch(()=>{});throw error;}
 finally{await writeFile(output+'/report.json',JSON.stringify(report,null,2));}
}
try{
 await scenario('reading home and prefixed assets work without a server API',async()=>{
  await page.goto(base.href,{waitUntil:'networkidle'});await page.locator('.bloom-hero').waitFor();
  assert.equal(await page.evaluate(()=>window.__READING_LAB_PAGES__),true);
  assert.match(await page.title(),/阅读工坊/);
  const status=await page.evaluate(async()=>{const api=await import(new URL('pages/client-api.js',location.href));const r=await api.requestReadingAPI('status');return r.json();});
  assert.equal(status.configured,true);assert.match(status.notice,/GitHub Pages/);
  assert.ok(await page.locator('.hero-book').evaluate(img=>img.complete&&img.naturalWidth>0));
  assert.ok((await page.locator('.hero-secondary').getAttribute('href')).startsWith(base.pathname));
  await page.screenshot({path:output+'/reading-desktop.png',fullPage:true});
 });
 await scenario('word collections, all 168 verbs, pronunciation, favorites and quizzes stay usable on static hosting',async()=>{
  await page.locator('.hero-secondary').click();await page.locator('#syncStatus[data-state="connected"]').waitFor();
  assert.equal(new URL(page.url()).pathname,base.pathname+'vocabulary.html');
  assert.equal(await page.evaluate(()=>vocabularyData.length),2792);
  assert.equal(await page.evaluate(()=>regularCollections().length),40);
  await page.locator('#topNav [data-page="library"]').click();await page.locator('#library [data-library-scope="verbs"]').click();
  assert.equal(await page.evaluate(()=>filteredWords().length),168);
  await page.fill('#search','write');const card=page.locator(`#library [data-card="${target.id}"]`);await card.waitFor();
  await card.locator('[data-verb-forms] .read-phrase-button[data-read-text="written"]').click();assert.equal(await page.evaluate(()=>window.__spoken.at(-1)),'written');
  await card.locator('[data-fav]').click();
  assert.equal(await page.evaluate(id=>JSON.parse(localStorage.getItem('wordsInBloomData')).words[id].favorite,target.id),true);
  await page.selectOption('#status','favorite');await page.locator('#library [data-grammar-quiz]').click();
  assert.equal(await page.locator('#quizCategory').inputValue(),'动词');assert.equal(await page.locator('#quizStatus').inputValue(),'favorite');
  await page.selectOption('#quizMode','blank');await page.locator('#startQuiz').click();
  const answer=await page.evaluate(()=>state.quiz.blankAnswer);await page.fill('#blankAnswer',answer);await page.locator('#submitBlank').click();await page.locator('#nextQuestion').click();
  await page.reload({waitUntil:'networkidle'});await page.locator('#syncStatus[data-state="connected"]').waitFor();
  const saved=await page.evaluate(id=>{const d=JSON.parse(localStorage.getItem('wordsInBloomData'));return{favorite:d.words[id].favorite,history:d.history.length};},target.id);
  assert.equal(saved.favorite,true);assert.ok(saved.history>=1);
  await page.locator('.reading-link').click();await page.locator('.bloom-hero').waitFor();assert.equal(new URL(page.url()).pathname,base.pathname);
 });
 const text='Passage: Static Text Import\n\nStudents learn a language by reading carefully every day. They can listen to simple sentences and collect useful words for later review.\n\n21. How can students learn?\n[A] By reading\n[B] By sleeping\n[C] By driving\n[D] By cooking';
 await scenario('text and JSON imports can be reviewed, saved and restored after a reload',async()=>{
  await page.goto(base.href+'#/import',{waitUntil:'networkidle'});await enterText(text);assert.equal(await page.locator('.preview-question').count(),1);
  await action('save-import-plain').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('readingLab.v1')||'{}').imported?.length===1);
  await page.goto(base.href+'#/import');await page.locator('#import-mode-text').click();
  const json={title:'Static JSON Import',paragraphs:['Students read every morning because practice helps them learn new words. They listen to short examples and review the words again in the evening.'],questions:[{number:22,stem:'What do students review?',options:['New words','Cars','Meals','Tickets'],answer:'A'}]};
  await page.locator('#import-file').setInputFiles({name:'reading.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(json))});await page.locator('#import-preview').waitFor();
  assert.equal(await page.locator('.preview-title').inputValue(),'Static JSON Import');await action('save-import-plain').click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('readingLab.v1')||'{}').imported?.length===2);
  await page.reload({waitUntil:'networkidle'});const state=await currentReading();assert.equal(state.imported.length,2);assert.equal(state.imported[0].questions[0].number,21);assert.equal(state.imported[1].questions[0].number,22);assert.equal(state.imported[1].answerStatus,'unverified');
 });
 await scenario('browser dictionary and complete free analysis use public-service protocols without /api calls',async()=>{
  const result=await page.evaluate(async base=>{
   const {requestReadingAPI}=await import(new URL('pages/client-api.js',base));
   const {generatePassageAnalysis,hasCompleteAnalysis}=await import(new URL('reading/analysis-client.js',base));
   const {normalizePassage}=await import(new URL('reading/core.js',base));
   const api=async(path,body,{signal}={})=>{const r=await requestReadingAPI(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;};
   const dictionary=await api('lookup',{word:'serendipity',provider:'free'});
   const input=normalizePassage({title:'Daily reading',paragraphs:['Students read simple books every morning. They collect useful words for later review.'],questions:[]});
   const analyzed=await generatePassageAnalysis(input,{api,config:{provider:'free',model:'free-online'},profile:{level:'beginner',depth:'detailed'}});
   const blocked=await requestReadingAPI('discover');const notice=await blocked.json();
   return{meaning:dictionary.entry.meaning,complete:hasCompleteAnalysis(analyzed),original:input.paragraphs.flat().map(s=>s.en),output:analyzed.paragraphs.flat().map(s=>s.en),questions:analyzed.questions,notice:notice.error,status:blocked.status};
  },base.href);
  assert.equal(result.meaning,'机缘巧合');assert.equal(result.complete,true);assert.deepEqual(result.output,result.original);assert.deepEqual(result.questions,[]);assert.equal(result.status,503);assert.match(result.notice,/GitHub Pages|导入/);
  assert.ok(report.remoteCalls.some(call=>call.provider==='google'));assert.ok(report.remoteCalls.some(call=>call.provider==='mymemory'));
 });
 await scenario('cancelled browser requests do not save partial analysis or discard imported material',async()=>{
  const before=await currentReading();
  const result=await page.evaluate(async base=>{const {requestReadingAPI}=await import(new URL('pages/client-api.js',base));const c=new AbortController();c.abort(new DOMException('用户取消','AbortError'));try{await requestReadingAPI('verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'free'}),signal:c.signal});return 'resolved';}catch(e){return e.name;}},base.href);
  assert.equal(result,'AbortError');assert.deepEqual(await currentReading(),before);
 });
 await scenario('real local image OCR loads engine and language files from the repository prefix',async()=>{
  await page.goto(base.href+'#/import');await page.locator('#import-mode-images').click();
  const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=1500;canvas.height=700;const g=canvas.getContext('2d');g.fillStyle='white';g.fillRect(0,0,1500,700);g.fillStyle='black';g.font='32px Arial';const lines=['Passage: Simple Reading','Students learn a language by reading carefully every day.','They listen to simple sentences and collect useful words.','Regular practice helps students understand English.','','21. What helps students learn?','[A] Reading every day','[B] Driving a car','[C] Cooking dinner','[D] Sleeping all day'];lines.forEach((line,i)=>g.fillText(line,45,60+i*55));return canvas.toDataURL('image/png').split(',')[1];});
  await page.locator('#import-images').setInputFiles({name:'clear-reading.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.locator('#ocr-pages [data-image-id]').waitFor();await action('ocr-start').click();
  await page.locator('#import-preview').waitFor({timeout:180000});
  const recognized=await page.locator('#import-text').inputValue();assert.match(recognized,/Students learn a language/i);assert.match(recognized,/Reading every day/i);assert.equal(await page.locator('.preview-question').count(),1);
  await page.screenshot({path:output+'/ocr-preview.png',fullPage:true});
 });
 await scenario('mobile reading, import and vocabulary remain within 390 pixels',async()=>{
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:output+'/import-mobile.png',fullPage:true});
  await page.goto(base.href+'vocabulary.html',{waitUntil:'networkidle'});await page.locator('#syncStatus[data-state="connected"]').waitFor();
  await page.locator('#bottomNav [data-page="library"]').click();await page.locator('#library [data-library-scope="verbs"]').click();await page.fill('#search','write');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:output+'/verbs-mobile.png',fullPage:true});
 });
 assert.deepEqual(report.apiRequests,[],'A static deployment must not request a missing /api endpoint');
 assert.deepEqual(report.outsidePrefix,[],'Local requests must remain under the GitHub repository path');
 assert.deepEqual(report.missing,[],'The static app must not request missing local files');
 assert.deepEqual(report.errors,[],'There must be no browser exceptions');
}finally{report.finishedAt=new Date().toISOString();await writeFile(output+'/report.json',JSON.stringify(report,null,2));await browser.close();}
console.log(`Pages browser QA passed: ${report.checks.length} scenarios / no missing local assets or server API requests.`);
