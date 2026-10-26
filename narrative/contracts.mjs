const string = { type: 'string', minLength: 1, maxLength: 100000 };
const id = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,79}$' };
const bookId = { type: 'string', pattern: '^book_[a-f0-9]{64}$' };
const strings = { type: 'array', items: string, maxItems: 1000 };
const nonempty = { ...strings, minItems: 1 };
const integer = { type: 'integer', minimum: 0 };
const citation = { type: 'object', properties: { passage_id: string, start: integer, end: integer, quote: string }, required: ['passage_id', 'start', 'end', 'quote'], additionalProperties: false };
const citations = { type: 'array', items: citation, maxItems: 1000 };
const spec = (name, description, properties, required, write = false) => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations: { readOnlyHint: !write, destructiveHint: false, idempotentHint: !write, openWorldHint: false } });
const b = { book_id: bookId };
export const toolDefinitions = [
  spec('import_book', 'Import an explicitly selected local UTF-8 TXT/Markdown file, preserving exact source offsets. Does not analyze prose.', { path: string, title: string }, ['path'], true),
  spec('inspect_book', 'Source identity, segmentation caveats and investigation counts; no full manuscript dump.', b, ['book_id']),
  spec('search_passages', 'Literal case-insensitive paged search. A zero match is not proof of semantic absence.', { ...b, query: string, offset: integer, limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['book_id', 'query']),
  spec('read_passage', 'Read one exact passage with absolute UTF-16 source offsets.', { ...b, passage_id: string }, ['book_id', 'passage_id']),
  spec('list_passages', 'Read passages in order with paging; continue until next_offset is null for full textual coverage.', { ...b, offset: integer, limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['book_id']),
  spec('record_claim', 'Record analyst observation/inference/hypothesis with exact verified citations. Interpretations require alternatives and a falsification test; citations do not prove meaning.', { ...b, id, kind: { enum: ['observation', 'inference', 'hypothesis'] }, statement: string, support: { ...citations, minItems: 1 }, against: citations, alternatives: strings, test: string }, ['book_id', 'id', 'kind', 'statement', 'support'], true),
  spec('record_scene', 'Record an analyst-inferred scene with optional exact source_spans for merged chapters: goals, knowledge changes, choice, consequence and dependencies. Does not assert these are textual facts.', { ...b, id, label: string, passage_ids: nonempty, source_spans: { ...citations, minItems: 1 }, pov: string, goals: strings, knowledge_before: strings, knowledge_after: strings, decision: string, consequence: string, depends_on: strings }, ['book_id', 'id', 'label', 'passage_ids', 'pov', 'goals', 'knowledge_before', 'knowledge_after', 'decision', 'consequence', 'depends_on'], true),
  spec('record_mechanism', 'Record a falsifiable construction hypothesis tied to claims, with competing explanation and abstract transfer constraints.', { ...b, id, title: string, claim_ids: nonempty, conditions: nonempty, steps: nonempty, rivals: nonempty, prediction: string, test: string, transfer_constraints: nonempty }, ['book_id', 'id', 'title', 'claim_ids', 'conditions', 'steps', 'rivals', 'prediction', 'test', 'transfer_constraints'], true),
  spec('record_unknown', 'Retain a question, supporting/counter claims and proposed investigation; do not fill gaps by invention.', { ...b, id, question: string, supporting_claim_ids: strings, contradicting_claim_ids: strings, proposed_test: string }, ['book_id', 'id', 'question', 'supporting_claim_ids', 'contradicting_claim_ids', 'proposed_test'], true),
  spec('resolve_unknown', 'Record analyst resolution with existing supporting claims; not independent truth verification. History is retained.', { ...b, id, rationale: string, claim_ids: nonempty }, ['book_id', 'id', 'rationale', 'claim_ids'], true),
  spec('trace_dependencies', 'Trace declared scene dependencies or mechanism-to-claim links. Reachability is not causal proof.', { ...b, id, direction: { enum: ['dependencies', 'dependents'] } }, ['book_id', 'id']),
  spec('verify_investigation', 'Verify source/citation/history/reference integrity and report annotated/unreviewed passages and open unknowns. Does not verify literary truth or quality.', b, ['book_id']),
  spec('read_records', 'Page retained scenes, claims, mechanisms, analyses or unknowns; includes uncertain and resolved records.', { ...b, kind: { enum: ['claims', 'scenes', 'mechanisms', 'analyses', 'unknowns'] }, offset: integer, limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['book_id', 'kind']),
  spec('transfer_brief', 'Return only analyst-provided abstract transfer constraints and test plans, omitting source passages and scene prose. Human originality review still required.', b, ['book_id']),
  spec('export_investigation', 'Return a portable complete investigation including source text and evidence history. Save output yourself; do not upload private sources without authorization.', b, ['book_id']),
  spec('import_investigation', 'Validate and import a local exported investigation into an empty destination; never overwrite existing investigations.', { path: string }, ['path'], true),
];

export function validateArguments(value, schema, path = 'arguments') {
  if (schema.oneOf) {
    let matches = 0;
    for (const candidate of schema.oneOf) {
      try { validateArguments(value, candidate, path); matches++; } catch { /* Try another complete record shape. */ }
    }
    if (matches !== 1) throw new Error(`${path}: expected exactly one supported record shape`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path}: expected one of ${schema.enum.join(', ')}`);
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: expected an object`);
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key}: required`);
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, key)) throw new Error(`${path}.${key}: unknown field`);
      validateArguments(value[key], schema.properties[key], `${path}.${key}`);
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || value.trim().length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity) || (schema.pattern && !new RegExp(schema.pattern).test(value))) throw new Error(`${path}: invalid string`);
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${path}: expected a boolean`);
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) throw new Error(`${path}: integer outside range`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) throw new Error(`${path}: invalid array length`);
    value.forEach((item, i) => validateArguments(item, schema.items, `${path}[${i}]`));
  }
}
