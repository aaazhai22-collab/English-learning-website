/** Pure import parser. It never invents source text, answers, or missing options. */
const LETTERS = 'ABCD';
const unique = values => [...new Set(values.filter(Boolean))];
const squash = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const warnTitle = (title, warning) => `${title || '阅读材料'}：${warning}`;

export function splitEnglishSentences(value) {
  const marker = '\uE000';
  let text = String(value ?? '').trim();
  if (!text) return [];
  // Protect common abbreviations and spaced initials such as “U. S.”.
  text = text.replace(/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|No|Fig|vs|etc)\./gi, match => match.replace(/\./g, marker));
  text = text.replace(/\b(?:[A-Za-z]\.\s*){2,}/g, match => match.replace(/\./g, marker));
  return text.split(/(?<=[.!?]["”’')\]]?)\s+(?=[A-Z“"'(])/)
    .map(part => part.replaceAll(marker, '.').trim()).filter(Boolean);
}

function prepareText(raw) {
  if (typeof raw !== 'string') throw new Error('导入内容需要是文本或 JSON 字符串');
  if (raw.length > 100000) throw new Error('一次导入请控制在 10 万字符以内，请按篇或按试卷部分拆分');
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\f/g, '\n\n').replace(/\u00a0/g, ' ').trim();
  if (!text) throw new Error('请先粘贴文章和题目，或识别图片');
  return text;
}

function halfWidthMarkers(line) {
  return line.replace(/[０-９Ａ-Ｄ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0));
}

function questionMarker(line) {
  const match = line.match(/^\s*(?:(?:Question|Q)\s*)?(?:(\d{1,3})\s*[.)、．:：）]|[（(]\s*(\d{1,3})\s*[)）]|\[\s*(\d{1,3})\s*\])\s*(.*)$/i);
  if (!match) return null;
  const number = Number(match[1] || match[2] || match[3]);
  return number > 0 && number <= 300 ? { number, text: match[4] } : null;
}

function optionTokens(line) {
  const regex = /\[\s*([A-D])\s*\]|[（(]\s*([A-D])\s*[)）]|(?:^|[ \t]+)([A-D])\s*[.)、．:：）]/g;
  const tokens = [];
  let match;
  while ((match = regex.exec(line))) tokens.push({ letter: match[1] || match[2] || match[3], index: match.index, end: regex.lastIndex, bracketed: !!(match[1] || match[2]) });
  if (tokens.length === 1 && !tokens[0].bracketed && line.slice(0, tokens[0].index).trim()) return [];
  return tokens;
}

function parseAnswerKey(lines, questionNumbers, warnings) {
  const text = lines.join('\n');
  const answers = new Map();
  const conflicts = new Set();
  const store = (number, answer) => {
    if (conflicts.has(number)) return;
    if (answers.has(number) && answers.get(number) !== answer) {
      warnings.push(`第 ${number} 题出现冲突的参考答案，暂不采用任一答案，请核实`);
      answers.set(number, null); conflicts.add(number); return;
    }
    answers.set(number, answer);
  };
  for (const match of text.matchAll(/(?:^|[\s,，;；:：])(\d{1,3})\s*[.、．:：)）\-]?\s*([A-D])(?=$|[\s,，;；.。]|\d)/gi)) {
    const number = Number(match[1]), answer = match[2].toUpperCase();
    store(number, answer);
  }
  for (const match of text.matchAll(/(\d{1,3})\s*[-–—~～]\s*(\d{1,3})\s*[:：]?\s*([A-D](?:[\s,，]*[A-D])*)/gi)) {
    const start = Number(match[1]), end = Number(match[2]), letters = match[3].replace(/[^A-D]/gi, '').toUpperCase();
    if (end < start || end - start >= 100 || letters.length !== end - start + 1) { warnings.push('分组答案的题号范围与答案数量不一致，请逐题校对'); continue; }
    [...letters].forEach((answer, index) => store(start + index, answer));
  }
  if (!answers.size && text.trim()) {
    const compact = text.replace(/[^A-Za-z]/g, '').toUpperCase();
    if (/^[A-D]+$/.test(compact) && compact.length === questionNumbers.length) questionNumbers.forEach((number, index) => store(number, compact[index]));
    else warnings.push('检测到答案区域，但未识别出可对应题号的 A—D 答案，请手动校对');
  }
  return answers;
}

function splitUnits(text) {
  const units = [], warnings = [];
  const make = (kind = 'reading', title = '') => ({ kind, title, lines: [], answerLines: [], rawLines: [] });
  let current = make(), inAnswers = false, directions = false;
  const finish = () => { if (current.lines.some(line => line.trim()) || current.answerLines.length) units.push(current); };
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const original = lines[index];
    let line = halfWidthMarkers(original).trim();
    const markdownHeading = line.match(/^#{1,6}\s+(.+)$/);
    if (markdownHeading) line = markdownHeading[1].trim();
    line = line.replace(/^[-*+]\s+(?=(?:\[[A-D]\]|[A-D][.)、．]|\d+[.)、．]))/, '');
    line = line.replace(/^\*\*(?=\d|Question|[A-D][.)])/, '').replace(/\*\*$/, '');
    if (/^\|.*(?:\[[A-D]\]|[A-D][.)]).*\|$/.test(line)) line = line.replace(/^\||\|$/g, '').replace(/\s*\|\s*/g, ' ').trim();
    if (/^Section\s*(?:I|1)\s+Use\s+of\s+English\b/i.test(line)) {
      finish(); current = make('cloze', '完形填空'); inAnswers = directions = false; current.rawLines.push(original); continue;
    }
    if (/^Section\s*(?:II|2)\s+Reading\s+Comprehension\b/i.test(line)) {
      finish(); current = make(); inAnswers = directions = false; continue;
    }
    const numberedTitle = line.match(/^(?:Text|Passage|Reading)\s*(\d+)(?:\s*[:：—-]\s*(.+))?$/i);
    const explicitTitle = line.match(/^(?:Passage|Title|标题|文章标题)\s*[:：]\s*(.+)$/i);
    if (numberedTitle || explicitTitle || (markdownHeading && !current.lines.some(value => value.trim()) && !/^Part\s+[A-Z]$/i.test(line))) {
      finish();
      current = make('reading', explicitTitle ? explicitTitle[1] : numberedTitle ? `Text ${numberedTitle[1]}${numberedTitle[2] ? ' · ' + numberedTitle[2] : ''}` : line);
      current.rawLines.push(original); inAnswers = directions = false; continue;
    }
    if (/^(?:\d{4}\s*年.*(?:研究生.*考试|考研英语.*(?:真题|试卷))|全国硕士研究生.*考试|英语\s*[（(]\s*[一二12ⅠⅡ]+\s*[)）]\s*(?:真题|试卷)?|Part\s+[A-Z])\s*$/i.test(line)) { warnings.push('已排除页眉或试卷分区标题；原始文本仍保留供校对'); continue; }
    if (/^(?:第\s*\d+\s*页(?:\s*[\/共]\s*\d+\s*页?)?|Page\s+\d+(?:\s*(?:of|\/)\s*\d+)?)$/i.test(line)) { warnings.push('已排除独立页码；请在原始文本中核对分页处是否接续'); continue; }
    if (/^\d{1,3}$/.test(line)) {
      const next = lines.slice(index + 1).find(value => value.trim()) || '';
      if (optionTokens(halfWidthMarkers(next.trim())).length) line += '.';
      else { warnings.push('已排除独立页码；请在原始文本中核对分页处是否接续'); continue; }
    }
    current.rawLines.push(original);
    const keyHeading = line.match(/^(?:参考答案|正确答案|答案|Answer\s*Key|Answers?)\s*[:：]?\s*(.*)$/i);
    if (keyHeading) {
      const individual = keyHeading[1].trim().match(/^\[?([A-D])\]?\s*$/i);
      const previous = current.lines.map(questionMarker).filter(Boolean).at(-1);
      if (individual && previous) { current.answerLines.push(`${previous.number}.${individual[1].toUpperCase()}`); inAnswers = false; }
      else { inAnswers = true; current.answerLines.push(keyHeading[1]); }
      continue;
    }
    if (inAnswers) {
      const marker = questionMarker(line);
      if (marker && marker.text && !/^\[?[A-D]\]?\s*[.;。]?$/i.test(marker.text)) inAnswers = false;
      else { current.answerLines.push(line); continue; }
    }
    if (/^Directions?\s*[:：]/i.test(line)) { directions = !/\(\s*\d+\s*points?\s*\)\s*$/i.test(line); continue; }
    if (directions && /^(?:mark\b|and\s+mark\b|A\s*[,，]|Answer\b|Choose\b|Read\b|questions?\b|by\s+choosing\b|on\s+the\b|\(\s*\d+\s*points?\s*\))/i.test(line)) { if (/points?\s*\)/i.test(line)) directions = false; continue; }
    if (line) directions = false;
    current.lines.push(line);
  }
  finish();
  return { units, warnings: unique(warnings) };
}

function parseQuestion(block, kind, answers, warnings) {
  const slots = ['', '', '', ''], seen = [], stemParts = [];
  let active = -1, ambiguous = false;
  for (const line of block.lines) {
    const tokens = optionTokens(line);
    if (!tokens.length) {
      if (/^\s*[E-H][.)、．]\s*/.test(line)) { ambiguous = true; warnings.push(`第 ${block.number} 题出现 A—D 以外的选项，当前练习仅支持四选项；原文保留在原始题目中`); }
      if (active >= 0) slots[active] += ' ' + line;
      else stemParts.push(line);
      continue;
    }
    const prefix = line.slice(0, tokens[0].index).trim();
    if (prefix) { if (active >= 0) slots[active] += ' ' + prefix; else stemParts.push(prefix); }
    tokens.forEach((token, index) => {
      active = LETTERS.indexOf(token.letter);
      if (seen.includes(token.letter)) { ambiguous = true; warnings.push(`第 ${block.number} 题的 ${token.letter} 选项重复，已保留内容，请校对`); }
      seen.push(token.letter);
      slots[active] += ' ' + line.slice(token.end, tokens[index + 1]?.index ?? line.length).trim();
    });
  }
  let stem = squash(stemParts.join(' '));
  const missing = [...LETTERS].filter((letter, index) => !slots[index].trim());
  if (missing.length) warnings.push(`第 ${block.number} 题缺少 ${missing.join('、')} 选项内容，可能在下一张图片中；未补写缺失内容`);
  if (seen.length && [...new Set(seen)].join('') !== 'ABCD') warnings.push(`第 ${block.number} 题选项标签未完整按 A—D 出现，请对照原图检查`);
  if (!stem && kind === 'cloze') stem = `Choose the best word(s) for blank ${block.number}.`;
  if (!stem) warnings.push(`第 ${block.number} 题未识别到题干，请补充题干后练习`);
  return { number: block.number, type: kind === 'cloze' ? '完形填空' : '阅读理解', stem, options: slots.map(squash), answer: answers.get(block.number) || null, incomplete: !!missing.length || !stem || ambiguous, rawText: block.rawLines.join('\n') };
}

function normalizeClozeBlanks(body, numbers, warnings) {
  let result = body.replace(/_+\s*(\d{1,3})\s*_+/g, '__$1__');
  result = result.replace(/\[\s*(\d{1,3})\s*\]|[（(]\s*(\d{1,3})\s*[)）]/g, (match, a, b) => numbers.includes(Number(a || b)) ? `__${Number(a || b)}__` : match);
  // OCR sometimes sees only the numeral on an underline. Infer it only when
  // each requested numeral occurs exactly once and they occur in source order.
  if (numbers.length > 1 && !/__\d+__/.test(result)) {
    const candidates = [...result.matchAll(/\b\d{1,3}\b/g)].filter(match => numbers.includes(Number(match[0])));
    if (candidates.length === numbers.length && candidates.every((match, index) => Number(match[0]) === numbers[index])) {
      result = result.replace(/\b\d{1,3}\b/g, match => numbers.includes(Number(match)) ? `__${Number(match)}__` : match);
      warnings.push('已将完形正文中连续对应的题号数字整理为填空标记，请对照原图核实');
    }
  }
  return result;
}

function parseUnit(unit, fallbackTitle, allowShort) {
  const bodyLines = [], blocks = [], warnings = [];
  let current = null;
  for (const line of unit.lines) {
    const marker = questionMarker(line);
    if (marker) {
      if (current) blocks.push(current);
      current = { number: marker.number, lines: [marker.text], rawLines: [line] };
    } else if (current) { current.lines.push(line); current.rawLines.push(line); }
    else bodyLines.push(line);
  }
  if (current) blocks.push(current);
  let body = bodyLines.join('\n').trim();
  const count = (body.match(/[A-Za-z]+/g) || []).length;
  if (!count || (!allowShort && count < 15)) throw new Error(`${unit.title || fallbackTitle || '这篇材料'}没有足够英文正文；请把文章及接续图片一起导入，不要只上传选项页`);
  const kind = unit.kind === 'cloze' || /_+\s*\d+\s*_+/.test(body) || (blocks.length > 1 && blocks.slice(0, 2).every(block => optionTokens(block.lines[0]).length)) ? 'cloze' : 'reading';
  const numbers = blocks.map(block => block.number);
  if (new Set(numbers).size !== numbers.length) warnings.push('出现重复题号，已全部保留；请确认是否遗漏了 Text 分篇标题');
  if (kind === 'cloze') body = normalizeClozeBlanks(body, numbers, warnings);
  if (/[a-z]-\n[a-z]/.test(body)) warnings.push('检测到行末连字符，请校对它是单词断行还是原有连字符');
  const bodyIncomplete = !/[.!?]["”’')\]]?$/.test(body.trim());
  if (bodyIncomplete) warnings.push('正文结尾可能在句中截断，请补充接续图片；当前内容按原样保留');
  if (count < 15) warnings.push('本篇正文很短，可能只有试卷的截断片段，请校对后再学习');
  const answers = parseAnswerKey(unit.answerLines, numbers, warnings);
  const questions = blocks.map(block => parseQuestion(block, kind, answers, warnings));
  if (!questions.length && /(?:\[[A-D]\]|^[A-D][.)、．])/m.test(body)) warnings.push('正文中似乎包含选项，但没有识别到对应题号，请补充题号或检查分篇');
  const known = questions.filter(question => question.answer).length;
  if (questions.length && !known) warnings.push('未提供可核对的参考答案：可先精读，暂不计算答题正确率');
  else if (known < questions.length) warnings.push('部分题目未提供参考答案，这些题不计算答题正确率');
  const title = unit.title || fallbackTitle || (kind === 'cloze' ? '完形填空' : '我的阅读材料');
  return { title, paragraphs: body.split(/\n\s*\n/).filter(part => part.trim()).map(part => splitEnglishSentences(part.replace(/\n/g, ' ')).map(en => ({ en }))), questions, type: kind === 'cloze' ? 'cloze' : 'reading', source: '个人文本 / OCR 导入', sourceType: 'import', analysisMode: 'rules', answerStatus: known ? 'verified' : 'unverified', incomplete: bodyIncomplete || questions.some(question => question.incomplete), warnings: unique(warnings), rawText: unit.rawLines.join('\n') };
}

function prepareJSONPassage(input, index, originalText) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`JSON 中第 ${index + 1} 篇需要是文章对象`);
  const value = { ...input }, warnings = Array.isArray(input.warnings) ? input.warnings.filter(item => typeof item === 'string') : [];
  if (input.questions !== undefined && !Array.isArray(input.questions)) throw new Error(`JSON 中第 ${index + 1} 篇的 questions 需要是题目数组`);
  const paragraphText = JSON.stringify(input.paragraphs || input.text || '');
  const cloze = input.type === 'cloze' || /_+\s*\d+\s*_+/.test(paragraphText);
  value.questions = (Array.isArray(input.questions) ? input.questions : []).map((question, qIndex) => {
    if (!question || typeof question !== 'object') throw new Error(`第 ${index + 1} 篇的第 ${qIndex + 1} 题格式不正确`);
    const number = Number.isInteger(Number(question.number)) && Number(question.number) > 0 ? Number(question.number) : qIndex + 1;
    let options = Array.isArray(question.options) ? [...question.options] : question.options && typeof question.options === 'object' ? [...LETTERS].map(letter => question.options[letter] ?? '') : [];
    if (options.length > 4 || options.some(option => typeof option !== 'string')) throw new Error(`第 ${number} 题仅支持 A—D 四个文本选项，请校对 JSON`);
    while (options.length < 4) options.push('');
    const stem = typeof question.stem === 'string' ? question.stem : typeof question.question === 'string' ? question.question : cloze ? `Choose the best word(s) for blank ${number}.` : '';
    const incomplete = !!question.incomplete || !stem.trim() || options.some(option => !option.trim());
    if (incomplete) warnings.push(`第 ${number} 题的题干或选项不完整，已保留现有内容，需补充后练习`);
    return { ...question, number, stem, options, answer: typeof question.answer === 'string' && /^[A-D]$/i.test(question.answer.trim()) ? question.answer.trim().toUpperCase() : null, type: question.type || (cloze ? '完形填空' : '阅读理解'), incomplete, rawText: question.rawText || JSON.stringify(question) };
  });
  if (value.questions.length && !value.questions.some(question => question.answer)) warnings.push('未提供可核对的参考答案：可先精读，暂不计算答题正确率');
  value.answerStatus = input.answerStatus === 'unverified' || !value.questions.some(question => question.answer) ? 'unverified' : 'verified';
  value.incomplete = !!input.incomplete || value.questions.some(question => question.incomplete);
  value.rawText = typeof input.rawText === 'string' ? input.rawText : originalText;
  value.warnings = unique(warnings);
  return value;
}

/** Returns every detected passage. No first-item shortcut and no implicit loss. */
export function parseImportText(raw, title = '') {
  const text = prepareText(raw);
  const unwrapped = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
  if (/^[\[{]/.test(unwrapped)) {
    let json;
    try { json = JSON.parse(unwrapped); } catch { throw new Error('JSON 格式不正确，请检查逗号、引号与括号'); }
    const list = Array.isArray(json) ? json : Array.isArray(json?.passages) ? json.passages : json?.passage && typeof json.passage === 'object' ? [json.passage] : [json];
    if (!list.length) throw new Error('JSON 中没有文章，请提供至少一篇材料');
    const passages = list.map((input, index) => prepareJSONPassage(input, index, raw));
    if (title && passages.length === 1) passages[0].title = title;
    return { passages, warnings: unique(passages.flatMap(passage => passage.warnings.map(warning => warnTitle(passage.title, warning)))), rawText: raw };
  }
  const { units, warnings } = splitUnits(text);
  if (!units.length) throw new Error('没有识别到文章内容，请检查图片识别结果或粘贴正文');
  const passages = units.map((unit, index) => parseUnit(unit, units.length === 1 ? title : title ? `${title} · 材料 ${index + 1}` : '', units.length > 1));
  // A full exam often has one answer key after its final article. Match it
  // across units only when original question numbers are unambiguous.
  const allNumbers = passages.flatMap(passage => passage.questions.map(question => question.number));
  const answerLines = units.flatMap(unit => unit.answerLines);
  if (passages.length > 1 && answerLines.length && new Set(allNumbers).size === allNumbers.length) {
    const answers = parseAnswerKey(answerLines, allNumbers, warnings);
    for (const passage of passages) {
      for (const question of passage.questions) if (answers.has(question.number)) question.answer = answers.get(question.number);
      passage.answerStatus = passage.questions.some(question => question.answer && !question.incomplete) ? 'verified' : 'unverified';
      passage.warnings = passage.warnings.filter(warning => !/^(?:未提供可核对的参考答案|部分题目未提供参考答案)/.test(warning));
      const known = passage.questions.filter(question => question.answer).length;
      if (passage.questions.length && !known) passage.warnings.push('未提供可核对的参考答案：可先精读，暂不计算答题正确率');
      else if (known < passage.questions.length) passage.warnings.push('部分题目未提供参考答案，这些题不计算答题正确率');
    }
  }
  if (title && passages.length === 1) passages[0].title = title;
  return { passages, warnings: unique([...warnings, ...passages.flatMap(passage => passage.warnings.map(warning => warnTitle(passage.title, warning)))]), rawText: raw };
}
