import fs from 'node:fs';
import assert from 'node:assert/strict';
import {curatedBeginnerExamples,beginnerExampleMetadata,selectBeginnerExample,validateBeginnerExample,exampleDifficulty,exampleWordCount} from '../public/data/beginner-examples.js';
const catalog=JSON.parse(fs.readFileSync(new URL('../public/data/catalog.json',import.meta.url),'utf8'));
const before=JSON.stringify(catalog);
const rows=catalog.words.map(word=>({word:word.word,originalLength:exampleWordCount(word.sentence),example:selectBeginnerExample(word)}));
assert.equal(rows.length,2557);
assert.equal(JSON.stringify(catalog),before,'Selecting a starter sentence must not mutate the original multi-sense catalog');
for(const {word,example}of rows){assert.ok(example.sentence.trim(),word);assert.ok(example.translation.trim(),word);assert.ok(example.sense.trim(),word);assert.ok(example.pos.trim(),word);assert.match(example.sentence,/[.!?][”’"']?$/,word);}
for(const [word,example]of Object.entries(curatedBeginnerExamples)){validateBeginnerExample(example,word);assert.ok(exampleWordCount(example.sentence)<=14,word);assert.ok(/\p{Script=Han}/u.test(example.translation),word);}
assert.throws(()=>validateBeginnerExample({sentence:'A dog is outside.',translation:'一只狗在外面。'},'cat'),/缺少目标词/);
assert.throws(()=>validateBeginnerExample({sentence:'Education is useful.',translation:'教育很有用。'},'cat'),/缺少目标词/,'A word may not match inside another word');
assert.throws(()=>validateBeginnerExample({sentence:'A cat',translation:'一只猫。'},'cat'),/完整结束/);
assert.throws(()=>selectBeginnerExample({word:'missing',examples:[]}),/没有可用/);
const complex={sentence:'An activist who explains evidence may influence debate because readers understand the facts.',translation:'能够解释证据的活动家可能影响辩论，因为读者理解了事实。'};
const simple={sentence:'The activist helps local people.',translation:'这位活动家帮助当地人。'};
assert.ok(exampleDifficulty(simple)<exampleDifficulty(complex));
const synthetic={word:'test-example',pos:'n.',meaning:'测试词',examples:[complex,simple]};
assert.equal(selectBeginnerExample(synthetic).sentence,simple.sentence,'Select a complete simple sentence; never clip the complex one');
const oldWorst=catalog.words.filter(word=>Math.min(...word.examples.map(ex=>exampleWordCount(ex.sentence)))>20);
assert.equal(oldWorst.length,242);
for(const word of oldWorst)assert.ok(exampleWordCount(selectBeginnerExample(word).sentence)<=14,word.word);
const counts={words:rows.length,curatedWords:Object.keys(curatedBeginnerExamples).length,curatedRowsUsed:rows.filter(row=>row.example.source==='beginner-editorial').length,average:Math.round(rows.reduce((sum,row)=>sum+exampleWordCount(row.example.sentence),0)/rows.length*100)/100,max:Math.max(...rows.map(row=>exampleWordCount(row.example.sentence))),under12:rows.filter(row=>exampleWordCount(row.example.sentence)<=12).length};
console.log('Beginner example checks passed:',JSON.stringify(counts));
