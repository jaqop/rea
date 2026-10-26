import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyContinuity, validateEventGraph } from './continuity.mjs';

const fact = (key, value, entity = 'hero', immutable = false) => ({ entity, key, value, immutable });
const event = (id, depends_on = [], requires = [], effects = []) => ({ id, revision: 1, title: id, participants: ['hero'], depends_on, requires, effects, rationale: 'Declared sequence' });
const state = facts => ({ id: 'initial', revision: 1, facts });
const check = (events, facts = [fact('alive', 'yes')], cast = [{ id: 'hero' }]) => verifyContinuity({ cast, states: [state(facts)], events });

test('valid causal chain uses causal order and supports new known-entity fact keys', () => {
  const result = check([event('escape', ['learn'], [fact('secret', 'known')]), event('learn', [], [fact('alive', 'yes')], [fact('secret', 'known')])]);
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.event_order, ['learn', 'escape']);
  assert.equal(result.literary_quality_verified, false);
  assert.equal(result.final_states.find(f => f.key === 'secret').value, 'known');
});

test('unknown cast participants and fact entities are explicit issues', () => {
  const result = check([{ ...event('arrive', [], [], [fact('alive', 'yes', 'ghost')]), participants: ['ghost'] }]);
  assert.ok(result.issues.some(i => i.code === 'unknown-participant'));
  assert.ok(result.issues.some(i => i.code === 'unknown-entity'));
  assert.equal(result.final_states.some(f => f.entity === 'ghost'), false);
});

test('graph validates dangling dependencies, cycles and duplicate event IDs', () => {
  assert.throws(() => validateEventGraph([event('a', ['absent'])]), /Unknown dependency/);
  assert.throws(() => validateEventGraph([event('a', ['b']), event('b', ['a'])]), /cycle/);
  assert.throws(() => validateEventGraph([event('a'), event('a')]), /Duplicate event/);
  assert.deepEqual(validateEventGraph([event('z'), event('a'), event('b', ['a'])]), ['a', 'b', 'z']);
  assert.equal(check([event('a', ['absent'])]).issues[0].code, 'invalid-graph');
});

test('unrelated knowledge cannot satisfy preconditions even if it sorts earlier', () => {
  const result = check([event('a_learn', [], [], [fact('secret', 'known')]), event('z_use', [], [fact('secret', 'known')], [fact('escaped', 'yes')])]);
  assert.ok(result.issues.some(i => i.event_id === 'z_use' && i.code === 'missing-precondition'));
  assert.equal(result.final_states.some(f => f.key === 'escaped'), false);
});

test('incomparable writes stay ambiguous; causal override resolves them', () => {
  const events = [event('a', [], [], [fact('location', 'east')]), event('b', [], [], [fact('location', 'west')]), event('c', ['a', 'b'], [fact('location', 'east')])];
  const result = check(events);
  assert.ok(result.issues.some(i => i.code === 'ambiguous-state' && i.event_id === 'c'));
  const final = result.final_states.find(f => f.key === 'location');
  assert.equal(final.value, null);
  assert.deepEqual(final.candidates.map(c => c.value).sort(), ['east', 'west']);
  events[1].depends_on = ['a'];
  events[2].requires = [fact('location', 'west')];
  const ordered = check(events);
  assert.equal(ordered.status, 'pass');
  assert.equal(ordered.final_states.find(f => f.key === 'location').value, 'west');
});

test('immutable world facts cannot be overridden even after previous matching assignments', () => {
  const result = check([event('a', [], [], [fact('magic', 'forbidden', 'world')]), event('b', ['a'], [], [fact('magic', 'allowed', 'world')])], [fact('magic', 'forbidden', 'world', true)]);
  assert.ok(result.issues.some(i => i.code === 'immutable-change' && i.event_id === 'b'));
  assert.equal(result.final_states.find(f => f.key === 'magic').value, 'forbidden');
});

test('failed events do not commit; dependents fail while independent branches continue', () => {
  const result = check([event('dead', [], [], [fact('alive', 'no')]), event('act', ['dead'], [fact('alive', 'yes')], [fact('reward', 'won')]), event('next', ['act'], [], [fact('prize', 'claimed')]), event('weather', [], [], [fact('rain', 'yes', 'world')])]);
  assert.ok(result.issues.some(i => i.code === 'conflicting-precondition' && i.event_id === 'act'));
  assert.ok(result.issues.some(i => i.code === 'dependency-failed' && i.event_id === 'next'));
  assert.equal(result.final_states.some(f => f.key === 'reward' || f.key === 'prize'), false);
  assert.equal(result.final_states.find(f => f.key === 'rain').value, 'yes');
});

test('duplicate initial facts and contradictory effect assignments are reported', () => {
  const result = verifyContinuity({ cast: [{ id: 'hero' }], states: [state([fact('alive', 'yes')]), { id: 'other', revision: 1, facts: [fact('alive', 'no')] }], events: [event('a', [], [], [fact('place', 'east'), fact('place', 'west')])] });
  assert.ok(result.issues.some(i => i.code === 'duplicate-fact'));
  assert.ok(result.issues.some(i => i.code === 'duplicate-effect'));
  assert.equal(result.final_states.find(f => f.key === 'alive').value, null);
  assert.equal(result.final_states.some(f => f.key === 'place'), false);
});

test('malformed inputs yield useful reports and never mutate caller data', () => {
  for (const input of [null, {}, { cast: [], states: [], events: [{ id: 'a' }] }, { cast: [], states: [state([{ entity: 'world', key: 'law', value: '' }])], events: [] }]) {
    const result = verifyContinuity(input);
    assert.equal(result.status, 'issues');
    assert.equal(result.issues[0].code, 'invalid-input');
  }
  const input = { cast: [{ id: 'hero' }], states: [state([fact('alive', 'yes')])], events: [event('a')] };
  const copy = structuredClone(input);
  verifyContinuity(input);
  assert.deepEqual(input, copy);
});

test('final concurrent disagreement is reported without a consumer; explicit merge can resolve it', () => {
  const branches = [event('east', [], [], [fact('location', 'east')]), event('west', [], [], [fact('location', 'west')])];
  const result = check(branches);
  assert.equal(result.status, 'issues');
  assert.ok(result.issues.some(i => i.code === 'ambiguous-state' && i.event_id === undefined));
  const resolved = check([...branches, event('merge', ['east', 'west'], [], [fact('location', 'meeting-place')])]);
  assert.equal(resolved.status, 'pass');
  assert.equal(resolved.final_states.find(f => f.key === 'location').value, 'meeting-place');
});

test('a thousand-event graph uses iterative traversal', () => {
  const events = Array.from({ length: 1000 }, (_, i) => event(`event${i}`, i ? [`event${i - 1}`] : []));
  assert.equal(validateEventGraph(events).length, 1000);
});
