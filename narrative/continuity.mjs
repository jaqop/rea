/** Continuity checks declared string facts only; no semantic or motive inference. */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be nonempty text.`);
}
function array(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
}
function fact(value, label) {
  if (!object(value)) throw new Error(`${label} must be a fact object.`);
  for (const key of ['entity', 'key', 'value']) text(value[key], `${label}.${key}`);
  if (value.immutable !== undefined && typeof value.immutable !== 'boolean') throw new Error(`${label}.immutable must be boolean.`);
}
const identity = value => JSON.stringify([value.entity, value.key]);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Return event IDs in deterministic lexical topological order, or throw. */
export function validateEventGraph(events) {
  array(events, 'events');
  const nodes = new Map();
  for (const event of events) {
    if (!object(event)) throw new Error('Each event must be an object.');
    text(event.id, 'event.id');
    array(event.depends_on, `${event.id}.depends_on`);
    event.depends_on.forEach(id => text(id, 'dependency'));
    if (new Set(event.depends_on).size !== event.depends_on.length) throw new Error(`Duplicate dependency for ${event.id}.`);
    if (nodes.has(event.id)) throw new Error(`Duplicate event ID: ${event.id}.`);
    nodes.set(event.id, event);
  }
  const indegree = new Map();
  const children = new Map([...nodes.keys()].map(id => [id, []]));
  for (const event of events) {
    indegree.set(event.id, event.depends_on.length);
    for (const dependency of event.depends_on) {
      if (!nodes.has(dependency)) throw new Error(`Unknown dependency ${dependency} in ${event.id}.`);
      children.get(dependency).push(event.id);
    }
  }
  const ready = [...nodes.keys()].filter(id => indegree.get(id) === 0).sort(compare);
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const child of children.get(id)) {
      indegree.set(child, indegree.get(child) - 1);
      if (indegree.get(child) === 0) { ready.push(child); ready.sort(compare); }
    }
  }
  if (order.length !== nodes.size) throw new Error('Event dependencies contain a cycle.');
  return order;
}

function validateInput(input) {
  if (!object(input)) throw new Error('Continuity input must be an object.');
  for (const key of ['cast', 'states', 'events']) array(input[key], key);
  for (const member of input.cast) {
    if (!object(member)) throw new Error('Each cast member must be an object.');
    text(member.id, 'cast.id');
    if (member.id === 'world') throw new Error('world is reserved for world facts.');
  }
  for (const state of input.states) {
    if (!object(state)) throw new Error('Each state must be an object.');
    text(state.id, 'state.id');
    if (!Number.isSafeInteger(state.revision) || state.revision < 1) throw new Error('state.revision must be a positive integer.');
    array(state.facts, 'state.facts');
    state.facts.forEach(value => fact(value, 'state.fact'));
  }
  for (const event of input.events) {
    if (!object(event)) throw new Error('Each event must be an object.');
    for (const key of ['id', 'title', 'rationale']) text(event[key], `event.${key}`);
    if (!Number.isSafeInteger(event.revision) || event.revision < 1) throw new Error('event.revision must be a positive integer.');
    for (const key of ['participants', 'depends_on', 'requires', 'effects']) array(event[key], `event.${key}`);
    if (event.constrained_by !== undefined) {
      array(event.constrained_by, 'event.constrained_by');
      for (const reference of event.constrained_by) {
        if (!object(reference)) throw new Error('event.constrained_by must contain fact references.');
        text(reference.entity, 'event.constrained_by.entity');
        text(reference.key, 'event.constrained_by.key');
      }
    }
    event.participants.forEach(id => text(id, 'participant'));
    event.requires.forEach(value => fact(value, 'event.requires'));
    event.effects.forEach(value => fact(value, 'event.effects'));
  }
}

export function verifyContinuity(input) {
  const issues = [];
  const report = (event_order = [], final_states = []) => ({ status: issues.length ? 'issues' : 'pass', issues, event_order, final_states, scope: 'Declared string facts, participants, immutable rules, constraint existence and causal dependencies only. Constraint existence does not establish semantic influence; no motive, semantic compatibility or reader-response verification.', literary_quality_verified: false });
  try { validateInput(input); }
  catch (cause) { issues.push({ code: 'invalid-input', message: cause.message }); return report(); }
  let order;
  try { order = validateEventGraph(input.events); }
  catch (cause) { issues.push({ code: 'invalid-graph', message: cause.message }); return report(); }
  const { cast, states, events } = input;
  const castIds = new Set();
  for (const member of cast) {
    if (castIds.has(member.id)) issues.push({ code: 'duplicate-cast', entity: member.id, message: `Duplicate cast identity ${member.id}.` });
    castIds.add(member.id);
  }
  const known = entity => entity === 'world' || castIds.has(entity);
  const byId = new Map(events.map(event => [event.id, event]));
  const ancestors = new Map();
  for (const id of order) {
    const inherited = new Set();
    for (const dependency of byId.get(id).depends_on) {
      inherited.add(dependency);
      for (const ancestor of ancestors.get(dependency)) inherited.add(ancestor);
    }
    ancestors.set(id, inherited);
  }
  const assignments = [];
  const immutable = new Map();
  const initialKeys = new Set();
  const stateIds = new Set();
  for (const state of [...states].sort((a, b) => compare(a.id, b.id))) {
    if (stateIds.has(state.id)) issues.push({ code: 'duplicate-state', message: `Duplicate state identity ${state.id}; revisions are not automatically merged.` });
    stateIds.add(state.id);
    for (const value of state.facts) {
      const key = identity(value);
      if (!known(value.entity)) { issues.push({ code: 'unknown-entity', entity: value.entity, key: value.key, message: 'Initial fact refers to an unknown cast entity.' }); continue; }
      if (initialKeys.has(key)) issues.push({ code: 'duplicate-fact', entity: value.entity, key: value.key, message: 'Multiple initial declarations share this fact identity; none takes precedence.' });
      initialKeys.add(key);
      assignments.push({ entity: value.entity, key: value.key, value: value.value, immutable: value.immutable === true, writer_event_id: null, state_id: state.id });
      if (value.immutable) {
        if (!immutable.has(key)) immutable.set(key, new Set());
        immutable.get(key).add(value.value);
      }
    }
  }
  // Keep only causal maxima for each identity. A lexical processing order is
  // scheduling, never state visibility or conflict resolution.
  function visible(scope) {
    const grouped = new Map();
    for (const assignment of assignments) {
      if (assignment.writer_event_id !== null && scope && !scope.has(assignment.writer_event_id)) continue;
      const key = identity(assignment);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(assignment);
    }
    for (const [key, values] of grouped) grouped.set(key, values.filter(value => !values.some(other => other.writer_event_id !== null && (value.writer_event_id === null || ancestors.get(other.writer_event_id).has(value.writer_event_id)))));
    return grouped;
  }
  const failed = new Set();
  for (const id of order) {
    const event = byId.get(id);
    const before = issues.length;
    for (const participant of event.participants) if (!castIds.has(participant)) issues.push({ code: 'unknown-participant', event_id: id, entity: participant, message: 'Participant is not in the declared cast.' });
    for (const value of [...event.requires, ...event.effects]) if (!known(value.entity)) issues.push({ code: 'unknown-entity', event_id: id, entity: value.entity, key: value.key, message: 'Event fact refers to an unknown entity.' });
    if (event.depends_on.some(dependency => failed.has(dependency))) issues.push({ code: 'dependency-failed', event_id: id, message: 'A dependency failed continuity checks; this event cannot commit effects.' });
    const current = visible(ancestors.get(id));
    for (const reference of event.constrained_by ?? []) {
      const context = { event_id: id, entity: reference.entity, key: reference.key };
      if (!known(reference.entity)) { issues.push({ code: 'unknown-entity', ...context, message: 'Constraint refers to an unknown entity.' }); continue; }
      const candidates = [...new Set((current.get(identity(reference)) ?? []).map(value => value.value))].sort(compare);
      if (!candidates.length) issues.push({ code: 'missing-constraint', ...context, message: 'No initial or causal ancestor fact establishes this constraint reference.' });
      else if (candidates.length > 1) issues.push({ code: 'ambiguous-constraint', ...context, actual: candidates, message: 'Constraint reference has incomparable conflicting assignments.' });
    }
    const required = new Set();
    for (const requirement of event.requires) {
      const key = identity(requirement);
      if (required.has(key)) issues.push({ code: 'duplicate-precondition', event_id: id, entity: requirement.entity, key: requirement.key, message: 'Duplicate precondition identity.' });
      required.add(key);
      const candidates = [...new Set((current.get(key) ?? []).map(value => value.value))].sort(compare);
      const context = { event_id: id, entity: requirement.entity, key: requirement.key, expected: requirement.value };
      if (!candidates.length) issues.push({ code: 'missing-precondition', ...context, message: 'No initial or causal ancestor fact establishes this precondition.' });
      else if (candidates.length > 1) issues.push({ code: 'ambiguous-state', ...context, actual: candidates, message: 'Incomparable fact assignments disagree; no causal winner exists.' });
      else if (candidates[0] !== requirement.value) issues.push({ code: 'conflicting-precondition', ...context, actual: candidates[0], message: 'Declared causal state conflicts with the required value.' });
    }
    const effectKeys = new Set();
    for (const effect of event.effects) {
      const key = identity(effect);
      if (effectKeys.has(key)) issues.push({ code: 'duplicate-effect', event_id: id, entity: effect.entity, key: effect.key, message: 'An event cannot assign the same fact identity more than once.' });
      effectKeys.add(key);
      const rules = immutable.get(key);
      if (rules && [...rules].some(value => value !== effect.value)) issues.push({ code: 'immutable-change', event_id: id, entity: effect.entity, key: effect.key, expected: [...rules].sort(compare), actual: effect.value, message: 'Effect would change an immutable initial fact.' });
    }
    if (issues.length > before) { failed.add(id); continue; }
    for (const effect of event.effects) assignments.push({ entity: effect.entity, key: effect.key, value: effect.value, immutable: immutable.has(identity(effect)), writer_event_id: id });
  }
  // Independently valid branches may still require incompatible interleavings.
  // Report their unordered read/write hazard after commits; do not invent an
  // execution order or retroactively remove effects from either branch.
  for (const id of order) {
    if (failed.has(id)) continue;
    for (const requirement of byId.get(id).requires) {
      for (const assignment of assignments) {
        const writer = assignment.writer_event_id;
        if (writer === null || writer === id || ancestors.get(id).has(writer) || ancestors.get(writer).has(id)) continue;
        if (identity(requirement) === identity(assignment) && requirement.value !== assignment.value) issues.push({ code: 'unordered-read-write', event_id: id, other_event_id: writer, entity: requirement.entity, key: requirement.key, expected: requirement.value, actual: assignment.value, message: 'An incomparable committed event changes a required fact; declare the intended dependency order.' });
      }
    }
  }
  const final = [...visible(null).values()].map(candidates => {
    candidates.sort((a, b) => compare(a.value, b.value) || compare(a.writer_event_id ?? '', b.writer_event_id ?? '') || compare(a.state_id ?? '', b.state_id ?? ''));
    const { entity, key } = candidates[0];
    const values = new Set(candidates.map(candidate => candidate.value));
    if (values.size > 1) issues.push({ code: 'ambiguous-state', entity, key, actual: [...values], message: 'Causally final assignments disagree; final state remains unresolved.' });
    return { entity, key, value: values.size === 1 ? candidates[0].value : null, status: values.size === 1 ? 'resolved' : 'ambiguous', immutable: immutable.has(identity(candidates[0])), candidates: candidates.map(candidate => ({ ...candidate })) };
  }).sort((a, b) => compare(a.entity, b.entity) || compare(a.key, b.key));
  return report(order, final);
}
