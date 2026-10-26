import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBook, buildClaim, digest } from './core.mjs';
import { projectState, validateProject } from './store.mjs';
import { validateWorkspace } from './workspace.mjs';

function source(text, subject) {
  const book = buildBook(text);
  const p = book.passages[0];
  const claim = buildClaim(book, { id: 'claim', kind: 'observation', statement: 'An action occurs.', support: [{ passage_id: p.id, start: p.start, end: p.end, quote: p.text }] });
  const project = { schema: 'NarrativeInvestigation/1', book, claims: [claim], scenes: [], mechanisms: [], unknowns: [], analyses: [{ id: 'character', focus: 'characterisation', subject, findings: [{ dimension: 'action', explanation: 'Observed choices support interpretation.', claim_ids: ['claim'] }], alternatives: ['A situational explanation.'], proposed_tests: ['Compare another choice.'], authority: 'analyst-inference' }], ledger: [] };
  project.state_sha256 = digest(projectState(project));
  const entry = { sequence: 1, previous: null, operation: 'import_book', state_sha256: project.state_sha256 };
  project.ledger = [{ ...entry, hash: digest(entry) }];
  return project;
}
function reseal(workspace, earlier = []) {
  const { ledger, state_sha256, ...state } = workspace;
  workspace.state_sha256 = digest(state);
  workspace.ledger = earlier;
  const entry = { sequence: earlier.length + 1, previous: earlier.at(-1)?.hash ?? null, operation: 'create_workspace', state_sha256: workspace.state_sha256 };
  workspace.ledger.push({ ...entry, hash: digest(entry) });
  return workspace;
}
function fixture() {
  return reseal({ schema: 'NarrativeWorkspace/1', id: 'novel', title: 'New novel', premise: 'Conflicting loyalties', mode: 'crossover', sources: [source('One refuses.', 'One'), source('Two agrees.', 'Two')], syntheses: [], cast: [], states: [], events: [], revisions: [], ledger: [] });
}

test('workspace integrity chain rejects a historical state that is not a SHA256 commitment', () => {
  const workspace = fixture();
  const entry = { sequence: 1, previous: null, operation: 'create_workspace', state_sha256: { fake: 'not a digest' } };
  reseal(workspace, [{ ...entry, hash: digest(entry) }]);
  assert.throws(() => validateWorkspace(workspace), /history|chain|digest|state/i);
});

test('imported cast history cannot swap a fixed source identity between revisions', () => {
  const workspace = fixture();
  const cast = { id: 'visitor', source: { book_id: workspace.sources[0].book.id, kind: 'analyses', id: 'character' }, name: 'Visitor', role: 'Negotiator', adaptations: [], revision: 2, authority: 'creative-decision' };
  workspace.cast = [cast];
  const prior = { ...structuredClone(cast), source: { ...cast.source, book_id: workspace.sources[1].book.id }, revision: 1 };
  workspace.revisions = [{ kind: 'cast', id: cast.id, revision: 1, record: prior }];
  reseal(workspace);
  assert.throws(() => validateWorkspace(workspace), /source|identity|revision/i);
});

test('old investigation without optional analyses retains its existing commitment', () => {
  const project = source('Old text.', 'Old');
  delete project.analyses;
  project.state_sha256 = digest(projectState(project));
  const entry = { sequence: 1, previous: null, operation: 'import_book', state_sha256: project.state_sha256 };
  project.ledger = [{ ...entry, hash: digest(entry) }];
  assert.equal(validateProject(project), project);
});
