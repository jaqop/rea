/** Review declared design structure only. Call after workspace schema/link validation. */
import { sourceWorkIdentity } from './source-identity.mjs';
export function reviewDesign(workspace) {
  const { cast = [], states = [], events = [], syntheses = [] } = workspace;
  const issues = [];
  const warnings = [];
  const eventById = new Map(events.map(event => [event.id, event]));
  const castById = new Map(cast.map(character => [character.id, character]));
  const synthesisById = new Map(syntheses.map(synthesis => [synthesis.id, synthesis]));
  const ancestorCache = new Map();
  function ancestors(id) {
    if (ancestorCache.has(id)) return ancestorCache.get(id);
    const found = new Set();
    const queue = [...(eventById.get(id)?.depends_on ?? [])];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const next = queue[cursor];
      if (found.has(next) || next === id) continue;
      found.add(next);
      queue.push(...(eventById.get(next)?.depends_on ?? []));
    }
    ancestorCache.set(id, found);
    return found;
  }
  const used = new Set(events.flatMap(event => event.participants));
  const unused_cast_ids = cast.filter(character => !used.has(character.id)).map(character => character.id);
  const unlabelled_event_ids = events.filter(event => !event.sequence).map(event => event.id);
  const sequences = new Set(events.filter(event => event.sequence).map(event => event.sequence));
  const connected = new Set();
  for (const event of events) for (const dependency of event.depends_on) {
    const prior = eventById.get(dependency);
    if (event.sequence && prior?.sequence && event.sequence !== prior.sequence) {
      connected.add(event.sequence);
      connected.add(prior.sequence);
    }
  }
  const isolated_sequences = [...sequences].filter(sequence => !connected.has(sequence));
  if (unused_cast_ids.length) warnings.push({ code: 'unused-cast', cast_ids: unused_cast_ids, message: 'These cast members are not declared participants in any planned event.' });
  if (unlabelled_event_ids.length) warnings.push({ code: 'unlabelled-events', event_ids: unlabelled_event_ids, message: 'These events have no sequence label; missing labels do not establish a plot gap.' });
  if (isolated_sequences.length) warnings.push({ code: 'isolated-sequences', sequences: isolated_sequences, message: 'These sequence labels have no direct dependency edge to another labelled sequence. Transitive connections through unlabelled events are outside this check.' });

  const booksCovered = synthesis => new Set((synthesis?.contributions ?? []).map(contribution => sourceWorkIdentity(workspace, contribution.source.book_id)));
  const unreviewed_pairings = [];
  const cast_source_mismatches = [];
  for (const character of cast) for (const synthesisId of character.synthesis_ids ?? []) {
    if (!booksCovered(synthesisById.get(synthesisId)).has(sourceWorkIdentity(workspace, character.source.book_id))) {
      const mismatch = { cast_id: character.id, synthesis_id: synthesisId };
      cast_source_mismatches.push(mismatch);
      warnings.push({ code: 'cast-source-mismatch', ...mismatch, message: 'The linked synthesis does not contribute this cast member’s source book; check whether this is a deliberate adaptation.' });
    }
  }
  for (const event of events) {
    for (let left = 0; left < event.participants.length; left++) for (let right = left + 1; right < event.participants.length; right++) {
      const one = castById.get(event.participants[left]);
      const two = castById.get(event.participants[right]);
      if (!one || !two || sourceWorkIdentity(workspace, one.source.book_id) === sourceWorkIdentity(workspace, two.source.book_id)) continue;
      const synthesisIds = new Set([...(event.synthesis_ids ?? []), ...(one.synthesis_ids ?? []), ...(two.synthesis_ids ?? [])]);
      const reviewed = [...synthesisIds].some(id => {
        const books = booksCovered(synthesisById.get(id));
        return books.has(sourceWorkIdentity(workspace, one.source.book_id)) && books.has(sourceWorkIdentity(workspace, two.source.book_id));
      });
      if (!reviewed) unreviewed_pairings.push({ event_id: event.id, cast_ids: [one.id, two.id], source_book_ids: [one.source.book_id, two.source.book_id] });
    }
  }
  if (unreviewed_pairings.length) warnings.push({ code: 'unreviewed-source-pairings', pairings: unreviewed_pairings, message: 'These cross-source participant pairings have no linked synthesis covering both source books. A link records declared review, not compatibility or psychological plausibility.' });
  const normalized = text => text.normalize('NFC').trim().replace(/\s+/gu, ' ');
  for (const synthesis of syntheses) {
    const descriptions = new Map();
    for (const [index, contribution] of synthesis.contributions.entries()) {
      const key = JSON.stringify([normalized(contribution.technique), normalized(contribution.transformation)]);
      if (descriptions.has(key)) warnings.push({ code: 'repeated-contribution-description', synthesis_id: synthesis.id, contribution_indexes: [descriptions.get(key), index], message: 'These contributions use identical normalized technique and transformation descriptions; check whether their distinct functions need explanation. This is not a quality judgment.' });
      else descriptions.set(key, index);
    }
  }

  const arcs = [];
  for (const character of cast) {
    if (!character.arc) continue;
    const arc = character.arc;
    const arcIssues = [];
    const report = (code, message, extra = {}) => arcIssues.push({ code, cast_id: character.id, message, ...extra });
    const initialValues = new Set(states.flatMap(state => state.facts).filter(fact => fact.entity === character.id && fact.key === arc.baseline.key).map(fact => fact.value));
    if (initialValues.size !== 1 || !initialValues.has(arc.baseline.value)) report('arc-baseline-not-established', 'Initial states must establish exactly one unique value matching the declared baseline.', { key: arc.baseline.key, expected: arc.baseline.value, actual_values: [...initialValues] });
    if (arc.changed_value === arc.baseline.value) report('arc-value-unchanged', 'Declared changed value must differ from the baseline.');
    const change = eventById.get(arc.change_event_id);
    if (!change) report('arc-change-event-missing', 'Declared change event does not exist.', { event_id: arc.change_event_id });
    else if (!change.effects.some(effect => effect.entity === character.id && effect.key === arc.baseline.key && effect.value === arc.changed_value)) report('arc-change-effect-missing', 'Change event must explicitly set this character’s baseline key to the declared changed value.', { event_id: change.id });
    const pressureIds = arc.pressure_event_ids;
    for (const id of pressureIds) if (!eventById.has(id)) report('arc-pressure-event-missing', 'Declared pressure event does not exist.', { event_id: id });
    if (!pressureIds.length) report('arc-pressure-not-declared', 'An arc requires at least one declared pressure event.');
    else if (change && !pressureIds.some(id => eventById.has(id) && ancestors(change.id).has(id))) report('arc-pressure-not-ancestor', 'At least one declared pressure event must be a strict causal ancestor of the change event.', { event_id: change.id });
    arcs.push({ cast_id: character.id, status: arcIssues.length ? 'issues' : 'pass', issues: arcIssues });
    issues.push(...arcIssues);
  }
  return { issues, warnings, structure: { unused_cast_ids, unlabelled_event_ids, isolated_sequences, isolated_sequence_scope: 'Direct dependency edges between differently labelled sequences only; no claim about transitive links through unlabelled events.' }, crossover: { unreviewed_pairings, cast_source_mismatches }, arcs, psychological_plausibility_verified: false, literary_quality_verified: false, limitations: ['Arc checks cover declared initial facts, dependency ancestry and explicit effects only; they do not establish believable psychological development.', 'Source-pair coverage records declared synthesis links, not semantic compatibility or originality.'] };
}
