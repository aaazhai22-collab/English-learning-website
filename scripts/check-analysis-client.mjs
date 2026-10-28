import assert from 'node:assert/strict';
import { normalizePassage } from '../public/reading/core.js';
import { generatePassageAnalysis, hasCompleteAnalysis, mergeAnalysis } from '../public/reading/analysis-client.js';

const original = normalizePassage({id:'preserve-article',title:'An imported article',paragraphs:[[{en:'Students compare evidence before choosing an answer.'},{en:'Careful reading helps them understand the argument.'}]],questions:[{id:'q1',number:21,stem:'What helps students?',options:['Reading','Guessing','Waiting','Leaving'],answer:'A',evidence:[2]}],answerStatus:'verified',analysisMode:'rules'});
const snapshot = JSON.stringify(original);
const calls = [];
const api = async (path, body) => {
  assert.equal(path, 'analyze');
  assert.equal(body.provider, 'free');
  calls.push(body.action);
  if(body.action==='sentences')return {sentences:body.sentenceIds.map((id,i)=>({id,en:original.paragraphs[0][i].en,paragraph:1,sentence:i+1,zh:'学生通过仔细阅读来比较证据并理解文章。',chunks:[{en:original.paragraphs[0][i].en,zh:'仔细阅读原文。'}],grammar:[{label:'主句结构',detail:'Students 是主语，compare 是谓语，evidence 是宾语。'}]}))};
  return {overview:{titleZh:'导入文章',summary:'学生通过仔细阅读比较证据。',structure:[{label:'第1段 · 学习方法',description:'说明仔细阅读和比较证据的作用。'}],vocabulary:[{word:'evidence',meaning:'证据',phrase:'compare evidence'}],questions:original.questions.map(q=>({...q,answer:'D',explanation:'不应覆盖原先已核实的参考答案。'}))},notice:'免费机器翻译＋自动句法分析'};
};
const result=await generatePassageAnalysis(original,{api});
assert.equal(JSON.stringify(original),snapshot,'analysis must not mutate the stored article while running');
assert.equal(result.id,original.id);
assert.equal(result.questions[0].number,21);
assert.equal(result.questions[0].answer,'A','verified answers must survive enrichment');
assert.equal(result.answerStatus,'verified');
assert.equal(result.analysisMode,'online');
assert.ok(hasCompleteAnalysis(result));
assert.deepEqual(calls,['sentences','overview']);

const moved=structuredClone(result);moved.paragraphs[0][0].en+=' Extra text.';
assert.throws(()=>mergeAnalysis(original,moved),/原文|分句/);
await assert.rejects(()=>generatePassageAnalysis(original,{api:async()=>({sentences:[]})}),/完整/);
assert.equal(JSON.stringify(original),snapshot,'failed requests must preserve all original data');
await assert.rejects(()=>generatePassageAnalysis(original,{api:async(path,body)=>body.action==='sentences'?api(path,body):{overview:{summary:'',structure:[],vocabulary:[]}}}),/结构|词汇/);
const controller=new AbortController();
await assert.rejects(()=>generatePassageAnalysis(original,{api,signal:controller.signal,onProgress:()=>controller.abort()}),{name:'AbortError'});
assert.equal(JSON.stringify(original),snapshot,'cancellation must not replace saved article or notes');
console.log('Analysis client checks passed: staged results, exact sentence identity, free default, preserved IDs/verified answers, incomplete output, failures and cancellation.');
