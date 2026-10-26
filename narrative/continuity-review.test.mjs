import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyContinuity } from './continuity.mjs';
import { recordSchemas } from './workspace-contracts.mjs';
import { validateArguments } from './contracts.mjs';

const f = (entity, key, value, immutable = false) => ({ entity, key, value, immutable });
const e = (id, dependencies = [], requires = [], effects = []) => ({ id, revision: 1, title: id, rationale: 'Explicit test declaration', participants: ['hero'], depends_on: dependencies, requires, effects });
const s = (id, facts) => ({ id, revision: 1, facts });
const run = (events, states = []) => verifyContinuity({ cast: [{ id: 'hero' }, { id: 'constructor' }], states, events });

test('missing declared constraint blocks all event effects and dependent events', () => {
  const constrained = { ...e('act', [], [], [f('hero', 'won', 'yes')]), constrained_by: [{ entity: 'world', key: 'law' }] };
  const result = run([constrained, e('after', ['act'], [], [f('hero', 'celebrated', 'yes')])]);
  assert.ok(result.issues.some(i => i.event_id === 'act' && i.code === 'missing-constraint'));
  assert.ok(result.issues.some(i => i.event_id === 'after' && i.code === 'dependency-failed'));
  assert.equal(result.final_states.some(f => f.key === 'won' || f.key === 'celebrated'), false);
});

test('review: world knowledge does not supply character knowledge, or another character knowledge', () => {
  const result = run([e('use', [], [f('hero', 'knows', 'secret')])], [s('start', [f('world', 'knows', 'secret'), f('constructor', 'knows', 'secret')])]);
  assert.ok(result.issues.some(i => i.code === 'missing-precondition' && i.entity === 'hero'));
});

test('review: descendant assignment never leaks backward or into sibling branches', () => {
  const initial = [s('start', [f('hero', 'location', 'home')])];
  const events = [e('a_parent'), e('b_child', ['a_parent'], [], [f('hero', 'location', 'away')]), e('z_sibling', ['a_parent'], [f('hero', 'location', 'home')], [f('hero', 'rested', 'yes')])];
  const result = run(events, initial);
  assert.equal(result.issues.some(i => i.code === 'conflicting-precondition'), false);
  assert.ok(result.issues.some(i => i.code === 'unordered-read-write' && i.event_id === 'z_sibling' && i.other_event_id === 'b_child'));
  assert.equal(result.final_states.find(f => f.key === 'rested').value, 'yes');
});

test('review: causal maximum in one branch does not outrank an incomparable branch', () => {
  const result = run([e('a', [], [], [f('hero', 'position', 'old')]), e('b', ['a'], [], [f('hero', 'position', 'new')]), e('c', [], [], [f('hero', 'position', 'elsewhere')]), e('d', ['b', 'c'], [f('hero', 'position', 'new')])]);
  const problem = result.issues.find(i => i.event_id === 'd' && i.code === 'ambiguous-state');
  assert.deepEqual(problem.actual, ['elsewhere', 'new']);
  assert.equal(problem.actual.includes('old'), false);
});

test('review: initial conflict remains an issue even when a later explicit write resolves final candidates', () => {
  const result = run([e('decide', [], [], [f('hero', 'alive', 'yes')])], [s('one', [f('hero', 'alive', 'yes')]), s('two', [f('hero', 'alive', 'no')])]);
  assert.equal(result.status, 'issues');
  assert.ok(result.issues.some(i => i.code === 'duplicate-fact'));
  assert.equal(result.final_states.find(f => f.key === 'alive').value, 'yes');
});

test('review: immutable rules survive an attempted branch assignment and explicit merge', () => {
  const result = run([e('bad', [], [], [f('world', 'magic', 'yes')]), e('good', [], [], [f('hero', 'prepared', 'yes')]), e('merge', ['bad', 'good'], [], [f('world', 'magic', 'yes')])], [s('rules', [f('world', 'magic', 'no', true)])]);
  assert.ok(result.issues.some(i => i.code === 'immutable-change' && i.event_id === 'bad'));
  assert.ok(result.issues.some(i => i.code === 'dependency-failed' && i.event_id === 'merge'));
  assert.equal(result.final_states.find(f => f.key === 'magic').value, 'no');
  assert.equal(result.final_states.find(f => f.key === 'prepared').value, 'yes');
});

test('review: one invalid effect prevents every effect of that event and all dependent commits', () => {
  const result = run([e('partial', [], [], [f('hero', 'knows', 'secret'), f('ghost', 'knows', 'secret')]), e('dependent', ['partial'], [], [f('hero', 'won', 'yes')]), e('sibling', [], [], [f('world', 'sun', 'up')])]);
  assert.equal(result.final_states.some(f => f.key === 'knows' || f.key === 'won'), false);
  assert.equal(result.final_states.find(f => f.key === 'sun').value, 'up');
});

test('review: constructor-like identifiers are Map-safe and malformed fields are rejected', () => {
  const result = run([e('constructor', [], [], [f('constructor', 'constructor', 'safe')]), e('toString', ['constructor'], [f('constructor', 'constructor', 'safe')])]);
  assert.equal(result.status, 'pass');
  for (const events of [[{ ...e('bad'), effects: [f('hero', 'x', null)] }], [{ ...e('bad'), participants: null }], [{ ...e('bad'), revision: 0 }]]) {
    assert.equal(run(events).issues[0].code, 'invalid-input');
  }
});

test('review: workspace state immutable flag is optional and defaults to mutable', () => {
  const state = { id: 'start', label: 'Initial state', facts: [{ entity: 'hero', key: 'alive', value: 'yes' }] };
  assert.doesNotThrow(() => validateArguments(state, recordSchemas.states));
  const result = run([e('change', [], [], [f('hero', 'alive', 'no')])], [{ ...state, revision: 1 }]);
  assert.equal(result.status, 'pass');
  assert.equal(result.final_states.find(f => f.key === 'alive').value, 'no');
});
