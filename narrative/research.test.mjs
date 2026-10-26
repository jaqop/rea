import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBook } from './core.mjs';
import { researchDefinitions, handleResearch, validateAnalyses, focusNames } from './research.mjs';

function fixture(text = 'قال 😀 نعم.\r\n\r\nثمن القاعدة معلوم.') {
  const project = { book: buildBook(text), claims: [{ id: 'evidence' }], scenes: [], mechanisms: [], unknowns: [] };
  const store = { async load(id) { assert.equal(id, project.book.id); return project; }, async mutate(id, name, run) { assert.equal(id, project.book.id); return run(project); }, async list(offset, limit) { return { items: [{ book_id: project.book.id }], total: 1, offset, limit }; } };
  return { project, store, book_id: project.book.id };
}

test('all four guides demand concrete causal evidence and falsification', async () => {
  assert.equal(focusNames.length, 4);
  for (const focus of focusNames) {
    const guide = await handleResearch('get_analysis_guide', { focus });
    assert.equal(guide.focus, focus);
    assert.ok(guide.dimensions.length >= 3);
    for (const dimension of guide.dimensions) {
      assert.ok(dimension.questions.length);
      assert.ok(dimension.evidence.length);
      assert.ok(dimension.falsification.length);
    }
  }
  assert.equal(await handleResearch('other', {}), undefined);
  assert.equal(researchDefinitions.length, 5);
});

test('analysis records require exact existing claim references and safe unique IDs', async () => {
  const { project, store, book_id } = fixture();
  const args = { book_id, id: 'world', focus: 'worldbuilding', subject: 'Cost of power', findings: [{ dimension: 'constraints', explanation: 'The rule removes an available choice.', claim_ids: ['evidence'] }], alternatives: ['The rule is only scenery.'], proposed_tests: ['Look for an exception without cost.'] };
  const record = await handleResearch('record_analysis', args, store);
  assert.equal(record.authority, 'analyst-inference');
  assert.equal(project.analyses.length, 1);
  validateAnalyses(project);
  await assert.rejects(handleResearch('record_analysis', args, store), /duplicate/i);
  await assert.rejects(handleResearch('record_analysis', { ...args, id: 'new', findings: [{ ...args.findings[0], claim_ids: ['missing'] }] }, store), /claim/i);
  await assert.rejects(handleResearch('record_analysis', { ...args, id: 'evidence' }, store), /duplicate/i);
  await assert.rejects(handleResearch('record_analysis', { ...args, id: '../bad' }, store));
  for (const patch of [{ authority: 'observed' }, { alternatives: [] }, { findings: [] }, { extra: true }]) {
    const changed = structuredClone(project);
    Object.assign(changed.analyses[0], patch);
    assert.throws(() => validateAnalyses(changed));
  }
  const missing = structuredClone(project);
  missing.analyses[0].findings[0].claim_ids = ['missing'];
  assert.throws(() => validateAnalyses(missing), /claim/i);
  validateAnalyses({ ...project, analyses: undefined });
});

test('source ranges read unsegmented books with original UTF16 Arabic emoji and CRLF', async () => {
  const { project, store, book_id } = fixture('a'.repeat(25000) + '\r\nقال 😀 نعم.');
  const start = 25002;
  const result = await handleResearch('read_source_range', { book_id, start, end: project.book.text.length }, store);
  assert.equal(result.text, 'قال 😀 نعم.');
  assert.equal(result.start, start);
  assert.deepEqual(result.passage_ids, ['p000001']);
  for (const range of [{ start: 0, end: 20001 }, { start: -1, end: 2 }, { start: 5, end: 5 }, { start: 0, end: 99999 }, { start: 25007, end: 25008 }]) await assert.rejects(handleResearch('read_source_range', { book_id, ...range }, store));
});

test('occurrence search keeps original offsets after expanding lowercase Unicode and pages matches', async () => {
  const { project, store, book_id } = fixture('İ 😀 A[x] A[x]\r\nعربي عربي');
  const first = await handleResearch('search_source', { book_id, query: 'a[X]', limit: 1, context: 2 }, store);
  assert.equal(first.total, 2);
  assert.equal(first.next_offset, 1);
  assert.equal(first.items[0].start, 5);
  assert.equal(first.items[0].quote, 'A[x]');
  assert.equal(project.book.text.slice(first.items[0].start, first.items[0].end), first.items[0].quote);
  const second = await handleResearch('search_source', { book_id, query: 'a[x]', offset: 1, context: 0 }, store);
  assert.equal(second.items[0].start, 10);
  assert.equal(second.next_offset, null);
  assert.equal((await handleResearch('search_source', { book_id, query: 'عربي' }, store)).total, 2);
  assert.equal((await handleResearch('search_source', { book_id, query: '.*' }, store)).total, 0);
  for (const patch of [{ limit: 101 }, { context: 201 }, { offset: -1 }, { query: '' }]) await assert.rejects(handleResearch('search_source', { book_id, query: 'A', ...patch }, store));
});

test('book discovery delegates bounded paging to store', async () => {
  const { store } = fixture();
  const result = await handleResearch('list_books', { offset: 2, limit: 3 }, store);
  assert.equal(result.offset, 2);
  assert.equal(result.limit, 3);
  assert.ok(!Object.hasOwn(result.items[0], 'text'));
});
