import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';
import { digest } from './core.mjs';
import { generateLocal } from './model-runtime.mjs';

const input = { system: 'Use only supplied synthetic evidence.', prompt: 'Return a short test response.' };
const good = { model: 'gemma3:4b', created_at: '2026-10-26T17:00:00Z', response: 'Synthetic عربي response.', done: true, done_reason: 'stop', prompt_eval_count: 12, eval_count: 8, total_duration: 1000 };
function fake({ status = 200, payload = good, chunks, hang = false, connectionError, responseError } = {}) {
  const capture = {};
  const requestFactory = (options, callback) => {
    capture.options = options;
    const request = new EventEmitter();
    request.destroy = error => { capture.destroyed = true; if (error) queueMicrotask(() => request.emit('error', error)); };
    request.end = body => {
      capture.body = JSON.parse(body);
      queueMicrotask(() => {
        if (connectionError) { request.emit('error', connectionError); return; }
        if (hang) return;
        const response = new PassThrough();
        response.statusCode = status;
        capture.response = response;
        callback(response);
        if (responseError) { response.destroy(responseError); return; }
        for (const chunk of chunks ?? [Buffer.from(JSON.stringify(payload))]) response.write(chunk);
        response.end();
      });
    };
    return request;
  };
  return { capture, requestFactory };
}

test('uses only fixed loopback endpoint and returns canonical request/raw text hashes', async () => {
  const { capture, requestFactory } = fake();
  const result = await generateLocal(input, { requestFactory });
  assert.equal(capture.options.hostname, '127.0.0.1');
  assert.equal(capture.options.port, 11434);
  assert.equal(capture.options.path, '/api/generate');
  assert.equal(capture.options.method, 'POST');
  assert.equal(capture.options.agent, false);
  assert.deepEqual(capture.body.options, { num_ctx: 32768, num_predict: 2048, seed: 42, temperature: 0.2 });
  assert.equal(capture.body.stream, false);
  assert.equal('format' in capture.body, false);
  assert.equal(result.request_sha256, digest(capture.body));
  assert.equal(result.response_sha256, createHash('sha256').update(good.response, 'utf8').digest('hex'));
  assert.equal(result.text, good.response);
  assert.deepEqual(result.stats, { prompt_eval_count: 12, eval_count: 8, done_reason: 'stop', total_duration: 1000 });
});

test('supports JSON generation and split UTF8 without parsing model text as JSON', async () => {
  const bytes = Buffer.from(JSON.stringify(good));
  const { capture, requestFactory } = fake({ chunks: Array.from(bytes, byte => Buffer.from([byte])) });
  const result = await generateLocal({ ...input, json: true, max_tokens: 8192, seed: 0, temperature: 0 }, { requestFactory });
  assert.equal(capture.body.format, 'json');
  assert.equal(result.text, good.response);
  assert.equal(capture.body.options.num_predict, 8192);
});

test('forwards a bounded JSON schema exactly and schema implies JSON output even when json is false', async () => {
  const schema = { type: 'object', properties: { evidence_ids: { type: 'array', items: { type: 'string', enum: ['p1', 'p2'] } } }, required: ['evidence_ids'], additionalProperties: false };
  const { capture, requestFactory } = fake();
  const result = await generateLocal({ ...input, json: false, schema }, { requestFactory });
  assert.deepEqual(capture.body.format, schema);
  assert.equal(result.request_sha256, digest(capture.body));
});

test('rejects invalid, external-reference, non-JSON and oversized schemas before network work', async () => {
  const cycle = {}; cycle.properties = cycle;
  for (const schema of [[], null, 'object', { $ref: 'https://example/schema' }, { properties: { a: { $ref: '#/defs/a' } } }, { $dynamicRef: '#item' }, { type: 'object', validate: () => true }, { minimum: NaN }, { description: 'x'.repeat(16 * 1024) }, cycle]) {
    let called = false;
    await assert.rejects(generateLocal({ ...input, schema }, { requestFactory: () => { called = true; throw new Error('must not run'); } }), error => error.code === 'MODEL_RUNTIME_SCHEMA');
    assert.equal(called, false);
  }
});

test('rejects malformed inputs before a request is created', async () => {
  for (const change of [{ model: 'https://example/model' }, { model: 'qwen3-coder:480b-cloud' }, { max_tokens: 8193 }, { temperature: NaN }, { seed: 1.5 }, { prompt: '' }, { system: 7 }, { json: 'yes' }, { url: 'http://elsewhere' }, { prompt: 'x'.repeat(192 * 1024) }]) {
    let called = false;
    await assert.rejects(generateLocal({ ...input, ...change }, { requestFactory: () => { called = true; throw new Error('must not run'); } }));
    assert.equal(called, false);
  }
});

test('surfaces unavailable service and missing model without fallback', async () => {
  await assert.rejects(generateLocal(input, fake({ connectionError: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) })), /unavailable|not running/i);
  await assert.rejects(generateLocal(input, fake({ status: 404, payload: { error: 'model missing' } })), /not installed|missing/i);
  await assert.rejects(generateLocal(input, fake({ status: 500, payload: { error: 'model load failed' } })), /model load failed/);
});

test('rejects truncation, incomplete responses and malformed JSON envelopes', async () => {
  for (const payload of [{ ...good, done: false }, { ...good, done_reason: 'length' }, { ...good, response: null }, null]) {
    await assert.rejects(generateLocal(input, fake({ payload })), /complete|truncat|response/i);
  }
  await assert.rejects(generateLocal(input, fake({ chunks: [Buffer.from('{not-json')] })), /JSON|response/i);
});

test('validates metadata and fatal UTF8 rather than silently retaining invalid provenance', async () => {
  for (const change of [{ prompt_eval_count: -1 }, { eval_count: 1.2 }, { total_duration: '1000' }, { model: {} }, { created_at: 'not a date' }]) {
    await assert.rejects(generateLocal(input, fake({ payload: { ...good, ...change } })), /invalid|response/i);
  }
  await assert.rejects(generateLocal(input, fake({ chunks: [Buffer.from([0xff])] })), /JSON|response/i);
});

test('bounds response and handles response stream failures', async () => {
  const oversized = fake({ chunks: [Buffer.alloc(2 * 1024 * 1024 + 1, 120)] });
  await assert.rejects(generateLocal(input, oversized), /2 MiB|limit/);
  assert.equal(oversized.capture.destroyed, true);
  await assert.rejects(generateLocal(input, fake({ responseError: new Error('stream broke') })), /stream broke|response/i);
});

test('timeout and cancellation terminate the owned request', async () => {
  const stalled = fake({ hang: true });
  await assert.rejects(generateLocal(input, { ...stalled, timeoutMs: 5 }), /timeout/i);
  assert.equal(stalled.capture.destroyed, true);
  const controller = new AbortController();
  const active = fake({ hang: true });
  const pending = generateLocal(input, { ...active, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /abort/i);
  assert.equal(active.capture.destroyed, true);
  let called = false;
  await assert.rejects(generateLocal(input, { signal: controller.signal, requestFactory: () => { called = true; } }), /abort/i);
  assert.equal(called, false);
});
