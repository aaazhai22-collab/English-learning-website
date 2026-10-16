export const STORAGE_KEY = 'readingLab.v1';
export const defaults = { version: 1, profile: { level: 'beginner', exam: '英语一', target: 70, minutes: 30, focus: ['syntax', 'vocabulary'], depth: 'detailed', accent: 'en-US', rate: 0.85 }, imported: [], attempts: {}, drafts: {}, saved: {}, words: {}, notes: {}, days: {} };
export function emptyState() { return JSON.parse(JSON.stringify(defaults)); }
export function readState(storage = globalThis.localStorage) {
  try { const v = JSON.parse(storage.getItem(STORAGE_KEY) || 'null'); return v ? validateState(v) : emptyState(); }
  catch { return emptyState(); }
}
export function validateState(v) {
  if (!v || v.version !== 1 || typeof v !== 'object' || Array.isArray(v)) throw new Error('不是阅读工坊 v1 备份文件');
  const s = emptyState();
  const p = v.profile || {};
  if (['beginner','intermediate','advanced'].includes(p.level)) s.profile.level = p.level;
  if (['英语一','英语二','综合英语'].includes(p.exam)) s.profile.exam = p.exam;
  s.profile.target = Math.min(100, Math.max(0, Number(p.target) || 70));
  s.profile.minutes = Math.min(180, Math.max(10, Number(p.minutes) || 30));
  s.profile.rate = Math.min(1.5, Math.max(0.5, Number(p.rate) || 0.85));
  if (['en-US','en-GB'].includes(p.accent)) s.profile.accent = p.accent;
  if (['brief','standard','detailed'].includes(p.depth)) s.profile.depth = p.depth;
  if (Array.isArray(p.focus)) s.profile.focus = p.focus.filter(x => ['syntax','vocabulary','logic','evidence','options'].includes(x)).slice(0,5);
  s.imported = (Array.isArray(v.imported) ? v.imported : []).slice(0,150).map(normalizePassage);
  for (const key of ['attempts','drafts','saved','words','notes','days']) {
    if (v[key] && typeof v[key] === 'object' && !Array.isArray(v[key])) s[key] = Object.fromEntries(Object.entries(v[key]).filter(([k]) => !['__proto__','constructor','prototype'].includes(k)));
  }
  return s;
}
export const clean = (v, max = 3000) => typeof v === 'string' ? v.slice(0, max).trim() : '';
export const escapeHTML = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeURL(v) { try { const u = new URL(v); return ['https:','http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; } }
export function sentences(text) {
  return String(text).replace(/\r/g,'').trim().split(/(?<=[.!?])\s+(?=[A-Z“"'(])/).map(x=>x.trim()).filter(Boolean);
}
export function normalizePassage(input) {
  if (!input || typeof input !== 'object') throw new Error('文章数据格式不正确');
  const s = input;
  let paragraphs = [];
  if (Array.isArray(s.paragraphs)) paragraphs = s.paragraphs.slice(0,80).map(p => (Array.isArray(p) ? p : []).slice(0,80).map(x => typeof x === 'string' ? {en:x} : x).filter(x=>x && clean(x.en)).map(x=>({en:clean(x.en,6000),zh:clean(x.zh,6000),grammar:(Array.isArray(x.grammar)?x.grammar:[]).slice(0,12).map(g=>({label:clean(g.label,100),detail:clean(g.detail,2000)})),chunks:(Array.isArray(x.chunks)?x.chunks:[]).slice(0,20).map(c=>({en:clean(c.en,2000),zh:clean(c.zh,2000)}))}))).filter(p=>p.length);
  if (!paragraphs.length) throw new Error('没有识别到英文正文，请检查文章内容');
  const count = paragraphs.flat().length;
  const questions = (Array.isArray(s.questions) ? s.questions : []).slice(0,50).map((q,i)=>{
    if (!q || !clean(q.stem) || !Array.isArray(q.options) || q.options.length !== 4 || !q.options.every(o=>typeof o === 'string' && o.trim())) throw new Error(`第 ${i+1} 题需要题干与四个非空选项`);
    return {id:`q${i+1}`,type:clean(q.type,40)||'阅读理解',stem:clean(q.stem),stemZh:clean(q.stemZh),options:q.options.map(o=>clean(o)),optionsZh:(Array.isArray(q.optionsZh)?q.optionsZh:[]).slice(0,4).map(o=>clean(o)),answer:/^[A-D]$/.test(q.answer)?q.answer:null,evidence:(Array.isArray(q.evidence)?q.evidence:[]).filter(n=>Number.isInteger(n)&&n>0&&n<=count),explanation:clean(q.explanation,6000),distractors:(Array.isArray(q.distractors)?q.distractors:[]).slice(0,4).map(o=>clean(o)),skill:['vocabulary','syntax','logic','evidence','options'].includes(q.skill)?q.skill:'evidence',paraphrase:(Array.isArray(q.paraphrase)?q.paraphrase:[]).slice(0,8).map(p=>({original:clean(p.original),option:clean(p.option)}))};
  });
  const vocabulary=(Array.isArray(s.vocabulary)?s.vocabulary:[]).slice(0,200).filter(v=>v&&clean(v.word)).map(v=>({word:clean(v.word,120),pos:clean(v.pos,40),meaning:clean(v.meaning,1000),phrase:clean(v.phrase,1000)}));
  return {id:clean(s.id,100)||`import-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,title:clean(s.title,250)||'我的阅读材料',titleZh:clean(s.titleZh,250),source:clean(s.source,300)||'个人导入',sourceUrl:safeURL(s.sourceUrl),sourceType:['user','original','import','web'].includes(s.sourceType)?s.sourceType:'import',level:clean(s.level,40)||'自选',exam:clean(s.exam,60)||'自选材料',topic:clean(s.topic,60)||'我的导入',summary:clean(s.summary,6000),structure:(Array.isArray(s.structure)?s.structure:[]).slice(0,50).map(t=>({label:clean(t.label,100),description:clean(t.description,2000)})),paragraphs,vocabulary,questions,answerStatus:s.answerStatus === 'unverified' ? 'unverified' : 'verified',analysisMode:clean(s.analysisMode,40)||'curated',createdAt:clean(s.createdAt,80)||new Date().toISOString()};
}
export function parseReadingText(raw, title = '') {
  if (raw.length > 100000) throw new Error('一次导入请控制在 10 万字符以内');
  let text=raw.replace(/\r\n?/g,'\n').trim();
  if (!text) throw new Error('请先粘贴文章和题目');
  if (/^[\[{]/.test(text)) { let j; try { j=JSON.parse(text); } catch { throw new Error('JSON格式不正确，请检查逗号、引号与括号'); } return normalizePassage(Array.isArray(j)?j[0]:j); }
  const keyIndex=text.search(/^(?:参考答案|答案|Answers?|Answer\s*Key)\s*[:：]/im);
  const keyText=keyIndex>=0?text.slice(keyIndex):'';
  if(keyIndex>=0)text=text.slice(0,keyIndex).trim();
  const questionStart=text.search(/^\s*(?:Question\s*)?\d+[.)、．]\s+\S/m);
  let body=questionStart>=0?text.slice(0,questionStart).trim():text;
  let questionText=questionStart>=0?text.slice(questionStart):'';
  let lines=body.split('\n');
  let inferred='';
  if (/^(?:Passage|Title|标题|文章标题)\s*[:：]/i.test(lines[0])) inferred=lines.shift().replace(/^[^:：]+[:：]\s*/,'');
  else if(lines.length>1&&lines[0].trim().length<130&&!/[.!?。]$/.test(lines[0].trim()))inferred=lines.shift().trim();
  body=lines.join('\n').trim();
  if ((body.match(/[a-zA-Z]+/g)||[]).length<15)throw new Error('正文太短，至少需要一段英文文章');
  const paragraphs=body.split(/\n\s*\n/).filter(Boolean).map(p=>sentences(p.replace(/\n/g,' ')).map(en=>({en,zh:'',grammar:syntaxHints(en),chunks:[]})));
  const questions=[];
  const blocks=[...questionText.matchAll(/^\s*(?:Question\s*)?(\d+)[.)、．]\s+([\s\S]*?)(?=^\s*(?:Question\s*)?\d+[.)、．]\s+|$(?![\s\S]))/gm)];
  for(const [_,number,rawBlock] of blocks){
    const block=rawBlock.replace(/[ \t]+([A-D])[.)、．]\s+/g,'\n$1. ');
    const options=[...block.matchAll(/^\s*([A-D])[.)、．]\s+([\s\S]*?)(?=^\s*[A-D][.)、．]\s+|$(?![\s\S]))/gm)];
    if(options.length!==4||options.map(x=>x[1]).join('')!=='ABCD')throw new Error(`第${number}题未识别到完整A—D选项。请每个选项单独一行，题号使用“1. ”格式`);
    const stem=block.slice(0,options[0].index).trim();
    const key=keyText.match(new RegExp(`(?:^|[\\s,，;；:：])${number}\\s*[.、:：)\\-]?\\s*([A-D])\\b`,'im'));
    questions.push({stem,options:options.map(o=>o[2].trim()),answer:key?key[1]:null});
  }
  return normalizePassage({title:title||inferred||'我的阅读材料',paragraphs,questions,sourceType:'import',source:'个人文本导入',analysisMode:'rules',answerStatus:'verified'});
}
export function syntaxHints(en) {
  const out=[];
  if(/\b(however|nevertheless|yet|but|although|despite)\b/i.test(en))out.push({label:'转折线索',detail:'先找转折前后各在说什么，再判断作者重点。连接词只是线索，不代表后面必然是答案。'});
  if(/\b(therefore|thus|because|since|as a result)\b/i.test(en))out.push({label:'因果线索',detail:'尝试用“因为……所以……”还原两部分；since、as等词也可能表达时间，需要结合语境。'});
  if(/\b(am|is|are|was|were|be|been)\s+(?:\w+ly\s+)?\w+(?:ed|en)\b/i.test(en))out.push({label:'可能的被动结构',detail:'检查be后面的过去分词，判断主语是否是动作的承受者。此处为规则提示，也可能是形容词表语。'});
  if(/\b(that|which|who|whose|where)\b/i.test(en))out.push({label:'从句边界',detail:'标出连接词前后的部分；先读主句，再判断从句是在修饰名词、说明内容，还是充当宾语。规则不能替代具体句法判断。'});
  if((en.match(/\b[a-zA-Z]+\b/g)||[]).length>28)out.push({label:'长句阅读',detail:'先找主语与谓语，暂时移开逗号间的插入内容、介词短语和从句，再把修饰信息补回。'});
  return out;
}
export function flatten(p) { let n=0;return p.paragraphs.flatMap((para,i)=>para.map(s=>({...s,number:++n,paragraph:i+1}))); }
export function wordsCount(p) { return (flatten(p).map(s=>s.en).join(' ').match(/\b[A-Za-z]+(?:['’-][A-Za-z]+)*\b/g)||[]).length; }
export function statistics(state) {
  const all=Object.values(state.attempts).flat().filter(a=>a&&a.answers);
  const first=Object.values(state.attempts).map(list=>Array.isArray(list)?list.find(a=>a&&a.mode!=='review'):null).filter(Boolean);
  const skills=Object.fromEntries(['vocabulary','syntax','logic','evidence','options'].map(k=>[k,{total:0,wrong:0}]));
  let correct=0,total=0;
  const independent=Object.values(state.attempts).map(list=>Array.isArray(list)?list.find(a=>a&&a.mode==='exam'&&!a.helped):null).filter(Boolean);
  for(const a of independent)for(const q of Object.values(a.answers||{})){if(q.correct===null||q.correct===undefined)continue;total++;if(q.correct)correct++;}
  for(const a of first)for(const q of Object.values(a.answers)){
    if(q.correct===null||q.correct===undefined)continue;
    const skill=q.cause||q.skill||'evidence';
    if(skills[skill]){skills[skill].total++;if(!q.correct||q.confidence==='low')skills[skill].wrong++;}
  }
  return {attempts:all.length,completed:first.length,total,correct,accuracy:total?Math.round(correct/total*100):null,skills,minutes:Math.round(all.reduce((sum,a)=>sum+(Number(a.seconds)||0),0)/60)};
}
export function recommendation(state) {
  const st=statistics(state);
  const entries=Object.entries(st.skills).filter(([,v])=>v.wrong>0).sort((a,b)=>b[1].wrong-a[1].wrong);
  const skill=entries[0]?.[0]||state.profile.focus[0]||'syntax';
  const texts={syntax:'先找到一句长句的主语和谓语，再补回从句与修饰语。',vocabulary:'把原文词组与选项中的同义表达成对记录，再遮住中文回忆。',logic:'标出转折、因果和举例，尝试用一句中文说明每段的作用。',evidence:'选答案后，回到原文找一句能直接支持它的证据。',options:'对比易混选项的范围、程度与因果关系，找出被改动的关键词。'};
  return {skill,text:texts[skill],basis:entries.length?'根据已提交练习中的可能错因推荐；可在解析中修正错因。':'先按你的学习画像推荐，完成练习后再逐步调整。',tentative:firstCount(state)<3};
}
function firstCount(s){return Object.keys(s.attempts).length;}
