import { validateArguments } from './contracts.mjs';

export const focusNames = ['worldbuilding', 'character-development', 'plot', 'characterisation'];
const text = { type: 'string', minLength: 1, maxLength: 100000 };
const id = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,79}$' };
const bookId = { type: 'string', pattern: '^book_[a-f0-9]{64}$' };
const texts = { type: 'array', items: text, minItems: 1, maxItems: 1000 };
const claimIds = { type: 'array', items: id, minItems: 1, maxItems: 1000 };
const integer = { type: 'integer', minimum: 0 };
const paging = { offset: integer, limit: { type: 'integer', minimum: 1, maximum: 100 } };
const spec = (name, description, properties, required, write = false) => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations: { readOnlyHint: !write, destructiveHint: false, idempotentHint: !write, openWorldHint: false } });
export const researchDefinitions = [
  spec('get_analysis_guide', 'Concrete investigation questions and disconfirmation criteria for a construction focus; does not analyze a book.', { focus: { enum: focusNames } }, ['focus']),
  spec('record_analysis', 'Retain analyst interpretation with source-backed claims, alternatives and proposed tests. Findings do not establish literary truth.', { book_id: bookId, id, focus: { enum: focusNames }, subject: text, findings: { type: 'array', minItems: 1, maxItems: 1000, items: { type: 'object', properties: { dimension: text, explanation: text, claim_ids: claimIds }, required: ['dimension', 'explanation', 'claim_ids'], additionalProperties: false } }, alternatives: texts, proposed_tests: texts }, ['book_id', 'id', 'focus', 'subject', 'findings', 'alternatives', 'proposed_tests'], true),
  spec('read_source_range', 'Read an exact absolute UTF16 range, including poorly segmented source; maximum 20000 code units.', { book_id: bookId, start: integer, end: integer }, ['book_id', 'start', 'end']),
  spec('search_source', 'Page non-overlapping literal occurrences with exact original UTF16 offsets, quotes and context. No match does not establish semantic absence.', { book_id: bookId, query: text, ...paging, context: { type: 'integer', minimum: 0, maximum: 200 } }, ['book_id', 'query']),
  spec('list_books', 'Page local investigation summaries without full source text.', paging, []),
];

const dimension = (name, questions, evidence, falsification) => ({ name, questions, evidence, falsification });
const guides = {
  worldbuilding: [
    dimension('constraints-and-costs', ['What action does a world rule permit, forbid or make costly?', 'Which later decision depends on that restriction?'], ['Cite the rule being applied, its price, and the affected decision.', 'Separate narrator statements from demonstrated enforcement.'], ['Find an equivalent action succeeding without the declared price.', 'Remove the rule: if choices and outcomes stay the same, causal importance is unsupported.']),
    dimension('institutions-and-distribution', ['Who controls resources, knowledge or legitimate force?', 'How does that distribution produce this conflict rather than merely decorate it?'], ['Trace access, denial, enforcement and the resulting response through exact claims.'], ['Look for actors bypassing the institution without consequence.', 'Test an alternative cause such as private rivalry.']),
    dimension('revelation-and-use', ['When does the reader learn the rule relative to its decisive use?', 'What prior detail makes a later solution available?'], ['Cite introduction, reinforcement, exception and payoff in reading order.'], ['Check whether the solution depends on a rule first invented at the payoff.', 'Test whether the apparent setup has another function.']),
  ],
  'character-development': [
    dimension('baseline-and-pressure', ['What does the character choose before pressure escalates?', 'Which cost exposes the limit of that strategy?'], ['Compare situated choices, options and consequences; do not substitute trait labels.'], ['Find a comparable early choice showing the supposedly new behavior.', 'Test changed circumstances rather than changed disposition.']),
    dimension('belief-revision-and-agency', ['What observation contradicts the character’s working belief?', 'What choice shows acceptance, rejection or distortion of that information?'], ['Cite belief expression, contradicting evidence and later action separately.'], ['Seek evidence the belief persists despite the action.', 'Check coercion, misunderstanding or concealed knowledge as rival explanations.']),
    dimension('persistence-and-relapse', ['Does the new strategy survive a later comparable cost?', 'What is gained and lost through the change?'], ['Trace repeated tests, reversals and final decisions with claims.'], ['Find an unacknowledged relapse or a final choice caused only by external rescue.', 'Keep incomplete trajectories unresolved.']),
  ],
  plot: [
    dimension('causal-choice-chain', ['Which preceding event changes available options?', 'Which decision causes the next irreversible consequence?'], ['Cite initiating condition, alternatives, choice and consequence; distinguish chronology from causation.'], ['Remove the proposed cause and inspect whether the next event still follows.', 'Compare coincidence, external intervention or a separate motive.']),
    dimension('information-and-reversal', ['Who knows what at each turn?', 'How does disclosure change a plan or reinterpret prior action?'], ['Track character knowledge and reader knowledge separately with presentation order.'], ['Find prior knowledge that makes the supposed reveal redundant.', 'Test whether the turn works without withholding this information.']),
    dimension('setup-payoff-and-escalation', ['What earlier constraint enables the resolution?', 'How does each failed attempt increase costs or close options?'], ['Link planted detail, failed attempts, narrowing choices and payoff claims.'], ['Look for an unprepared capability or an unchanged option that defeats the escalation.', 'Test a rival explanation for the apparent pattern.']),
  ],
  characterisation: [
    dimension('action-under-cost', ['What does the character protect when values compete?', 'Which concrete action makes a trait inference warranted?'], ['Use actions and costs in several contexts; separate self-description and behavior.'], ['Cite counterexamples under comparable costs.', 'Test whether role obligations or coercion explain the action.']),
    dimension('voice-and-presentation', ['What choices of speech, attention or silence distinguish this character?', 'Whose perception frames the apparent trait?'], ['Cite exact language and focalisation with speaker/observer attribution.'], ['Check whether the feature belongs to the narrator or another viewpoint.', 'Find contrary language in the same situation.']),
    dimension('relationships-and-contradictions', ['How does behavior change with audience or power?', 'Does a contradiction reveal concealment, complexity or missing evidence?'], ['Compare interactions, private acts and others’ accounts without inventing motives.'], ['Test situational incentives against a stable trait explanation.', 'Retain incompatible testimony rather than force a unified personality.']),
  ],
};

const recordCollections = ['claims', 'scenes', 'mechanisms', 'unknowns', 'analyses'];

/** Validate optional analysis records from both live projects and imported snapshots. */
export function validateAnalyses(project) {
  if (project.analyses === undefined) return project;
  if (!Array.isArray(project.analyses)) throw new Error('Analyses must be an array.');
  const existing = new Set();
  for (const key of recordCollections.filter(key => key !== 'analyses')) for (const record of project[key] ?? []) existing.add(record.id);
  const schema = researchDefinitions.find(item => item.name === 'record_analysis').inputSchema;
  const claimSet = new Set((project.claims ?? []).map(claim => claim.id));
  for (const analysis of project.analyses) {
    if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) throw new Error('Invalid analysis record.');
    const { authority, ...input } = analysis;
    if (authority !== 'analyst-inference') throw new Error('Analysis authority must remain analyst-inference.');
    validateArguments({ ...input, book_id: project.book.id }, schema);
    if (Object.hasOwn(input, 'book_id')) throw new Error('Stored analysis must use its owning source book.');
    if (existing.has(analysis.id)) throw new Error(`Duplicate record ID: ${analysis.id}`);
    existing.add(analysis.id);
    for (const finding of analysis.findings) for (const claimId of finding.claim_ids) if (!claimSet.has(claimId)) throw new Error(`Unknown claim: ${claimId}`);
  }
  return project;
}

function splitsSurrogate(text, offset) {
  return offset > 0 && offset < text.length && /[\uD800-\uDBFF]/u.test(text[offset - 1]) && /[\uDC00-\uDFFF]/u.test(text[offset]);
}
function contextBounds(text, start, end, count) {
  let left = Math.max(0, start - count);
  let right = Math.min(text.length, end + count);
  // Context never splits a Unicode scalar, while remaining within the requested bound.
  if (splitsSurrogate(text, left)) left++;
  if (splitsSurrogate(text, right)) right--;
  return [left, right];
}

export async function handleResearch(name, args, store) {
  const definition = researchDefinitions.find(item => item.name === name);
  if (!definition) return undefined;
  validateArguments(args, definition.inputSchema);
  if (name === 'get_analysis_guide') return { focus: args.focus, dimensions: structuredClone(guides[args.focus]), instructions: 'Investigate this specific source. Link every finding to exact source-backed claims, retain counterevidence and alternatives, and record what would falsify the proposed mechanism. These questions are a guide, not generated analysis.', literary_truth_verified: false };
  if (name === 'list_books') return store.list(args.offset ?? 0, args.limit ?? 20);
  if (name === 'record_analysis') return store.mutate(args.book_id, name, project => {
    const { book_id, ...input } = args;
    const record = { ...structuredClone(input), authority: 'analyst-inference' };
    const candidate = { ...project, analyses: [...(project.analyses ?? []), record] };
    validateAnalyses(candidate);
    project.analyses = candidate.analyses;
    return record;
  });
  const project = await store.load(args.book_id);
  const { book } = project;
  const source = { book_id: book.id, source_sha256: book.source_sha256, offset_unit: book.offset_unit };
  if (name === 'read_source_range') {
    const { start, end } = args;
    if (end <= start || end > book.text.length || end - start > 20000 || splitsSurrogate(book.text, start) || splitsSurrogate(book.text, end)) throw new Error('Source range must be within the source, nonempty, at most 20000 UTF16 units and must not split a surrogate pair.');
    return { ...source, start, end, text: book.text.slice(start, end), passage_ids: book.passages.filter(passage => passage.end > start && passage.start < end).map(passage => passage.id) };
  }
  const offset = args.offset ?? 0;
  const limit = args.limit ?? 20;
  const count = args.context ?? 80;
  const pattern = new RegExp(args.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const items = [];
  let total = 0;
  for (const match of book.text.matchAll(pattern)) {
    if (total >= offset && items.length < limit) {
      const start = match.index;
      const end = start + match[0].length;
      const [context_start, context_end] = contextBounds(book.text, start, end, count);
      items.push({ start, end, quote: match[0], context_start, context_end, context: book.text.slice(context_start, context_end), passage_ids: book.passages.filter(passage => passage.end > start && passage.start < end).map(passage => passage.id) });
    }
    total++;
  }
  return { ...source, items, total, next_offset: offset + items.length < total ? offset + items.length : null, coverage: { status: 'complete', scope: 'literal-nonoverlapping-occurrences', examined_utf16_units: book.text.length, limitations: ['Unicode simple case folding is used; accents and spelling variants are not normalized.', 'Literal occurrence coverage does not establish semantic presence or absence.'] } };
}
