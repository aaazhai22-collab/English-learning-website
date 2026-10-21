import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Run against an existing server with QA_BASE, or start an isolated local server.
// OCR is exercised with the original five scans, without mocked OCR output.
// Non-OCR API fixtures are mocked so this suite does not spend model credits.
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
let chromium;
try { ({chromium} = require('playwright')); }
catch { ({chromium} = await import('file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')); }
const base = process.env.QA_BASE || 'http://127.0.0.1:5182';
const output = path.resolve(projectRoot, process.env.QA_OUTPUT || 'qa/import');
const imageDirectory = process.env.QA_IMAGE_DIR || 'C:/Users/Administrator/Desktop';
const imagePaths = ['201.jpg','202.jpg','203.jpg','204.jpg','205.jpg'].map(name=>path.join(imageDirectory,name));
const storageKey = 'readingLab.v1';
const report = {startedAt:new Date().toISOString(),base,checks:[],errors:[],images:imagePaths};
let server, browser, serverLog='';
const sleep = ms=>new Promise(resolve=>setTimeout(resolve,ms));
const requestTimeout = Number(process.env.QA_OCR_TIMEOUT || 420000);
const body = 'Students learn a language by reading carefully every day. They can listen to sentences and collect useful words for later review.';
const passage = (title,number=21)=>({title,paragraphs:[body+` This lesson explores the practice called ${title}.`],questions:[{number,stem:'How can students learn?',options:['By reading','By sleeping','By driving','By cooking'],answer:null}],answerStatus:'unverified'});
const text = (title,number=21)=>`Passage: ${title}\n\n${body}\n\n${number}. How can students learn?\n[A] By reading\n[B] By sleeping\n[C] By driving\n[D] By cooking`;
const apiStatus = {configured:false,provider:null,providers:{deepseek:{configured:false},openai:{configured:false}},notice:'服务端尚未配置模型。图片识别可在本机完成。'};
const action=(page,name)=>page.locator(`[data-action="${name}"]`).first();
const parseButton=page=>page.locator('[data-action="parse-import"], #parse-import').first();
const preview=page=>page.locator('#import-preview');
const imageRows=page=>page.locator('#ocr-pages [data-image-id]');
const feedback=async page=>(await page.locator('#import-error, #ocr-status, #ai-status, .ai-status, #toast, .error, [role="alert"]').allTextContents()).join('\n');
const readStored=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),storageKey);
async function waitForServer(){
  try { if((await fetch(base)).ok)return; } catch{}
  if(process.env.QA_BASE)throw new Error(`QA_BASE is not reachable: ${base}`);
  server=spawn(process.execPath,['server.mjs'],{cwd:projectRoot,env:{...process.env,PORT:new URL(base).port},windowsHide:true,stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',data=>{serverLog+=data;});server.stderr.on('data',data=>{serverLog+=data;});
  for(let attempt=0;attempt<100;attempt++){
    if(server.exitCode!==null)throw new Error(`Test server exited: ${serverLog}`);
    try { if((await fetch(base)).ok)return; } catch{}
    await sleep(150);
  }
  throw new Error(`Test server did not start: ${serverLog}`);
}
async function withPage(name,callback){
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,reducedMotion:'reduce'});
  const page=await context.newPage(),pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.route('**/api/reading/status',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(apiStatus)}));
  try{
    await page.goto(base+'/#/import',{waitUntil:'networkidle'});
    assert.doesNotMatch(await page.locator('body').innerText(),/<<<<<<<|=======|>>>>>>>/,'Rendered page must not expose unresolved merge conflict markers');
    await callback(page,context);
    assert.doesNotMatch(await page.locator('body').innerText(),/<<<<<<<|=======|>>>>>>>/,'Rendered result must not expose unresolved merge conflict markers');
    assert.deepEqual(pageErrors,[],`Unexpected browser exceptions: ${pageErrors.join('; ')}`);
  }catch(error){
    await page.screenshot({path:path.join(output,'failed-'+name.replace(/[^a-z0-9]+/gi,'-').slice(0,90)+'.png'),fullPage:true}).catch(()=>{});
    throw error;
  }finally{
    if(pageErrors.length)report.errors.push(...pageErrors.map(message=>({name,message})));
    await context.close();
  }
}
async function check(name,callback){
  if(process.env.QA_CHECK&&!name.toLowerCase().includes(process.env.QA_CHECK.toLowerCase()))return;
  const started=Date.now();console.log(`START ${name}`);
  try{await withPage(name,callback);report.checks.push({name,passed:true,milliseconds:Date.now()-started});console.log(`PASS ${name}`);}
  catch(error){report.checks.push({name,passed:false,milliseconds:Date.now()-started,error:error.stack||String(error)});console.error(`FAIL ${name}: ${error.message}`);}
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
}
async function enterText(page,value,title=''){
  const mode=page.locator('#import-mode-text');if(await mode.count())await mode.click();
  if(await page.locator('#import-title').count())await page.locator('#import-title').fill(title);
  await page.locator('#import-text').fill(value);
  await parseButton(page).click();
  await preview(page).waitFor({state:'visible'});
}
async function savePreview(page){
  await action(page,'save-import').click();
  await page.waitForFunction(key=>{try{return JSON.parse(localStorage.getItem(key)||'{}').imported?.length>0;}catch{return false;}},storageKey);
  return readStored(page);
}
async function chooseImages(page,files){
  await page.locator('#import-mode-images').click();
  await page.locator('#import-images').setInputFiles(files);
}
async function clearImages(page){
  const remove=page.locator('[data-action="ocr-remove"]');
  for(let attempts=0;await remove.count()&&attempts<30;attempts++)await remove.first().click();
  assert.equal(await imageRows(page).count(),0);
}
async function assertNoHorizontalOverflow(page){
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Page overflows the mobile viewport');
}

await mkdir(output,{recursive:true});
try{
  await waitForServer();
  browser=await chromium.launch({channel:'msedge',headless:process.env.QA_HEADED!=='1'});

  await check('text errors, bracket options, source numbers, stale preview invalidation',async page=>{
    await parseButton(page).click();assert.match(await feedback(page),/粘贴|正文|文章|输入/);
    await enterText(page,text('TEXT IMPORT / A',26));
    assert.equal(await page.locator('.preview-question').count(),1);
    assert.match(await preview(page).innerText(),/26/);
    const editable=page.locator('.preview-question').first().locator('textarea,input:not([type="checkbox"]):not([type="radio"]),[contenteditable="true"]');
    assert.ok(await editable.count()>=5,'Question stem and all four options must be editable before saving');
    await page.locator('#import-text').fill('{ this is not valid JSON');
    assert.ok(!(await preview(page).isVisible())||await action(page,'save-import').isDisabled(),'An edited source must invalidate the previous preview');
    await parseButton(page).click();assert.match(await feedback(page),/JSON|格式|引号|解析/);
    assert.ok(!(await preview(page).isVisible())||await action(page,'save-import').isDisabled(),'A failed parse must not leave an old preview saveable');
    await enterText(page,text('TEXT IMPORT / B',26));
    await page.route('**/api/reading/analyze',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'尚未连接模型，请在学习设置配置服务。',code:'model_not_configured'})}));
    await action(page,'ai-analyze').click();
    await page.waitForFunction(()=>/尚未连接模型|未连接模型|配置服务/.test([...document.querySelectorAll('#import-error, .ai-status, #ai-status, #toast')].map(el=>el.textContent).join(' ')));
    assert.equal(await page.locator('.preview-question').count(),1,'Missing model configuration must not destroy the imported material');
    await page.locator('.preview-question summary').first().click();
    await page.locator('.preview-question [data-import-field="stem"]').first().fill('How can students learn English?');
    await page.locator('.preview-question [data-import-field="option"]').first().fill('By reading English');
    const saved=await savePreview(page);
    assert.equal(saved.imported.length,1);assert.equal(saved.imported[0].questions[0].number,26);
    assert.equal(saved.imported[0].questions[0].stem,'How can students learn English?');
    assert.equal(saved.imported[0].questions[0].options[0],'By reading English');
    assert.equal(saved.imported[0].answerStatus,'unverified');
    assert.ok(saved.imported[0].questions[0].options.every(option=>!/^\[[A-D]\]/.test(option)));
    await page.reload({waitUntil:'networkidle'});
    assert.equal((await readStored(page)).imported.length,1);
  });

  await check('TXT and JSON collections preserve every passage and question',async page=>{
    const collection=`Text 1\n\n${body}\n\n21. How can students learn?\nA. By reading\nB. By sleeping\nC. By driving\nD. By cooking\n\nText 2\n\n${body.replace('Students','Readers')}\n\n26. How can students learn?\nA. By reading\nB. By sleeping\nC. By driving\nD. By cooking`;
    await page.locator('#import-mode-text').click();
    await page.locator('#import-file').setInputFiles({name:'two-passages.txt',mimeType:'text/plain',buffer:Buffer.from(collection)});
    await parseButton(page).click();await preview(page).waitFor();assert.equal(await page.locator('.preview-question').count(),2);
    let saved=await savePreview(page);assert.equal(saved.imported.length,2);
    assert.deepEqual(saved.imported.map(p=>p.questions[0].number),[21,26]);
    await page.goto(base+'/#/import');
    await page.locator('#import-mode-text').click();
    await page.locator('#import-file').setInputFiles({name:'two-passages.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([passage('JSON FIRST',31),passage('JSON SECOND',36)]))});
    await parseButton(page).click();await preview(page).waitFor();assert.equal(await page.locator('.preview-question').count(),2);
    saved=await savePreview(page);assert.equal(saved.imported.length,4);
    assert.ok(saved.imported.some(p=>p.title==='JSON FIRST'));assert.ok(saved.imported.some(p=>p.title==='JSON SECOND'));
    await page.goto(base+'/#/import');
    await page.locator('#import-mode-text').click();
    const templateDownload=page.waitForEvent('download');await action(page,'download-template').click();
    const template=await templateDownload;const templateJSON=JSON.parse(await readFile(await template.path(),'utf8'));
    assert.ok(templateJSON.paragraphs?.length||templateJSON.passages?.length,'The template download contains importable structured reading material');
    await page.locator('#import-file').setInputFiles({name:'oversized.txt',mimeType:'text/plain',buffer:Buffer.alloc(1000001,65)});
    assert.match(await feedback(page),/超过|过大|上限|限制/);
  });

  await check('empty URL, fetched webpage, and recoverable source failure',async page=>{
    await page.locator('#import-mode-web').click();
    await action(page,'fetch-url').click();assert.match(await feedback(page),/填写|网址|链接/);
    let failNext=true;
    await page.route('**/api/reading/fetch',route=>{if(failNext){failNext=false;return route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'来源暂时无法读取，请复制文字后重试。'})});}return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({title:'WEB IMPORT',text:body,sourceUrl:'https://learnenglish.britishcouncil.org/test',source:'British Council',notice:'已读取，请校对。'})});});
    await page.locator('#source-url').fill('https://learnenglish.britishcouncil.org/test');
    await action(page,'fetch-url').click();await page.waitForFunction(()=>document.querySelector('#import-error')?.textContent.includes('无法读取'));
    assert.ok(await action(page,'fetch-url').isEnabled());
    await action(page,'fetch-url').click();await page.waitForFunction(()=>document.querySelector('#import-text')?.value.includes('Students learn'));
    await parseButton(page).click();await preview(page).waitFor();const saved=await savePreview(page);
    assert.equal(saved.imported[0].sourceType,'web');assert.match(saved.imported[0].sourceUrl,/britishcouncil/);
  });

  await check('generated bilingual analysis survives preview snapshot and save',async page=>{
    await enterText(page,text('BILINGUAL MATERIAL',26));
    const analyzed={title:'BILINGUAL MATERIAL',titleZh:'双语学习材料',summary:'通过精读与复习学习语言。',paragraphs:[[
      {en:'Students learn a language by reading carefully every day.',zh:'学生通过每天认真阅读学习语言。',grammar:[{label:'介词 by + doing',detail:'by 后接动名词，表示通过某种方式。'}],chunks:[{en:'by reading carefully every day',zh:'通过每天认真阅读'}]},
      {en:'They can listen to sentences and collect useful words for later review.',zh:'他们可以听句子并收集有用单词以便复习。',grammar:[],chunks:[]}
    ]],questions:[{number:26,stem:'How can students learn?',stemZh:'学生怎样学习？',options:['By reading','By sleeping','By driving','By cooking'],optionsZh:['通过阅读','通过睡觉','通过驾驶','通过做饭'],answer:'A',evidence:[1],explanation:'第一句说明学习方式。',distractors:['正确','文中未提到','文中未提到','文中未提到']}],vocabulary:[{word:'carefully',meaning:'认真地',pos:'adv.'}],answerStatus:'unverified',analysisMode:'ai'};
    await page.route('**/api/reading/analyze',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({passage:analyzed})}));
    await action(page,'ai-analyze').click();
    await page.waitForFunction(()=>/解析已生成/.test(document.querySelector('#toast')?.textContent||''));
    const saved=await savePreview(page),material=saved.imported[0];
    assert.equal(material.paragraphs[0][0].zh,analyzed.paragraphs[0][0].zh,'Saving an untouched preview must retain its generated Chinese translation');
    assert.equal(material.paragraphs[0][0].grammar[0]?.label,'介词 by + doing');
    assert.equal(material.paragraphs[0][0].chunks[0]?.zh,'通过每天认真阅读');
    assert.equal(material.questions[0].number,26);assert.equal(material.answerStatus,'unverified');
  });

  await check('keyboard file button, Markdown, draft editing, and export round trips',async page=>{
    await page.locator('#import-mode-text').click();
    const chooserPromise=page.waitForEvent('filechooser');
    await action(page,'choose-text').focus();await page.keyboard.press('Enter');
    const chooser=await chooserPromise;
    await chooser.setFiles({name:'lesson.md',mimeType:'text/markdown',buffer:Buffer.from(text('MARKDOWN MATERIAL',26))});
    await preview(page).waitFor();
    assert.equal(await page.locator('.preview-question').count(),1);
    await page.locator('.preview-title').fill('EDITED MARKDOWN MATERIAL');
    await page.locator('#import-mode-images').click();await page.locator('#import-mode-text').click();
    assert.equal(await page.locator('.preview-title').inputValue(),'EDITED MARKDOWN MATERIAL','Switching import modes must retain reviewed titles');
    const rawDownload=page.waitForEvent('download');await action(page,'export-import-text').click();
    assert.match(await readFile(await(await rawDownload).path(),'utf8'),/MARKDOWN MATERIAL/);
    const jsonDownload=page.waitForEvent('download');await action(page,'export-import-json').click();
    const exported=JSON.parse(await readFile(await(await jsonDownload).path(),'utf8'));
    assert.equal(exported.passages.length,1);assert.equal(exported.passages[0].title,'EDITED MARKDOWN MATERIAL');
    assert.equal(exported.passages[0].questions[0].number,26);
    await page.locator('#import-file').setInputFiles({name:'round-trip.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
    await preview(page).waitFor();
    const saved=await savePreview(page);assert.equal(saved.imported[0].title,'EDITED MARKDOWN MATERIAL');
    await page.goto(base+'/#/import');await enterText(page,JSON.stringify(exported));await savePreview(page);
    assert.equal((await readStored(page)).imported.length,1,'Re-importing the same material must preserve the original learning record');
  });

  await check('incomplete questions stay visible without requiring an invented answer',async page=>{
    const source=passage('INCOMPLETE MATERIAL',26);
    source.questions.push({number:27,stem:'Which option is missing?',options:['First','Second','Third',''],incomplete:true,answer:null});
    await enterText(page,JSON.stringify(source));
    assert.match(await preview(page).innerText(),/缺|补全|不完整/);
    await savePreview(page);await page.getByRole('tab',{name:'阅读练习',exact:true}).click();
    assert.match(await page.locator('#question-q1 .question-number').innerText(),/26/,'Reader retains the printed source question number');
    const incompleteInputs=page.locator('#question-q2 input[type="radio"]');
    for(let i=0;i<await incompleteInputs.count();i++)assert.ok(await incompleteInputs.nth(i).isDisabled(),'A missing-option question must not require guessing');
    assert.match(await page.locator('#question-q2').innerText(),/缺|补全|不完整/);
    await page.locator('input[data-question="q1"][value="A"]').check({force:true});await action(page,'submit').click();
    await page.locator('.result-strip').waitFor();assert.match(await page.locator('.result-strip').innerText(),/待核实|不计分|未核实/);
    const saved=await readStored(page),attempt=Object.values(saved.attempts).flat().at(-1);
    assert.deepEqual(Object.keys(attempt.answers),['q1']);assert.equal(attempt.answers.q1.correct,null);
  });

  await check('answer key requires manual confirmation before scoring',async page=>{
    const unconfirmed=passage('UNCONFIRMED ANSWER',26);unconfirmed.questions[0].answer='A';unconfirmed.answerStatus='verified';
    await enterText(page,JSON.stringify(unconfirmed));
    assert.ok(!(await page.locator('.confirm-answers').isChecked()),'An answer supplied in a file is not automatically treated as reviewed');
    await savePreview(page);await page.getByRole('tab',{name:'阅读练习',exact:true}).click();
    await page.locator('input[data-question="q1"][value="A"]').check({force:true});await action(page,'submit').click();await page.locator('.result-strip').waitFor();
    let stored=await readStored(page);assert.equal(stored.imported[0].answerStatus,'unverified');
    assert.equal(Object.values(stored.attempts).flat().at(-1).answers.q1.correct,null,'An unreviewed answer never contributes a correctness score');
    await page.goto(base+'/#/import');
    const confirmed=passage('CONFIRMED ANSWER',31);confirmed.questions[0].answer='A';confirmed.answerStatus='verified';
    await enterText(page,JSON.stringify(confirmed));assert.ok(!(await page.locator('.confirm-answers').isChecked()));
    await page.locator('.confirm-answers').check();await savePreview(page);
    await page.getByRole('tab',{name:'阅读练习',exact:true}).click();
    await page.locator('input[data-question="q1"][value="A"]').check({force:true});await action(page,'submit').click();await page.locator('.result-strip').waitFor();
    stored=await readStored(page);assert.equal(stored.imported.at(-1).answerStatus,'verified');
    assert.equal(Object.values(stored.attempts).flat().at(-1).answers.q1.correct,true,'A user-confirmed answer can be scored');
    assert.match(await page.locator('.result-strip').innerText(),/100%/);
  });

  await check('backup errors do not alter data; valid complete backup restores legacy progress',async page=>{
    await enterText(page,text('BACKUP MATERIAL',26));await savePreview(page);
    const legacy={catalogIdVersion:40,learningDataVersion:2,words:{100:{favorite:true,status:'learning'}},history:[],activity:[],dates:[]};
    await page.evaluate(value=>localStorage.setItem('wordsInBloomData',JSON.stringify(value)),legacy);
    const before=await readStored(page);await page.goto(base+'/#/profile');
    await page.locator('#restore-file').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{')});
    assert.match(await feedback(page),/未恢复|格式|JSON|备份/);assert.deepEqual(await readStored(page),before);
    await page.locator('#restore-file').setInputFiles({name:'wrong-version.json',mimeType:'application/json',buffer:Buffer.from('{"version":9}')});
    assert.match(await feedback(page),/未恢复|不是|版本|备份/);assert.deepEqual(await readStored(page),before);
    const downloadPromise=page.waitForEvent('download');await action(page,'backup').click();
    const download=await downloadPromise,backup=await readFile(await download.path());
    const exported=JSON.parse(backup);assert.equal(exported.reading.imported.length,1);assert.deepEqual(exported.legacyVocabulary,legacy);
    await page.evaluate(()=>{localStorage.removeItem('readingLab.v1');localStorage.removeItem('wordsInBloomData');});await page.reload({waitUntil:'networkidle'});
    await page.locator('#restore-file').setInputFiles({name:'complete-backup.json',mimeType:'application/json',buffer:backup});
    await page.locator('#restore-legacy').check();await action(page,'apply-restore').click();
    assert.equal((await readStored(page)).imported.length,1);
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('wordsInBloomData'))),legacy);
    await page.goto(base+'/index.html',{waitUntil:'networkidle'});
    assert.ok(await page.locator('#topNav').isVisible(),'The restored legacy vocabulary site remains usable');
  });

  await check('storage failure leaves the import available and reports failure',async page=>{
    await enterText(page,text('CANNOT STORE',26));
    await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='readingLab.v1')throw new DOMException('Quota exceeded','QuotaExceededError');return set.call(this,key,value);};});
    await action(page,'save-import').click();
    assert.match(await feedback(page),/存储|空间|保存失败|未能保存/);
    assert.ok(await preview(page).isVisible(),'Unsaved material remains recoverable');
    assert.ok(!(await feedback(page)).includes('阅读材料已保存'));
  });

  await check('image controls, invalid file, cancellation, and mobile layout',async page=>{
    for(const image of imagePaths)await access(image);
    await page.locator('#import-mode-images').click();
    const chooserPromise=page.waitForEvent('filechooser');await action(page,'choose-images').focus();await page.keyboard.press('Enter');
    await(await chooserPromise).setFiles(imagePaths.slice(0,1));await page.waitForFunction(()=>document.querySelectorAll('#ocr-pages [data-image-id]').length===1);
    await clearImages(page);
    await chooseImages(page,imagePaths.slice(0,2));
    assert.equal(await page.locator('#import-images').getAttribute('multiple')!==null,true);
    await page.waitForFunction(()=>document.querySelectorAll('#ocr-pages [data-image-id]').length===2);
    const oldIds=await imageRows(page).evaluateAll(rows=>rows.map(row=>row.dataset.imageId));
    const move=page.locator('[data-action="ocr-move"]:enabled').first();await move.click();
    const movedIds=await imageRows(page).evaluateAll(rows=>rows.map(row=>row.dataset.imageId));assert.notDeepEqual(movedIds,oldIds,'Reordering changes the recognition order');
    const firstRow=imageRows(page).first();const before=await firstRow.evaluate(row=>({data:row.dataset.rotation,html:row.querySelector('img')?.getAttribute('style'),src:row.querySelector('img')?.src}));
    await firstRow.locator('[data-action="ocr-rotate"]').click();
    const after=await imageRows(page).first().evaluate(row=>({data:row.dataset.rotation,html:row.querySelector('img')?.getAttribute('style'),src:row.querySelector('img')?.src}));assert.notDeepEqual(after,before,'Rotation changes the displayed image');
    await page.locator('[data-action="ocr-remove"]').first().click();assert.equal(await imageRows(page).count(),1);
    await clearImages(page);
    await page.locator('#import-images').setInputFiles({name:'damaged.jpg',mimeType:'image/jpeg',buffer:Buffer.from('this is not a JPEG image')});
    await page.waitForFunction(()=>document.querySelectorAll('#ocr-pages [data-image-id]').length>0||/损坏|无法读取|无法解码|无效|不支持|格式不正确|读取失败/.test(document.querySelector('#import-error')?.textContent||''));
    if(await imageRows(page).count()){
      await action(page,'ocr-start').click();
      await page.waitForFunction(()=>/损坏|无法读取|无法解码|无效|不支持|格式不正确|读取失败|识别失败|页失败/.test([document.querySelector('#ocr-status')?.textContent,document.querySelector('#toast')?.textContent,document.querySelector('#import-error')?.textContent,document.querySelector('#ocr-pages')?.textContent].join(' ')),null,{timeout:requestTimeout});
      assert.ok(!(await preview(page).isVisible()),'A damaged image must not produce a fabricated reading');
      await clearImages(page);
    }
    await chooseImages(page,imagePaths.slice(0,1));await page.waitForFunction(()=>document.querySelectorAll('#ocr-pages [data-image-id]').length===1);
    await action(page,'ocr-start').click();
    const cancel=page.locator('[data-action="ocr-cancel"], [data-action="ocr-stop"]');await cancel.first().waitFor({state:'visible'});await cancel.first().click();
    await page.waitForFunction(()=>/停止|取消|中止/.test(document.querySelector('#ocr-status')?.textContent||''),null,{timeout:30000});
    await clearImages(page);await chooseImages(page,imagePaths.slice(0,2));await page.waitForFunction(()=>document.querySelectorAll('#ocr-pages [data-image-id]').length===2);
    await page.setViewportSize({width:390,height:844});await assertNoHorizontalOverflow(page);
    await page.screenshot({path:path.join(output,'mobile-images.png'),fullPage:true});
    assert.ok((await page.locator('#ocr-status').innerText()).length>0,'Image status is visible on mobile');
  });

  await check('real OCR: five original scans, 4 materials, 30 questions, cross-page continuation',async page=>{
    for(const image of imagePaths)await access(image);
    const imageAPICalls=[];page.on('request',request=>{if(request.url().includes('/api/reading/')&&request.postData()?.includes('data:image/'))imageAPICalls.push(request.url());});
    await chooseImages(page,imagePaths);await page.waitForFunction(()=>document.querySelectorAll('#ocr-pages [data-image-id]').length===5);
    await page.screenshot({path:path.join(output,'desktop-images.png'),fullPage:true});
    await action(page,'ocr-start').click();
    const progress=setInterval(async()=>{try{console.log('OCR PROGRESS '+(await page.locator('#ocr-status').innerText()).replace(/\s+/g,' ').slice(0,240));}catch{}},15000);
    try{await preview(page).waitFor({state:'visible',timeout:requestTimeout});}finally{clearInterval(progress);}
    await writeFile(path.join(output,'real-ocr-text.txt'),await page.locator('#import-text').inputValue());
    await writeFile(path.join(output,'real-ocr-preview.json'),JSON.stringify(await page.locator('[data-preview-index]').evaluateAll(rows=>rows.map(row=>({title:row.querySelector('.preview-title')?.value,body:row.querySelector('.preview-body')?.value,questions:[...row.querySelectorAll('.preview-question')].map(q=>({summary:q.querySelector('summary')?.innerText,stem:q.querySelector('[data-import-field="stem"]')?.value,options:[...q.querySelectorAll('[data-import-field="option"]')].map(input=>input.value)}))}))),null,2));
    assert.equal(await page.locator('.preview-question').count(),30,'The original 20 cloze questions and 10 reading questions must all remain available');
    const previewText=await preview(page).innerText();const titles=await page.locator('.preview-title').evaluateAll(inputs=>inputs.map(input=>input.value).join('\n'));assert.match(titles,/Text\s*1/i);assert.match(titles,/Text\s*2/i);assert.match(titles,/Text\s*3/i);assert.match(previewText,/截断|不完整|缺页|补充|未结束/);
    assert.deepEqual(imageAPICalls,[],'Local OCR must not send images to the reading API');
    await page.screenshot({path:path.join(output,'desktop-real-ocr-preview.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await assertNoHorizontalOverflow(page);
    await page.screenshot({path:path.join(output,'mobile-real-ocr-preview.png'),fullPage:true});
    // Preserve the residual Text 3 for reading too; it has no answer key to score.
    const choices=page.locator('#import-preview input.preview-select, #import-preview input[data-preview-select], #import-preview input[data-import-select]');
    for(let index=0;index<await choices.count();index++)await choices.nth(index).check();
    const saved=await savePreview(page);assert.equal(saved.imported.length,4);
    const allQuestions=saved.imported.flatMap(p=>p.questions);assert.equal(allQuestions.length,30);
    assert.deepEqual(allQuestions.map(q=>q.number).sort((a,b)=>a-b),Array.from({length:30},(_,i)=>i+1));
    const text2=saved.imported.find(p=>p.questions.some(q=>q.number===26));assert.ok(text2);assert.equal(text2.questions.length,5);
    const text2Body=text2.paragraphs.flat().map(s=>s.en).join(' ');assert.match(text2Body,/understanding of the needs of their populations\s*\?/i);assert.ok(!/Heat action plans/i.test(text2Body),'Text 3 must not leak into Text 2');
    const text3=saved.imported.find(p=>/Text\s*3/i.test(p.title));assert.ok(text3);assert.equal(text3.questions.length,0);assert.ok(text3.incomplete||text3.warnings?.length);
    const text3Body=text3.paragraphs.flat().map(s=>s.en).join(' ');assert.match(text3Body,/high daytime\s*$/i,'Do not invent a continuation to the cut-off page');
    assert.ok(saved.imported.every(p=>p.answerStatus==='unverified'));
    await page.goto(base+'/#/library');await page.setViewportSize({width:390,height:844});await assertNoHorizontalOverflow(page);
    await page.screenshot({path:path.join(output,'mobile-imported-library.png'),fullPage:true});
    await writeFile(path.join(output,'real-ocr-imported.json'),JSON.stringify(saved.imported,null,2));
  });
}finally{
  report.finishedAt=new Date().toISOString();
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  if(browser)await browser.close();
  if(server)server.kill();
}
const failed=report.checks.filter(check=>!check.passed);
console.log(`Import browser checks: ${report.checks.length-failed.length}/${report.checks.length} passed. Report: ${path.join(output,'report.json')}`);
if(failed.length)process.exitCode=1;
