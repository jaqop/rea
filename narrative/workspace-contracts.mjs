const text = { type: 'string', minLength: 1, maxLength: 100000 };
const id = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,79}$' };
const bookId = { type: 'string', pattern: '^book_[a-f0-9]{64}$' };
const array = (items, minItems = 0) => ({ type: 'array', items, minItems, maxItems: 1000 });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
export const sourceReference = object({ book_id: bookId, kind: { enum: ['claims', 'scenes', 'mechanisms', 'analyses'] }, id });
const focus = { enum: ['worldbuilding', 'character-development', 'plot', 'characterisation'] };
const fact = object({ entity: id, key: id, value: text });
const conflict = object({ issue: text, status: { enum: ['open', 'resolved'] }, resolution: text }, ['issue', 'status']);
const arc = object({ baseline: object({ key: id, value: text }), pressure_event_ids: array(id, 1), change_event_id: id, changed_value: text });
const workLabels = array(object({ book_id: bookId, work_id: id }));
export const recordSchemas = {
  syntheses: object({ id, focus, target: text, contributions: array(object({ source: sourceReference, technique: text, transformation: text }), 2), compatibility_review: text, conflicts: array(conflict), design: text, test: text }),
  cast: object({ id, source: sourceReference, name: text, role: text, adaptations: array(object({ aspect: text, source_value: text, target_value: text, rationale: text })), synthesis_ids: array(id), arc }, ['id', 'source', 'name', 'role', 'adaptations']),
  states: object({ id, label: text, facts: array(object({ ...fact.properties, immutable: { type: 'boolean' } }, ['entity', 'key', 'value']), 1), synthesis_ids: array(id) }, ['id', 'label', 'facts']),
  events: object({ id, title: text, participants: array(id), depends_on: array(id), requires: array(fact), effects: array(fact), rationale: text, synthesis_ids: array(id), constrained_by: array(object({ entity: id, key: id })), sequence: text }, ['id', 'title', 'participants', 'depends_on', 'requires', 'effects', 'rationale', 'synthesis_ids']),
};
const workspace = { workspace_id: id };
const integer = { type: 'integer', minimum: 0 };
const paging = { offset: integer, limit: { type: 'integer', minimum: 1, maximum: 100 } };
const spec = (name, description, schema, write = false) => ({ name, description, inputSchema: schema, annotations: { readOnlyHint: !write, destructiveHint: false, idempotentHint: !write, openWorldHint: false } });
const writeRecord = (name, kind, description) => spec(name, description, object({ ...workspace, ...recordSchemas[kind].properties }, ['workspace_id', ...recordSchemas[kind].required]), true);
export const workspaceDefinitions = [
  spec('create_workspace', 'Create a novel design workspace with frozen validated source investigations. Optional source_work_ids groups editions/fragments of one work under the same analyst-assigned work_id. Does not write a manuscript.', object({ id, title: text, premise: text, mode: { enum: ['crossover', 'original-inspired'] }, book_ids: array(bookId, 1), source_work_ids: workLabels }, ['id', 'title', 'premise', 'mode', 'book_ids']), true),
  spec('list_workspaces', 'List private novel workspaces without source text, paged.', object(paging, [])),
  spec('inspect_workspace', 'Summarize frozen sources, mode, record counts and current revision.', object(workspace)),
  spec('add_workspace_source', 'Add one frozen source snapshot with optional analyst-assigned work_id; reject a different snapshot of a book already present.', object({ ...workspace, book_id: bookId, work_id: id }, ['workspace_id', 'book_id']), true),
  writeRecord('record_synthesis', 'syntheses', 'Combine qualified evidence from at least two distinct source books into one declared design, with explicit compatibility review, conflicts and a test.'),
  writeRecord('cast_character', 'cast', 'Cast a character from a character-development/characterisation source analysis. Record adaptations explicitly; crossover and original-inspired modes remain distinct.'),
  writeRecord('set_story_state', 'states', 'Declare initial world or cast state as creative decisions, including immutable world rules. Values are literal strings.'),
  writeRecord('record_story_event', 'events', 'Plan a new event with participants, causal dependencies, required facts and effects. Continuity is checked against dependency ancestors, not arbitrary event order.'),
  spec('revise_workspace_record', 'Repair a synthesis, cast member, initial state or event. Complete replacement with fixed identity and expected revision; previous version retained.', object({ ...workspace, kind: { enum: Object.keys(recordSchemas) }, id, expected_revision: { type: 'integer', minimum: 1 }, replacement: { oneOf: Object.values(recordSchemas) } }), true),
  spec('read_workspace_records', 'Page planned records or prior versions without dumping source text.', object({ ...workspace, kind: { enum: [...Object.keys(recordSchemas), 'revisions'] }, ...paging }, ['workspace_id', 'kind'])),
  spec('read_workspace_source', 'Read a source-qualified record from the frozen snapshot, even if the live source investigation changes.', object({ ...workspace, source: sourceReference })),
  spec('verify_workspace', 'Check source links and declared continuity; report conflicting preconditions, immutable rule changes, ambiguous branches and open synthesis conflicts. Does not establish literary quality.', object(workspace)),
  spec('workspace_brief', 'Return a design brief with explicit source origins, adaptations and open issues. No source passages or autonomous prose generation.', object(workspace)),
  spec('export_workspace', 'Export the complete portable workspace INCLUDING frozen source texts; keep private and transfer separately from code.', object(workspace)),
  spec('import_workspace', 'Validate a portable workspace and all frozen sources before atomic import into a destination with no matching ID.', object({ path: text }), true),
];
