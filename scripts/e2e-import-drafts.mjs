import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { chromium } from 'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const base=process.env.QA_BASE||'http://localhost:5184';
const browser=await chromium.launch({channel:'msedge',headless:true});
const report=[];
const en='Students can learn English by reading a short passage every day. They listen carefully and collect useful words for later review.';
const fixture=(title='Draft lesson')=>({title,paragraphs:[[{en,zh:'学生每天读一小段英文来学习。',grammar:[{label:'介词结构',detail:'by 后接动名词。'}],chunks:[{en:'by reading',zh:'通过阅读'}]}]],questions:[{number:26,stem:'How do students learn?',options:['By reading','By sleeping','By cooking','By running'],answer:null}],answerStatus:'unverified',analysisMode:'ai'});
async function scenario(name,fn){const ctx=await browser.newContext({acceptDownloads:true,reducedMotion:'reduce'}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/reading/status',r=>r.fulfill({json:{configured:false,notice:'Test'}}));await page.goto(base+'/#/import');await page.locator('#import-text').waitFor();try{await fn(page);assert.deepEqual(errors,[]);report.push({name,status:'passed'});console.log('PASS',name);}catch(e){report.push({name,status:'failed',error:e.message});console.error('FAIL',name,e.message);}finally{await ctx.close();}}
async function parse(page,value){await page.fill('#import-text',JSON.stringify(value));await page.locator('[data-action="parse-import"]').click();await page.locator('#import-preview').waitFor();}
async function stored(page){return page.evaluate(()=>JSON.parse(localStorage.getItem('readingLab.v1')));}
try{
await scenario('unchanged English preserves translation grammar and chunks',async page=>{await parse(page,fixture());await page.locator('[data-action="save-import"]').click();await page.waitForURL('**/#/read/**');const p=(await stored(page)).imported[0];assert.equal(p.paragraphs[0][0].zh,fixture().paragraphs[0][0].zh);assert.equal(p.paragraphs[0][0].grammar[0].label,'介词结构');assert.equal(p.paragraphs[0][0].chunks[0].en,'by reading');});
await scenario('mode switch and reload preserve all preview edits',async page=>{await parse(page,fixture());const body=en+' This is the corrected last sentence.';await page.fill('.preview-body',body);await page.locator('.preview-question summary').click();await page.fill('[data-import-field="stem"]','What helps students understand English?');await page.fill('[data-import-field="option"][data-option="0"]','By reading and listening');await page.locator('#import-mode-web').click();assert.equal(await page.inputValue('.preview-body'),body);assert.equal(await page.inputValue('[data-import-field="stem"]'),'What helps students understand English?');await page.reload();await page.locator('.preview-body').waitFor();assert.equal(await page.inputValue('.preview-body'),body);assert.equal(await page.inputValue('[data-import-field="option"][data-option="0"]'),'By reading and listening');});
await scenario('saving selected material ignores invalid unselected body and retains it',async page=>{await parse(page,{passages:[fixture('Keep first'),fixture('Keep second')]});await page.locator('.preview-select[data-index="1"]').uncheck();await page.locator('.preview-body').nth(1).fill('');await page.locator('[data-action="save-import"]').click();await page.waitForURL('**/#/read/**');assert.equal((await stored(page)).imported.length,1);await page.goto(base+'/#/import');assert.equal(await page.locator('[data-preview-index]').count(),1);assert.equal(await page.inputValue('.preview-title'),'Keep second');assert.equal(await page.inputValue('.preview-body'),'');});
await scenario('return to editor preserves corrected question and body',async page=>{await parse(page,fixture());await page.fill('.preview-body',en+' The editor keeps this correction.');await page.locator('.preview-question summary').click();await page.fill('[data-import-field="stem"]','Which activity is useful?');await page.locator('[data-action="edit-import"]').click();assert.match(await page.inputValue('#import-text'),/Which activity is useful/);await page.locator('[data-action="parse-import"]').click();await page.locator('#import-preview').waitFor();assert.match(await page.inputValue('.preview-body'),/editor keeps this correction/);assert.equal(await page.inputValue('[data-import-field="stem"]'),'Which activity is useful?');});
await scenario('late text file never overwrites a newer manually edited draft',async page=>{await page.locator('#import-mode-text').click();await page.evaluate(()=>{const original=File.prototype.arrayBuffer;File.prototype.arrayBuffer=async function(){await new Promise(r=>setTimeout(r,500));return original.call(this);};});await page.locator('#import-file').setInputFiles({name:'delayed.txt',mimeType:'text/plain',buffer:Buffer.from('Passage: Late\n\n'+en)});await page.fill('#import-text','Passage: Newer\n\n'+en);await page.waitForTimeout(700);assert.match(await page.inputValue('#import-text'),/^Passage: Newer/);});
await scenario('AI enrichment is retained when saved',async page=>{await page.route('**/api/reading/analyze',r=>r.fulfill({json:{passage:fixture('AI lesson')}}));const p=fixture('AI lesson');p.paragraphs[0][0].zh='';p.paragraphs[0][0].grammar=[];p.paragraphs[0][0].chunks=[];await parse(page,p);await page.locator('[data-action="ai-analyze"]').click();await page.waitForFunction(()=>document.querySelector('.preview-fields')&&!document.querySelector('.preview-fields').disabled);await page.locator('[data-action="save-import"]').click();await page.waitForURL('**/#/read/**');const saved=(await stored(page)).imported[0];assert.equal(saved.paragraphs[0][0].zh,fixture().paragraphs[0][0].zh);assert.equal(saved.paragraphs[0][0].chunks[0].zh,'通过阅读');});
await scenario('editing a verified option requires answer confirmation again',async page=>{const p=fixture();p.questions[0].answer='A';p.answerStatus='verified';await parse(page,p);await page.locator('.preview-question summary').click();await page.locator('.confirm-answers').check();await page.fill('[data-import-field="option"][data-option="0"]','Through careful reading');assert.equal(await page.locator('.confirm-answers').isChecked(),false);await page.locator('[data-action="save-import"]').click();await page.waitForURL('**/#/read/**');assert.equal((await stored(page)).imported[0].answerStatus,'unverified');});
await scenario('real OCR cancellation retains completed page and rerun offers previous draft recovery',async page=>{
  await page.locator('#import-images').setInputFiles(['C:/Users/Administrator/Desktop/201.jpg','C:/Users/Administrator/Desktop/202.jpg']);
  await page.locator('[data-action="ocr-start"]').click();
  await page.waitForFunction(()=>document.querySelector('#ocr-status')?.textContent.includes('第 2/2'),{timeout:120000});
  await page.locator('[data-action="ocr-cancel"]').click();
  await page.waitForFunction(()=>!document.querySelector('[data-action="ocr-cancel"]'),{timeout:30000});
  assert.match(await page.inputValue('#import-text'),/There are many understandable reasons/i);
  assert.match(await page.locator('#import-preview').innerText(),/取消|未完整识别/);
  const corrected='Passage: My carefully corrected draft\n\n'+en;
  await page.fill('#import-text',corrected);
  await page.locator('[data-action="ocr-start"]').click();
  await page.waitForFunction(()=>!document.querySelector('[data-action="ocr-cancel"]'),{timeout:120000});
  await page.locator('[data-action="restore-import-draft"]').click();
  assert.equal(await page.inputValue('#import-text'),corrected);
});
await scenario('real partial OCR failure is preserved as material warning',async page=>{
  await page.locator('#import-images').setInputFiles([{name:'valid.png',mimeType:'image/png',buffer:await(await import('node:fs/promises')).readFile('C:/Users/Administrator/Desktop/203.jpg')},{name:'broken.png',mimeType:'image/png',buffer:Buffer.from('not an image')}]);
  await page.locator('[data-action="ocr-start"]').click();
  await page.waitForFunction(()=>!document.querySelector('[data-action="ocr-cancel"]'),{timeout:120000});
  assert.match(await page.inputValue('#import-text'),/digital payment/i);
  assert.match(await page.locator('#import-preview').innerText(),/broken\.png/);
  const downloaded=page.waitForEvent('download');await page.locator('[data-action="export-import-json"]').click();const download=await downloaded;const data=JSON.parse(await(await import('node:fs/promises')).readFile(await download.path(),'utf8'));assert.ok(data.passages.every(p=>p.incomplete&&p.warnings.some(w=>w.includes('broken.png'))));
});
}finally{await mkdir('qa/import-drafts',{recursive:true});await writeFile('qa/import-drafts/report.json',JSON.stringify(report,null,2));await browser.close();}
if(report.some(r=>r.status!=='passed'))process.exitCode=1;
