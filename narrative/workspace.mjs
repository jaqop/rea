import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from './core.mjs';
import { ProjectStore, readBounded, validateProject, checkId } from './store.mjs';
import { validateArguments } from './contracts.mjs';
import { recordSchemas, workspaceDefinitions } from './workspace-contracts.mjs';
import { verifyContinuity, validateEventGraph } from './continuity.mjs';
import { reviewDesign } from './design-review.mjs';
import { sourceWorkIdentity as workIdentity } from './source-identity.mjs';

const collections = Object.keys(recordSchemas);
const authority = kind => kind === 'syntheses' ? 'design-hypothesis' : 'creative-decision';
const page = (items, { offset = 0, limit = 20 } = {}) => ({ items: items.slice(offset, offset + limit), total: items.length, next_offset: offset + limit < items.length ? offset + limit : null });
function sourceSummary(source) { return { book_id: source.book.id, title: source.book.title, snapshot_sha256: source.state_sha256 }; }
function summary(workspace) {
  return { workspace_id: workspace.id, title: workspace.title, premise: workspace.premise, mode: workspace.mode, sources: workspace.sources.map(source => ({ ...sourceSummary(source), work_id: workspace.source_work_ids?.find(item => item.book_id === source.book.id)?.work_id ?? null })), counts: Object.fromEntries([...collections, 'revisions'].map(kind => [kind, workspace[kind].length])), state_sha256: workspace.state_sha256 };
}
function sourceRecord(workspace, reference) {
  const source = workspace.sources.find(item => item.book.id === reference.book_id);
  if (!source) throw new Error(`Unknown source book: ${reference.book_id}`);
  const record = (source[reference.kind] ?? []).find(item => item.id === reference.id);
  if (!record) throw new Error(`Unknown qualified source record: ${reference.book_id}/${reference.kind}/${reference.id}`);
  return record;
}
function recordData(record) { const { revision, authority, ...data } = record; return data; }
function validateRecord(workspace, kind, record) {
  if (!Number.isSafeInteger(record.revision) || record.revision < 1 || record.authority !== authority(kind)) throw new Error('Invalid planned record revision or authority.');
  validateArguments(recordData(record), recordSchemas[kind]);
  if (kind !== 'syntheses') (record.synthesis_ids ?? []).forEach(id => { if (!workspace.syntheses.some(item => item.id === id)) throw new Error(`Unknown synthesis: ${id}`); });
  if (kind === 'syntheses') {
    record.contributions.forEach(item => sourceRecord(workspace, item.source));
    if (new Set(record.contributions.map(item => item.source.book_id)).size < 2) throw new Error('A synthesis requires contributions from two distinct source books.');
    if (new Set(record.contributions.map(item => workIdentity(workspace, item.source.book_id))).size < 2) throw new Error('The contributions are fragments or editions of one declared work, not two distinct works.');
    if (new Set(record.contributions.map(item => JSON.stringify([item.source.book_id, item.source.kind, item.source.id]))).size !== record.contributions.length) throw new Error('Duplicate qualified source contribution.');
    for (const conflict of record.conflicts) {
      if (conflict.status === 'resolved' && !conflict.resolution?.trim()) throw new Error('Resolved conflict requires an explicit resolution.');
      if (conflict.status === 'open' && conflict.resolution !== undefined) throw new Error('Open conflict cannot claim a resolution.');
    }
  }
  if (kind === 'cast') {
    if (record.id === 'world') throw new Error('world is reserved for shared story facts.');
    const original = sourceRecord(workspace, record.source);
    if (record.source.kind !== 'analyses' || !['character-development', 'characterisation'].includes(original.focus)) throw new Error('Cast source must be a character analysis.');
    if (workspace.mode === 'original-inspired') {
      if (record.name.trim().normalize('NFC').toLocaleLowerCase() === original.subject.trim().normalize('NFC').toLocaleLowerCase()) throw new Error('Original-inspired cast requires a new name.');
      if (!record.adaptations.length) throw new Error('Original-inspired cast requires explicit adaptations.');
    }
  }
  if (kind === 'states' || kind === 'events') {
    const facts = kind === 'states' ? [record.facts] : [record.requires, record.effects];
    for (const group of facts) {
      const keys = new Set();
      for (const fact of group) {
        if (fact.entity !== 'world' && !workspace.cast.some(item => item.id === fact.entity)) throw new Error(`Unknown story entity: ${fact.entity}`);
        const key = JSON.stringify([fact.entity, fact.key]);
        if (keys.has(key)) throw new Error('Duplicate fact in one record.');
        keys.add(key);
      }
    }
  }
  if (kind === 'events') {
    if (new Set(record.participants).size !== record.participants.length || new Set(record.depends_on).size !== record.depends_on.length) throw new Error('Duplicate event participant or dependency.');
    record.participants.forEach(id => { if (!workspace.cast.some(item => item.id === id)) throw new Error(`Unknown event participant: ${id}`); });
  }
}
function workspaceState(workspace) {
  const { ledger, state_sha256, ...state } = workspace;
  return state;
}
export function validateWorkspace(workspace) {
  if (!workspace || workspace.schema !== 'NarrativeWorkspace/1') throw new Error('Unsupported workspace format.');
  const rootKeys = new Set(['schema', 'id', 'title', 'premise', 'mode', 'sources', 'source_work_ids', ...collections, 'revisions', 'ledger', 'state_sha256']);
  if (Object.keys(workspace).some(key => !rootKeys.has(key))) throw new Error('Unexpected workspace field.');
  validateArguments({ id: workspace.id, title: workspace.title, premise: workspace.premise, mode: workspace.mode, book_ids: workspace.sources?.map(source => source.book?.id), ...(workspace.source_work_ids === undefined ? {} : { source_work_ids: workspace.source_work_ids }) }, workspaceDefinitions.find(t => t.name === 'create_workspace').inputSchema);
  for (const key of [...collections, 'sources', 'revisions', 'ledger']) if (!Array.isArray(workspace[key]) || workspace[key].length > (['revisions', 'ledger'].includes(key) ? 10000 : 1000)) throw new Error(`Invalid workspace ${key}; split oversized plans into separate workspaces.`);
  if (new Set(workspace.sources.map(item => item.book.id)).size !== workspace.sources.length) throw new Error('Duplicate source snapshot.');
  if (new Set((workspace.source_work_ids ?? []).map(item => item.book_id)).size !== (workspace.source_work_ids ?? []).length || (workspace.source_work_ids ?? []).some(item => !workspace.sources.some(source => source.book.id === item.book_id))) throw new Error('Work identities must uniquely label existing workspace sources.');
  workspace.sources.forEach(validateProject);
  const ids = collections.flatMap(kind => workspace[kind].map(record => record.id));
  if (new Set(ids).size !== ids.length) throw new Error('Workspace record IDs must be unique across collections.');
  for (const kind of collections) for (const record of workspace[kind]) validateRecord(workspace, kind, record);
  validateEventGraph(workspace.events);
  const historyKeys = new Set();
  for (const entry of workspace.revisions) {
    if (Object.keys(entry).some(key => !['kind', 'id', 'revision', 'record'].includes(key))) throw new Error('Unexpected revision field.');
    if (!collections.includes(entry.kind) || entry.id !== entry.record?.id || entry.revision !== entry.record?.revision) throw new Error('Invalid prior revision identity.');
    const key = JSON.stringify([entry.kind, entry.id, entry.revision]);
    if (historyKeys.has(key)) throw new Error('Duplicate prior revision.');
    historyKeys.add(key);
    const current = workspace[entry.kind].find(record => record.id === entry.id);
    if (!current || entry.revision >= current.revision) throw new Error('Orphan prior revision.');
    if (entry.kind === 'cast' && digest(entry.record.source) !== digest(current.source)) throw new Error('Cast source identity changed across revisions.');
    validateRecord(workspace, entry.kind, entry.record);
  }
  for (const kind of collections) for (const record of workspace[kind]) {
    if (record.revision > workspace.revisions.length + 1) throw new Error('Record revision exceeds retained history.');
    for (let revision = 1; revision < record.revision; revision++) if (!historyKeys.has(JSON.stringify([kind, record.id, revision]))) throw new Error('Missing prior revision.');
  }
  if (workspace.state_sha256 !== digest(workspaceState(workspace))) throw new Error('Workspace state digest mismatch.');
  let previous = null;
  workspace.ledger.forEach((entry, index) => {
    const { hash, ...payload } = entry;
    if (Object.keys(entry).some(key => !['sequence', 'previous', 'operation', 'state_sha256', 'hash'].includes(key)) || !/^[a-f0-9]{64}$/.test(payload.state_sha256) || !/^[a-f0-9]{64}$/.test(hash) || payload.sequence !== index + 1 || payload.previous !== previous || typeof payload.operation !== 'string' || !payload.operation || hash !== digest(payload)) throw new Error('Broken workspace integrity chain.');
    previous = hash;
  });
  if (!workspace.ledger.length || workspace.ledger.at(-1).state_sha256 !== workspace.state_sha256) throw new Error('Workspace history does not bind state.');
  return workspace;
}
function seal(workspace, operation) {
  workspace.state_sha256 = digest(workspaceState(workspace));
  const payload = { sequence: workspace.ledger.length + 1, previous: workspace.ledger.at(-1)?.hash ?? null, operation, state_sha256: workspace.state_sha256 };
  workspace.ledger.push({ ...payload, hash: digest(payload) });
  return validateWorkspace(workspace);
}
class WorkspaceStore extends ProjectStore {
  constructor(home) { super(join(home, 'workspaces')); }
  path(id) { checkId(id); return join(this.home, `${id}.json`); }
  async load(id) {
    const workspace = validateWorkspace(JSON.parse(await readBounded(this.path(id))));
    if (workspace.id !== id) throw new Error('Workspace identity does not match requested ID.');
    return workspace;
  }
  async create(workspace, operation) {
    return this.locked(workspace.id, async path => {
      try { await stat(path); throw new Error('Workspace already exists; select a new ID or destination home.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (operation) seal(workspace, operation); else validateWorkspace(workspace);
      await this.save(path, workspace);
      return summary(workspace);
    });
  }
  async mutate(id, operation, run) {
    return this.locked(id, async path => {
      const workspace = await this.load(id);
      const result = await run(workspace);
      seal(workspace, operation);
      await this.save(path, workspace);
      return result;
    });
  }
  async list(options) {
    let names;
    try { names = (await readdir(this.home)).filter(name => /^[A-Za-z][A-Za-z0-9_-]{0,79}\.json$/.test(name)).sort(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; names = []; }
    const result = page(names, options);
    result.items = await Promise.all(result.items.map(name => this.load(name.slice(0, -5)).then(summary)));
    return result;
  }
}
function verify(workspace) {
  const continuity = verifyContinuity(workspace);
  const design_review = reviewDesign(workspace);
  const source_conflicts = workspace.syntheses.flatMap(record => record.conflicts.filter(conflict => conflict.status === 'open').map(conflict => ({ synthesis_id: record.id, issue: conflict.issue })));
  return { workspace_id: workspace.id, integrity: 'pass', status: continuity.status === 'pass' && !source_conflicts.length && !design_review.issues.length ? 'pass' : 'issues', continuity, source_conflicts, design_review, literary_quality_verified: false, originality_verified: false, plan_scope: { cast: workspace.cast.length, events: workspace.events.length }, limitations: ['Only declared facts and causal dependencies are checked, not unstated knowledge or semantic motives.', 'Sources are frozen investigation snapshots, not live references.', 'Text hashes distinguish exact texts only. Work IDs are analyst declarations; unlabeled variants or fragments of one work are not recognized automatically.', 'A consistent plan is not proof of literary quality, psychological plausibility or originality.'] };
}
export function createWorkspaceTools(home, bookStore) {
  const store = new WorkspaceStore(home);
  return { async call(name, args) {
    if (name === 'list_workspaces') return store.list(args);
    if (name === 'create_workspace') {
      if (new Set(args.book_ids).size !== args.book_ids.length) throw new Error('Duplicate source books.');
      const sources = [];
      for (const id of args.book_ids) sources.push(await bookStore.load(id));
      return store.create({ schema: 'NarrativeWorkspace/1', id: args.id, title: args.title, premise: args.premise, mode: args.mode, sources, ...(args.source_work_ids === undefined ? {} : { source_work_ids: args.source_work_ids }), syntheses: [], cast: [], states: [], events: [], revisions: [], ledger: [] }, name);
    }
    if (name === 'import_workspace') return store.create(validateWorkspace(JSON.parse(await readBounded(args.path))));
    const { workspace_id, ...input } = args;
    if (name === 'add_workspace_source') {
      const source = await bookStore.load(input.book_id);
      return store.mutate(workspace_id, name, workspace => {
        if (workspace.sources.some(item => item.book.id === source.book.id)) throw new Error('A frozen snapshot of this source already exists; create another workspace for a different snapshot.');
        workspace.sources.push(source);
        if (input.work_id !== undefined) (workspace.source_work_ids ??= []).push({ book_id: source.book.id, work_id: input.work_id });
        return sourceSummary(source);
      });
    }
    const recordKinds = { record_synthesis: 'syntheses', cast_character: 'cast', set_story_state: 'states', record_story_event: 'events' };
    if (recordKinds[name]) return store.mutate(workspace_id, name, workspace => {
      const kind = recordKinds[name];
      if (collections.some(key => workspace[key].some(record => record.id === input.id))) throw new Error('Duplicate workspace record ID.');
      const record = { ...input, revision: 1, authority: authority(kind) };
      workspace[kind].push(record);
      return record;
    });
    if (name === 'revise_workspace_record') return store.mutate(workspace_id, name, workspace => {
      const { kind, id, expected_revision, replacement } = input;
      const index = workspace[kind].findIndex(record => record.id === id);
      if (index < 0) throw new Error('Unknown record for revision.');
      const current = workspace[kind][index];
      if (current.revision !== expected_revision) throw new Error('Revision conflict: reread the current record before replacing it.');
      validateArguments(replacement, recordSchemas[kind]);
      if (replacement.id !== id) throw new Error('A revision cannot change record identity.');
      if (kind === 'cast' && digest(replacement.source) !== digest(current.source)) throw new Error('A cast revision cannot change its source identity; add a new cast member.');
      workspace.revisions.push({ kind, id, revision: current.revision, record: structuredClone(current) });
      const revised = { ...replacement, revision: current.revision + 1, authority: authority(kind) };
      workspace[kind][index] = revised;
      return revised;
    });
    const workspace = await store.load(workspace_id);
    if (name === 'inspect_workspace') return summary(workspace);
    if (name === 'read_workspace_records') return page(workspace[input.kind], input);
    if (name === 'read_workspace_source') {
      const record = sourceRecord(workspace, input.source);
      return { source: sourceSummary(workspace.sources.find(source => source.book.id === input.source.book_id)), record };
    }
    if (name === 'verify_workspace') return verify(workspace);
    if (name === 'export_workspace') return workspace;
    if (name === 'workspace_brief') return { ...summary(workspace), syntheses: workspace.syntheses.map(record => ({ id: record.id, focus: record.focus, target: record.target, contributions: record.contributions.map(item => ({ source: item.source, technique: item.technique, transformation: item.transformation })), design: record.design, compatibility_review: record.compatibility_review, conflicts: record.conflicts, test: record.test })), cast: workspace.cast.map(record => ({ id: record.id, name: record.name, role: record.role, source: record.source, adaptations: record.adaptations, synthesis_ids: record.synthesis_ids ?? [], ...(record.arc === undefined ? {} : { arc: record.arc }) })), states: workspace.states, events: workspace.events, verification: verify(workspace), instructions: 'The assistant may draft only when the user requests prose. Preserve explicit crossover origins or original-inspired adaptations. Do not silently merge source canons or imitate a living author voice.' };
    throw new Error(`Unhandled workspace tool: ${name}`);
  } };
}
