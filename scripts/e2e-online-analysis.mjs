import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'file:///C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const base = process.env.QA_BASE || 'http://localhost:5173';
const out = '.qa/online-analysis';
await mkdir(out, { recursive: true });
const sentences = [
  'U. S. customers historically tipped the people they assumed were earning most of their income via tips, such as restaurant servers earning less than the minimum wage.',
  'In the early 2010s, a wide range of businesses started processing purchases with iPads and other digital payment systems.',
];
const raw = sentences.join(' ');
const report = { started: new Date().toISOString(), base, scenarios: [], requests: [], analysisResponses: [], pageErrors: [], note: 'Success scenarios use real application and real analysis responses without route mocks. Browser network observation cannot expose server-side outgoing requests.' };
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'] });
let realPassage;
const readState = page => page.evaluate(() => JSON.parse(localStorage.getItem('readingLab.v1')));
const check = (item, name, condition, details) => { item.checks.push({ name, passed: !!condition, details }); assert.ok(condition, name); };
const complete = p => p?.paragraphs?.flat().length === 2 && p.paragraphs.flat().every(s => /[\u3400-\u9fff]/.test(s.zh) && s.grammar?.some(g => g.label && /[\u3400-\u9fff]/.test(g.detail)) && s.chunks?.some(c => c.en && /[\u3400-\u9fff]/.test(c.zh))) && /[\u3400-\u9fff]/.test(p.summary) && p.structure?.length === 1 && p.vocabulary?.some(v => /[\u3400-\u9fff]/.test(v.meaning));
async function scenario(name, mode, fn) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const item = { name, mode, checks: [], status: 'running' };
  report.scenarios.push(item);
  page.on('pageerror', error => report.pageErrors.push({ scenario: name, message: error.message }));
  page.on('request', request => {
    const url = request.url();
    const value = { scenario: name, url, method: request.method() };
    if (url.includes('/api/reading/analyze')) {
      try { const body = request.postDataJSON(); value.analysis = { provider: body.provider, model: body.model, action: body.action, apiKeyPresent: !!body.apiKey, sentenceIds: body.sentenceIds }; } catch {}
    }
    report.requests.push(value);
  });
  page.on('response', async response => {
    if (!response.url().includes('/api/reading/analyze')) return;
    try { const body = await response.json(); report.analysisResponses.push({ scenario: name, status: response.status(), body }); } catch {}
  });
  try {
    await page.goto(base + '/#/home', { waitUntil: 'networkidle' });
    await fn(page, item);
    item.status = 'passed'; console.log('PASS', name);
  } catch (error) {
    item.status = 'failed'; item.error = error.stack || String(error);
    await page.screenshot({ path: `${out}/${name}-failure.png`, fullPage: true }).catch(() => {});
    console.error('FAIL', name, error.message);
  } finally {
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
    await context.close();
  }
}
async function importRaw(page, title) {
  await page.goto(base + '/#/import');
  await page.locator('#import-mode-text').click();
  await page.locator('#import-title').fill(title);
  await page.locator('#import-text').fill(raw);
  await page.locator('[data-action="parse-import"]').click();
  await page.locator('#import-preview').waitFor();
}
async function waitImported(page) {
  await page.waitForFunction(() => location.hash.startsWith('#/read/') || !!document.querySelector('#import-error')?.textContent.trim(), undefined, { timeout: 180000 });
  if (!page.url().includes('#/read/')) throw new Error('Real online import did not complete: ' + await page.locator('#import-error').textContent());
}
async function waitSavedAnalysis(page) {
  await page.waitForFunction(() => !document.querySelector('[data-action="cancel-saved-analysis"]'), undefined, { timeout: 180000 });
}
async function screenshots(page, name, item) {
  await page.locator('#toast.visible').waitFor({ state: 'hidden', timeout: 6000 });
  await page.getByRole('tab', { name: '逐句精读', exact: true }).click();
  if (!(await page.locator('#toggle-translation').isChecked())) await page.locator('#toggle-translation').check();
  if (!(await page.locator('#toggle-chunks').isChecked())) await page.locator('#toggle-chunks').check();
  check(item, 'two sentence cards displayed', await page.locator('.sentence-card').count() === 2);
  check(item, 'translations, specific grammar and chunks rendered', await page.locator('.sentence-zh').count() === 2 && await page.locator('.grammar-item').count() >= 2 && await page.locator('.chunk').count() >= 2);
  check(item, 'study fits viewport width', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `${out}/${name}-study.png`, fullPage: true });
  await page.getByRole('tab', { name: '结构与词汇', exact: true }).click();
  check(item, 'summary structure vocabulary rendered', await page.locator('.summary-box p').innerText().then(t => /[\u3400-\u9fff]/.test(t)) && await page.locator('.structure-row').count() === 1 && await page.locator('.word-phrase').count() > 0);
  check(item, 'structure fits viewport width', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `${out}/${name}-structure.png`, fullPage: true });
}
async function seedOld(page, id, passage = null) {
  const state = await page.evaluate(async ({ id, sentences, passage }) => {
    const { emptyState, normalizePassage } = await import('/reading/core.js');
    const state = emptyState();
    const p = normalizePassage(passage ? { ...passage, id } : { id, title: 'Already saved tipping article', paragraphs: [sentences.map(en => ({ en, zh: '', grammar: [], chunks: [] }))], questions: [], analysisMode: 'rules', summary: '', structure: [], vocabulary: [], createdAt: '2026-10-01T00:00:00.000Z' });
    state.imported = [p]; state.notes[id + ':1'] = '我的旧笔记必须保留';
    state.drafts[id] = { answers: {}, confidence: {}, helped: true };
    state.attempts[id] = [{ id: 'previous-attempt', mode: 'exam', seconds: 37, answers: {} }];
    state.words['word:tipped'] = { kind: 'word', entry: { word: 'tipped', meaning: '给小费' }, context: { passageId: id, sentence: 1 }, createdAt: '2026-10-01T00:00:00.000Z', schedule: null };
    return state;
  }, { id, sentences, passage });
  // Seed before app initialization: pagehide otherwise writes the old in-memory
  // application state over a direct localStorage assignment during reload.
  await page.addInitScript(state => {
    if (sessionStorage.getItem('online-analysis-qa-seeded')) return;
    localStorage.setItem('readingLab.v1', JSON.stringify(state));
    sessionStorage.removeItem('reading-lab-import-draft-v1');
    sessionStorage.setItem('online-analysis-qa-seeded', '1');
  }, state);
  await page.reload({ waitUntil: 'networkidle' });
  return state;
}
function records(state, id) { return { notes: state.notes, draft: state.drafts[id], attempts: state.attempts[id], words: state.words, id: state.imported[0].id, createdAt: state.imported[0].createdAt }; }

try {
  await scenario('01-real-main-import', 'real-online-no-mock', async (page, item) => {
    await page.goto(base + '/#/profile');
    check(item, 'default free provider and empty API key', await page.locator('#ai-provider').inputValue() === 'free' && await page.locator('#ai-key').inputValue() === '');
    await importRaw(page, 'User tipping passage — real free analysis');
    await page.screenshot({ path: `${out}/01-import-preview.png`, fullPage: true });
    await page.locator('[data-action="save-import"]').click();
    await waitImported(page);
    const state = await readState(page), p = state.imported[0];
    check(item, 'original one paragraph and exact two sentences preserved', p.paragraphs.length === 1 && JSON.stringify(p.paragraphs[0].map(s => s.en)) === JSON.stringify(sentences));
    check(item, 'real free online analysis complete', complete(p), p);
    const firstGrammar = p.paragraphs[0][0].grammar.map(g => g.label + ' ' + g.detail).join(' '), secondGrammar = p.paragraphs[0][1].grammar.map(g => g.label + ' ' + g.detail).join(' ');
    check(item, 'grammar explains this source rather than generic hints', ['tipped', 'they assumed', 'were earning', 'servers earning', 'less than'].every(t => firstGrammar.includes(t)) && ['range', 'started processing'].every(t => secondGrammar.includes(t)), { firstGrammar, secondGrammar });
    check(item, 'free online mode and unverified answers retained', p.analysisMode === 'online' && p.answerStatus === 'unverified');
    realPassage = p;
    await writeFile(`${out}/real-generated-passage.json`, JSON.stringify(p, null, 2));
    await screenshots(page, '01-real-import', item);
    await page.reload({ waitUntil: 'networkidle' });
    check(item, 'all generated fields retained after refresh', complete((await readState(page)).imported[0]));
    await page.setViewportSize({ width: 390, height: 844 });
    await screenshots(page, '01-mobile', item);
    check(item, '390px study and structure do not overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  });

  await scenario('02-real-saved-empty-upgrade', 'real-online-no-mock', async (page, item) => {
    const id = 'qa-old-empty-online';
    await seedOld(page, id);
    await page.goto(base + '/#/read/' + id);
    await page.locator('[data-action="analyze-saved"]').waitFor();
    const before = records(await readState(page), id);
    await page.locator('[data-action="analyze-saved"]').click();
    await waitSavedAnalysis(page);
    const state = await readState(page), p = state.imported[0];
    check(item, 'saved empty article receives complete real online analysis', complete(p), await page.locator('#reader-analysis-status').innerText());
    check(item, 'ID date notes drafts attempts and collections retained', JSON.stringify(records(state, id)) === JSON.stringify(before), { before, after: records(state, id) });
    await screenshots(page, '02-real-saved-upgrade', item);
    if (!realPassage) realPassage = p;
  });

  await scenario('03-real-duplicate-upgrade', 'real-online-no-mock', async (page, item) => {
    const id = 'qa-duplicate-original-id';
    await seedOld(page, id);
    await page.reload({ waitUntil: 'networkidle' });
    const before = records(await readState(page), id);
    await importRaw(page, 'Reimport same source upgrades old article');
    await page.locator('[data-action="save-import"]').click();
    await waitImported(page);
    const state = await readState(page);
    check(item, 'same source upgraded instead of duplicate creation', state.imported.length === 1 && state.imported[0].id === id && complete(state.imported[0]), state.imported);
    check(item, 'duplicate upgrade retains learning records', JSON.stringify(records(state, id)) === JSON.stringify(before), { before, after: records(state, id) });
    await page.screenshot({ path: `${out}/03-real-duplicate-upgrade.png`, fullPage: true });
  });

  await scenario('04-controlled-overview-failure', 'controlled-failure-one-mock-response', async (page, item) => {
    if (!realPassage) throw new Error('No real complete result available; failure fixture not substituted for real success.');
    const id = 'qa-failure-preserves-old';
    await seedOld(page, id, realPassage);
    await page.goto(base + '/#/read/' + id);
    await page.locator('[data-action="analyze-saved"]').waitFor();
    const before = await readState(page);
    let mocked = 0;
    await page.route('**/api/reading/analyze', async route => {
      const body = route.request().postDataJSON();
      if (body.action === 'overview') { mocked++; return route.fulfill({ status: 502, json: { error: 'QA controlled free service failure; old data must remain', code: 'free_translation_unavailable' } }); }
      await route.continue();
    });
    await page.locator('[data-action="analyze-saved"]').click();
    await waitSavedAnalysis(page);
    const after = await readState(page);
    check(item, 'exactly one overview response mocked as failure', mocked === 1);
    check(item, 'failure preserves old article and all learning records', JSON.stringify(after.imported) === JSON.stringify(before.imported) && JSON.stringify(records(after, id)) === JSON.stringify(records(before, id)));
    check(item, 'failure shown with retry control available', /QA controlled|失败|无法|保留/.test(await page.locator('#reader-analysis-status').innerText()) && await page.locator('[data-action="analyze-saved"]').isEnabled());
    await page.screenshot({ path: `${out}/04-controlled-failure.png`, fullPage: true });
  });

  const analyzeRequests = report.requests.filter(r => r.analysis);
  report.freeOnly = {
    analysisRequests: analyzeRequests.length,
    allProviderFree: analyzeRequests.length > 0 && analyzeRequests.every(r => r.analysis.provider === 'free' && !r.analysis.apiKeyPresent && r.analysis.model === 'free-online'),
    paidHostsRequested: report.requests.filter(r => /api\.(?:openai|deepseek|anthropic)\.com|generativelanguage\.googleapis\.com/.test(r.url)),
    scope: 'Browser requests and request payloads only; server-side provider routing is checked separately by backend tests.',
  };
  assert.ok(report.freeOnly.allProviderFree, 'All analysis requests must use the free provider without an API key.');
  assert.equal(report.freeOnly.paidHostsRequested.length, 0, 'No paid API browser requests allowed.');
  assert.equal(report.pageErrors.length, 0, 'No browser page errors.');
} catch (error) {
  report.globalError = error.stack || String(error);
} finally {
  report.finished = new Date().toISOString();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ scenarios: report.scenarios.map(s => ({ name: s.name, status: s.status, error: s.error })), freeOnly: report.freeOnly, pageErrors: report.pageErrors, globalError: report.globalError }, null, 2));
  await browser.close();
}
if (report.globalError || report.scenarios.some(s => s.status !== 'passed')) process.exitCode = 1;
