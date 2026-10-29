import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { buildPublicSpeechEntries } from './catalog-utils.mjs';
import { selectBeginnerExample } from '../public/data/beginner-examples.js';

const catalog=JSON.parse(await readFile(new URL('../public/data/catalog.json',import.meta.url),'utf8'));
const grammar=JSON.parse(await readFile(new URL('../public/data/grammar-handbook.json',import.meta.url),'utf8'));
const regular={collections:catalog.collections.filter(value=>value.id!=='grammar-handbook'),words:catalog.words.filter(value=>value.collectionId!=='grammar-handbook')};
assert.equal(createHash('sha256').update(JSON.stringify(regular)).digest('hex'),grammar.regularCatalogSHA256,'Existing catalog, IDs and multi-sense entries must remain byte-for-byte equivalent');
assert.equal(grammar.entries.length,99);
assert.equal(new Set(grammar.entries.map(value=>value.category)).size,10);
assert.equal(new Set(catalog.words.map(value=>value.id)).size,catalog.words.length);
const words=catalog.words.filter(value=>value.collectionId==='grammar-handbook');
assert.equal(words.length,99);
for(const word of words){
  assert.ok(word.grammarNote&&word.sourceSection&&word.lexiconType==='grammar',word.word);
  assert.ok(word.examples.every(example=>example.sentence&&example.translation&&['manual','added'].includes(example.exampleOrigin)),word.word);
  assert.equal(selectBeginnerExample(word).sentence,word.examples[0].sentence,'Grammar uses its own context, even if a regular word shares its spelling');
}
const oldSpeech=buildPublicSpeechEntries(regular),newSpeech=buildPublicSpeechEntries(catalog);
assert.deepEqual(newSpeech.slice(0,oldSpeech.length),oldSpeech,'Speech IDs for existing open tabs must be stable');
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
assert.equal(run('grammarWords().length'),99);
assert.equal(run('wordsForCollectionScope("all").length'),2557);
assert.equal(run('scopeCategories("grammar-handbook").length'),10);
assert.equal(run('getWord(grammarWords()[0]).grammarNote'),words[0].grammarNote);
run('state.collectionFilter="grammar-handbook"; state.categoryFilter="all";');
assert.equal(run('filteredWords().length'),99);
run('state.user.words[100001]={favorite:true,status:"learning"};');
assert.equal(run('getWord(getVocabularyWordById(100001)).favorite'),true);
assert.equal(run('getWord(getVocabularyWordById(1)).favorite'),false,'Same text in a regular collection has independent learning state');
assert.equal(run('filterWordPool(vocabularyData.map(getWord),{forceFavorite:true}).length'),1,'Grammar favorites remain discoverable outside the grammar tab');
run('state.quizCollectionFilter="grammar-handbook"; state.quizCategoryFilter="all"; state.quizStatusFilter="all";');
assert.equal(run('quizFilteredPool().length'),99);
assert.equal(run('quizEligiblePool("blank").length'),97);
assert.deepEqual(JSON.parse(run('JSON.stringify(grammarWords().filter(word=>!grammarBlankExample(word)).map(word=>word.word))')),['be','predicate']);
assert.equal(run('quizEligiblePool("blank").every(word=>createBlankQuestion(word).text.includes("________"))'),true);
for(const mode of ['cn-en','en-cn','blank']){
  get('#quizMode').value=mode;get('#quizCount').value='all';run('startQuiz()');
  assert.equal(run('state.quiz.items.length'),mode==='blank'?97:99);
  assert.equal(run('state.quiz.items.every(isGrammarWord)'),true);
  if(mode!=='blank'){
    assert.equal(run(`state.quiz.items.every(word=>{const options=makeOptions(word,${JSON.stringify(mode)});return options.length>=2&&options.filter(option=>option.correct).length===1&&options.every(option=>getVocabularyWordById(option.wordId).collectionId==='grammar-handbook')&&new Set(options.map(option=>option.label.toLowerCase())).size===options.length;})`),true);
  }
}
run('state.quiz=null;state.quizCategoryFilter="人称代词";');
assert.equal(run('quizFilteredPool().length'),8);
get('#quizMode').value='cn-en';run('startQuiz()');
assert.equal(run('state.quiz.items.every(word=>word.category==="人称代词")'),true);
assert.equal(run('state.quiz.items.every(word=>makeOptions(word,"cn-en").every(option=>getVocabularyWordById(option.wordId).category==="人称代词"))'),true);
run('state.quiz=null; state.quizCollectionFilter="latest"; state.quizCategoryFilter="all";');
assert.equal(run('quizFilteredPool().length'),57,'Latest still means the regular 40th collection');
console.log(`Grammar checks passed: 99 entries / 10 categories; stable original data and ${oldSpeech.length} speech IDs; real app filtering, separate favorites, all quiz modes, valid blanks and in-scope distinct distractors.`);
