import assert from 'node:assert/strict';
import { parseReadingCollection, parseReadingText, normalizePassage, flatten, sentences, emptyState, validateState } from '../public/reading/core.js';
import { seedPassages } from '../public/reading/content.js';

const english = 'Students can learn unfamiliar ideas by reading a passage carefully. They should compare the evidence before choosing an answer.';
const options = ['A careful comparison', 'An unsupported assumption', 'A completely different subject', 'A change in the question'];
const question = (number, style = 'brackets', stem = 'What does the passage suggest?') => {
  const labels = style === 'brackets' ? ['[A]', '[B]', '[C]', '[D]'] : style === 'parentheses' ? ['A)', 'B)', 'C)', 'D)'] : ['A.', 'B.', 'C.', 'D.'];
  return `${number}.${stem}\n${options.map((text, index) => labels[index] + text).join('\n')}`;
};

// Regression: five consecutive scanned pages, including a table of cloze
// options, page furniture, reading continuations, and an incomplete Text 3.
const clozeParagraphs = Array.from({ length: 5 }, (_, index) => {
  const start = index * 4 + 1;
  return `People sometimes find it __${start}__ to ask for help. A friend may __${start + 1}__ carefully and offer a __${start + 2}__ answer, making a difficult problem seem more __${start + 3}__.`;
});
const clozeOptions = Array.from({ length: 20 }, (_, index) => Array.from('ABCD', letter => `choice-${index + 1}-${letter}`));
const clozeRows = clozeOptions.map((items, index) => `${index + 1}. ${items.map((text, letter) => `[${'ABCD'[letter]}]${text}`).join(' ')}`);
const reading1Paragraphs = ['U. S. customers can compare several choices before paying for a service. Clear information helps them make an informed decision.', 'A request made before the service can influence that decision. The timing therefore deserves attention.'];
const reading2Paragraphs = ['Local communities have different needs that a single plan may fail to address. Researchers should examine both local experience and wider resources.', 'A useful reform requires evidence as well as a practical way to improve services. This does not mean that every region must use an identical method.'];
const reading3Paragraphs = ['Heat action plans can help local officials prepare for difficult summer conditions. Each plan should account for the people and services in the area.', 'Implementation is not always consistent across regions. In some areas, high daytime'];
const pages = [
  `2025年全国硕士研究生招生考试\n英语（二）真题\nSection I Use of English\nDirections: Read the following text. Choose the best word(s) for each numbered blank and\nmark A, B, C or D on the ANSWER SHEET. (10 points)\n\n${clozeParagraphs.join('\n\n')}\n\n${clozeRows.slice(0, 2).join('\n')}\n1`,
  `Page 2\n${clozeRows.slice(2).join('\n')}\n\nSection II Reading Comprehension\nPart A\nDirections: Read the following four texts. Answer the questions below each text by choosing\nA, B, C or D. Mark your answers on the ANSWER SHEET. (40 points)\nText 1\n${reading1Paragraphs[0]}`,
  `第3页\n${reading1Paragraphs[1]}\n\n${Array.from({ length: 5 }, (_, index) => question(index + 21)).join('\n\n')}\n\nText 2\n${reading2Paragraphs[0]}`,
  `Page 4 of 5\n${reading2Paragraphs[1]}\n\n${Array.from({ length: 5 }, (_, index) => question(index + 26, 'parentheses')).join('\n\n')}\n\nText 3\n${reading3Paragraphs[0]}`,
  `5\n${reading3Paragraphs[1]}`,
];
const mixedRaw = pages.join('\n\n');
const mixed = parseReadingCollection(mixedRaw, '五页扫描试卷');
assert.equal(mixed.passages.length, 4);
assert.deepEqual(mixed.passages.map(passage => passage.questions.length), [20, 5, 5, 0]);
assert.deepEqual(mixed.passages.flatMap(passage => passage.questions.map(q => q.number)), Array.from({ length: 30 }, (_, index) => index + 1));
assert.equal(mixed.passages.flatMap(passage => passage.questions).flatMap(q => q.options).length, 120);
assert.deepEqual(mixed.passages[0].questions.map(q => q.options), clozeOptions);
assert(mixed.passages[0].questions.every(q => q.type === '完形填空' && !q.incomplete && q.stem.includes(String(q.number))));
assert.equal(flatten(mixed.passages[0]).map(s => s.en).join(' '), clozeParagraphs.join(' '));
for (const [index, expected] of [reading1Paragraphs, reading2Paragraphs, reading3Paragraphs].entries()) assert.equal(flatten(mixed.passages[index + 1]).map(s => s.en).join(' '), expected.join(' '));
assert(mixed.passages.every(passage => passage.answerStatus === 'unverified'));
assert.equal(mixed.passages[3].incomplete, true);
assert(flatten(mixed.passages[3]).at(-1).en.endsWith('In some areas, high daytime'));
assert(mixed.warnings.some(warning => warning.includes('截断')));
assert(mixed.warnings.some(warning => warning.includes('页码')));
assert.equal(mixed.rawText, mixedRaw);
assert.throws(() => parseReadingText(mixedRaw), /4 篇/);

// Standard question forms and common OCR label variants must preserve all
// four options, rather than silently storing a zero-question passage.
for (const style of ['brackets', 'parentheses', 'periods']) {
  const p = parseReadingText(`Passage: Label variants\n\n${english}\n\n${question(21, style)}`);
  assert.equal(p.questions.length, 1);
  assert.equal(p.questions[0].number, 21);
  assert.deepEqual(p.questions[0].options, options);
  assert.equal(p.answerStatus, 'unverified');
}
const inline = parseReadingText(`${english}\n\n21.What does the passage suggest? A.One B.Two C.Three D.Four\n答案：21.C`);
assert.deepEqual(inline.questions[0].options, ['One', 'Two', 'Three', 'Four']);
assert.equal(inline.questions[0].answer, 'C');
assert.equal(inline.answerStatus, 'verified');
const wide = parseReadingText(`${english}\n\n２１．What is suggested?\nＡ）One\nＢ）Two\nＣ）Three\nＤ）Four`);
assert.deepEqual(wide.questions[0].options, ['One', 'Two', 'Three', 'Four']);
const wrapped = parseReadingText(`${english}\n\n(21)\nAccording to Dr. A. Smith, what should students do?\n(A) Compare the evidence\ncarefully before choosing\n(B) Guess immediately\n(C) Ignore the passage\n(D) Change the topic`);
assert.equal(wrapped.questions[0].stem, 'According to Dr. A. Smith, what should students do?');
assert.equal(wrapped.questions[0].options[0], 'Compare the evidence carefully before choosing');
const markdown = parseReadingText(`# Learning notes\n\n${english}\n\n**21. What matters?**\n- A. Evidence\n- B. Guessing\n- C. Speed alone\n- D. Colors`);
assert.equal(markdown.title, 'Learning notes');
assert.equal(markdown.questions[0].stem, 'What matters?');
assert.deepEqual(markdown.questions[0].options, ['Evidence', 'Guessing', 'Speed alone', 'Colors']);

// A missing label cannot shift C into B, and a truncated D cannot be invented.
const gap = parseReadingCollection(`${english}\n\n21.What is important?\n[A]Evidence\n[C]Guessing\n[D]Colors\n答案：21.A`);
assert.deepEqual(gap.passages[0].questions[0].options, ['Evidence', '', 'Guessing', 'Colors']);
assert.equal(gap.passages[0].questions[0].incomplete, true);
assert.equal(gap.passages[0].questions[0].answer, null);
assert(gap.warnings.some(warning => warning.includes('21') && warning.includes('B')));
const cut = parseReadingCollection(`${english}\n\n22.What is important?\nA) Evidence\nB) Guessing\nC) Colors`);
assert.deepEqual(cut.passages[0].questions[0].options, ['Evidence', 'Guessing', 'Colors', '']);
assert.equal(cut.passages[0].incomplete, true);
assert(cut.warnings.some(warning => warning.includes('22') && warning.includes('D')));

// Input line wrapping must not eat the first line as an invented title.
const wrappedBody = 'Many students learn unfamiliar ideas by reading\nthe passage carefully before comparing the evidence and choosing an answer.';
assert.equal(flatten(parseReadingText(wrappedBody)).map(s => s.en).join(' '), wrappedBody.replace('\n', ' '));
assert.deepEqual(sentences('U. S. customers read carefully. Dr. Smith agrees. Students learn.'), ['U. S. customers read carefully.', 'Dr. Smith agrees.', 'Students learn.']);

// Arrays and wrappers are multi-passage inputs; a single-passage API must
// reject them explicitly instead of selecting the first JSON entry.
const jsonA = { title: 'JSON A', paragraphs: [english, 'Another paragraph gives learners time to check their answers.'], questions: [{ number: 21, stem: 'What matters?', options, answer: 'b' }] };
const jsonB = { title: 'JSON B', paragraphs: [[{ en: english, zh: '测试中文', grammar: [{ label: '主干', detail: '保留已有讲解' }] }]], questions: [] };
for (const source of [JSON.stringify([jsonA, jsonB]), JSON.stringify({ passages: [jsonA, jsonB] })]) {
  const result = parseReadingCollection(source);
  assert.deepEqual(result.passages.map(passage => passage.title), ['JSON A', 'JSON B']);
  assert.equal(result.passages[0].paragraphs.length, 2);
  assert.equal(result.passages[0].questions[0].answer, 'B');
  assert.equal(result.passages[1].paragraphs[0][0].zh, '测试中文');
  assert.equal(result.passages[1].paragraphs[0][0].grammar[0].detail, '保留已有讲解');
  assert.throws(() => parseReadingText(source), /2 篇/);
}
assert.equal(parseReadingText(JSON.stringify({ passage: jsonA })).questions[0].number, 21);
assert.equal(parseReadingText('```json\n' + JSON.stringify(jsonA) + '\n```').title, 'JSON A');
assert.equal(parseReadingText('Passage: Old title\n\n' + english, 'Edited title').title, 'Edited title');
assert.equal(normalizePassage({ paragraphs: [english], questions: [] }).answerStatus, 'unverified');
const incompleteJSON = parseReadingText(JSON.stringify({ title: 'Cut JSON', paragraphs: [english], questions: [{ number: 30, stem: 'Question?', options: ['first', 'second'] }] }));
assert.deepEqual(incompleteJSON.questions[0].options, ['first', 'second', '', '']);
assert.equal(incompleteJSON.questions[0].incomplete, true);
assert(incompleteJSON.warnings.length);
const clozeJSON = parseReadingText(JSON.stringify({ paragraphs: ['People can __1__ unfamiliar ideas when they work together. This approach can make a challenging task easier for everyone.'], questions: [{ number: 1, options }] }));
assert.equal(clozeJSON.type, 'cloze');
assert.equal(clozeJSON.questions[0].stem, 'Choose the best word(s) for blank 1.');

// Missing and contradictory answers never become automatically scorable.
const keyedQuestions = `${question(21)}\n\n${question(22)}`;
const partial = parseReadingText(`${english}\n\n${keyedQuestions}\n答案：21.A`);
assert.deepEqual(partial.questions.map(q => q.answer), ['A', null]);
assert(partial.warnings.some(warning => warning.includes('部分题目')));
const conflicting = parseReadingText(`${english}\n\n${question(21)}\n答案：21.A 21.B`);
assert.equal(conflicting.questions[0].answer, null);
assert.equal(conflicting.answerStatus, 'unverified');
assert(conflicting.warnings.some(warning => warning.includes('冲突')));
const compact = parseReadingText(`${english}\n\n${keyedQuestions}\nAnswer Key:\nBA`);
assert.deepEqual(compact.questions.map(q => q.answer), ['B', 'A']);
const range = parseReadingText(`${english}\n\n${keyedQuestions}\n答案：21—22 CD`);
assert.deepEqual(range.questions.map(q => q.answer), ['C', 'D']);
const individualKeys = parseReadingText(`${english}\n\n${question(21)}\nAnswer: B\n\n${question(22)}\n答案：D`);
assert.deepEqual(individualKeys.questions.map(q => q.answer), ['B', 'D']);
const globalKey = parseReadingCollection(`Text 1\n${english}\n\n${question(21)}\n\nText 2\n${english}\n\n${question(26)}\n\n参考答案：21.B 26.C`);
assert.deepEqual(globalKey.passages.map(passage => passage.questions[0].answer), ['B', 'C']);
assert(globalKey.passages.every(passage => passage.answerStatus === 'verified'));
assert(!globalKey.warnings.some(warning => warning.includes('未提供可核对')));
const duplicateChoice = parseReadingText(`${english}\n\n21.Question?\n[A]First\n[A]Repeated\n[B]Second\n[C]Third\n[D]Fourth\n答案：21.A`);
assert.equal(duplicateChoice.questions[0].incomplete, true);
assert.equal(duplicateChoice.questions[0].answer, null);

// Empty/oversized inputs fail visibly, and saved import metadata survives a
// backup validation round trip rather than disappearing after a reload.
assert.throws(() => parseReadingText('Passage: Hello\nNot enough words.'));
assert.throws(() => parseReadingCollection('[]'), /没有文章/);
assert.throws(() => parseReadingCollection('[broken json]'), /JSON/);
assert.throws(() => parseReadingCollection(JSON.stringify({paragraphs:[english],questions:{q1:{}}})), /questions/);
assert.throws(() => parseReadingCollection('x'.repeat(100001)), /10 万/);
assert.throws(() => normalizePassage({ paragraphs: Array.from({ length: 81 }, () => english), questions: [] }), /80 段/);
const state = emptyState();
state.imported = [...mixed.passages, incompleteJSON];
const restored = validateState(JSON.parse(JSON.stringify(state)));
assert.equal(restored.imported.length, 5);
assert.equal(restored.imported[0].questions[19].number, 20);
assert.equal(restored.imported[4].questions[0].number, 30);
assert.equal(restored.imported[4].questions[0].incomplete, true);
assert.equal(restored.imported[3].incomplete, true);
assert(restored.imported[3].warnings.some(warning => warning.includes('截断')));
for (const passage of seedPassages) assert.equal(normalizePassage(passage).questions.length, 5);

console.log('Import checks passed: five-page mixed OCR -> 4 passages / 30 questions / 120 choices; JSON collections, label variants, cloze, page furniture, incomplete choices, answer provenance, and backup round trips.');
