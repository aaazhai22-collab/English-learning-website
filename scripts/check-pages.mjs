import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.resolve(root,process.env.PAGES_OUTPUT||'_site');
const base='/'+(process.env.PAGES_BASE_PATH||'/English-learning-website/').replace(/^\/+|\/+$/g,'')+'/';
const siteBase=base==='//' ? '/' : base;
const virtual=new URL(siteBase,'https://pages.test');
const read=relative=>readFile(path.join(output,relative),'utf8');
const files=[];
async function inventory(directory,prefix=''){
 for(const item of await readdir(directory,{withFileTypes:true})){
  const relative=prefix+item.name;
  assert.ok(!item.isSymbolicLink(),`Pages artifacts cannot contain a symlink: ${relative}`);
  if(item.isDirectory())await inventory(path.join(directory,item.name),relative+'/');
  else files.push(relative);
 }
}
await inventory(output);
for(const forbidden of ['.git/','.openai/','node_modules/','qa/','.qa/','.env'])assert.ok(!files.some(file=>file===forbidden||file.startsWith(forbidden)),`Private/build-only files must not be published: ${forbidden}`);
for(const name of ['index.html','reading.html','vocabulary.html','.nojekyll','pages/config.js','pages/client-api.js','pages/reading-api-core.js','pages/free-analysis.js'])assert.ok(files.includes(name),`Missing published entry/runtime: ${name}`);
assert.equal(await read('index.html'),await read('reading.html'),'The home page must remain the reading app');
assert.match(await read('vocabulary.html'),/词间日和/);
assert.match(await read('pages/config.js'),/__READING_LAB_PAGES__\s*=\s*true/);
let references=0;
async function checkReference(value,owner){
 if(!value||/^(?:#|https?:|data:|blob:|mailto:|tel:|\/\/)/i.test(value))return;
 const resolved=new URL(value,new URL(owner,virtual));
 assert.equal(resolved.origin,virtual.origin,`Unexpected generated asset origin: ${owner}: ${value}`);
 assert.ok(resolved.pathname.startsWith(siteBase),`Asset escaped the repository prefix: ${owner}: ${value}`);
 const relative=decodeURIComponent(resolved.pathname.slice(siteBase.length));
 const target=path.join(output,relative);
 const info=await stat(target).catch(()=>null);
 assert.ok(info,`Missing generated local reference: ${owner}: ${value}`);
 if(info.isDirectory())assert.ok((await stat(path.join(target,'index.html')).catch(()=>null))?.isFile(),`Missing directory landing page: ${value}`);
 references++;
}
for(const name of ['index.html','reading.html','vocabulary.html']){
 const html=await read(name);
 const config=html.indexOf('pages/config.js');
 assert.ok(config>=0&&config<html.indexOf('</script>'),'Pages config must load before the app script');
 for(const match of html.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/g))await checkReference(match[1],name);
}
for(const name of files.filter(file=>/\.(?:js|mjs)$/.test(file)&&!file.startsWith('vendor/'))){
 const source=await read(name);
 const syntax=spawnSync(process.execPath,['--check',path.join(output,name)],{encoding:'utf8'});
 assert.equal(syntax.status,0,`${name}: ${syntax.stderr}`);
 for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\()(["'])(\.{1,2}\/[^"']+)\1/g))await checkReference(match[2],name);
 assert.doesNotMatch(source,/["'`](?:\/(?:reading|vendor|assets|data)\/|\/index\.html["'`])/,'Generated application URLs must keep the repository prefix');
}
const catalog=await read('data/catalog.json');
assert.equal(catalog,await readFile(path.join(root,'public/data/catalog.json'),'utf8'),'Pages must use the checked source catalog');
const parsed=JSON.parse(catalog),grammar=parsed.words.filter(word=>word.collectionId==='grammar-handbook');
assert.equal(parsed.words.filter(word=>word.collectionId!=='grammar-handbook').length,2557);
assert.equal(grammar.length,235);assert.equal(grammar.filter(word=>word.category==='动词').length,168);
for(const [artifact,source] of [['pages/reading-api-core.js','worker/reading-api.js'],['pages/free-analysis.js','worker/free-analysis.js'],['vendor/ocr/core/tesseract-core-lstm.wasm.js','public/vendor/ocr/core/tesseract-core-lstm.wasm.js'],['vendor/ocr/core/tesseract-core-simd-lstm.wasm.js','public/vendor/ocr/core/tesseract-core-simd-lstm.wasm.js'],['vendor/ocr/lang/eng.traineddata.gz','public/vendor/ocr/lang/eng.traineddata.gz'],['vendor/ocr/lang/chi_sim.traineddata.gz','public/vendor/ocr/lang/chi_sim.traineddata.gz']]){
 assert.deepEqual(await readFile(path.join(output,artifact)),await readFile(path.join(root,source)),`Published shared engine must retain the checked bytes: ${artifact}`);
}
assert.match(await read('reading/app.js'),/__READING_LAB_PAGES__/);
assert.match(await read('reading/app.js'),/pages\/client-api\.js/);
assert.match(await read('speech.js'),/__READING_LAB_PAGES__/);
console.log(`Pages checks passed: ${files.length} static files / ${references} resolved local references / ${grammar.length} grammar cards (${grammar.filter(word=>word.category==='动词').length} verbs), prefix ${siteBase}; shared OCR and teaching engines match the source.`);
