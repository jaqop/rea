import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyContinuity } from './continuity.mjs';
const fact = (entity, key, value, immutable = false) => ({ entity, key, value, immutable });
const event = (id, depends_on = [], requires = [], effects = [], constrained_by) => ({ id, revision: 1, title: id, participants: ['hero'], depends_on, requires, effects, rationale: 'Declared test', ...(constrained_by === undefined ? {} : { constrained_by }) });
const run = (events, facts = [fact('world', 'gate', 'closed')]) => verifyContinuity({ cast: [{ id: 'hero' }, { id: 'other' }], states: [{ id: 'start', revision: 1, facts }], events });

test('unordered conflicting read/write is reported without rejecting committed effects', () => {
  const result = run([event('A', [], [fact('world', 'gate', 'closed')], [fact('world', 'gate', 'open')]), event('B', [], [fact('world', 'gate', 'closed')], [fact('hero', 'crossed', 'yes')])]);
  assert.ok(result.issues.some(i => i.code === 'unordered-read-write' && i.event_id === 'B' && i.other_event_id === 'A'));
  assert.equal(result.final_states.find(f => f.key === 'crossed').value, 'yes');
});

test('ordering writer after reader resolves race; ordering reader after writer exposes conflict', () => {
  assert.equal(run([event('A', ['B'], [fact('world', 'gate', 'closed')], [fact('world', 'gate', 'open')]), event('B', [], [fact('world', 'gate', 'closed')])]).status, 'pass');
  const result = run([event('A', [], [fact('world', 'gate', 'closed')], [fact('world', 'gate', 'open')]), event('B', ['A'], [fact('world', 'gate', 'closed')])]);
  assert.ok(result.issues.some(i => i.code === 'conflicting-precondition' && i.event_id === 'B'));
  assert.equal(result.issues.some(i => i.code === 'unordered-read-write'), false);
});

test('failed and same-value incomparable writes do not cause read/write warnings', () => {
  const result = run([event('failed', [], [fact('hero', 'permission', 'yes')], [fact('world', 'gate', 'open')]), event('same', [], [], [fact('world', 'gate', 'closed')]), event('read', [], [fact('world', 'gate', 'closed')])]);
  assert.equal(result.issues.some(i => i.code === 'unordered-read-write'), false);
});

test('constraint references require visible declared facts without asserting semantic effect', () => {
  const result = run([event('A', [], [], [], [{ entity: 'world', key: 'gate' }])], [fact('world', 'gate', 'closed', true)]);
  assert.equal(result.status, 'pass');
  assert.equal(result.literary_quality_verified, false);
});

test('constraints report missing, ambiguous and unknown entities separately', () => {
  const result = run([event('A', [], [], [fact('world', 'place', 'east')]), event('B', [], [], [fact('world', 'place', 'west')]), event('C', ['A', 'B'], [], [], [{ entity: 'world', key: 'place' }, { entity: 'hero', key: 'secret' }, { entity: 'ghost', key: 'exists' }])]);
  assert.ok(result.issues.some(i => i.code === 'ambiguous-constraint' && i.event_id === 'C'));
  assert.ok(result.issues.some(i => i.code === 'missing-constraint' && i.entity === 'hero'));
  assert.ok(result.issues.some(i => i.code === 'unknown-entity' && i.entity === 'ghost'));
});

test('constraints do not borrow another character knowledge or unrelated effects', () => {
  const result = run([event('A', [], [], [fact('hero', 'knows', 'secret')]), event('B', [], [], [], [{ entity: 'hero', key: 'knows' }])], [fact('other', 'knows', 'secret')]);
  assert.ok(result.issues.some(i => i.code === 'missing-constraint' && i.event_id === 'B'));
});

test('constraint shape validates array, object, entity and key', () => {
  for (const constraints of [null, {}, [null], [{ entity: 'world' }], [{ entity: '', key: 'gate' }]]) {
    assert.equal(run([event('A', [], [], [], constraints)]).issues[0].code, 'invalid-input');
  }
});
