import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)('playwright');
const base=process.env.QA_BASE||'http://localhost:5174';
const catalog=JSON.parse(await readFile(new URL('../public/data/catalog.json',import.meta.url),'utf8'));
const grammar=catalog.words.filter(word=>word.collectionId==='grammar-handbook');
const verbs=grammar.filter(word=>word.category==='动词');
const verbIds=new Set(verbs.map(word=>word.id));
const write=verbs.find(word=>word.word==='write');
assert.ok(write?.verbForms&&verbs.length>=120,'The expanded source catalog must be generated before browser QA');
const initial={catalogIdVersion:40,learningDataVersion:2,words:{1:{status:'learning',favorite:true}},history:[],activity:[],dates:[],lastWordId:1,lastIndex:0,studyCollectionId:'all',motion:false,quizTargetCursor:false};
const report={checks:[],errors:[],grammarEntries:grammar.length,verbEntries:verbs.length};
await mkdir('qa/grammar-review',{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
await ctx.addInitScript(data=>{
  if(location.protocol==='http:'||location.protocol==='https:'){
    if(!localStorage.getItem('qaGrammarSeeded')){localStorage.setItem('wordsInBloomData',JSON.stringify(data));localStorage.setItem('qaGrammarSeeded','yes');}
  }
  window.__spoken=[];
  class Utterance{constructor(text){this.text=text;}}
  const synth={speaking:false,paused:false,pending:false,getVoices:()=>[{name:'English',lang:'en-US',default:true,localService:true}],addEventListener(){},removeEventListener(){},cancel(){this.speaking=false;},resume(){},speak(u){this.speaking=true;window.__spoken.push(u.text);u.onstart?.();}};
  Object.defineProperty(window,'speechSynthesis',{value:synth,configurable:true});
  Object.defineProperty(window,'SpeechSynthesisUtterance',{value:Utterance,configurable:true});
},initial);
const page=await ctx.newPage();
page.on('pageerror',error=>report.errors.push(error.message));
async function scenario(name,fn){try{await fn();report.checks.push({name,passed:true});console.log('PASS',name);}catch(error){report.checks.push({name,passed:false,error:error.message});await page.screenshot({path:'qa/grammar-review/failure.png',fullPage:true}).catch(()=>{});throw error;}}
async function nav(name){await page.locator(`#topNav [data-page="${name}"]:visible, #bottomNav [data-page="${name}"]:visible`).first().click();await page.locator(`#${name}.active`).waitFor();}
async function grammarLibrary(){await nav('library');await page.locator('#library [data-library-scope="grammar"]').click();await page.locator('#library .grammar-category-list').waitFor();}
async function selectVerbs(){await nav('library');await page.locator('#library [data-library-scope="verbs"]').click();assert.equal(await page.locator('#library .section-head h2').innerText(),'动词词库');assert.equal(await page.locator('#category').inputValue(),'动词');}
async function ready(){await page.locator('#syncStatus[data-state="connected"]').waitFor();}
const savedState=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('wordsInBloomData')));
try{
  await page.goto(base+'/index.html',{waitUntil:'networkidle'});await ready();
  await scenario('the vocabulary library has a direct verb entry and exposes all 168 verbs through pagination',async()=>{
    await selectVerbs();const seen=[];
    for(let p=0;p<Math.ceil(verbs.length/60);p++){
      if(p)await page.locator(`#library [data-library-page="${p}"]`).first().click();
      const ids=await page.locator('#library [data-card]').evaluateAll(cards=>cards.map(card=>Number(card.dataset.card)));
      assert.ok(ids.every(id=>verbIds.has(id)));seen.push(...ids);
    }
    assert.deepEqual([...new Set(seen)].sort((a,b)=>a-b),[...verbIds].sort((a,b)=>a-b));
    assert.match(await page.locator('#library .content-tools .count').innerText(),new RegExp(`${verbs.length} 个词条`));
    await page.screenshot({path:'qa/grammar-review/verbs-desktop.png',fullPage:true});
  });
  await scenario('the original grammar entry and its verb category still share the same cards',async()=>{
    await grammarLibrary();assert.match(await page.locator('#library .content-tools .count').innerText(),new RegExp(`${grammar.length} 个词条`));
    await page.locator('#library [data-grammar-category="动词"]').click();assert.equal(await page.locator('#library .section-head h2').innerText(),'动词词库');
    assert.equal(await page.evaluate(()=>filteredWords().length),verbs.length);
  });
  await scenario('verb cards show the source form table and preserve point-reading behavior',async()=>{
    await page.fill('#search','write');const card=page.locator(`#library [data-card="${write.id}"]`);await card.waitFor();
    const table=card.locator(`[data-verb-forms="${write.id}"]`);assert.ok(await table.isVisible());
    for(const label of ['原形','第三人称单数','过去式','过去分词','-ing'])assert.match(await table.innerText(),new RegExp(label));
    for(const value of ['write',...Object.values(write.verbForms)])assert.ok((await table.innerText()).includes(value));
    await card.locator('[data-expand]').click();await card.locator('.sentence').first().waitFor();
    await page.waitForFunction(id=>document.querySelector(`[data-card="${id}"] .word [data-read-text]`),write.id);
    await card.locator('.word [data-read-text]').first().click();assert.equal(await page.evaluate(()=>window.__spoken.at(-1)),'write');
    await table.locator('.read-phrase-button[data-read-text="written"]').click();assert.equal(await page.evaluate(()=>window.__spoken.at(-1)),'written','The displayed past participle must be read exactly');
    assert.equal(await page.locator('#library.active').count(),1,'Reading a form must not open its word card');
    const expected=(await card.locator('.sentence').first().innerText()).trim();await card.locator('.sentence').first().click();assert.equal(await page.evaluate(()=>window.__spoken.at(-1)),expected);
    assert.equal(await page.locator('#library.active').count(),1,'Reading aloud must not enter a card or answer a question');
    await card.locator('[data-fav]').click();assert.equal((await savedState()).words[write.id].favorite,true);
    await card.locator('.meaning').click();await page.locator('#study.active').waitFor();
    await page.locator(`#study [data-status="${write.id}:learning"]`).click();
    assert.equal((await savedState()).words[write.id].status,'learning');
  });
  await scenario('be and its old form cards show a present-form label and the correct lemma',async()=>{
    await selectVerbs();await page.fill('#search','was');
    const was=verbs.find(word=>word.word==='was'),table=page.locator(`#library [data-verb-forms="${was.id}"]`);
    assert.match(await table.innerText(),/现在时形式/);assert.match(await table.innerText(),/am\/is\/are/);
    assert.equal((await table.locator('dd').first().innerText()).trim(),'be');
    assert.ok(!(await table.innerText()).includes('第三人称单数'));
  });
  await scenario('verb category survives grammar flashcard and study shortcuts',async()=>{
    await selectVerbs();await page.locator('#library [data-grammar-flash]').click();await page.locator('#flash.active').waitFor();
    assert.equal(await page.locator('#flashCategory').inputValue(),'动词');
    const flashScope=await page.evaluate(()=>flashPool().map(word=>word.id));assert.equal(flashScope.length,verbs.length);assert.ok(flashScope.every(id=>verbIds.has(id)));
    await page.locator('#flash [data-flip]').click({position:{x:18,y:18}});assert.equal(await page.locator('#flash [data-flip]').getAttribute('aria-pressed'),'true');
    await selectVerbs();await page.locator('#library [data-grammar-study]').click();await page.locator('#study.active').waitFor();
    const studyScope=await page.evaluate(()=>studyPool().map(word=>word.id));assert.equal(studyScope.length,verbs.length);assert.ok(studyScope.every(id=>verbIds.has(id)));
  });
  await scenario('search and favorite filters remain selected when opening learning cards or cloze tests',async()=>{
    const chooseSavedWrite=async()=>{await selectVerbs();await page.fill('#search','write');await page.selectOption('#status','favorite');assert.equal(await page.evaluate(()=>filteredWords().length),1);};
    await chooseSavedWrite();await page.locator('#library [data-grammar-flash]').click();await page.locator('#flash.active').waitFor();
    assert.equal(await page.locator('#flashCategory').inputValue(),'动词');assert.equal(await page.locator('#flashStatus').inputValue(),'favorite');assert.equal(await page.locator('#flashSearch').inputValue(),'write');
    assert.deepEqual(await page.evaluate(()=>flashPool().map(word=>word.id)),[write.id]);
    await chooseSavedWrite();await page.locator('#library [data-grammar-study]').click();await page.locator('#study.active').waitFor();
    assert.deepEqual(await page.evaluate(()=>studyPool().map(word=>word.id)),[write.id]);
    await chooseSavedWrite();await page.locator('#library [data-grammar-quiz]').click();await page.locator('#quiz.active').waitFor();
    assert.equal(await page.locator('#quizCategory').inputValue(),'动词');assert.equal(await page.locator('#quizStatus').inputValue(),'favorite');assert.equal(await page.locator('#quizSearch').inputValue(),'write');
    await page.selectOption('#quizMode','blank');assert.equal(await page.locator('#quizAvailableCount').innerText(),'1');
  });
  await scenario('an empty verb learning range has an explicit message and stays in the library',async()=>{
    await selectVerbs();await page.fill('#search','zzzz_no_document_word');await page.locator('#library [data-grammar-study]').click();
    assert.equal(await page.locator('#library.active').count(),1);assert.match(await page.locator('#grammar-scope-notice[role="status"]').innerText(),/当前范围没有可学习/);
  });
  await scenario('all three memory test modes keep verb-only questions and distinct in-scope distractors',async()=>{
    await selectVerbs();await page.locator('#library [data-grammar-quiz]').click();await page.locator('#quiz.active').waitFor();
    assert.equal(await page.locator('#quizCollection').inputValue(),'grammar-handbook');assert.equal(await page.locator('#quizCategory').inputValue(),'动词');
    for(const mode of ['cn-en','en-cn','blank']){
      await page.selectOption('#quizMode',mode);await page.selectOption('#quizCount','10');await page.locator('#startQuiz').click();
      const q=await page.evaluate(()=>({mode:state.quiz.mode,items:state.quiz.items.map(word=>({id:word.id,category:word.category})),options:state.quiz.options,blankAnswer:state.quiz.blankAnswer}));
      assert.equal(q.mode,mode);assert.equal(q.items.length,10);assert.ok(q.items.every(word=>word.category==='动词'&&verbIds.has(word.id)));
      if(mode==='blank'){
        assert.match(await page.locator('#quiz .prompt').innerText(),/________/);assert.ok(q.blankAnswer);
        await page.fill('#blankAnswer',q.blankAnswer);await page.locator('#submitBlank').click();
      }else{
        assert.ok(q.options.length>=2&&q.options.every(option=>verbIds.has(option.wordId)));
        assert.equal(new Set(q.options.map(option=>option.label.toLowerCase())).size,q.options.length);
        assert.equal(q.options.filter(option=>option.correct).length,1);
        assert.equal(await page.evaluate(()=>state.quiz.options.every((option,i,options)=>options.slice(i+1).every(other=>quizCanDistinguish(getVocabularyWordById(option.wordId),getVocabularyWordById(other.wordId),state.quiz.mode)))),true,'Distractors must have distinguishable senses as well as different labels');
        await page.locator(`#quiz [data-answer="${q.options.findIndex(option=>option.correct)}"]`).click();
      }
      assert.match(await page.locator('#quiz .feedback').innerText(),/答对/);
      await page.locator('#exitQuiz').click();
    }
  });
  await scenario('synonym-only verb ranges cannot produce a one-answer multiple-choice question',async()=>{
    for(const pair of [['begin','start'],['was','were'],['should','ought to'],['pick','choose'],['remain','stay'],['remain','keep']]){
      const ids=pair.map(term=>verbs.find(word=>word.word===term).id);
      await page.evaluate(ids=>{state.quiz=null;state.quizSessionIds=ids;state.quizCollectionFilter='grammar-handbook';state.quizCategoryFilter='动词';state.quizSearchKeyword='';state.quizStatusFilter='all';renderQuiz();},ids);
      await page.selectOption('#quizMode','cn-en');await page.locator('#startQuiz').click();
      assert.match(await page.locator('#quizHint').innerText(),/至少需要两个可区分/);assert.equal(await page.locator('#quiz [data-answer]').count(),0);
    }
    await page.evaluate(()=>{state.quiz=null;state.quizSessionIds=null;renderQuiz();});
  });
  await scenario('empty and single-item test ranges give guidance without unrelated distractors',async()=>{
    await page.selectOption('#quizMode','cn-en');await page.fill('#quizSearch','zzzz_no_document_word');assert.equal(await page.locator('#quizAvailableCount').innerText(),'0');
    await page.locator('#startQuiz').click();assert.match(await page.locator('#quizHint').innerText(),/没有可测试/);
    await page.locator('#clearQuizFilters').click();assert.equal(await page.locator('#quizCollection').inputValue(),'grammar-handbook');
    await page.selectOption('#quizCategory','动词');await page.selectOption('#quizStatus','favorite');
    assert.equal(await page.evaluate(()=>quizFilteredPool().length),1);assert.equal(await page.locator('#quizAvailableCount').innerText(),'0');
    await page.locator('#startQuiz').click();assert.match(await page.locator('#quizHint').innerText(),/至少需要两个/);assert.equal(await page.locator('#quiz [data-answer]').count(),0);
    await page.selectOption('#quizMode','blank');await page.locator('#startQuiz').click();
    assert.equal(await page.evaluate(()=>state.quiz.items[0].id),write.id);
    await page.fill('#blankAnswer',await page.evaluate(()=>state.quiz.blankAnswer));await page.locator('#submitBlank').click();await page.locator('#nextQuestion').click();
    assert.ok((await savedState()).history.length>=1,'Completing the singleton cloze must save its result');
  });
  await scenario('new grammar favorites and progress survive reload without changing old vocabulary progress',async()=>{
    await page.reload({waitUntil:'networkidle'});await ready();
    const saved=await savedState();assert.equal(saved.words[write.id].favorite,true);assert.ok(['learning','mastered','review'].includes(saved.words[write.id].status));
    assert.equal(saved.words[1].favorite,true);assert.equal(saved.words[1].status,'learning');
    await nav('favorites');assert.ok(await page.locator(`#favorites [data-card="${write.id}"]`).isVisible());assert.ok(await page.locator('#favorites [data-card="1"]').isVisible());
  });
  await scenario('mobile grammar filters and the verb table fit a 390-pixel viewport',async()=>{
    await page.setViewportSize({width:390,height:844});await selectVerbs();await page.fill('#search','write');
    assert.ok(await page.locator(`#library [data-verb-forms="${write.id}"]`).isVisible());
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:'qa/grammar-review/verbs-mobile.png',fullPage:true});
    await page.locator('#library [data-grammar-quiz]').click();assert.equal(await page.locator('#quizCategory').inputValue(),'动词');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:'qa/grammar-review/quiz-mobile.png',fullPage:true});
  });
  assert.deepEqual(report.errors,[]);
}finally{await writeFile('qa/grammar-review/report.json',JSON.stringify(report,null,2));await browser.close();}
console.log(`Grammar browser review passed: ${report.checks.length} scenarios / ${verbs.length} verbs / no page errors.`);
