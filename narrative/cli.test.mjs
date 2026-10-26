import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const cli = resolve('narrative/cli.mjs');
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 15000 });

test('CLI finalizes a new output while preserving input and refusing overwrite', async () => {
  const root = await mkdtemp(join(process.cwd(), '.rea-test-'));
  try {
    const input = join(root, 'draft.md');
    const output = join(root, 'final.md');
    const original = 'نص\u200b جديد.\n\n> اقتباس\u200b محفوظ\n';
    await writeFile(input, original);
    const result = run('finalize', input, '--output', output);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).report.removed_count, 1);
    assert.equal(await readFile(output, 'utf8'), original.replace('نص\u200b', 'نص'));
    assert.equal(await readFile(input, 'utf8'), original);
    assert.notEqual(run('finalize', input, '--output', output).status, 0);
    assert.notEqual(run('finalize', input, '--output', input).status, 0);
    assert.notEqual(run('mcp', '--output', output).status, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CLI import, reopen, config and errors work from another directory', async () => {
  const root = await mkdtemp(join(process.cwd(), '.rea-test-'));
  try {
    const path = join(root, 'source.md');
    const home = join(root, 'state');
    await writeFile(path, '# One\n\nThe witness knew.\n\n# Two\n\nThe witness waited.');
    const imported = run('import', path, '--home', home, '--title', 'Demo');
    assert.equal(imported.status, 0, imported.stderr);
    const book = JSON.parse(imported.stdout);
    const inspected = run('call', 'inspect_book', JSON.stringify({ book_id: book.book_id }), '--home', home);
    assert.equal(inspected.status, 0, inspected.stderr);
    assert.equal(JSON.parse(inspected.stdout).title, 'Demo');
    const config = JSON.parse(run('config', '--home', home).stdout);
    assert.equal(config.mcpServers['rea-narrative'].command, process.execPath);
    assert.ok(config.mcpServers['rea-narrative'].args.includes(home));
    const bad = run('call', 'inspect_book', '{bad}');
    assert.notEqual(bad.status, 0);
    assert.equal(bad.stdout, '');
    assert.match(run('workflow').stdout, /record_mechanism/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('real MCP subprocess imports and searches a source', async () => {
  const root = await mkdtemp(join(process.cwd(), '.rea-test-'));
  try {
    const source = join(root, 'arabic.txt');
    await writeFile(source, 'المعلومة الأولى.\n\nالمعلومة الثانية.');
    const imported = run('import', source, '--home', root);
    assert.equal(imported.status, 0, imported.stderr);
    const book_id = JSON.parse(imported.stdout).book_id;
    const messages = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_passages', arguments: { book_id, query: 'الثانية' } } },
    ];
    const result = spawnSync(process.execPath, [cli, 'mcp', '--home', root], { input: messages.map(m => JSON.stringify(m)).join('\n') + '\n', encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
    const replies = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(replies.length, 3);
    assert.ok(replies[1].result.tools.some(tool => tool.name === 'record_mechanism'));
    assert.equal(JSON.parse(replies[2].result.content[0].text).items[0].text, 'المعلومة الثانية.');
  } finally { await rm(root, { recursive: true, force: true }); }
});
