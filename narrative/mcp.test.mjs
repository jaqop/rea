import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { startMcp } from './mcp.mjs';
import pkg from '../package.json' with { type: 'json' };

const descriptor = { name: 'echo', description: 'Echo input', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } };
const request = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
const init = (version = '2025-11-25') => request(1, 'initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'test', version: '1' } });
const ready = { jsonrpc: '2.0', method: 'notifications/initialized' };
async function run(messages, callTool = async (_, args) => args) {
  const input = new PassThrough();
  const output = new PassThrough();
  let raw = '';
  output.on('data', chunk => { raw += chunk; });
  const done = startMcp({ tools: [descriptor], callTool, input, output });
  for (const message of messages) input.write(typeof message === 'string' ? message : JSON.stringify(message) + '\n');
  input.end();
  await done;
  return { raw, responses: raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) };
}

test('initialization gates tools and preserves notifications without responses', async () => {
  const { responses } = await run([request(0, 'tools/list'), init(), request(2, 'tools/list'), ready, request(3, 'tools/list')]);
  assert.equal(responses.length, 4);
  assert.equal(responses[0].error.code, -32002);
  assert.equal(responses[1].result.serverInfo.name, 'rea-narrative');
  assert.equal(responses[1].result.serverInfo.version, pkg.version);
  assert.equal(responses[2].error.code, -32002);
  assert.deepEqual(responses[3].result.tools, [descriptor]);
});

test('negotiates supported versions and offers latest for unsupported version', async () => {
  for (const version of ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25', 'unknown']) {
    const { responses } = await run([init(version)]);
    assert.equal(responses[0].result.protocolVersion, version === 'unknown' ? '2025-11-25' : version);
  }
});

test('parse, envelope, IDs, initialize and tool parameters are validated', async () => {
  const { responses } = await run(['bad\n', [], request(null, 'ping'), request(1, 'initialize', { protocolVersion: 'x', capabilities: [], clientInfo: {} }), init(), ready, request(2, 'tools/call', { name: 'echo', arguments: [] }), request(3, 'tools/call', { name: 'missing' })]);
  assert.deepEqual(responses.slice(0, 4).map(r => r.error.code), [-32700, -32600, -32600, -32602]);
  assert.equal(responses[5].error.code, -32602);
  assert.equal(responses[6].error.code, -32602);
});

test('calls serialize, drain at EOF, return JSON-only stdout and handle tool errors', async () => {
  const seen = [];
  const { responses, raw } = await run([init(), ready, request('a', 'tools/call', { name: 'echo', arguments: { text: 'عربي\ntext' } }), request('b', 'tools/call', { name: 'echo', arguments: { fail: true } }), request('c', 'ping'), request('d', 'unknown'), { jsonrpc: '2.0', method: 'unknown' }], async (_, args) => {
    seen.push(args);
    await new Promise(resolve => setTimeout(resolve, 2));
    if (args.fail) throw new Error('tool failed');
    return args;
  });
  assert.equal(seen.length, 2);
  assert.deepEqual(responses.map(r => r.id), [1, 'a', 'b', 'c', 'd']);
  assert.equal(JSON.parse(responses[1].result.content[0].text).text, 'عربي\ntext');
  assert.equal('isError' in responses[1].result, false);
  assert.equal(responses[2].result.isError, true);
  assert.match(responses[2].result.content[0].text, /tool failed/);
  assert.deepEqual(responses[3].result, {});
  assert.equal(responses[4].error.code, -32601);
  assert.equal(raw.split('\n').filter(Boolean).length, 5);
});

test('rejects repeat initialization and accepts a final unterminated line', async () => {
  const { responses } = await run([init(), ready, init(), JSON.stringify(request(5, 'ping'))]);
  assert.equal(responses[1].error.code, -32600);
  assert.deepEqual(responses[2].result, {});
});

test('oversized line returns one error then closes instead of accumulating input', async () => {
  const { responses } = await run(['x'.repeat(16 * 1024 * 1024 + 1)]);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].error.code, -32600);
  assert.match(responses[0].error.message, /16 MiB/);
});

test('byte-fragmented UTF-8 and CRLF preserve exact arguments', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let raw = '';
  output.on('data', chunk => { raw += chunk; });
  const done = startMcp({ tools: [descriptor], callTool: async (_, args) => args, input, output });
  const text = [ready, init(), ready, request(4, 'tools/call', { name: 'echo', arguments: { text: 'إلينتور 🌙' } })].map(v => JSON.stringify(v)).join('\r\n') + '\r\n';
  for (const byte of Buffer.from(text)) input.write(Buffer.from([byte]));
  input.end();
  await done;
  const responses = raw.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(responses.length, 2);
  assert.equal(JSON.parse(responses[1].result.content[0].text).text, 'إلينتور 🌙');
});
