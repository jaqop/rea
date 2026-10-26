import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTools } from './tools.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function fixture(run) {
  const root = await mkdtemp(join(process.cwd(), '.rea-test-'));
  try {
    const api = createTools(join(root, 'data'));
    const books = [];
    for (let i = 0; i < 2; i++) {
      const path = join(root, `${i}.txt`);
      await writeFile(path, `# Book ${i}\n\nPerson ${i} refuses to reveal a costly secret.`);
      const { book_id } = await api.call('import_book', { path });
      const p = (await api.call('list_passages', { book_id })).items[1];
      await api.call('record_claim', { book_id, id: 'same_claim', kind: 'observation', statement: 'A refusal occurs', support: [{ passage_id: p.id, start: p.start, end: p.end, quote: p.text }] });
      for (const focus of ['worldbuilding', 'character-development', 'plot', 'characterisation']) {
        await api.call('record_analysis', { book_id, id: focus.replaceAll('-', '_'), focus, subject: `Person ${i}`, findings: [{ dimension: 'Constraint', explanation: 'Refusal has a cost', claim_ids: ['same_claim'] }], alternatives: ['Other motives remain possible'], proposed_tests: ['Trace consequences'] });
      }
      books.push(book_id);
    }
    await api.call('create_workspace', { id: 'novel', title: 'Combined story', premise: 'An original conflict between incompatible obligations', mode: 'crossover', book_ids: books });
    await run({ api, root, books });
  } finally { await rm(root, { recursive: true, force: true }); }
}
const synthesis = books => ({ workspace_id: 'novel', id: 'blend', focus: 'plot', target: 'A consequential refusal', contributions: books.map((book_id, index) => ({ source: { book_id, kind: 'analyses', id: 'plot' }, technique: index === 0 ? 'Personal cost of refusal' : 'Withheld information', transformation: index === 0 ? 'Make a changed personal cost constrain the negotiation' : 'Use an information imbalance to change available choices' })), compatibility_review: 'Check obligations and incentives', conflicts: [{ issue: 'The obligations differ', status: 'open' }], design: 'Require a new resolution of the conflict', test: 'Compare causal coherence with independent threats' });
const casting = (book_id, id, name) => ({ workspace_id: 'novel', id, source: { book_id, kind: 'analyses', id: 'characterisation' }, name, role: 'Negotiator', adaptations: [{ aspect: 'world', source_value: 'source setting', target_value: 'shared setting', rationale: 'Make the encounter possible' }] });

test('two-book synthesis, crossover, contradiction repair, history and portable reopen', async () => fixture(async ({ api, root, books }) => {
  await api.call('record_synthesis', synthesis(books));
  for (let i = 0; i < 2; i++) await api.call('cast_character', { ...casting(books[i], `cast${i}`, `Person ${i}`), synthesis_ids: ['blend'] });
  await api.call('set_story_state', { workspace_id: 'novel', id: 'initial', label: 'Opening', facts: [{ entity: 'cast0', key: 'knows_secret', value: 'no', immutable: false }], synthesis_ids: ['blend'] });
  await api.call('record_story_event', { workspace_id: 'novel', id: 'reveal', title: 'Premature use of a secret', participants: ['cast0', 'cast1'], depends_on: [], requires: [{ entity: 'cast0', key: 'knows_secret', value: 'yes' }], effects: [], rationale: 'Deliberate continuity error', synthesis_ids: ['blend'] });
  let report = await api.call('verify_workspace', { workspace_id: 'novel' });
  assert.equal(report.status, 'issues');
  assert.ok(report.continuity.issues.some(i => i.code === 'conflicting-precondition'));
  const old = (await api.call('read_workspace_records', { workspace_id: 'novel', kind: 'events' })).items[0];
  const { revision, authority, ...replacement } = old;
  replacement.requires[0].value = 'no';
  await api.call('revise_workspace_record', { workspace_id: 'novel', kind: 'events', id: 'reveal', expected_revision: revision, replacement });
  const design = synthesis(books);
  delete design.workspace_id;
  design.conflicts[0] = { issue: 'The obligations differ', status: 'resolved', resolution: 'Make this difference the explicit negotiation obstacle' };
  await api.call('revise_workspace_record', { workspace_id: 'novel', kind: 'syntheses', id: 'blend', expected_revision: 1, replacement: design });
  report = await api.call('verify_workspace', { workspace_id: 'novel' });
  assert.equal(report.status, 'pass');
  assert.equal(report.literary_quality_verified, false);
  assert.deepEqual((await api.call('workspace_brief', { workspace_id: 'novel' })).cast[0].synthesis_ids, ['blend']);
  const brief = await api.call('workspace_brief', { workspace_id: 'novel' });
  assert.equal(brief.syntheses[0].compatibility_review, 'Check obligations and incentives');
  assert.equal(brief.syntheses[0].contributions[0].technique, 'Personal cost of refusal');
  const subprocess = spawnSync(process.execPath, [fileURLToPath(new URL('./cli.mjs', import.meta.url)), 'call', 'inspect_workspace', JSON.stringify({ workspace_id: 'novel' }), '--home', join(root, 'data')], { cwd: root, encoding: 'utf8', timeout: 15000 });
  assert.equal(subprocess.status, 0, subprocess.stderr);
  assert.equal(JSON.parse(subprocess.stdout).counts.cast, 2);
  assert.equal((await api.call('read_workspace_records', { workspace_id: 'novel', kind: 'revisions' })).total, 2);
  const before = await api.call('export_workspace', { workspace_id: 'novel' });
  await assert.rejects(api.call('revise_workspace_record', { workspace_id: 'novel', kind: 'events', id: 'reveal', expected_revision: 1, replacement }), /revision/i);
  assert.deepEqual(await api.call('export_workspace', { workspace_id: 'novel' }), before);
  const path = join(root, 'workspace.json');
  await writeFile(path, JSON.stringify(before));
  const other = createTools(join(root, 'other'));
  await other.call('import_workspace', { path });
  assert.deepEqual(await other.call('verify_workspace', { workspace_id: 'novel' }), report);
  assert.deepEqual((await other.call('inspect_workspace', { workspace_id: 'novel' })).sources.map(s => s.book_id), books);
}));

test('revisions reject cycles and wrong shapes without corrupting the current plan', async () => fixture(async ({ api, books }) => {
  await api.call('cast_character', casting(books[0], 'actor', 'Actor'));
  const event = id => ({ workspace_id: 'novel', id, title: id, participants: ['actor'], depends_on: [], requires: [], effects: [], rationale: 'Declared test event', synthesis_ids: [] });
  const first = event('first');
  await api.call('record_story_event', first);
  const second = event('second'); second.depends_on = ['first'];
  await api.call('record_story_event', second);
  const before = await api.call('export_workspace', { workspace_id: 'novel' });
  const { workspace_id, ...replacement } = first;
  replacement.depends_on = ['second'];
  await assert.rejects(api.call('revise_workspace_record', { workspace_id: 'novel', kind: 'events', id: 'first', expected_revision: 1, replacement }), /cycle/i);
  await assert.rejects(api.call('revise_workspace_record', { workspace_id: 'novel', kind: 'events', id: 'first', expected_revision: 1, replacement: { id: 'first', label: 'Wrong type', facts: [{ entity: 'world', key: 'x', value: '1' }] } }));
  assert.deepEqual(await api.call('export_workspace', { workspace_id: 'novel' }), before);
}));

test('qualified references, meaningful blend, cast origin and immutable snapshots', async () => fixture(async ({ api, root, books }) => {
  await assert.rejects(api.call('record_synthesis', synthesis([books[0], books[0]])), /two distinct/i);
  const wrong = casting(books[0], 'bad', 'Bad'); wrong.source.id = 'plot';
  await assert.rejects(api.call('cast_character', wrong), /character/i);
  await assert.rejects(api.call('cast_character', casting('book_' + '0'.repeat(64), 'missing', 'Missing')), /source/i);
  const before = await api.call('export_workspace', { workspace_id: 'novel' });
  const p = (await api.call('list_passages', { book_id: books[0] })).items[1];
  await api.call('record_claim', { book_id: books[0], id: 'later', kind: 'observation', statement: 'Later analysis', support: [{ passage_id: p.id, start: p.start, end: p.end, quote: p.text }] });
  assert.deepEqual(await api.call('export_workspace', { workspace_id: 'novel' }), before);
  await assert.rejects(api.call('add_workspace_source', { workspace_id: 'novel', book_id: books[0] }), /snapshot/i);
  const path = join(root, 'bad.json');
  const bad = structuredClone(before); bad.sources[0].book.text += 'tamper';
  await writeFile(path, JSON.stringify(bad));
  await assert.rejects(createTools(join(root, 'bad-home')).call('import_workspace', { path }));
  await api.call('create_workspace', { id: 'original', title: 'Original', premise: 'New people', mode: 'original-inspired', book_ids: books });
  const cast = { ...casting(books[0], 'original_cast', 'Person 0'), workspace_id: 'original' };
  await assert.rejects(api.call('cast_character', cast), /name/i);
  await assert.rejects(api.call('cast_character', { ...cast, name: 'New Name', adaptations: [] }), /adaptation/i);
}));

test('work labels reject same-work fragments and source contributions cannot be repeated', async () => fixture(async ({ api, books }) => {
  await api.call('create_workspace', { id: 'fragments', title: 'Two fragments', premise: 'Test source identity', mode: 'crossover', book_ids: books, source_work_ids: books.map(book_id => ({ book_id, work_id: 'one_work' })) });
  await assert.rejects(api.call('record_synthesis', { ...synthesis(books), workspace_id: 'fragments' }), /one declared work/i);
  const duplicated = synthesis(books); duplicated.contributions.push(duplicated.contributions[0]);
  await assert.rejects(api.call('record_synthesis', duplicated), /duplicate qualified/i);
  await assert.rejects(api.call('create_workspace', { id: 'invalid_labels', title: 'Invalid', premise: 'Test', mode: 'crossover', book_ids: books, source_work_ids: [{ book_id: 'book_' + '0'.repeat(64), work_id: 'unknown' }] }), /work identit/i);
}));

test('world constraints, sequence structure and declared character arc are reviewable and revisable', async () => fixture(async ({ api, books }) => {
  await api.call('cast_character', casting(books[0], 'actor', 'Actor'));
  await api.call('set_story_state', { workspace_id: 'novel', id: 'baseline', label: 'Initial strategy', facts: [{ entity: 'actor', key: 'strategy', value: 'avoid' }, { entity: 'world', key: 'oath', value: 'binding', immutable: true }] });
  const event = (id, sequence, depends_on, effects) => ({ workspace_id: 'novel', id, title: id, participants: ['actor'], depends_on, requires: [], effects, rationale: 'A declared test of strategy', synthesis_ids: [], constrained_by: [{ entity: 'world', key: 'oath' }], sequence });
  await api.call('record_story_event', event('pressure', 'act_one', [], []));
  await api.call('record_story_event', event('change', 'act_two', ['pressure'], [{ entity: 'actor', key: 'strategy', value: 'confront' }]));
  const { workspace_id, ...cast } = casting(books[0], 'actor', 'Actor');
  cast.arc = { baseline: { key: 'strategy', value: 'avoid' }, pressure_event_ids: ['pressure'], change_event_id: 'change', changed_value: 'confront' };
  await api.call('revise_workspace_record', { workspace_id: 'novel', kind: 'cast', id: 'actor', expected_revision: 1, replacement: cast });
  const report = await api.call('verify_workspace', { workspace_id: 'novel' });
  assert.equal(report.status, 'pass');
  assert.equal(report.design_review.arcs[0].status, 'pass');
  assert.equal(report.design_review.psychological_plausibility_verified, false);
  assert.deepEqual(report.design_review.structure.isolated_sequences, []);
  assert.deepEqual((await api.call('workspace_brief', { workspace_id: 'novel' })).cast[0].arc, cast.arc);
  await assert.rejects(api.call('revise_workspace_record', { workspace_id: 'novel', kind: 'cast', id: 'actor', expected_revision: 2, replacement: { id: 'actor', label: 'Wrong shape', facts: [{ entity: 'world', key: 'x', value: 'y' }] } }), /required|invalid|expected/i);
}));
