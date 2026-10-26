import { extname } from 'node:path';
import { buildBook, getPassage, searchBook, buildClaim } from './core.mjs';
import { ProjectStore, readBounded, addRecord, requireRecord } from './store.mjs';

import { toolDefinitions as bookDefinitions, validateArguments } from './contracts.mjs';
import { researchDefinitions, handleResearch } from './research.mjs';
import { workspaceDefinitions } from './workspace-contracts.mjs';
import { createWorkspaceTools } from './workspace.mjs';
import { outputDefinitions, handleOutput } from './output-tools.mjs';
export { validateArguments } from './contracts.mjs';
export const toolDefinitions = [...bookDefinitions, ...researchDefinitions, ...workspaceDefinitions, ...outputDefinitions];
const outputNames = new Set(outputDefinitions.map(item => item.name));
const researchNames = new Set(researchDefinitions.map(item => item.name));
const workspaceNames = new Set(workspaceDefinitions.map(item => item.name));

function summary(project) {
  const { book } = project;
  return { book_id: book.id, title: book.title, source_sha256: book.source_sha256, offset_unit: book.offset_unit, passage_count: book.passages.length, counts: Object.fromEntries(['claims', 'scenes', 'mechanisms', 'unknowns', 'analyses'].map(key => [key, (project[key] ?? []).length])), limitations: ['Paragraphs and headings are heuristic; they do not establish scene boundaries.', 'A connected assistant supplies interpretations; this runtime does not contain an LLM.', 'Exact citations establish source location, not interpretive truth.'] };
}
function page(items, { offset = 0, limit = 20 }) {
  return { items: items.slice(offset, offset + limit), total: items.length, next_offset: offset + limit < items.length ? offset + limit : null };
}
function graph(project, seed, direction) {
  const nodes = [...project.scenes.map(item => ({ id: item.id, kind: 'scene', label: item.label })), ...project.claims.map(item => ({ id: item.id, kind: item.kind, label: item.statement })), ...project.mechanisms.map(item => ({ id: item.id, kind: 'mechanism-hypothesis', label: item.title }))];
  if (!nodes.some(node => node.id === seed)) throw new Error(`Unknown trace node: ${seed}`);
  const edges = [...project.scenes.flatMap(item => item.depends_on.map(to => ({ from: item.id, to, type: 'analyst-dependency' }))), ...project.mechanisms.flatMap(item => item.claim_ids.map(to => ({ from: item.id, to, type: 'supported-by-claim' })))];
  const visited = new Set([seed]);
  const queue = [seed];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    for (const edge of edges) {
      const next = direction === 'dependents' ? (edge.to === current ? edge.from : null) : (edge.from === current ? edge.to : null);
      if (next && !visited.has(next)) { visited.add(next); queue.push(next); }
    }
  }
  return { nodes: nodes.filter(node => visited.has(node.id)), edges: edges.filter(edge => visited.has(edge.from) && visited.has(edge.to)), limitations: ['Declared graph connectivity does not prove causality or reader response.'] };
}

export function createTools(home) {
  const store = new ProjectStore(home);
  const workspaces = createWorkspaceTools(home, store);
  return { definitions: toolDefinitions, async call(name, args = {}) {
    const definition = toolDefinitions.find(tool => tool.name === name);
    if (!definition) throw new Error(`Unknown tool: ${name}`);
    validateArguments(args, definition.inputSchema);
    if (outputNames.has(name)) return handleOutput(name, args);
    if (researchNames.has(name)) return handleResearch(name, args, store);
    if (workspaceNames.has(name)) return workspaces.call(name, args);
    if (name === 'import_book') {
      if (!['.txt', '.md', '.markdown'].includes(extname(args.path).toLowerCase())) throw new Error('Supported source formats: UTF-8 .txt, .md, .markdown. Convert other formats explicitly first.');
      const book = buildBook(await readBounded(args.path), args.title ?? 'Untitled');
      return summary(await store.create(book));
    }
    if (name === 'import_investigation') return store.restore(JSON.parse(await readBounded(args.path)));
    const { book_id, ...input } = args;
    if (name.startsWith('record_') || name === 'resolve_unknown') return store.mutate(book_id, name, project => {
      if (name === 'record_claim') return addRecord(project, 'claims', buildClaim(project.book, input));
      if (name === 'record_scene') {
        input.passage_ids.forEach(id => getPassage(project.book, id));
        input.depends_on.forEach(id => requireRecord(project, 'scenes', id));
        return addRecord(project, 'scenes', { ...input, authority: 'analyst-inference' });
      }
      if (name === 'record_mechanism') {
        input.claim_ids.forEach(id => requireRecord(project, 'claims', id));
        return addRecord(project, 'mechanisms', { ...input, authority: 'hypothesis', tested: false });
      }
      if (name === 'record_unknown') {
        [...input.supporting_claim_ids, ...input.contradicting_claim_ids].forEach(id => requireRecord(project, 'claims', id));
        return addRecord(project, 'unknowns', { ...input, status: 'open', resolution: null });
      }
      input.claim_ids.forEach(id => requireRecord(project, 'claims', id));
      const unknown = requireRecord(project, 'unknowns', input.id);
      if (unknown.status === 'resolved') throw new Error('Unknown is already resolved.');
      unknown.status = 'resolved';
      unknown.resolution = { rationale: input.rationale, claim_ids: input.claim_ids, authority: 'analyst-inference' };
      return unknown;
    });
    const project = await store.load(book_id);
    if (name === 'inspect_book') return summary(project);
    if (name === 'search_passages') return searchBook(project.book, input.query, input);
    if (name === 'read_passage') return getPassage(project.book, input.passage_id);
    if (name === 'list_passages') return page(project.book.passages, input);
    if (name === 'read_records') return page(project[input.kind] ?? [], input);
    if (name === 'trace_dependencies') return graph(project, input.id, input.direction ?? 'dependencies');
    if (name === 'export_investigation') return project;
    if (name === 'transfer_brief') return { schema: 'NarrativeTransfer/1', source_book_id: book_id, mechanisms: project.mechanisms.map(item => ({ id: item.id, constraints: item.transfer_constraints, prediction: item.prediction, proposed_test: item.test, tested: item.tested })), open_questions: project.unknowns.filter(item => item.status !== 'resolved').map(item => ({ id: item.id })), instructions: 'Use these analyst-authored constraints with a new premise, cast, world, scene order and original voice. Review for source-specific content; constraints are hypotheses, not proven writing laws.' };
    if (name === 'verify_investigation') {
      const annotated = new Set([...project.claims.flatMap(claim => [...claim.support, ...claim.against].map(c => c.passage_id)), ...project.scenes.flatMap(scene => scene.passage_ids)]);
      return { ...summary(project), integrity: 'pass', literary_truth_verified: false, scene_annotations_are: 'analyst-inference', coverage: { annotated_passages: annotated.size, total_passages: project.book.passages.length, unreviewed_passage_ids: project.book.passages.filter(p => !annotated.has(p.id)).map(p => p.id), caveat: 'Annotation coverage is not comprehension or literary correctness.' }, open_unknowns: project.unknowns.filter(item => item.status !== 'resolved'), untested_mechanism_ids: project.mechanisms.filter(item => !item.tested).map(item => item.id) };
    }
    throw new Error(`Unhandled tool: ${name}`);
  } };
}
