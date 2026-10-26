import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createTools } from './tools.mjs';

const cli = resolve('narrative/cli.mjs');

test('review: explicit home reopens across distinct working directories and JSON argument files', async () => {
  const root = await mkdtemp(join(process.cwd(), '.rea-test-'));
  try {
    const first = join(root, 'first directory');
    const second = join(root, 'second directory');
    await mkdir(first); await mkdir(second);
    const home = join(root, 'state عربي');
    const source = join(first, 'رواية.txt');
    await writeFile(source, 'النص الأول.\r\n\r\nالنص الثاني.');
    const run = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 10000 });
    const imported = run(first, 'import', 'رواية.txt', '--home', home);
    assert.equal(imported.status, 0, imported.stderr);
    const book_id = JSON.parse(imported.stdout).book_id;
    await writeFile(join(second, 'arguments.json'), JSON.stringify({ book_id, query: 'الثاني' }));
    const found = run(second, 'call', 'search_passages', '--input', 'arguments.json', '--home', home);
    assert.equal(found.status, 0, found.stderr);
    assert.equal(JSON.parse(found.stdout).items[0].text, 'النص الثاني.');
    assert.equal(JSON.parse(run(second, 'config', '--home', home).stdout).mcpServers['rea-narrative'].args.at(-1), home);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('review: rejected mutation and writer contention preserve committed investigation bytes', async () => {
  const root = await mkdtemp(join(process.cwd(), '.rea-test-'));
  try {
    const source = join(root, 'source.txt');
    await writeFile(source, 'First paragraph.\n\nSecond paragraph.');
    const home = join(root, 'home');
    const api = createTools(home);
    const { book_id } = await api.call('import_book', { path: source });
    const path = join(home, `${book_id}.json`);
    const before = await readFile(path, 'utf8');
    await assert.rejects(api.call('record_unknown', { book_id, id: 'bad', question: 'Why?', supporting_claim_ids: ['absent'], contradicting_claim_ids: [], proposed_test: 'Read more' }), /Unknown claim/);
    assert.equal(await readFile(path, 'utf8'), before);
    await mkdir(`${path}.lock`);
    await assert.rejects(api.call('record_unknown', { book_id, id: 'question', question: 'Why?', supporting_claim_ids: [], contradicting_claim_ids: [], proposed_test: 'Read more' }), /written elsewhere/);
    assert.equal(await readFile(path, 'utf8'), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
