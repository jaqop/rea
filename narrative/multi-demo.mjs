import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTools } from './tools.mjs';

// Synthetic source fixtures only. The demo removes its own temporary directory.
const root = await mkdtemp(join(process.cwd(), '.rea-test-'));
try {
  const api = createTools(join(root, 'data'));
  const bookIds = [];
  for (const [index, name] of ['Mira', 'Oren'].entries()) {
    const path = join(root, `source-${index}.txt`);
    await writeFile(path, `# Source ${index}\n\n${name} protects a secret despite a personal cost.`);
    const { book_id } = await api.call('import_book', { path, title: `Synthetic source ${index}` });
    bookIds.push(book_id);
    const passage = (await api.call('list_passages', { book_id })).items[1];
    await api.call('record_claim', { book_id, id: 'costly_choice', kind: 'observation', statement: 'The source explicitly describes protection with a cost.', support: [{ passage_id: passage.id, start: passage.start, end: passage.end, quote: passage.text }] });
    for (const focus of ['worldbuilding', 'character-development', 'plot', 'characterisation']) {
      await api.call('record_analysis', { book_id, id: focus.replaceAll('-', '_'), focus, subject: name, findings: [{ dimension: 'A protected resource under pressure', explanation: 'This tiny fixture supports one costly-choice observation, not a complete character or world model.', claim_ids: ['costly_choice'] }], alternatives: ['The wider motive is unknown in this fixture'], proposed_tests: ['Compare a later choice under a different cost'] });
    }
  }
  const workspace_id = 'shared_novel';
  await api.call('create_workspace', { id: workspace_id, title: 'Synthetic multi-book design', premise: 'Two source characters negotiate a new obligation.', mode: 'crossover', book_ids: bookIds });
  await api.call('record_synthesis', { workspace_id, id: 'combined_conflict', focus: 'plot', target: 'A new negotiation event', contributions: bookIds.map((book_id, index) => ({ source: { book_id, kind: 'analyses', id: 'plot' }, technique: index === 0 ? 'Personal cost of protection' : 'Information withheld from others', transformation: index === 0 ? 'Make the personal risk constrain negotiation options' : 'Make unequal knowledge constrain the other negotiator' })), compatibility_review: 'Use explicit new shared-world rules rather than silently importing source settings.', conflicts: [], design: 'Neither character can secure their goal by simply abandoning their obligation.', test: 'Check that both obligations change the available choices.' });
  for (const [i, name] of ['Mira', 'Oren'].entries()) await api.call('cast_character', { workspace_id, id: `person${i}`, source: { book_id: bookIds[i], kind: 'analyses', id: 'characterisation' }, name, role: 'Negotiator', adaptations: [{ aspect: 'setting', source_value: 'Unspecified source setting', target_value: 'New shared meeting place', rationale: 'Declared crossover adaptation, not a source-canon claim' }] });
  await api.call('set_story_state', { workspace_id, id: 'opening_state', label: 'Declared opening knowledge', facts: [{ entity: 'person0', key: 'knows_terms', value: 'no' }, { entity: 'world', key: 'oath_cost', value: 'binding', immutable: true }] });
  const event = { id: 'negotiate', title: 'A negotiation using terms not yet learned', participants: ['person0', 'person1'], depends_on: [], requires: [{ entity: 'person0', key: 'knows_terms', value: 'yes' }], effects: [], rationale: 'Intentional fixture error to demonstrate detection and repair.', synthesis_ids: ['combined_conflict'], constrained_by: [{ entity: 'world', key: 'oath_cost' }], sequence: 'negotiation' };
  await api.call('record_story_event', { workspace_id, ...event });
  const before = await api.call('verify_workspace', { workspace_id });
  await api.call('record_story_event', { workspace_id, id: 'learn_terms', title: 'Terms are communicated', participants: ['person0', 'person1'], depends_on: [], requires: [], effects: [{ entity: 'person0', key: 'knows_terms', value: 'yes' }], rationale: 'Add the missing causal acquisition of knowledge.', synthesis_ids: [] });
  await api.call('revise_workspace_record', { workspace_id, kind: 'events', id: event.id, expected_revision: 1, replacement: { ...event, depends_on: ['learn_terms'] } });
  const after = await api.call('verify_workspace', { workspace_id });
  const exportPath = join(root, 'portable.json');
  await writeFile(exportPath, JSON.stringify(await api.call('export_workspace', { workspace_id })));
  const other = createTools(join(root, 'other-device'));
  await other.call('import_workspace', { path: exportPath });
  console.log(JSON.stringify({ tools: api.definitions.length, focus_guides: ['worldbuilding', 'character-development', 'plot', 'characterisation'], source_books: bookIds.length, cast_members: 2, detected_issues: before.continuity.issues, after_repair: after.status, preserved_prior_versions: (await api.call('read_workspace_records', { workspace_id, kind: 'revisions' })).total, restored_on_other_home: (await other.call('verify_workspace', { workspace_id })).status, literary_quality_verified: false }, null, 2));
} finally { await rm(root, { recursive: true, force: true }); }
