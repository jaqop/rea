import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTools } from './tools.mjs';

test('scene anchors retain an exact subrange in a merged chapter and reject forged or unrelated spans', async () => {
  const root = await mkdtemp(join(process.cwd(), '.rea-test-'));
  try {
    const path = join(root, 'merged.txt');
    await writeFile(path, 'مشهد أول.\f مشهد ثان.\n\nمقطع آخر.');
    const api = createTools(join(root, 'data'));
    const { book_id } = await api.call('import_book', { path });
    const hit = (await api.call('search_source', { book_id, query: 'مشهد ثان.' })).items[0];
    const span = { passage_id: hit.passage_ids[0], start: hit.start, end: hit.end, quote: hit.quote };
    const scene = { book_id, id: 'precise', label: 'Second scene only', passage_ids: [span.passage_id], source_spans: [span], pov: 'unknown', goals: [], knowledge_before: [], knowledge_after: [], decision: 'unknown', consequence: 'unknown', depends_on: [] };
    await api.call('record_scene', scene);
    assert.deepEqual((await api.call('read_records', { book_id, kind: 'scenes' })).items[0].source_spans, [span]);
    await assert.rejects(api.call('record_scene', { ...scene, id: 'forged', source_spans: [{ ...span, quote: 'not in source' }] }));
    await assert.rejects(api.call('record_scene', { ...scene, id: 'wrong_passage', passage_ids: ['p000002'] }));
  } finally { await rm(root, { recursive: true, force: true }); }
});
