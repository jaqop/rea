#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTools } from './tools.mjs';
import { readBounded } from './store.mjs';
import { startMcp } from './mcp.mjs';
import { finalizeOutput } from './text-output.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const help = `REA Narrative — reverse engineering books with source-bound evidence

Usage:
  rea-narrative import <book.txt|book.md> [--title <title>] [--home <directory>]
  rea-narrative tools
  rea-narrative call <tool> --input <arguments.json> [--home <directory>]
  rea-narrative call <tool> '<JSON arguments>' [--home <directory>]
  rea-narrative config [--home <directory>]
  rea-narrative mcp [--home <directory>]
  rea-narrative workflow
  rea-narrative finalize <draft.md|draft.txt> --output <new-file> [--format markdown|plain]

Node.js 24 or later. Core runtime requires no dependencies or API keys.
Optional rewriting and image restoration require separately installed local models.
An MCP-connected assistant performs interpretation and optional original writing.
Default data directory: .rea-narrative under the current working directory.
Use an explicit --home to reopen the same investigations from any directory.
All output is JSON except help/workflow. Errors go to stderr.
`;

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or later is required.');
  const args = process.argv.slice(2);
  const options = {};
  const positionals = [];
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (['--home', '--title', '--input', '--output', '--format'].includes(token)) {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${token}`);
      if (Object.hasOwn(options, token)) throw new Error(`Duplicate option ${token}`);
      options[token] = args[++index];
    } else if (token.startsWith('--') && token !== '--help') throw new Error(`Unknown option ${token}`);
    else positionals.push(token);
  }
  const [command, ...rest] = positionals;
  if (command !== 'finalize' && (options['--output'] || options['--format'])) throw new Error('--output and --format are only supported by finalize.');
  const home = resolve(options['--home'] ?? '.rea-narrative');
  const api = createTools(home);
  if (!command || command === 'help' || command === '--help') { process.stdout.write(help); return; }
  const emit = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  if (command === 'finalize') {
    if (rest.length !== 1 || !options['--output'] || options['--input'] || options['--title'] || options['--home']) throw new Error('finalize requires one input and --output to a new file; optional --format only.');
    const result = finalizeOutput(await readBounded(resolve(rest[0])), { format: options['--format'] ?? 'markdown' });
    const output = resolve(options['--output']);
    await writeFile(output, result.cleaned_text, { encoding: 'utf8', flag: 'wx' });
    emit({ output, report: result.report });
  } else if (command === 'mcp') {
    if (rest.length || options['--title'] || options['--input']) throw new Error('mcp accepts only --home.');
    await startMcp({ tools: api.definitions, callTool: (name, input) => api.call(name, input) });
  } else if (command === 'config') {
    emit({ mcpServers: { 'rea-narrative': { command: process.execPath, args: [join(root, 'cli.mjs'), 'mcp', '--home', home] } } });
  } else if (command === 'workflow') {
    process.stdout.write(await readFile(join(root, 'skills', 'reverse-engineer-novels', 'SKILL.md'), 'utf8'));
  } else if (command === 'tools') emit(api.definitions);
  else if (command === 'import') {
    if (rest.length !== 1 || options['--input']) throw new Error('import requires exactly one source path.');
    emit(await api.call('import_book', { path: resolve(rest[0]), ...(options['--title'] ? { title: options['--title'] } : {}) }));
  } else if (command === 'call') {
    if (!rest[0] || rest.length > 2 || (options['--input'] && rest[1]) || options['--title']) throw new Error('call requires a tool name and one JSON argument or --input file.');
    const text = options['--input'] ? await readBounded(options['--input']) : rest[1] ?? '{}';
    emit(await api.call(rest[0], JSON.parse(text)));
  } else throw new Error(`Unknown command: ${command}. Run rea-narrative --help.`);
}

process.stdout.on('error', error => { if (error.code === 'EPIPE') process.exit(0); throw error; });
main().catch(error => { process.stderr.write(`REA Narrative: ${error.message}\n`); process.exitCode = 1; });
