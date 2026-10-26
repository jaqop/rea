import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTools } from './tools.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(process.cwd(), '.rea-test-'));
  try {
    const path = join(root, 'book.txt');
    await writeFile(path, '# الفصل الأول\n\nعرفت سلمى السر.\n\n# الفصل الثاني\n\nاختارت سلمى الصمت.');
    const api = createTools(join(root, 'projects'));
    const book = await api.call('import_book', { path, title: 'اختبار' });
    await run({ root, path, api, book });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('persistent exact citations, mechanism, trace and portable export round trip', async () => fixture(async ({ root, api, book }) => {
  const book_id = book.book_id;
  const found = await api.call('search_passages', { book_id, query: 'عرفت' });
  const passage = found.items[0];
  const claim = await api.call('record_claim', { book_id, id: 'secret', kind: 'observation', statement: 'عرفت سلمى السر.', support: [{ passage_id: passage.id, start: passage.start, end: passage.end, quote: passage.text }] });
  assert.equal(claim.id, 'secret');
  await api.call('record_mechanism', { book_id, id: 'delay', title: 'Delayed disclosure', claim_ids: ['secret'], conditions: ['Unequal information'], steps: ['Delay a disclosure'], rivals: ['Another event may explain the effect'], prediction: 'Reader judgment may change', test: 'Blind compare order variants', transfer_constraints: ['Disclose a constraint after a consequential choice'] });
  const trace = await api.call('trace_dependencies', { book_id, id: 'delay', direction: 'dependencies' });
  assert.ok(trace.nodes.some(node => node.id === 'secret'));
  const fresh = createTools(join(root, 'projects'));
  const report = await fresh.call('verify_investigation', { book_id });
  assert.equal(report.integrity, 'pass');
  assert.equal(report.literary_truth_verified, false);
  assert.equal(report.counts.claims, 1);
  assert.ok(report.coverage.unreviewed_passage_ids.length > 0);
  const brief = await fresh.call('transfer_brief', { book_id });
  assert.ok(!JSON.stringify(brief).includes('عرفت سلمى السر'));
  const exported = await fresh.call('export_investigation', { book_id });
  const other = createTools(join(root, 'other'));
  const bundlePath = join(root, 'export.json');
  await writeFile(bundlePath, JSON.stringify(exported));
  await other.call('import_investigation', { path: bundlePath });
  assert.equal((await other.call('verify_investigation', { book_id })).counts.mechanisms, 1);
}));

test('rejects forged citations, duplicate claims, dangling references and bad parameters', async () => fixture(async ({ api, book }) => {
  const book_id = book.book_id;
  await assert.rejects(api.call('record_claim', { book_id, id: 'fake', kind: 'observation', statement: 'Unsupported', support: [{ passage_id: 'p000001', start: 0, end: 1, quote: 'X' }] }));
  await assert.rejects(api.call('record_mechanism', { book_id, id: 'm', title: 'M', claim_ids: ['absent'], conditions: ['c'], steps: ['s'], rivals: ['r'], prediction: 'p', test: 't', transfer_constraints: ['x'] }), /Unknown claim/);
  await assert.rejects(api.call('search_passages', { book_id, query: 'سلمى', limit: -1 }));
  await assert.rejects(api.call('read_passage', { book_id: '../../secret', passage_id: 'p000001' }));
  await assert.rejects(api.call('inspect_book', { book_id, unexpected: true }));
}));

test('tampered stored text or ledger is rejected', async () => fixture(async ({ root, api, book }) => {
  const path = join(root, 'projects', `${book.book_id}.json`);
  const stored = JSON.parse(await readFile(path, 'utf8'));
  stored.book.text += 'tamper';
  await writeFile(path, JSON.stringify(stored));
  await assert.rejects(api.call('inspect_book', { book_id: book.book_id }));
}));

test('scene knowledge changes and unknowns remain explicit', async () => fixture(async ({ api, book }) => {
  const book_id = book.book_id;
  const p = (await api.call('search_passages', { book_id, query: 'عرفت' })).items[0];
  await api.call('record_scene', { book_id, id: 'scene1', label: 'Discovery', passage_ids: [p.id], pov: 'Salma', goals: ['Protect someone'], knowledge_before: ['Secret unknown'], knowledge_after: ['Secret known'], decision: 'Remain silent', consequence: 'Information withheld', depends_on: [] });
  await api.call('record_unknown', { book_id, id: 'u1', question: 'Why silence?', supporting_claim_ids: [], contradicting_claim_ids: [], proposed_test: 'Inspect later scenes' });
  const report = await api.call('verify_investigation', { book_id });
  assert.equal(report.open_unknowns.length, 1);
  assert.equal(report.scene_annotations_are, 'analyst-inference');
  await assert.rejects(api.call('resolve_unknown', { book_id, id: 'u1', rationale: 'Guess', claim_ids: ['absent'] }));
}));
