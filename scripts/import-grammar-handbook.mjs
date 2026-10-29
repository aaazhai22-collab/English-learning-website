import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const catalogURL = new URL('../public/data/catalog.json', import.meta.url);
const grammarURL = new URL('../public/data/grammar-handbook.json', import.meta.url);
const catalog = JSON.parse(await readFile(catalogURL, 'utf8'));
const grammar = JSON.parse(await readFile(grammarURL, 'utf8'));
const regular = {
  collections: catalog.collections.filter(value => value.id !== 'grammar-handbook'),
  words: catalog.words.filter(value => value.collectionId !== 'grammar-handbook'),
};
const hash = createHash('sha256').update(JSON.stringify(regular)).digest('hex');
if (hash !== grammar.regularCatalogSHA256) throw new Error('The original catalog changed. Review it before regenerating the grammar collection.');
const ids = new Set(regular.words.map(value => value.id));
const terms = new Set();
const words = grammar.entries.map(entry => {
  const term = entry.word.toLowerCase();
  if (!Number.isInteger(entry.id) || entry.id < 100001 || ids.has(entry.id) || terms.has(term)) throw new Error(`Duplicate or unstable grammar entry: ${entry.word}`);
  ids.add(entry.id); terms.add(term);
  const examples = entry.examples.map(example => ({...example,pos:entry.pos,sense:entry.meaning,collocations:[]}));
  if (!entry.meaning || !entry.usage || !entry.sourceSection || !examples.every(example => example.sentence && example.translation)) throw new Error(`Incomplete grammar entry: ${entry.word}`);
  return {
    id:entry.id, word:entry.word, phonetic:entry.phonetic || '', pos:entry.pos,
    meaning:entry.meaning, sentence:examples[0].sentence, translation:examples[0].translation,
    category:entry.category, collectionId:'grammar-handbook', collectionTitle:'语法词库 · 零基础语序',
    status:'new',favorite:false,examples,collocations:[],lexiconType:'grammar',
    grammarNote:entry.usage+(entry.exampleNote ? ` ${entry.exampleNote}` : ''),
    sourceSection:entry.sourceSection,sourceKind:'manual',sourceTitle:grammar.sourceTitle,
  };
});
const collection = {
  id:'grammar-handbook',date:'2026-10-29',title:'语法词库 · 零基础语序',type:'grammar',
  sortOrder:1000,wordCount:words.length,description:'手册词语、动词形式与基础句法，按语法用途分组。',
};
await writeFile(catalogURL,JSON.stringify({...catalog,collections:[...regular.collections,collection],words:[...regular.words,...words]})+'\n');
console.log(`Imported ${words.length} grammar entries. Original ${regular.words.length} words and their IDs are unchanged.`);
