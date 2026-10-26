/** Minimal tools-only MCP stdio transport. No network, model calls or logging. */
export const serverInfo = Object.freeze({ name: 'rea-narrative', version: '0.1.0' });
const versions = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);
const maxLineBytes = 16 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));

/** Resolve after stdin EOF and all accepted requests have completed and flushed. */
export async function startMcp({ tools, callTool, input = process.stdin, output = process.stdout }) {
  let lifecycle = 'new';
  const toolNames = new Set(tools.map(tool => tool.name));
  const send = message => new Promise((resolve, reject) => {
    output.write(JSON.stringify(message) + '\n', error => error ? reject(error) : resolve());
  });
  const error = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

  async function handle(line) {
    let message;
    try { message = JSON.parse(line); }
    catch { await error(null, -32700, 'Parse error'); return; }
    const hasId = object(message) && Object.hasOwn(message, 'id');
    const notification = object(message) && !hasId && typeof message.method === 'string';
    if (!object(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || (hasId && !validId(message.id))) {
      if (!notification) await error(null, -32600, 'Invalid request');
      return;
    }
    if (notification) {
      if (message.method === 'notifications/initialized' && lifecycle === 'initializing' &&
          (message.params === undefined || object(message.params))) lifecycle = 'ready';
      return;
    }
    const { id, method, params } = message;
    if (params !== undefined && !object(params)) { await error(id, -32602, 'Parameters must be an object'); return; }
    const reply = result => send({ jsonrpc: '2.0', id, result });
    if (method === 'ping') { await reply({}); return; }
    if (method === 'initialize') {
      if (lifecycle !== 'new') { await error(id, -32600, 'Already initialized'); return; }
      if (!object(params) || typeof params.protocolVersion !== 'string' || !params.protocolVersion ||
          !object(params.capabilities) || !object(params.clientInfo) ||
          typeof params.clientInfo.name !== 'string' || !params.clientInfo.name ||
          typeof params.clientInfo.version !== 'string' || !params.clientInfo.version) {
        await error(id, -32602, 'initialize requires protocolVersion, capabilities and clientInfo name/version'); return;
      }
      lifecycle = 'initializing';
      await reply({ protocolVersion: versions.has(params.protocolVersion) ? params.protocolVersion : '2025-11-25', capabilities: { tools: {} }, serverInfo });
      return;
    }
    if (method !== 'tools/list' && method !== 'tools/call') { await error(id, -32601, 'Method not found'); return; }
    if (lifecycle !== 'ready') { await error(id, -32002, 'Complete initialize and notifications/initialized first'); return; }
    if (method === 'tools/list') {
      if (params?.cursor !== undefined) { await error(id, -32602, 'This tool catalog has no pagination cursor'); return; }
      await reply({ tools }); return;
    }
    if (!object(params) || typeof params.name !== 'string' || !toolNames.has(params.name) ||
        (params.arguments !== undefined && !object(params.arguments))) {
      await error(id, -32602, 'Unknown tool or invalid tool arguments'); return;
    }
    let result;
    try {
      const value = await callTool(params.name, params.arguments ?? {});
      result = { content: [{ type: 'text', text: JSON.stringify(value ?? null) }] };
    } catch (cause) {
      result = { isError: true, content: [{ type: 'text', text: cause instanceof Error ? cause.message : String(cause) }] };
    }
    await reply(result);
  }

  // Retain at most one bounded line. Await each handler to preserve input order,
  // apply readable-stream backpressure and drain accepted work before EOF returns.
  let lineBuffer = Buffer.alloc(64 * 1024);
  let size = 0;
  for await (const data of input) {
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline === -1 ? chunk.length : newline;
      const length = end - start;
      if (size + length > maxLineBytes) {
        lineBuffer = Buffer.alloc(0);
        size = 0;
        await error(null, -32600, 'Message exceeds the 16 MiB line limit; closing transport');
        input.destroy();
        await new Promise((resolve, reject) => output.end(error => error ? reject(error) : resolve()));
        return;
      }
      if (size + length > lineBuffer.length) {
        const expanded = Buffer.alloc(Math.min(maxLineBytes, Math.max(size + length, lineBuffer.length * 2)));
        lineBuffer.copy(expanded, 0, 0, size);
        lineBuffer = expanded;
      }
      if (length) { chunk.copy(lineBuffer, size, start, end); size += length; }
      if (newline !== -1) {
        const line = lineBuffer.toString('utf8', 0, size);
        size = 0;
        await handle(line);
      }
      start = end + 1;
    }
  }
  if (size) await handle(lineBuffer.toString('utf8', 0, size));
}
