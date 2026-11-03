import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {buildPublicSpeechEntries} from './catalog-utils.mjs';
import {coreVerbEntries,coreVerbSourceTitle,coreVerbTable} from './core-verb-data.mjs';

// Always merge from the published handbook. Re-running this importer must not
// inherit unrelated draft changes or allocate a second ID for an existing word.
const baselineRevision='7c0cd32a2e5328f7a50e72ae10863d42dabbeecd';
const readPublished=path=>JSON.parse(execFileSync('git',['show',`${baselineRevision}:${path}`],{encoding:'utf8',maxBuffer:20_000_000}));
const grammarURL=new URL('../public/data/grammar-handbook.json',import.meta.url);
const grammar=readPublished('public/data/grammar-handbook.json');
const originalCatalog=readPublished('public/data/catalog.json');
const previousTitle=grammar.sourceTitle;
const regularCatalog={...originalCatalog,words:originalCatalog.words.filter(word=>word.collectionId!=='grammar-handbook')};
const speechBaseline=buildPublicSpeechEntries(originalCatalog).slice(buildPublicSpeechEntries(regularCatalog).length);
const legacyPhrases=new Set(['listen to','go home','go to school']);
const legacyVerb=entry=>['be 与助动词','动词与形式'].includes(entry.category)||legacyPhrases.has(entry.word);
const entries=grammar.entries.map(entry=>({
  ...entry,
  sourceTitle:previousTitle,
  ...(legacyVerb(entry)?{category:'动词'}:{}),
}));

// These two base cards were already added locally; reserve their IDs before
// assigning new ones so saved learning records keep referring to the same word.
for(const [word,id] of [['open',100100],['write',100101]]){
  const incoming=coreVerbEntries.find(entry=>entry.word===word);
  if(!incoming)throw new Error(`Missing stable base card: ${word}`);
  entries.push({...incoming,id,coreSource:true});
}
let nextID=100102;
const sourceTerms=new Set();
for(const incoming of coreVerbEntries){
  if(incoming.category!=='动词'||sourceTerms.has(incoming.word))throw new Error(`Invalid or duplicate verb source: ${incoming.word}`);
  sourceTerms.add(incoming.word);
  const existing=entries.find(entry=>entry.word===incoming.word);
  const merged={...existing,...incoming,id:existing?.id??nextID++,sourceTitle:coreVerbSourceTitle,coreSource:true};
  if(merged.word==='put')merged.usage+=' 原形、过去式和过去分词都拼 put；本例可结合上下文理解为现在的习惯或过去的动作。';
  if(existing)entries[entries.indexOf(existing)]=merged;else entries.push(merged);
}

const legacyForms={
  am:['be','现在时形式'],is:['be','现在时形式'],are:['be','现在时形式'],
  was:['be','过去式'],were:['be','过去式'],
  reads:['read','第三人称单数'],reading:['read','-ing 形式'],
  walks:['walk','第三人称单数'],walked:['walk','过去式'],
  plays:['play','第三人称单数'],played:['play','过去式'],
  ate:['eat','过去式'],went:['go','过去式'],sleeps:['sleep','第三人称单数'],
  opens:['open','第三人称单数'],writes:['write','第三人称单数'],
};
for(const entry of entries){
  const form=legacyForms[entry.word];
  if(form){
    const [lemma,formLabel]=form;
    const base=entries.find(value=>value.word===lemma);
    if(!base?.verbForms)throw new Error(`Missing lemma forms: ${entry.word} → ${lemma}`);
    Object.assign(entry,{verbLemma:lemma,formLabel,verbForms:{...base.verbForms},priority:base.priority,verbGroup:'保留词形卡'});
  }
}

const priorityCount=coreVerbTable.filter(entry=>entry.priority==='必背').length;
if(coreVerbTable.length!==120||priorityCount!==75||coreVerbEntries.length!==149)throw new Error('The verb source coverage changed unexpectedly.');
if(entries.length!==235||entries.filter(entry=>entry.category==='动词').length!==168)throw new Error('Expected 235 grammar entries, including 168 verbs.');
grammar.sourceTitle='语法词库 · 核心动词更新';
grammar.previousSourceTitles=[previousTitle];
grammar.policy='本次仅合并核心清单中的动词、助动词、情态动词和动词搭配；保留原有非动词内容与全部旧ID。表中120个动词保留75个必背、45个扩展标记及变化；补充例句单独标记。';
grammar.entries=entries;
grammar.speechBaseline=speechBaseline;
grammar.coreSourceTerms=coreVerbEntries.map(entry=>({word:entry.word,category:entry.category}));
await writeFile(grammarURL,JSON.stringify(grammar,null,2)+'\n');
await import('./import-grammar-handbook.mjs');
console.log(`Imported verb-only handbook: 120 table verbs (75 required, 45 extended); 149 core verb cards; 168 verbs / ${entries.length} grammar entries. Legacy IDs and non-verbs preserved.`);
