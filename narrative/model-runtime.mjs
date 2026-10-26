import http from 'node:http';
import { createHash } from 'node:crypto';
import { digest } from './core.mjs';

const MAX_REQUEST = 192 * 1024;
const MAX_RESPONSE = 2 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const runtimeError = (code, message, cause) => Object.assign(new Error(message, cause ? { cause } : undefined), { code });

function validateOutputSchema(schema) {
  const invalid = message => { throw runtimeError('MODEL_RUNTIME_SCHEMA', `Schema ${message}`); };
  if (!object(schema)) invalid('must be a plain JSON object.');
  let bytes = 0;
  const active = new Set();
  const charge = amount => { bytes += amount; if (bytes > 16 * 1024) invalid('exceeds 16 KiB.'); };
  function visit(value, depth) {
    if (depth > 64) invalid('exceeds the supported nesting depth of 64.');
    if (typeof value === 'string') {
      if (Buffer.byteLength(value) > 16 * 1024) invalid('exceeds 16 KiB.');
      charge(Buffer.byteLength(JSON.stringify(value))); return;
    }
    if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) { charge(Buffer.byteLength(JSON.stringify(value))); return; }
    if (typeof value !== 'object' || active.has(value)) invalid('requires acyclic plain JSON data.');
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid('requires plain JSON objects.');
    active.add(value);
    charge(2);
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) invalid('cannot contain sparse arrays.');
        if (index) charge(1);
        visit(value[index], depth + 1);
      }
    } else {
      for (const [index, key] of Object.keys(value).entries()) {
        if (key === '$ref' || key === '$dynamicRef') invalid('references are unsupported; provide an inline schema.');
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!Object.hasOwn(descriptor, 'value')) invalid('cannot contain property accessors.');
        if (index) charge(1);
        visit(key, depth + 1); charge(1);
        visit(descriptor.value, depth + 1);
      }
    }
    active.delete(value);
  }
  visit(schema, 0);
}

/** Bounded, non-streaming generation through the fixed local Ollama endpoint.
 * requestFactory is an http.request-compatible testing seam, never a tool input.
 * schema, when supplied, implies JSON output and overrides the json flag.
 * Hashes commit the exact canonical payload and returned model text, not truth.
 */
export async function generateLocal(input = {}, { timeoutMs = 180000, signal, requestFactory = http.request } = {}) {
  if (!object(input)) throw new TypeError('Generation input must be an object.');
  const { model = 'gemma3:4b', system = '', prompt, json = false, schema, temperature = 0.2, max_tokens = 2048, seed = 42 } = input;
  for (const key of Object.keys(input)) if (!['model', 'system', 'prompt', 'json', 'schema', 'temperature', 'max_tokens', 'seed'].includes(key)) throw new TypeError(`Unknown generation parameter: ${key}`);
  if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/.test(model) || model.includes('://') || /(?:^|[:-])cloud$/i.test(model)) throw new TypeError('Model must be a local model name, without URLs or cloud tags.');
  if (typeof system !== 'string' || typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('Generation system must be text and prompt must be nonempty text.');
  // Bound source strings before JSON escaping allocates another representation.
  if (Buffer.byteLength(system) + Buffer.byteLength(prompt) > MAX_REQUEST) throw runtimeError('MODEL_RUNTIME_LIMIT', 'Generation request exceeds 192 KiB.');
  if (typeof json !== 'boolean') throw new TypeError('json must be boolean.');
  if (schema !== undefined) validateOutputSchema(schema);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new RangeError('temperature must be between 0 and 2.');
  if (!Number.isSafeInteger(max_tokens) || max_tokens < 1 || max_tokens > 8192) throw new RangeError('max_tokens must be between 1 and 8192.');
  if (!Number.isSafeInteger(seed)) throw new TypeError('seed must be a safe integer.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) throw new RangeError('timeoutMs must be a positive bounded timer duration.');
  if (signal !== undefined && (typeof signal?.addEventListener !== 'function' || typeof signal?.removeEventListener !== 'function')) throw new TypeError('signal must be an AbortSignal.');
  if (typeof requestFactory !== 'function') throw new TypeError('requestFactory must be a function.');
  if (signal?.aborted) throw runtimeError('MODEL_RUNTIME_ABORTED', 'Local generation aborted.');
  const payload = { model, system, prompt, stream: false, ...(schema !== undefined ? { format: schema } : json ? { format: 'json' } : {}), options: { num_ctx: 32768, num_predict: max_tokens, seed, temperature } };
  const body = JSON.stringify(payload);
  const byteLength = Buffer.byteLength(body);
  if (byteLength > MAX_REQUEST) throw runtimeError('MODEL_RUNTIME_LIMIT', 'Generation request exceeds 192 KiB.');
  const request_sha256 = digest(payload);

  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    let response;
    let timer;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const fail = error => {
      if (settled) return;
      settled = true;
      cleanup();
      request?.destroy();
      response?.destroy();
      reject(error);
    };
    const abort = () => fail(runtimeError('MODEL_RUNTIME_ABORTED', 'Local generation aborted.'));
    timer = setTimeout(() => fail(runtimeError('MODEL_RUNTIME_TIMEOUT', 'Local generation timeout exceeded.')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try {
      request = requestFactory({ hostname: '127.0.0.1', port: 11434, path: '/api/generate', method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': byteLength } }, incoming => {
        response = incoming;
        if (settled) { response.destroy(); return; }
        const chunks = [];
        let size = 0;
        response.on('error', cause => fail(runtimeError('MODEL_RUNTIME_RESPONSE', `Local model response failed: ${cause.message}`, cause)));
        response.on('aborted', () => fail(runtimeError('MODEL_RUNTIME_RESPONSE', 'Local model response was interrupted before completion.')));
        response.on('data', chunk => {
          if (settled) return;
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > MAX_RESPONSE) { fail(runtimeError('MODEL_RUNTIME_LIMIT', 'Local model response exceeds 2 MiB.')); return; }
          chunks.push(bytes);
        });
        response.on('end', () => {
          if (settled) return;
          let data;
          try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))); }
          catch (cause) { fail(runtimeError('MODEL_RUNTIME_RESPONSE', 'Local model returned an invalid JSON response.', cause)); return; }
          if (incoming.statusCode !== 200 || (object(data) && typeof data.error === 'string')) {
            const detail = typeof data?.error === 'string' ? data.error.slice(0, 1000) : `HTTP ${incoming.statusCode}`;
            if (incoming.statusCode === 404) fail(runtimeError('MODEL_NOT_INSTALLED', `Local model is not installed: ${model}. ${detail}`));
            else fail(runtimeError('MODEL_RUNTIME_RESPONSE', `Local model generation failed: ${detail}`));
            return;
          }
          if (!object(data) || data.done !== true || typeof data.response !== 'string' || !data.response.trim()) { fail(runtimeError('MODEL_RUNTIME_RESPONSE', 'Local model did not return a complete text response.')); return; }
          if (data.done_reason !== 'stop') { fail(runtimeError('MODEL_RUNTIME_TRUNCATED', `Local model response may be truncated or incomplete (done_reason=${String(data.done_reason)}); no result returned.`)); return; }
          for (const key of ['prompt_eval_count', 'eval_count', 'total_duration']) if (data[key] !== undefined && (!Number.isSafeInteger(data[key]) || data[key] < 0)) { fail(runtimeError('MODEL_RUNTIME_RESPONSE', `Local model response has invalid ${key}.`)); return; }
          if (data.model !== undefined && (typeof data.model !== 'string' || !data.model.trim())) { fail(runtimeError('MODEL_RUNTIME_RESPONSE', 'Local model response has an invalid model identity.')); return; }
          if (data.created_at !== undefined && (typeof data.created_at !== 'string' || !Number.isFinite(Date.parse(data.created_at)))) { fail(runtimeError('MODEL_RUNTIME_RESPONSE', 'Local model response has an invalid creation timestamp.')); return; }
          settled = true;
          cleanup();
          resolve({ text: data.response, model: data.model ?? model, created_at: data.created_at ?? null, request_sha256, response_sha256: createHash('sha256').update(data.response, 'utf8').digest('hex'), stats: { prompt_eval_count: data.prompt_eval_count ?? null, eval_count: data.eval_count ?? null, done_reason: data.done_reason, total_duration: data.total_duration ?? null } });
        });
      });
      request.on('error', cause => fail(runtimeError('MODEL_RUNTIME_UNAVAILABLE', `Local Ollama is unavailable or not running at 127.0.0.1:11434: ${cause.message}`, cause)));
      request.end(body);
    } catch (cause) { fail(runtimeError('MODEL_RUNTIME_UNAVAILABLE', `Could not contact local Ollama: ${cause.message}`, cause)); }
  });
}
