// Analysis is staged in memory. A caller saves only the fully validated result.
const clone = value => JSON.parse(JSON.stringify(value));
const text = value => typeof value === 'string' && value.trim().length > 0;
const chinese = value => text(value) && /[\u3400-\u9fff]/.test(value);
const abort = signal => { if (signal?.aborted) throw new DOMException('已取消解析，原材料仍保留。', 'AbortError'); };

// Request only the text needed by the analysis service. Existing annotations,
// imported rawText, notes and other local passage metadata stay in the browser.
export function analysisPayload(passage, includeTranslations = false) {
  return {
    id: passage.id, title: passage.title, answerStatus: passage.answerStatus, type: passage.type,
    paragraphs: passage.paragraphs.map(paragraph => paragraph.map(s => ({
      en: s.en, ...(includeTranslations ? { zh: s.zh || '' } : {}),
    }))),
    questions: passage.questions.map(q => ({
      id: q.id, number: q.number, stem: q.stem, options: [...q.options],
      answer: q.answer, incomplete: !!q.incomplete, evidence: [...(q.evidence || [])],
    })),
  };
}

export function sentenceIdentities(passage) {
  let number = 0;
  return passage.paragraphs.flatMap((paragraph, p) => paragraph.map((s, i) => ({
    id: `p${p + 1}s${i + 1}`, paragraph: p + 1, sentence: i + 1, number: ++number, en: s.en,
  })));
}

export function analysisCompleteness(passage) {
  const sentences = passage?.paragraphs?.flat() || [];
  let score = 0;
  for (const s of sentences) {
    if (chinese(s.zh)) score += 3;
    if (s.grammar?.some(g => text(g.label) && text(g.detail))) score += 2;
    if (s.chunks?.some(c => text(c.en) && chinese(c.zh))) score += 1;
  }
  if (chinese(passage?.summary)) score += 3;
  if (passage?.structure?.length >= passage?.paragraphs?.length && passage.structure.every(s => text(s.label) && chinese(s.description))) score += 3;
  if (passage?.vocabulary?.some(v => text(v.word) && chinese(v.meaning))) score += 2;
  return score;
}

export function hasCompleteAnalysis(passage) {
  const sentences = passage?.paragraphs?.flat() || [];
  return sentences.length > 0 && sentences.every(s => chinese(s.zh)
    && s.grammar?.some(g => text(g.label) && text(g.detail))
    && s.chunks?.some(c => text(c.en) && chinese(c.zh)))
    && chinese(passage.summary) && passage.structure?.length >= passage.paragraphs.length
    && passage.structure.every(s => text(s.label) && chinese(s.description))
    && passage.vocabulary?.some(v => text(v.word) && chinese(v.meaning));
}

export function mergeAnalysis(original, incoming) {
  const before = sentenceIdentities(original), after = sentenceIdentities(incoming);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('解析改变了原文分句，已保留原材料，请重试。');
  const result = clone(original);
  result.paragraphs = original.paragraphs.map((paragraph, p) => paragraph.map((s, i) => ({
    ...s, zh: incoming.paragraphs[p][i].zh, grammar: clone(incoming.paragraphs[p][i].grammar), chunks: clone(incoming.paragraphs[p][i].chunks),
  })));
  for (const key of ['titleZh', 'summary', 'structure', 'vocabulary', 'analysisMode', 'analysisNotice']) {
    if (incoming[key] !== undefined) result[key] = clone(incoming[key]);
  }
  // Keep answers, question IDs, source, and all original sentence positions stable.
  if (Array.isArray(incoming.questions)) {
    if (incoming.questions.length !== original.questions.length) throw new Error('解析改变了题目数量，已保留原材料。');
    result.questions = original.questions.map((q, i) => {
      const next = incoming.questions[i];
      if (q.stem !== next.stem || JSON.stringify(q.options) !== JSON.stringify(next.options)) throw new Error('解析改变了题干或选项，已保留原材料。');
      const value = { ...q };
      for (const key of ['stemZh', 'optionsZh', 'explanation', 'evidence', 'distractors', 'paraphrase']) {
        // A free overview can echo question identity without new explanations.
        // Its empty default fields must not clear useful existing explanations.
        if (Array.isArray(next[key]) ? next[key].length > 0 : text(next[key])) value[key] = clone(next[key]);
      }
      return value;
    });
  }
  return result;
}

export async function generatePassageAnalysis(passage, { api, config = {}, profile = {}, signal, onProgress = () => {} } = {}) {
  const original = clone(passage), result = clone(passage), identities = sentenceIdentities(original);
  if (!identities.length) throw new Error('没有可解析的英文原文。');
  const totalSteps = Math.ceil(identities.length / 6) + 1;
  const provider = config.provider || 'free';
  const sentencePayload = analysisPayload(original);
  let done = 0, notice = '';
  const progress = message => { abort(signal); onProgress({ completed: done, total: totalSteps, message, progress: done / totalSteps }); };
  for (let offset = 0; offset < identities.length; offset += 6) {
    abort(signal);
    const batch = identities.slice(offset, offset + 6);
    progress(`正在${provider === 'free' ? '免费联网翻译与自动拆句' : '生成逐句讲解'} · 第 ${offset + 1}—${offset + batch.length} / ${identities.length} 句`);
    const response = await api('analyze', { ...config, provider, action: 'sentences', passage: sentencePayload, sentenceIds: batch.map(s => s.id), profile }, { signal });
    abort(signal);
    if (!Array.isArray(response.sentences) || response.sentences.length !== batch.length) throw new Error('逐句讲解没有完整返回，当前草稿与旧解析仍保留，请重试。');
    const returned = new Map(response.sentences.map(s => [s.id, s]));
    if (returned.size !== batch.length) throw new Error('逐句结果存在重复，未覆盖原资料。');
    for (const expected of batch) {
      const s = returned.get(expected.id);
      if (!s || s.en !== expected.en || (s.paragraph !== undefined && s.paragraph !== expected.paragraph) || (s.sentence !== undefined && s.sentence !== expected.sentence)) throw new Error('解析改变了原文或句子位置，已保留原材料。');
      if (!chinese(s.zh) || !Array.isArray(s.grammar) || !s.grammar.length
        || !s.grammar.every(g => text(g?.label) && chinese(g?.detail))
        || !Array.isArray(s.chunks) || !s.chunks.length || !s.chunks.every(c => text(c?.en) && chinese(c?.zh) && expected.en.includes(c.en))) {
        throw new Error(`第 ${expected.number} 句的翻译或语法拆解不完整，已保留原资料，请重试。`);
      }
      Object.assign(result.paragraphs[expected.paragraph - 1][expected.sentence - 1], { zh: s.zh, grammar: clone(s.grammar), chunks: clone(s.chunks) });
    }
    done += 1;
    notice = response.notice || notice;
  }
  progress('正在整理全文要点、段落结构与重点词汇…');
  const response = await api('analyze', { ...config, provider, action: 'overview', passage: analysisPayload(result, true), profile }, { signal });
  abort(signal);
  const overview = response.overview;
  if (!overview || !chinese(overview.summary) || !Array.isArray(overview.structure)
    || overview.structure.length !== original.paragraphs.length || !overview.structure.every(s => text(s?.label) && chinese(s?.description))
    || !Array.isArray(overview.vocabulary) || !overview.vocabulary.length || !overview.vocabulary.every(v => text(v?.word) && chinese(v?.meaning))) {
    throw new Error('全文结构或词汇讲解没有完整返回，当前草稿与旧解析仍保留，请重试。');
  }
  Object.assign(result, { titleZh: overview.titleZh || original.titleZh, summary: overview.summary, structure: overview.structure, vocabulary: overview.vocabulary, questions: overview.questions || original.questions, analysisMode: provider === 'free' ? 'online' : 'ai', analysisNotice: response.notice || notice });
  const merged = mergeAnalysis(original, result);
  if (!hasCompleteAnalysis(merged)) throw new Error('解析尚未完整，未覆盖原材料。');
  done += 1;
  progress('全部完成：逐句翻译、自动语法、全文要点与词汇已就绪。');
  return merged;
}
