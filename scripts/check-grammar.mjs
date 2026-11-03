import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { buildPublicSpeechEntries } from './catalog-utils.mjs';
import { selectBeginnerExample } from '../public/data/beginner-examples.js';

const catalog=JSON.parse(await readFile(new URL('../public/data/catalog.json',import.meta.url),'utf8'));
const grammar=JSON.parse(await readFile(new URL('../public/data/grammar-handbook.json',import.meta.url),'utf8'));
const documentVerbs=JSON.parse(await readFile(new URL('./fixtures/core-handbook-verbs.json',import.meta.url),'utf8')).verbs;
const compatibilityBase='7c0cd32a2e5328f7a50e72ae10863d42dabbeecd';
const regular={collections:catalog.collections.filter(value=>value.id!=='grammar-handbook'),words:catalog.words.filter(value=>value.collectionId!=='grammar-handbook')};
assert.equal(createHash('sha256').update(JSON.stringify(regular)).digest('hex'),grammar.regularCatalogSHA256,'Existing catalog, IDs and multi-sense entries must remain byte-for-byte equivalent');
const handbookVerbForms=['read','reads','reading','walk','walks','walked','play','plays','played','eat','ate','go','went','sleep','sleeps','like','know','listen','opens','writes','put','study','be','am','is','are','was','were','do'];
const priorVerbTerms=[...handbookVerbForms,'open','write','listen to','go home','go to school'];
assert.equal(documentVerbs.length,120,'The source document has 75 required and 45 extension verbs');
assert.equal(new Set(documentVerbs.map(value=>value.word)).size,120);
assert.equal(grammar.entries.length,235,'This release merges verbs only and retains the previously published non-verb entries');
const categories=new Set(grammar.entries.map(value=>value.category));
assert.ok(categories.has('动词'));
assert.ok(!categories.has('动词与形式')&&!categories.has('be 与助动词'),'The verb scope must include action, linking, auxiliary and phrasal forms together');
const entriesForTerm=term=>grammar.entries.filter(value=>value.word.toLowerCase()===term.toLowerCase());
const entryByTerm=new Map(grammar.entries.map(value=>[value.word.toLowerCase(),value]));
for(const entry of grammar.entries.filter(value=>value.category==='动词'))entryByTerm.set(entry.word.toLowerCase(),entry);
assert.equal(new Set(grammar.entries.map(value=>value.word+'\u0000'+value.category)).size,grammar.entries.length,'A word may have separate meanings in different learning categories, but not duplicate cards within the same category');
const expectedVerbTerms=grammar.entries.filter(value=>value.category==='动词').map(value=>value.word.toLowerCase());
assert.equal(expectedVerbTerms.length,168);
for(const term of priorVerbTerms){const entry=entryByTerm.get(term);assert.equal(entry?.category,'动词',`A previously taught verb form must remain in the unified verb scope: ${term}`);assert.ok(entry?.usage&&entry?.sourceSection,`Missing grammar or source explanation for ${term}`);}
for(const reference of documentVerbs){
  const entry=entryByTerm.get(reference.word);
  assert.equal(entry?.category,'动词',`Missing document verb: ${reference.word}`);
  assert.equal(entry.priority,reference.priority,`Source priority differs for ${reference.word}`);
  assert.ok(entry.verbForms,`Missing verb table for ${reference.word}`);
  for(const field of ['thirdPerson','past','pastParticiple','ing'])assert.equal(entry.verbForms[field].replace(/\s+/g,''),reference.verbForms[field].replace(/\s+/g,''),`${reference.word}: ${field} differs from the source table`);
}
assert.equal(documentVerbs.filter(value=>entryByTerm.get(value.word).priority==='必背').length,75);
assert.equal(documentVerbs.filter(value=>entryByTerm.get(value.word).priority==='扩展').length,45);
for(const badForm of ['readed','goed','eated','writed','sleeped'])assert.ok(!entryByTerm.has(badForm),`An error example must not become a study word: ${badForm}`);
for(const term of ['open','write'])assert.ok(entryByTerm.get(term).examples.some(example=>new RegExp(`\\b${term}\\b`,'i').test(example.sentence)),`The base ${term} needs an exact-form example`);
assert.ok(grammar.entries.some(entry=>entry.word==='may'&&entry.category==='动词'),'may the modal must remain in the verb scope');
for(const term of ['be','am','is','are','was','were','been','being','do','does','did','have','has','had','can','could','will','would','should','must','may','might','shall','seem','sound','smell','taste','remain','appear','prove'])assert.equal(entryByTerm.get(term)?.category,'动词',`Linking, auxiliary and modal forms must all be discoverable as verbs: ${term}`);
assert.equal(new Set(catalog.words.map(value=>value.id)).size,catalog.words.length);
const words=catalog.words.filter(value=>value.collectionId==='grammar-handbook');
assert.equal(words.length,grammar.entries.length);
for(const word of words){
  assert.ok(word.grammarNote&&word.sourceSection&&word.lexiconType==='grammar',word.word);
  assert.ok(word.examples.every(example=>example.sentence&&example.translation&&['manual','added'].includes(example.exampleOrigin)),word.word);
  assert.equal(selectBeginnerExample(word).sentence,word.examples[0].sentence,'Grammar uses its own context, even if a regular word shares its spelling');
}
const oldSpeech=buildPublicSpeechEntries(regular),newSpeech=buildPublicSpeechEntries(catalog);
assert.deepEqual(newSpeech.slice(0,oldSpeech.length),oldSpeech,'Speech IDs for existing open tabs must be stable');
const deployedCatalog=JSON.parse(execFileSync('git',['show',compatibilityBase+':public/data/catalog.json'],{cwd:new URL('../',import.meta.url),encoding:'utf8',maxBuffer:32*1024*1024}));
const deployedGrammar=JSON.parse(execFileSync('git',['show',compatibilityBase+':public/data/grammar-handbook.json'],{cwd:new URL('../',import.meta.url),encoding:'utf8'}));
const deployedUtils=execFileSync('git',['show',compatibilityBase+':scripts/catalog-utils.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8'}).replace(/^import .+;\r?\n/gm,'').replaceAll('export function ','function ');
const deployedSpeech=Array.from(vm.runInNewContext(deployedUtils+';buildPublicSpeechEntries(__catalog);',{__catalog:deployedCatalog,selectBeginnerExample}));
assert.deepEqual(newSpeech.slice(0,deployedSpeech.length),deployedSpeech,'Previously published grammar speech IDs must also keep their exact positions');
const currentById=new Map(words.map(value=>[value.id,value]));
for(const previous of deployedCatalog.words.filter(value=>value.collectionId==='grammar-handbook'))assert.equal(currentById.get(previous.id)?.word,previous.word,'Existing grammar learning IDs must keep their words');
const allVerbTerms=new Set(priorVerbTerms);
const previousNonVerbs=deployedGrammar.entries.filter(entry=>!allVerbTerms.has(entry.word.toLowerCase()));
for(const previous of previousNonVerbs){
  const current=grammar.entries.find(entry=>entry.id===previous.id);
  for(const field of Object.keys(previous))assert.deepEqual(current?.[field],previous[field],`Verb-only release must preserve non-verb ${previous.word}: ${field}`);
}
assert.equal(grammar.entries.filter(entry=>entry.category!=='动词').length,previousNonVerbs.length,'No new non-verb lists may be imported');
const oldFormLemmas={am:'be',is:'be',are:'be',was:'be',were:'be',reads:'read',reading:'read',walks:'walk',walked:'walk',plays:'play',played:'play',ate:'eat',went:'go',sleeps:'sleep',opens:'open',writes:'write'};
for(const [form,lemma]of Object.entries(oldFormLemmas)){
  assert.equal(entryByTerm.get(form)?.verbLemma,lemma,`Old form ${form} needs its correct lemma`);
  assert.deepEqual(entryByTerm.get(form).verbForms,entryByTerm.get(lemma).verbForms,`Old form ${form} must display the lemma table`);
}
for(const word of words){assert.ok(newSpeech.includes(word.word));for(const ex of word.examples)assert.ok(newSpeech.includes(ex.sentence));}

// Execute the real app's definitions with an inert DOM. No copied filtering or
// quiz algorithm: this checks the same code used by the page.
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const source=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].find(match=>!match[1].includes('src=')&&match[2].includes('let beginnerExampleFor'))[2].split('// ===== 应用入口：')[0];
const elements=new Map();
const element={style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},addEventListener(){},querySelector(){return element},querySelectorAll(){return[]}};
const get=selector=>{if(!elements.has(selector))elements.set(selector,{...element,value:'',textContent:''});return elements.get(selector);};
const context=vm.createContext({console,document:{querySelector:get,querySelectorAll:()=>[],addEventListener(){},getElementById(){return null},body:element,documentElement:element},window:{addEventListener(){},matchMedia:()=>({matches:true}),innerWidth:1440},localStorage:{getItem(){return null},setItem(){}},location:{protocol:'http:'},setInterval(){},setTimeout(){},clearTimeout(){},clearInterval(){},requestAnimationFrame(){},cancelAnimationFrame(){},URL,Date,Intl,Map,Set,structuredClone,__catalog:catalog,__selectExample:selectBeginnerExample});
const run=code=>vm.runInContext(code,context);
run(source);
run('const __normalized=normalizeBackendCatalog(__catalog); vocabularyCollections=__normalized.collections; vocabularyData=__normalized.words; beginnerExampleFor=__selectExample; renderQuiz=()=>{};');
assert.equal(run('regularCollections().length'),40);
assert.equal(run('latestRegularCollection().id'),'batch-40-valid-otherwise');
assert.equal(run('grammarWords().length'),grammar.entries.length);
assert.equal(run('wordsForCollectionScope("all").length'),2557);
assert.equal(run('scopeCategories("grammar-handbook").length'),categories.size);
assert.equal(run('getWord(grammarWords()[0]).grammarNote'),words[0].grammarNote);
assert.match(run('grammarContextHtml(grammarWords().find(word=>word.word==="be"))'),/现在时形式/,'be must not label am/is/are as third-person singular');
assert.match(run('grammarContextHtml(grammarWords().find(word=>word.word==="was"))'),/现在时形式/,'A form card must present its lemma’s be table');
assert.match(run('grammarContextHtml(grammarWords().find(word=>word.word==="write"))'),/第三人称单数/);
const punctuationCases=[
  {word:'a.m.',sentence:'It is six a.m.',answer:'a.m.'},
  {word:'p.m.',sentence:'We meet at five p.m.',answer:'p.m.'},
  {word:'twenty-first',sentence:'Today is the twenty-first of May.',answer:'twenty-first'},
  {word:'at home',sentence:'We are at home.',answer:'at home'},
];
for(const item of punctuationCases){
  const result=JSON.parse(run(`JSON.stringify(grammarBlankExample(${JSON.stringify({word:item.word,sentence:item.sentence,examples:[]})}))`));
  assert.equal(result?.answer,item.answer,`Exact cloze must support punctuation or phrases: ${item.word}`);assert.ok(result.text.includes('________'));assert.ok(!result.text.includes(item.answer));
}
for(const [word,sentence] of [['one','Someone can help.'],['one','We need twenty-one chairs.'],['first','This is my twenty-first visit.'],['read','She reads books.']])assert.equal(run(`grammarBlankExample(${JSON.stringify({word,sentence,examples:[]})})`),null,`Do not cloze ${word} inside another word or a different inflection`);
run('state.collectionFilter="grammar-handbook"; state.categoryFilter="all";');
assert.equal(run('filteredWords().length'),grammar.entries.length);
run('state.categoryFilter="动词";');
assert.equal(run('filteredWords().length'),expectedVerbTerms.length);
assert.equal(run('filteredWords().every(word=>word.category==="动词")'),true);
run('state.user.words[100001]={favorite:true,status:"learning"};');
assert.equal(run('getWord(getVocabularyWordById(100001)).favorite'),true);
assert.equal(run('getWord(getVocabularyWordById(1)).favorite'),false,'Same text in a regular collection has independent learning state');
assert.equal(run('filterWordPool(vocabularyData.map(getWord),{forceFavorite:true}).length'),1,'Grammar favorites remain discoverable outside the grammar tab');
run('state.quizCollectionFilter="grammar-handbook"; state.quizCategoryFilter="all"; state.quizStatusFilter="all";');
assert.equal(run('quizFilteredPool().length'),grammar.entries.length);
const blankCount=run('quizEligiblePool("blank").length');
assert.ok(blankCount>0);
for(const reference of documentVerbs)assert.equal(run(`Boolean(grammarBlankExample(grammarWords().find(word=>word.word===${JSON.stringify(reference.word)})))`),true,`The document verb ${reference.word} needs a usable exact-form cloze`);
assert.equal(run('quizEligiblePool("blank").every(word=>createBlankQuestion(word).text.includes("________"))'),true);
for(const mode of ['cn-en','en-cn','blank']){
  get('#quizMode').value=mode;get('#quizCount').value='all';run('startQuiz()');
  assert.equal(run('state.quiz.items.length'),mode==='blank'?blankCount:grammar.entries.length);
  assert.equal(run('state.quiz.items.every(isGrammarWord)'),true);
  if(mode!=='blank'){
    assert.equal(run(`state.quiz.items.every(word=>{const options=makeOptions(word,${JSON.stringify(mode)});return options.length>=2&&options.filter(option=>option.correct).length===1&&options.every(option=>getVocabularyWordById(option.wordId).collectionId==='grammar-handbook')&&new Set(options.map(option=>option.label.toLowerCase())).size===options.length;})`),true);
  }
}
for(const [first,second] of [['begin','start'],['was','were'],['should','ought to'],['pick','choose'],['remain','stay'],['remain','keep']]){
  const a=entryByTerm.get(first),b=entryByTerm.get(second),help=entryByTerm.get('help');
  assert.ok(a&&b&&help);
  for(const mode of ['cn-en','en-cn']){
    assert.equal(run(`quizCanDistinguish(getVocabularyWordById(${a.id}),getVocabularyWordById(${b.id}),${JSON.stringify(mode)})`),false,`Same-sense ${first}/${second} must never compete`);
    run(`state.quiz={optionPool:[getVocabularyWordById(${a.id}),getVocabularyWordById(${b.id}),getVocabularyWordById(${help.id})]};`);
    const options=JSON.parse(run(`JSON.stringify(makeOptions(getVocabularyWordById(${a.id}),${JSON.stringify(mode)}))`));
    assert.ok(!options.some(option=>option.wordId===b.id));
    assert.ok(options.length>=2&&options.filter(option=>option.correct).length===1);
    run(`state.quiz=null;state.quizSessionIds=[${a.id},${b.id}];state.quizCategoryFilter="动词";state.quizSearchKeyword="";state.quizStatusFilter="all";`);
    get('#quizMode').value=mode;run('startQuiz()');assert.equal(run('state.quiz'),null);assert.match(get('#quizHint').textContent,/至少需要两个可区分/);
  }
}
run('state.quiz=null;state.quizSessionIds=null;state.quizCategoryFilter="all";');
run('state.quiz=null;state.quizCategoryFilter="动词";');
assert.equal(run('quizFilteredPool().length'),expectedVerbTerms.length);
const verbBlankCount=run('quizEligiblePool("blank").length');
assert.ok(verbBlankCount>=documentVerbs.length);
for(const mode of ['cn-en','en-cn','blank']){
  get('#quizMode').value=mode;get('#quizCount').value='all';run('startQuiz()');
  assert.equal(run('state.quiz.items.length'),mode==='blank'?verbBlankCount:expectedVerbTerms.length);
  assert.equal(run('state.quiz.items.every(word=>word.category==="动词")'),true);
  if(mode!=='blank')assert.equal(run(`state.quiz.items.every(word=>{const options=makeOptions(word,${JSON.stringify(mode)});return options.length>=2&&options.filter(option=>option.correct).length===1&&options.every(option=>getVocabularyWordById(option.wordId).category==='动词')&&new Set(options.map(option=>option.label.toLowerCase())).size===options.length;})`),true);
}
run('state.quiz=null;state.quizSearchKeyword="a_term_that_cannot_match";');
get('#quizMode').value='cn-en';run('startQuiz()');assert.equal(run('state.quiz'),null);assert.match(get('#quizHint').textContent,/没有可测试/);
run(`state.quizSearchKeyword="";state.quizSessionIds=[${entryByTerm.get('open').id}];`);
run('startQuiz()');assert.equal(run('state.quiz'),null);assert.match(get('#quizHint').textContent,/至少需要两个/);
get('#quizMode').value='blank';run('startQuiz()');assert.equal(run('state.quiz.items.length'),1);assert.equal(run('state.quiz.items[0].word'),'open');
run('state.quiz=null;state.quizSessionIds=null;');
run('state.quiz=null;state.quizCategoryFilter="人称代词";');
assert.equal(run('quizFilteredPool().length'),grammar.entries.filter(value=>value.category==='人称代词').length);
get('#quizMode').value='cn-en';run('startQuiz()');
assert.equal(run('state.quiz.items.every(word=>word.category==="人称代词")'),true);
assert.equal(run('state.quiz.items.every(word=>makeOptions(word,"cn-en").every(option=>getVocabularyWordById(option.wordId).category==="人称代词"))'),true);
run('state.quiz=null; state.quizCollectionFilter="latest"; state.quizCategoryFilter="all";');
assert.equal(run('quizFilteredPool().length'),57,'Latest still means the regular 40th collection');
console.log(`Grammar checks passed: ${words.length} entries / ${categories.size} categories / ${expectedVerbTerms.length} verbs; complete handbook forms, stable original data and ${deployedSpeech.length} published speech IDs; real app filtering, separate favorites, all quiz modes, empty/single pools, valid blanks and in-scope distinct distractors.`);
