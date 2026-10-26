import test from 'node:test';
import assert from 'node:assert/strict';
import { handleOutput, outputDefinitions } from './output-tools.mjs';

const okay = (text) => ({ ok: true, result: { text, semantic_similarity: 0.95, fact_check_passed: true } });

test('named output dispatch audits/finalizes without invoking providers', async () => {
  assert.equal(outputDefinitions.length, 5);
  assert.equal(await handleOutput('unknown', {}), undefined);
  const options = { run: async () => { throw new Error('Must not invoke'); } };
  const audit = await handleOutput('inspect_output_text', { text: 'a\u200Bb' }, options);
  assert.equal(audit.changed, true);
  assert.ok(!Object.hasOwn(audit, 'cleaned_text'));
  assert.equal((await handleOutput('finalize_output_text', { text: 'a\u200Bb' }, options)).cleaned_text, 'ab');
  await assert.rejects(handleOutput('finalize_output_text', { text: 'ok', extra: true }));
  await assert.rejects(handleOutput('rewrite_output_text', { text: 'a'.repeat(1048577) }));
});

test('rewrite restores exact Markdown code/URLs/citations after successful provider gates', async () => {
  const input = 'Draft \u200B`cmd\u200Bvalue` https://x.test/a\u200Bb exact\u200Bquote';
  const start = input.indexOf('exact');
  const result = await handleOutput('rewrite_output_text', { text: input, protected_ranges: [{ start, end: input.length }] }, { run: async ({ payload }) => {
    assert.ok(!payload.text.includes('cmd'));
    assert.ok(!payload.text.includes('https://'));
    assert.ok(!payload.text.includes('exact'));
    return okay(payload.text.replace('Draft', 'Revised'));
  } });
  assert.equal(result.cleaned_text, input.replace('Draft \u200B', 'Revised '));
  assert.equal(result.report.meaning_verified, false);
  assert.equal(result.protected_spans_preserved, true);
  assert.equal(result.semantic_fidelity_guaranteed, false);
});

test('missing, duplicated or reordered protected placeholders reject without fallback', async () => {
  const input = 'Text `one` then `two`.';
  const edits = [
    value => value.replace(/⟦REA_PROTECTED_[^⟧]+⟧/u, ''),
    value => { const token = value.match(/⟦REA_PROTECTED_[^⟧]+⟧/u)[0]; return value + token; },
    value => { const tokens = [...value.matchAll(/⟦REA_PROTECTED_[^⟧]+⟧/gu)].map(m => m[0]); return value.replace(tokens[0], 'TEMP').replace(tokens[1], tokens[0]).replace('TEMP', tokens[1]); },
  ];
  for (const edit of edits) await assert.rejects(handleOutput('rewrite_output_text', { text: input }, { run: async ({ payload }) => okay(edit(payload.text)) }), /protected|placeholder/i);
  await assert.rejects(handleOutput('rewrite_output_text', { text: input }, { run: async () => ({ ok: false, error: { message: 'provider missing' } }) }), /provider missing/);
});

test('provider candidate must satisfy gates and bounded output requirements', async () => {
  await assert.rejects(handleOutput('rewrite_output_text', { text: 'Original.' }, { run: async () => ({ ok: true, result: { text: 'Changed.', semantic_similarity: 0.1, fact_check_passed: true } }) }), /gate/);
  await assert.rejects(handleOutput('rewrite_output_text', { text: 'Original.' }, { run: async () => okay('x'.repeat(1048577)) }), /limit|1048576/);
});

test('rewrite refuses truncated prose, dropped paragraphs, changed language and oversized units', async () => {
  const text = 'A witness waited outside the locked gate. '.repeat(10);
  for (const candidate of ['A witness waited.', text + '\n\nA new paragraph.']) {
    await assert.rejects(handleOutput('rewrite_output_text', { text }, { run: async () => okay(candidate) }), /coverage|paragraph|length/i);
  }
  await assert.rejects(handleOutput('rewrite_output_text', { text: 'انتظر الشاهد عند البوابة المغلقة. ' }, { run: async () => okay('The witness waited at the locked gate.') }), /language/i);
  await assert.rejects(handleOutput('rewrite_output_text', { text: 'ن'.repeat(2049) }, { run: async () => { throw new Error('must not invoke'); } }), /4096|4 KiB/);
});

test('opaque spans cannot hide an Arabic translation or inflate the provider input unnoticed', async () => {
  const prose = 'هذه حكاية صغيرة عن مكتبة هادئة.';
  const input = prose + ' `a` `b` `c`';
  await assert.rejects(handleOutput('rewrite_output_text', { text: input }, { run: async ({ payload }) => okay(payload.text.replace(prose, 'This is a small story about a quiet library.')) }), /language/);
  await assert.rejects(handleOutput('rewrite_output_text', { text: '`x` '.repeat(200) }, { run: async () => { throw new Error('provider should not run'); } }), /masked/);
  await assert.rejects(handleOutput('rewrite_output_text', { text: 'First part\u2028Second part' }, { run: async () => okay('First part Second part') }), /paragraph|line/);
});

test('hidden prefixes cannot hide Markdown headings or list markers from rewrite protection', async () => {
  for (const input of ['\uFEFF# Heading', '\u200b1. List item', '\u00ad- List item']) {
    await assert.rejects(handleOutput('rewrite_output_text', { text: input }, { run: async ({ payload }) => okay(payload.text.replace(/⟦REA_PROTECTED_[^⟧]+⟧/gu, '')) }), /protected|placeholder/);
    const result = await handleOutput('rewrite_output_text', { text: input }, { run: async ({ payload }) => okay(payload.text) });
    assert.equal(result.cleaned_text, input.slice(1));
    assert.equal(result.requires_human_review, true);
  }
});

test('image and capabilities operations route only declared inputs', async () => {
  let payload;
  const options = { modelPath: 'local-model.pt', run: async request => { payload = request.payload; return { ok: true, result: { status: 'ready' } }; } };
  const capabilities = await handleOutput('output_capabilities', {}, options);
  assert.equal(capabilities.status, 'ready');
  assert.equal(capabilities.unicode_cleanup.ready, true);
  const paths = { input_path: 'source.png', mask_path: 'mask.png', output_path: 'new.png' };
  await handleOutput('restore_output_image', paths, options);
  assert.equal(payload.operation, 'image');
  assert.equal(payload.output_path, 'new.png');
  await assert.rejects(handleOutput('restore_output_image', { ...paths, command: 'delete' }, options));
});
