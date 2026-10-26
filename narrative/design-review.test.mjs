import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewDesign } from './design-review.mjs';

const cast = (id, book_id) => ({ id, source: { book_id, kind: 'analyses', id: 'same_character_id' } });
const event = (id, depends_on = [], participants = [], extra = {}) => ({ id, depends_on, participants, effects: [], synthesis_ids: [], ...extra });
const workspace = (extra = {}) => ({ mode: 'crossover', cast: [], states: [], events: [], syntheses: [], ...extra });

test('arc validates initial baseline, strict pressure ancestry and declared changed effect', () => {
  const character = { ...cast('hero', 'book_a'), arc: { baseline: { key: 'trust', value: 'none' }, pressure_event_ids: ['pressure'], change_event_id: 'choice', changed_value: 'earned' } };
  const input = workspace({ cast: [character], states: [{ facts: [{ entity: 'hero', key: 'trust', value: 'none' }] }], events: [event('pressure'), event('bridge', ['pressure']), event('choice', ['bridge'], ['hero'], { effects: [{ entity: 'hero', key: 'trust', value: 'earned' }] })] });
  const report = reviewDesign(input);
  assert.equal(report.arcs[0].status, 'pass');
  assert.equal(report.psychological_plausibility_verified, false);
  const failed = structuredClone(input);
  failed.events[2].depends_on = [];
  assert.equal(reviewDesign(failed).arcs[0].status, 'issues');
  assert.ok(reviewDesign(failed).arcs[0].issues.some(issue => issue.code === 'arc-pressure-not-ancestor'));
});

test('arc reports missing IDs, contradictory baseline and unchanged result explicitly', () => {
  const hero = { ...cast('hero', 'book_a'), arc: { baseline: { key: 'trust', value: 'none' }, pressure_event_ids: ['absent'], change_event_id: 'missing', changed_value: 'none' } };
  const report = reviewDesign(workspace({ cast: [hero], states: [{ facts: [{ entity: 'hero', key: 'trust', value: 'yes' }, { entity: 'hero', key: 'trust', value: 'none' }] }] }));
  const codes = report.arcs[0].issues.map(issue => issue.code);
  assert.ok(codes.includes('arc-baseline-not-established'));
  assert.ok(codes.includes('arc-change-event-missing'));
  assert.ok(codes.includes('arc-pressure-event-missing'));
  assert.ok(codes.includes('arc-value-unchanged'));
  assert.ok(report.issues.length);
});

test('pair coverage uses source-qualified books despite equal local record IDs', () => {
  const input = workspace({ cast: [cast('one', 'book_a'), cast('two', 'book_b')], events: [event('meeting', [], ['one', 'two'])] });
  assert.deepEqual(reviewDesign(input).crossover.unreviewed_pairings, [{ event_id: 'meeting', cast_ids: ['one', 'two'], source_book_ids: ['book_a', 'book_b'] }]);
  input.syntheses = [{ id: 'blend', contributions: [{ source: { book_id: 'book_a' }, technique: 'A', transformation: 'B' }, { source: { book_id: 'book_b' }, technique: 'C', transformation: 'D' }] }];
  input.cast[0].synthesis_ids = ['blend'];
  assert.equal(reviewDesign(input).crossover.unreviewed_pairings.length, 0);
  input.syntheses[0].contributions.pop();
  input.cast[1].synthesis_ids = ['blend'];
  assert.deepEqual(reviewDesign(input).crossover.cast_source_mismatches, [{ cast_id: 'two', synthesis_id: 'blend' }]);
});

test('structure gaps are warnings and isolated labels mean only direct labelled edges', () => {
  const report = reviewDesign(workspace({ cast: [cast('unused', 'book_a')], events: [event('a', [], [], { sequence: 'first' }), event('middle', ['a']), event('b', ['middle'], [], { sequence: 'second' })] }));
  assert.deepEqual(report.structure.unused_cast_ids, ['unused']);
  assert.deepEqual(report.structure.unlabelled_event_ids, ['middle']);
  assert.deepEqual(report.structure.isolated_sequences, ['first', 'second']);
  assert.equal(report.issues.length, 0);
  assert.ok(report.warnings.length >= 3);
  assert.match(report.structure.isolated_sequence_scope, /direct/i);
});

test('duplicate contribution descriptions warn without judging design quality or mode', () => {
  const report = reviewDesign(workspace({ mode: 'original-inspired', syntheses: [{ id: 'blend', contributions: [{ source: { book_id: 'a' }, technique: ' A  B ', transformation: 'cafe\u0301' }, { source: { book_id: 'b' }, technique: 'A B', transformation: 'café' }] }] }));
  assert.ok(report.warnings.some(issue => issue.code === 'repeated-contribution-description'));
  assert.equal(report.issues.length, 0);
  assert.equal(report.literary_quality_verified, false);
});
