import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewDesign } from './design-review.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTools } from './tools.mjs';

test('characters from two fragments of one declared work need no cross-work pairing review', () => {
  const workspace = { mode: 'crossover', source_work_ids: [{ book_id: 'a', work_id: 'one' }, { book_id: 'b', work_id: 'one' }], cast: [{ id: 'a_cast', source: { book_id: 'a' } }, { id: 'b_cast', source: { book_id: 'b' } }], states: [], events: [{ id: 'meeting', participants: ['a_cast', 'b_cast'], depends_on: [], requires: [], effects: [], synthesis_ids: [] }], syntheses: [] };
  assert.deepEqual(reviewDesign(workspace).crossover.unreviewed_pairings, []);
});

test('analyst work labels cannot collide with implicit text identities', async () => {
  const root = await mkdtemp(join(process.cwd(), '.rea-test-'));
  try {
    const api = createTools(join(root, 'data')); const books = [];
    for (let i = 0; i < 2; i++) {
      const path = join(root, `${i}.txt`); await writeFile(path, `Source ${i}.`);
      const { book_id } = await api.call('import_book', { path }); books.push(book_id);
      const p = (await api.call('list_passages', { book_id })).items[0];
      await api.call('record_claim', { book_id, id: 'fact', kind: 'observation', statement: 'Fixture statement', support: [{ passage_id: p.id, start: p.start, end: p.end, quote: p.text }] });
    }
    await api.call('create_workspace', { id: 'labels', title: 'Labels', premise: 'Identity boundary', mode: 'crossover', book_ids: books, source_work_ids: [{ book_id: books[1], work_id: books[0] }] });
    await api.call('record_synthesis', { workspace_id: 'labels', id: 'mix', focus: 'plot', target: 'A design', contributions: books.map((book_id, i) => ({ source: { book_id, kind: 'claims', id: 'fact' }, technique: `Technique ${i}`, transformation: `Transformation ${i}` })), compatibility_review: 'Declared review', conflicts: [], design: 'New design', test: 'Check the construction' });
    assert.equal((await api.call('verify_workspace', { workspace_id: 'labels' })).status, 'pass');
  } finally { await rm(root, { recursive: true, force: true }); }
});
