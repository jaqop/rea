import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBook, digest } from './core.mjs';
import { ProjectStore, readBounded, projectState, validateProject } from './store.mjs';

async function temporary(run) {
  const home = await mkdtemp(join(tmpdir(), 'narrative-review-'));
  try { await run(home); } finally { await rm(home, { recursive: true, force: true }); }
}
function reseal(project) {
  project.state_sha256 = digest(projectState(project));
  const payload = { sequence: 1, previous: null, operation: 'import_book', state_sha256: project.state_sha256 };
  project.ledger = [{ ...payload, hash: digest(payload) }];
  return project;
}
const emptyProject = (book) => reseal({ schema: 'NarrativeInvestigation/1', book, claims: [], scenes: [], mechanisms: [], unknowns: [], ledger: [] });

test('source reader preserves an explicit UTF8 BOM', () => temporary(async home => {
  const path = join(home, 'book.txt');
  await writeFile(path, '\uFEFFالفصل الأول\n\nنص.', 'utf8');
  assert.equal((await readBounded(path)).charCodeAt(0), 0xFEFF);
}));

test('requested investigation identity must match the stored book', () => temporary(async home => {
  const store = new ProjectStore(home);
  const first = buildBook('First source.');
  const second = emptyProject(buildBook('Different source.'));
  await writeFile(store.path(first.id), JSON.stringify(second));
  await assert.rejects(store.load(first.id), /identity|book|source/i);
}));

test('import rejects rehashed records that claim unsupported authority or verification', () => temporary(async home => {
  const project = emptyProject(buildBook('A source.'));
  const variants = [
    { collection: 'scenes', record: { id: 'scene', passage_ids: ['p000001'], depends_on: [], authority: 'observed' } },
    { collection: 'mechanisms', record: { id: 'mechanism', claim_ids: [], authority: 'hypothesis', tested: true } },
    { collection: 'unknowns', record: { id: 'question', supporting_claim_ids: [], contradicting_claim_ids: [], status: 'resolved', resolution: null } },
  ];
  for (const { collection, record } of variants) {
    const changed = structuredClone(project);
    changed[collection].push(record);
    assert.throws(() => validateProject(reseal(changed)), undefined, `${collection} must be rejected`);
  }
}));
