import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const base=process.env.QA_BASE||'http://localhost:5173';
const browser=await chromium.launch({channel:'msedge',headless:true});
const report=[];
const fixture={version:1,profile:{level:'beginner'},imported:[{id:'lookup-fixture',title:'Lookup fixture',paragraphs:[[{en:'The quokka lives near a small tree. A pangolin walks slowly through the garden.'}]],questions:[],answerStatus:'unverified'}],words:{},attempts:{},drafts:{},saved:{},notes:{},days:{}};
const entry=(word,meaning,extra={})=>({word,meaning,core:meaning,pos:'noun',usage:'A small animal.',examples:[{en:'The '+word+' is small.',zh:'这只动物很小。'}],phrases:[],source:'测试在线词典参考义',meaningLanguage:'zh-CN',...extra});
async function scenario(name,fn,{viewport={width:1280,height:900},saved={}}={}){
  const ctx=await browser.newContext({viewport,reducedMotion:'reduce'}),page=await ctx.newPage(),errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  await page.route(/https:\/\/(?:api\.dictionaryapi\.dev|api\.mymemory\.translated\.net)\//,r=>r.abort('failed'));
  await page.addInitScript(data=>{localStorage.setItem('readingLab.v1',JSON.stringify(data));},{...fixture,words:saved});
  await page.route('**/api/reading/status',r=>r.fulfill({json:{configured:false,notice:'无需密钥也可查询公共词典。'}}));
  try{await page.goto(base+'/#/read/lookup-fixture',{waitUntil:'networkidle'});await page.getByRole('tab',{name:'逐句精读'}).click();await fn(page);assert.deepEqual(errors,[]);report.push({name,passed:true});console.log('PASS',name);}catch(err){report.push({name,passed:false,error:err.message});await page.screenshot({path:'qa/lookup-failed-'+report.length+'.png',fullPage:true});console.error('FAIL',name,err.message);}finally{await ctx.close();}
}
const word=(page,value)=>page.locator(`.sentence-card .word-token[data-word="${value}"]`).first().click();
const close=page=>page.locator('dialog [data-action="close-modal"]').click();
await mkdir('qa',{recursive:true});
try{
await scenario('automatic lookup exposes loading and retryable failures inside dialog; empty meaning cannot be saved',async page=>{
  let count=0,release;const wait=new Promise(r=>release=r);
  await page.route('**/api/reading/lookup',async route=>{count++;if(count===1){await wait;await route.fulfill({status:502,json:{error:'在线词典暂不可用，请稍后重试。'}});}else await route.fulfill({json:{entry:entry('quokka','短尾矮袋鼠')}});});
  await word(page,'quokka');await page.locator('#lookup-status').filter({hasText:'正在联网'}).waitFor();
  assert.equal(await page.locator('dialog [data-action="save-lookup"]').isDisabled(),true);
  assert.equal(await page.locator('dialog [data-action="lookup-online"]').isDisabled(),true);
  release();await page.locator('dialog #lookup-status[role="alert"]').waitFor();
  assert.match(await page.locator('dialog').innerText(),/重试/);
  await page.getByRole('button',{name:'重试联网查询',exact:true}).click();
  await page.locator('dialog #lookup-status[role="status"]').filter({hasText:'已获取'}).waitFor();
  assert.match(await page.locator('dialog').innerText(),/短尾矮袋鼠/);assert.equal(count,2);
  await close(page);await word(page,'quokka');await page.locator('#lookup-status').filter({hasText:'本次会话'}).waitFor();assert.equal(count,2);
  await page.getByRole('button',{name:'收藏到学习库',exact:true}).click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('readingLab.v1')).words['word:quokka'].entry.meaning),'短尾矮袋鼠');
});
await scenario('English-only response and model degradation notices remain visible inside modal',async page=>{
  await page.route('**/api/reading/lookup',r=>r.fulfill({json:{entry:entry('quokka','A small plant-eating animal.',{meaningLanguage:'en'}),notice:'模型暂不可用，已改用无需密钥的在线词典参考义。中文释义暂不可用。'}}));
  await word(page,'quokka');await page.locator('#lookup-status').filter({hasText:'模型暂不可用'}).waitFor();
  assert.match(await page.locator('#lookup-status').innerText(),/英文词典释义/);assert.match(await page.locator('dialog').innerText(),/A small plant-eating animal/);
  await close(page);await word(page,'quokka');await page.locator('#lookup-status').filter({hasText:'本次会话'}).waitFor();assert.match(await page.locator('#lookup-status').innerText(),/模型暂不可用/);
});
await scenario('a late response for a closed word never overwrites the next open word',async page=>{
  let release;const pending=new Promise(r=>release=r);
  await page.route('**/api/reading/lookup',async r=>{const value=r.request().postDataJSON().word;if(value==='quokka')await pending;await r.fulfill({json:{entry:entry(value,value==='quokka'?'短尾矮袋鼠':'穿山甲')}});});
  await word(page,'quokka');await page.locator('#lookup-status').filter({hasText:'正在联网'}).waitFor();await close(page);
  await word(page,'pangolin');await page.locator('#lookup-status').filter({hasText:'已获取'}).waitFor();release();await page.waitForTimeout(300);
  assert.equal(await page.locator('#modal-title').innerText(),'pangolin');assert.match(await page.locator('dialog').innerText(),/穿山甲/);assert.doesNotMatch(await page.locator('dialog').innerText(),/短尾矮袋鼠/);
});
await scenario('saved user meanings are preserved when the dictionary supplements usage',async page=>{
  let calls=0;await page.route('**/api/reading/lookup',r=>{calls++;return r.fulfill({json:{entry:entry('quokka','一般词典义',{usage:'Supplemental use.',meaningLanguage:'en'})}});});
  await word(page,'quokka');assert.match(await page.locator('dialog').innerText(),/我整理的词义/);assert.equal(calls,0);
  await page.getByRole('button',{name:'联网查词',exact:true}).click();await page.locator('#lookup-status').filter({hasText:'已获取'}).waitFor();assert.match(await page.locator('dialog').innerText(),/我整理的词义/);assert.doesNotMatch(await page.locator('dialog').innerText(),/一般词典义/);assert.doesNotMatch(await page.locator('#lookup-status').innerText(),/当前展示英文词典/);
},{saved:{'word:quokka':{entry:entry('quokka','我整理的词义'),kind:'word',schedule:null}}});
await scenario('legacy placeholder meanings are refreshed rather than treated as learned definitions',async page=>{
  let calls=0;await page.route('**/api/reading/lookup',r=>{calls++;return r.fulfill({json:{entry:entry('quokka','短尾矮袋鼠')}});});
  await word(page,'quokka');await page.locator('#lookup-status').filter({hasText:'已获取'}).waitFor();assert.equal(calls,1);assert.match(await page.locator('dialog').innerText(),/短尾矮袋鼠/);assert.doesNotMatch(await page.locator('dialog').innerText(),/请结合下面/);
},{saved:{'word:quokka':{entry:entry('quokka','请结合下面的英文定义判断词义。'),kind:'word'}}});
await scenario('manual fallback gives inline validation and stores an explicit explanation',async page=>{
  await page.route('**/api/reading/lookup',r=>r.fulfill({status:502,json:{error:'词典暂不可用，请重试。'}}));
  await word(page,'quokka');await page.locator('#lookup-status[role="alert"]').waitFor();await page.getByRole('button',{name:'手动补充 / 修改',exact:true}).click();
  await page.getByRole('button',{name:'保存词条',exact:true}).click();await page.locator('dialog #custom-entry-error').waitFor();assert.match(await page.locator('#custom-entry-error').innerText(),/核心解释/);
  await page.fill('#custom-meaning','短尾矮袋鼠');await page.fill('#custom-usage','一种体型较小的动物。');await page.getByRole('button',{name:'保存词条',exact:true}).click();assert.equal(await page.locator('dialog[open]').count(),0);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('readingLab.v1')).words['word:quokka'].entry.meaning),'短尾矮袋鼠');
});
await scenario('browser dictionary recovers a server failure and its Chinese result can be saved',async page=>{
  await page.route('**/api/reading/lookup',r=>r.fulfill({status:502,json:{error:'服务器词典不可用。'}}));
  let externalCalls=0;
  await page.route('https://api.mymemory.translated.net/**',r=>{externalCalls++;const url=new URL(r.request().url());assert.equal(url.searchParams.get('q'),'quokka');assert.ok(!r.request().headers().authorization);assert.ok(!r.request().headers().cookie);assert.ok(!url.href.includes('garden'));return r.fulfill({headers:{'access-control-allow-origin':'*'},json:{responseStatus:200,responseData:{translatedText:'短尾矮袋鼠'}}});});
  await word(page,'quokka');await page.locator('#lookup-status').filter({hasText:/备用|机器翻译/}).waitFor();
  assert.match(await page.locator('dialog').innerText(),/短尾矮袋鼠/);assert.ok(externalCalls>=1);
  await page.getByRole('button',{name:'收藏到学习库',exact:true}).click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('readingLab.v1')).words['word:quokka'].entry.meaning),'短尾矮袋鼠');
});
await scenario('grammar tokens do not trigger word lookup and mobile actions stay reachable',async page=>{
  let calls=0;await page.route('**/api/reading/lookup',r=>{calls++;return r.fulfill({json:{entry:entry('quokka','短尾矮袋鼠')}});});
  await word(page,'The');assert.equal(await page.locator('dialog [data-action="lookup-online"]').count(),0);assert.equal(calls,0);await close(page);
  await word(page,'quokka');await page.locator('#lookup-status').filter({hasText:'已获取'}).waitFor();for(const selector of ['[data-action="save-lookup"]','[data-action="lookup-online"]','[data-action="edit-entry"]']){const box=await page.locator('dialog '+selector).boundingBox();assert.ok(box&&box.x>=0&&box.y>=0&&box.x+box.width<=390&&box.y+box.height<=844);}
  await page.screenshot({path:'qa/lookup-mobile.png'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
},{viewport:{width:390,height:844}});
}finally{await writeFile('qa/lookup-report.json',JSON.stringify(report,null,2));await browser.close();}
if(report.some(r=>!r.passed))process.exitCode=1;else console.log(`Lookup browser checks passed: ${report.length} scenarios.`);
