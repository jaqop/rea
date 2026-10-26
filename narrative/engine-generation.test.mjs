import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { generateAdaptation } from './engine-generation.mjs';
import { generateLocal } from './model-runtime.mjs';

const target = 'I hold the gate. I choose to stay. I pay the price.';
const candidate = 'I brace the gate. I decide to stay. I accept the price.';
const plan = { strategy: 'Make the choice close an escape route.', beats: [{ fragment_index: 0, change: 'Staying prevents an easy retreat.', preserve: 'The gate remains held.' }], canon_checks: ['Keep narrator and outcome.'] };
const mechanism = { id: 'mechanism_1', title: 'Choice under cost', focus: 'plot', claimed_effect: 'A choice closes an option.', alternative: 'External pressure alone explains the loss.', steps: ['Force a costly choice.'], quote: 'SECRET QUOTATION', source_entities: ['SourceHero'] };
const promptData = prompt => JSON.parse(prompt.split('\n\nOUTPUT_BOUNDARY:')[0]);
const planFor = request => ({ ...plan, beats: promptData(request.prompt).fragment_manifest.map(fragment => ({ ...plan.beats[0], fragment_index: fragment.index })) });

test('plan requires exactly one ordered beat for every real fragment and never proportionally reuses beats', async () => {
  const original = 'I stand at the gate. '.repeat(210);
  const prompts = [];
  const result = await generateAdaptation({ targetText: original, mechanisms: [mechanism], call: async request => {
    const data = promptData(request.prompt); prompts.push(data);
    if (request.json) return { text: JSON.stringify({ ...planFor(request), beats: data.fragment_manifest.map(fragment => ({ fragment_index: fragment.index, change: `Local change ${fragment.index}`, preserve: `Local baseline ${fragment.index}` })) }) };
    return { text: data.current_fragment.replace(/\bstand\b/gu, 'brace') };
  } });
  const manifest = prompts[0].fragment_manifest;
  assert.equal(manifest.length, result.segments.length);
  assert.ok(manifest.every(fragment => Number.isInteger(fragment.words) && fragment.first_words && fragment.last_words));
  for (const data of prompts.slice(1)) assert.equal(data.relevant_plan_beat.fragment_index, data.fragment_index);
  for (const badBeats of [[], [plan.beats[0], plan.beats[0]], [{ ...plan.beats[0], fragment_index: 4 }]]) {
    let attempts = 0;
    await assert.rejects(generateAdaptation({ targetText: target, mechanisms: [mechanism], call: async () => { attempts++; return { text: JSON.stringify({ ...plan, beats: badBeats }) }; } }), /plan.*3 attempts/i);
    assert.equal(attempts, 3);
  }
  await assert.rejects(generateAdaptation({ targetText: original, mechanisms: [mechanism], call: async request => ({ text: JSON.stringify({ ...planFor(request), beats: promptData(request.prompt).fragment_manifest.map(() => plan.beats[0]) }) }) }), /exactly once in source order/i);
  let planningAttempts = 0; const repairedPrompts = [];
  const repaired = await generateAdaptation({ targetText: target, mechanisms: [mechanism], call: async request => {
    if (!request.json) return { text: candidate };
    repairedPrompts.push(request.prompt);
    const output = planFor(request);
    if (++planningAttempts === 1) output.beats[0].fragment_index = 99;
    return { text: JSON.stringify(output) };
  } });
  assert.equal(planningAttempts, 2);
  assert.match(repairedPrompts[1], /previous_attempt_errors/u);
  assert.equal(repaired.plan.beats[0].fragment_index, 0);
});

test('compact plan schema and runtime validation reject oversized individual and total output', async () => {
  const invalid = [
    { ...plan, strategy: 'x'.repeat(601) },
    { ...plan, beats: [{ ...plan.beats[0], change: 'x'.repeat(401) }] },
    { ...plan, beats: [{ ...plan.beats[0], preserve: 'x'.repeat(401) }] },
    { ...plan, canon_checks: ['x'.repeat(241)] },
    { ...plan, canon_checks: Array(13).fill('A check.') },
  ];
  for (const output of invalid) await assert.rejects(generateAdaptation({ targetText: target, mechanisms: [], call: async () => ({ text: JSON.stringify(output) }) }), /plan.*3 attempts/i);
  let schema;
  await generateAdaptation({ targetText: target, mechanisms: [], call: async request => {
    if (request.json) { schema = request.schema; assert.match(request.prompt, /2000 words/u); }
    return { text: request.json ? JSON.stringify(planFor(request)) : candidate };
  } });
  assert.equal(schema.properties.strategy.maxLength, 600);
  assert.equal(schema.properties.beats.items.properties.change.maxLength, 400);
  assert.equal(schema.properties.beats.items.properties.preserve.maxLength, 400);
  assert.equal(schema.properties.canon_checks.maxItems, 12);
  assert.equal(schema.properties.canon_checks.items.maxLength, 240);
  const longTarget = 'I stand beside the gate. '.repeat(1500);
  await assert.rejects(generateAdaptation({ targetText: longTarget, mechanisms: [], call: async request => {
    const output = planFor(request);
    output.beats = output.beats.map(beat => ({ ...beat, change: 'c'.repeat(400), preserve: 'p'.repeat(400) }));
    return { text: JSON.stringify(output) };
  } }), /12000 UTF8 bytes/u);
});

test('protected author phrases and names crossing a nominal chunk boundary cannot disappear', async () => {
  for (const [key, phrase] of [['must_keep', 'keepA keepB'], ['preserve_names', 'Mira Vale']]) {
    const original = 'I '.repeat(499) + phrase + ' wait '.repeat(101);
    const seen = [];
    await assert.rejects(generateAdaptation({ targetText: original, mechanisms: [], [key]: [phrase], call: async request => {
      if (request.json) return { text: JSON.stringify(planFor(request)) };
      const data = promptData(request.prompt); seen.push(data);
      return { text: data.current_fragment.replaceAll('I ', 'We ').replace(phrase, 'someone else') };
    } }), /preserve required local (?:phrase|name)/u);
    assert.equal(seen[0].fragment_count, 1);
    assert.ok(seen[0].current_fragment.includes(phrase));
    const result = await generateAdaptation({ targetText: original, mechanisms: [], [key]: [phrase], call: async request => ({ text: request.json ? JSON.stringify(planFor(request)) : promptData(request.prompt).current_fragment.replaceAll('I ', 'We ') }) });
    assert.ok(result.text.includes(phrase));
  }
});

test('unchanged prose and heading/punctuation-only repackaging fail closed', async () => {
  for (const unchanged of [target, '# Experimental draft\n\nI hold the gate! I choose to stay; I pay the price?']) {
    await assert.rejects(generateAdaptation({ targetText: target, mechanisms: [mechanism], call: async request => ({ text: request.json ? JSON.stringify(planFor(request)) : unchanged }) }), /unchanged/i);
  }
});

test('explicit local preserved names reject a rename independently of natural-language constraints', async () => {
  const original = 'I watch Mira at the gate. I choose to stay and pay the price.';
  await assert.rejects(generateAdaptation({ targetText: original, mechanisms: [mechanism], preserve_names: ['Mira'], constraints: ['Preserve Mira.'], call: async request => ({ text: request.json ? JSON.stringify(planFor(request)) : 'I watch Nora by the gate. I decide to stay and accept the price.' }) }), /preserv.*Mira/i);
});

test('source names use Unicode term boundaries rather than substrings', async () => {
  const result = await generateAdaptation({ targetText: target, mechanisms: [{ ...mechanism, source_entities: ['Ann'] }], call: async request => ({ text: request.json ? JSON.stringify(planFor(request)) : 'I feel annoyed at the gate. I decide to stay and accept the price.' }) });
  assert.ok(result.text.includes('annoyed'));
});

test('portable transfer rules exclude source-scene conditions and other source construction fields', async () => {
  const requests = [];
  const card = { ...mechanism, transfer_rule: 'Make each exit choice sacrifice a different resource.', conditions: ['six horsemen with a cart'], title: 'Source scene title', steps: ['Source scene events happen here.'], test: 'Source-specific test', alternative: 'Source-specific rival' };
  await generateAdaptation({ targetText: target, mechanisms: [card], call: async request => {
    requests.push(request);
    return { text: request.json ? JSON.stringify(planFor(request)) : candidate };
  } });
  for (const request of requests) {
    const data = promptData(request.prompt);
    assert.deepEqual(data.abstract_mechanisms, [{ id: mechanism.id, focus: mechanism.focus, transfer_rule: card.transfer_rule }]);
    for (const excluded of ['six horsemen with a cart', card.title, card.steps[0], card.test, card.alternative]) assert.ok(!request.prompt.includes(excluded));
  }
});

test('preservation names are required only in their original fragment', async () => {
  const original = 'Mira waits. ' + 'I stand beside the gate. '.repeat(100) + '\n\nNora waits. ' + 'I stand beside the gate. '.repeat(100);
  const localNames = [];
  await generateAdaptation({ targetText: original, mechanisms: [mechanism], preserve_names: ['Mira', 'Nora'], call: async request => {
    if (request.json) return { text: JSON.stringify(planFor(request)) };
    const data = promptData(request.prompt); localNames.push(data.required_local_names);
    return { text: data.current_fragment.replace(/\bstand\b/gu, 'brace') };
  } });
  assert.deepEqual(localNames, [['Mira'], ['Nora']]);
});

test('must_keep author phrases are exact local guards and missing phrases trigger model retry', async () => {
  let drafts = 0; const prompts = [];
  const result = await generateAdaptation({ targetText: target, mechanisms: [mechanism], must_keep: ['I pay the price.', 'Not in this fragment.'], call: async request => {
    if (request.json) return { text: JSON.stringify(planFor(request)) };
    prompts.push(promptData(request.prompt));
    return { text: ++drafts === 1 ? candidate : 'I brace the gate. I decide to stay. I pay the price.' };
  } });
  assert.equal(drafts, 2);
  assert.deepEqual(prompts[0].required_local_phrases, ['I pay the price.']);
  assert.ok(result.text.includes('I pay the price.'));
  await assert.rejects(generateAdaptation({ targetText: target, mechanisms: [mechanism], must_keep: ['I pay the price.'], call: async request => ({ text: request.json ? JSON.stringify(planFor(request)) : candidate }) }), /phrase/i);
});

test('must_keep phrases from another fragment are not forced into current prose', async () => {
  const original = 'Mira waits beside me. ' + 'I stand beside the gate. '.repeat(100) + '\n\nNora stays behind me. ' + 'I stand beside the gate. '.repeat(100);
  const localPhrases = [];
  await generateAdaptation({ targetText: original, mechanisms: [mechanism], must_keep: ['Mira waits beside me.', 'Nora stays behind me.'], call: async request => {
    if (request.json) return { text: JSON.stringify(planFor(request)) };
    const data = promptData(request.prompt); localPhrases.push(data.required_local_phrases);
    return { text: data.current_fragment.replace(/\bstand\b/gu, 'brace') };
  } });
  assert.deepEqual(localPhrases, [['Mira waits beside me.'], ['Nora stays behind me.']]);
});

test('heading-only names and protected phrases do not force chapter labels into generated prose', async () => {
  const original = '# Chapter1 - Fog - Mira\n\nI wait at the gate. I choose to stay. I pay the price.';
  let local;
  const result = await generateAdaptation({ targetText: original, mechanisms: [mechanism], preserve_names: ['Mira', 'Fog'], must_keep: ['Chapter1 - Fog - Mira'], call: async request => {
    if (request.json) return { text: JSON.stringify(planFor(request)) };
    local = promptData(request.prompt);
    return { text: candidate };
  } });
  assert.deepEqual(local.required_local_names, []);
  assert.deepEqual(local.required_local_phrases, []);
  assert.equal(result.text, candidate);
  await assert.rejects(generateAdaptation({ targetText: original + '\nMira stands beside me.', mechanisms: [mechanism], preserve_names: ['Mira'], call: async request => ({ text: request.json ? JSON.stringify(planFor(request)) : candidate + ' I remain beside the gate.' }) }), /preserve required local name: Mira/u);
});

test('new long paragraph duplication is rejected inside a fragment and across accepted fragments', async () => {
  const paragraph = 'I brace the heavy gate with both hands while the rain runs down my sleeves and gathers around my feet.';
  const other = 'I watch the narrow passage behind me and listen for the footsteps that would tell me whether anyone follows my retreat.';
  const original = paragraph + '\n\n' + other;
  await assert.rejects(generateAdaptation({ targetText: original, mechanisms: [], call: async request => ({ text: request.json ? JSON.stringify(planFor(request)) : paragraph + '\n\n' + paragraph }) }), /duplicat.*paragraph/i);
  const longOriginal = 'I stand beside the gate. '.repeat(100) + '\n\n' + 'I wait beside the wall. '.repeat(100);
  let lastAttempts = 0;
  await assert.rejects(generateAdaptation({ targetText: longOriginal, mechanisms: [], call: async request => {
    if (request.json) return { text: JSON.stringify(planFor(request)) };
    const data = promptData(request.prompt);
    if (data.fragment_index === 1) lastAttempts++;
    return { text: paragraph + '\n\n' + data.current_fragment.replace(/\bstand\b/gu, 'brace').replace(/\bwait\b/gu, 'watch') };
  } }), /duplicat.*paragraph/i);
  assert.equal(lastAttempts, 3);
});

test('intentional original long paragraph duplicates and short refrains remain allowed', async () => {
  const paragraph = 'I brace the heavy gate with both hands while the rain runs down my sleeves and gathers around my feet.';
  const original = paragraph + '\n\n' + paragraph + '\n\nI wait.\n\nI wait.';
  const output = paragraph + '\n\n' + paragraph + '\n\nI stay.\n\nI stay.';
  const result = await generateAdaptation({ targetText: original, mechanisms: [], call: async request => ({ text: request.json ? JSON.stringify(planFor(request)) : output }) });
  assert.equal(result.text, output);
});

test('source borrowing callback gates model candidates and cannot leak reference excerpts into retry prompts', async () => {
  let drafts = 0; const prompts = [];
  const result = await generateAdaptation({ targetText: target, mechanisms: [mechanism], checkProse: () => ({ rejected: drafts === 1 ? [{ text: 'PRIVATE_REFERENCE_EXCERPT' }] : [], review: [{ reason: 'Human check' }] }), call: async request => {
    prompts.push(request.prompt);
    if (request.json) return { text: JSON.stringify(planFor(request)) };
    drafts++; return { text: candidate };
  } });
  assert.equal(drafts, 2);
  assert.ok(prompts.at(-1).includes('borrowing'));
  assert.ok(prompts.every(prompt => !prompt.includes('PRIVATE_REFERENCE_EXCERPT') && !prompt.includes('checkProse')));
  assert.equal(result.segments[0].checks.borrowing_review.length, 1);
  await assert.rejects(generateAdaptation({ targetText: target, mechanisms: [], checkProse: () => ({ rejected: [{}], review: [] }), call: async request => ({ text: request.json ? JSON.stringify(planFor(request)) : candidate }) }), /borrowing/i);
});

test('writer requests satisfy actual strict runtime contract through a fake HTTP boundary', async () => {
  let requests = 0;
  const result = await generateAdaptation({ targetText: target, mechanisms: [mechanism], call: request => generateLocal(request, { requestFactory: (_options, receive) => {
    const outgoing = new EventEmitter(); outgoing.destroy = () => {};
    outgoing.end = body => {
      requests++;
      const payload = JSON.parse(body);
      const incoming = new PassThrough(); incoming.statusCode = 200;
      queueMicrotask(() => { receive(incoming); incoming.end(JSON.stringify({ done: true, done_reason: 'stop', response: typeof payload.format === 'object' ? JSON.stringify(plan) : candidate })); });
    };
    return outgoing;
  } }) });
  assert.equal(requests, 2);
  assert.equal(result.text, candidate);
});

test('program requests model plan then prose, excludes source quotes/entities and retains provenance', async () => {
  const requests = []; const events = [];
  const result = await generateAdaptation({ targetText: target, mechanisms: [mechanism], constraints: ['Keep the gate held.'], call: async request => {
    requests.push(request);
    return { text: request.json ? JSON.stringify(planFor(request)) : candidate, model: 'fake-local', elapsed_ms: 1 };
  }, emit: async event => events.push(event) });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].json, true);
  assert.ok(requests[1].prompt.includes(target));
  assert.equal(Object.hasOwn(promptData(requests[1].prompt), 'original_whole_chapter'), false);
  assert.ok(!requests.some(request => request.prompt.includes('SECRET QUOTATION') || request.prompt.includes('SourceHero')));
  assert.ok(requests[1].system.includes('first person'));
  assert.ok(requests.every(request => request.max_tokens <= 8192));
  const allowed = new Set(['system', 'prompt', 'json', 'schema', 'max_tokens', 'temperature', 'seed', 'model']);
  assert.ok(requests.every(request => Object.keys(request).every(key => allowed.has(key)) && typeof request.temperature === 'number' && !Object.hasOwn(request, 'temp')));
  assert.ok(requests[0].prompt.includes('claimed_effect') && requests[0].prompt.includes(mechanism.alternative));
  assert.ok(requests[0].prompt.includes(mechanism.id));
  assert.equal(requests[0].schema.additionalProperties, false);
  assert.deepEqual(requests[0].schema.required, ['strategy', 'beats', 'canon_checks']);
  assert.equal(requests[0].schema.properties.beats.minItems, 1);
  assert.equal(requests[0].schema.properties.beats.maxItems, 1);
  assert.deepEqual(requests[0].schema.properties.beats.items.properties.fragment_index.enum, [0]);
  assert.equal(Object.hasOwn(requests[1], 'schema'), false);
  assert.equal(result.text, candidate);
  assert.equal(result.requires_human_review, true);
  assert.equal(result.checks.semantic_verified, false);
  assert.equal(result.segments.length, 1);
  assert.deepEqual(events.map(event => event.type), ['request', 'response', 'request', 'response']);
});

test('ordered chunks preserve every original character and receive generated previous-tail context', async () => {
  const paragraphs = Array.from({ length: 7 }, (_, index) => `I mark ${index}. ` + 'I stand and wait. '.repeat(110));
  const text = paragraphs.join('\r\n\r\n'); const prompts = [];
  const result = await generateAdaptation({ targetText: text, mechanisms: [mechanism], call: async request => {
    if (request.json) return { text: JSON.stringify(planFor(request)) };
    prompts.push(request.prompt);
    const data = promptData(request.prompt);
    return { text: data.current_fragment.replace(/\bstand\b/gu, 'brace') };
  } });
  assert.ok(result.segments.length > 1);
  assert.equal(result.segments.map(segment => text.slice(segment.start, segment.end)).join(''), text);
  assert.equal(promptData(prompts[0]).previous_generated_tail, '');
  assert.ok(promptData(prompts[1]).previous_generated_tail.length > 0);
  for (const [index, prompt] of prompts.entries()) {
    const data = promptData(prompt);
    assert.equal(Object.hasOwn(data, 'original_whole_chapter'), false);
    assert.equal(Object.hasOwn(data, 'global_plan'), false);
    assert.equal(data.current_fragment, text.slice(result.segments[index].start, result.segments[index].end));
    assert.equal(data.source_interval.start, result.segments[index].start);
    assert.equal(data.source_interval.end, result.segments[index].end);
    assert.ok(data.min_words > 0 && data.max_words >= data.min_words);
    assert.match(prompt, /OUTPUT_BOUNDARY:.*Stop at this interval's endpoint/u);
  }
  assert.ok(!prompts[0].includes('I mark 6.'));
});

test('malformed plan fails after bounded model retries without host prose fallback', async () => {
  let count = 0;
  await assert.rejects(generateAdaptation({ targetText: target, mechanisms: [mechanism], call: async () => { count++; return { text: 'not a JSON plan' }; } }), /plan.*3 attempts/i);
  assert.equal(count, 3);
});

test('invalid draft gates retry with errors then reject instead of returning original source', async () => {
  let count = 0; const events = [];
  await assert.rejects(generateAdaptation({ targetText: target, mechanisms: [mechanism], call: async request => {
    count++;
    return { text: request.json ? JSON.stringify(planFor(request)) : '```\nSourceHero arrives.\n```' };
  }, emit: async event => events.push(event) }), /fragment.*3 attempts/i);
  assert.equal(count, 4);
  assert.ok(events.filter(event => event.type === 'request').at(-1).request.prompt.includes('previous_attempt_errors'));
});

test('no host writer input, invalid model responses and oversized target fail closed', async () => {
  let calls = 0; const call = async () => { calls++; return { text: JSON.stringify(plan) }; };
  await assert.rejects(generateAdaptation({ targetText: 'x'.repeat(65537), mechanisms: [], call }), /64 KiB/i);
  assert.equal(calls, 0);
  await assert.rejects(generateAdaptation({ targetText: target, mechanisms: [mechanism] }), /call/i);
  await assert.rejects(generateAdaptation({ targetText: target, mechanisms: [mechanism], call, hostDraft: 'A host-written chapter' }), /host-written/i);
  await assert.rejects(generateAdaptation({ targetText: target, mechanisms: [mechanism], call: async () => ({ text: '' }) }), /plan.*3 attempts/i);
});

test('retries are model requests with gate errors, not host-created repairs', async () => {
  let draftCount = 0; const requests = [];
  const result = await generateAdaptation({ targetText: target, mechanisms: [mechanism], call: async request => {
    requests.push(request);
    if (request.json) return { text: JSON.stringify(planFor(request)) };
    return { text: ++draftCount === 1 ? 'Too short.' : candidate };
  } });
  assert.equal(draftCount, 2);
  assert.match(requests.at(-1).prompt, /word ratio/);
  assert.equal(result.text, candidate);
});

test('Arabic target cannot be silently translated and nested source names remain excluded', async () => {
  const arabic = 'أمسك الباب وأقرر البقاء هنا لأنني أدفع ثمن اختياري وأعرف أن الهرب لن يساعدني.';
  const nested = { title: 'An abstract mechanism', metadata: { source_entities: ['ForeignHero'] }, steps: ['ForeignHero chooses under pressure.'] };
  const requests = [];
  await assert.rejects(generateAdaptation({ targetText: arabic, mechanisms: [nested], call: async request => { requests.push(request); return { text: request.json ? JSON.stringify(planFor(request)) : target }; } }), /language/i);
  assert.ok(requests.every(request => !request.prompt.includes('ForeignHero')));
});

test('source names cannot be introduced but names already in target are permitted', async () => {
  let drafts = 0;
  await assert.rejects(generateAdaptation({ targetText: target, mechanisms: [mechanism], call: async request => ({ text: request.json ? JSON.stringify(planFor(request)) : (++drafts && target.replace('the gate', 'SourceHero')) }) }), /source entit/i);
  assert.equal(drafts, 3);
  const result = await generateAdaptation({ targetText: target.replace('the gate', 'SourceHero'), mechanisms: [mechanism], call: async request => ({ text: request.json ? JSON.stringify(planFor(request)) : candidate.replace('the gate', 'SourceHero') }) });
  assert.ok(result.text.includes('SourceHero'));
});
