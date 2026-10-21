import {STORAGE_KEY,validateState} from './core.js';
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function parseBackup(text){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>8000000)throw new Error('备份为空或超过 8 MB，请检查文件。');
  let data;try{data=JSON.parse(text);}catch{throw new Error('JSON 格式不正确，备份未恢复。');}
  if(!object(data))throw new Error('请选择阅读工坊导出的学习备份。');
  if(data.format!==undefined&&(data.format!=='reading-lab-backup'||data.version!==1))throw new Error('不支持此备份格式或版本。');
  const raw=data.format==='reading-lab-backup'?data.reading:data;
  if(!object(raw)||raw.version!==1||!Array.isArray(raw.imported)||!object(raw.profile)||!object(raw.attempts)||!object(raw.words))throw new Error('这不是完整的阅读工坊学习备份。文章 JSON 请在“导入文章”中使用。');
  if(raw.imported.length>150)throw new Error('备份包含超过150篇材料，请分批整理，未截断任何文章。');
  for(const key of ['drafts','saved','notes','days'])if(raw[key]!==undefined&&!object(raw[key]))throw new Error(`备份的 ${key} 字段格式不正确。`);
  const hasLegacy=data.legacyVocabulary!==undefined&&data.legacyVocabulary!==null;
  if(hasLegacy&&!object(data.legacyVocabulary))throw new Error('原词间日和词汇进度格式不正确。');
  const reading=validateState(raw);
  return {reading,legacyVocabulary:hasLegacy?data.legacyVocabulary:null,hasLegacy,summary:{passages:reading.imported.length,words:Object.keys(reading.words).length,questions:Object.keys(reading.saved).length}};
}
export function mergeBackupState(current,backup,{restoreProfile=false}={}){
  const b=backup.reading,merged={...current,profile:restoreProfile?b.profile:current.profile,imported:[...new Map([...current.imported,...b.imported].map(p=>[p.id,p])).values()],attempts:{...current.attempts},drafts:{...current.drafts,...b.drafts},saved:{...current.saved,...b.saved},words:{...current.words,...b.words},notes:{...current.notes,...b.notes},days:{...current.days,...b.days}};
  if(merged.imported.length>150)throw new Error('合并后超过150篇材料，请先导出备份并整理题库；当前记录未改变。');
  for(const [id,arr]of Object.entries(b.attempts)){if(!Array.isArray(arr))throw new Error('备份中的练习记录格式不正确。');merged.attempts[id]=[...new Map([...(Array.isArray(current.attempts[id])?current.attempts[id]:[]),...arr].filter(a=>a&&typeof a.id==='string').map(a=>[a.id,a])).values()];}
  return validateState(merged);
}
export function restoreBackup(storage,current,backup,{restoreProfile=false,restoreLegacy=false}={}){
  const merged=mergeBackupState(current,backup,{restoreProfile}),keys=[STORAGE_KEY,...(restoreLegacy&&backup.hasLegacy?['wordsInBloomData']:[])];
  const old=new Map(keys.map(k=>[k,storage.getItem(k)]));
  try{storage.setItem(STORAGE_KEY,JSON.stringify(merged));if(keys.length>1)storage.setItem('wordsInBloomData',JSON.stringify(backup.legacyVocabulary));}
  catch{let rollbackFailed=false;for(const key of keys){try{old.get(key)===null?storage.removeItem(key):storage.setItem(key,old.get(key));}catch{rollbackFailed=true;}}throw new Error(rollbackFailed?'存储空间不足，恢复未完成，请保留备份并检查当前记录。':'存储空间不足或浏览器禁止写入，已保留恢复前的记录。');}
  return merged;
}
