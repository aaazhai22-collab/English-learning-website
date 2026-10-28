// Owner-private production QA: a short-lived Site service token arrives only
// through hidden stdin, never argv, source, environment, or saved QA output.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
if (typeof http.setGlobalProxyFromEnv === 'function') http.setGlobalProxyFromEnv();
const input = await new Promise((resolve, reject) => {
  let value = '';
  const terminal = process.stdin.isTTY;
  function finish(error) {
    process.stdin.removeListener('data', receive);
    if (terminal) process.stdin.setRawMode(false);
    process.stdin.pause();
    error ? reject(error) : resolve(JSON.parse(value.trim()));
  }
  function receive(chunk) {
    value += chunk;
    if(value.includes('\u0003'))finish(new Error('Cancelled'));
    else if(value.length>65536)finish(new Error('Input too long'));
    else if(/[\r\n]/.test(value))finish();
  }
  if (terminal) process.stdin.setRawMode(true);
  process.stdout.write('Ready for private Site QA JSON on stdin (input is hidden).\n');
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', receive);
  process.stdin.resume();
});
const origin='https://words-in-bloom-read-along.sacred-jelly-1754.chatgpt.site';
const headers={'OAI-Sites-Authorization':`Bearer ${input.token}`};
async function api(action, body) {
  const response=await fetch(`${origin}/api/reading/${action}`, {method:body?'POST':'GET',redirect:'manual',headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(95000)});
  assert.equal(response.status,200,`${action}: HTTP ${response.status}`);
  return response.json();
}
const source={title:'Tipping and digital payments',paragraphs:[[
  {en:'U. S. customers historically tipped the people they assumed were earning most of their income via tips, such as restaurant servers earning less than the minimum wage.'},
  {en:'In the early 2010s, a wide range of businesses started processing purchases with iPads and other digital payment systems.'},
]],questions:[],answerStatus:'unverified'};
const status=await api('status');
assert.equal(status.defaultProvider,'free');
assert.equal(status.modelConfigured,false);
const batch=await api('analyze',{provider:'free',action:'sentences',passage:source,sentenceIds:['p1s1','p1s2']});
assert.equal(batch.sentences.length,2);
for(const [i,sentence] of batch.sentences.entries()){
  assert.equal(sentence.en,source.paragraphs[0][i].en);
  assert.match(sentence.zh,/[\u3400-\u9fff]/);
  assert.ok(sentence.grammar.length>=3);
  assert.ok(sentence.chunks.length>=2);
}
const overview=await api('analyze',{provider:'free',action:'overview',passage:{...source,paragraphs:[batch.sentences]}});
assert.match(overview.overview.summary,/[\u3400-\u9fff]/);
assert.equal(overview.overview.structure.length,1);
assert.ok(overview.overview.vocabulary.length>=3);
await mkdir('.qa',{recursive:true});
await writeFile('.qa/live-free-analysis.json',JSON.stringify({status:{defaultProvider:status.defaultProvider,modelConfigured:status.modelConfigured},sentences:batch.sentences,overview:overview.overview,verifiedAt:new Date().toISOString()},null,2));
console.log(JSON.stringify({productionVerified:true,sentences:batch.sentences.map(s=>({en:s.en,zh:s.zh,grammar:s.grammar.length,chunks:s.chunks.length})),paragraphs:overview.overview.structure.length,vocabulary:overview.overview.vocabulary.length,noModelKey:true}));
