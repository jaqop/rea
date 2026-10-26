import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { join, delimiter } from 'node:path';
import { spawn } from 'node:child_process';
import { providerCapabilities, rewriteWithReweave, restoreWithLama, defaultRun, resolvePythonExecutable, providerTimeout } from './output-providers.mjs';

test('rewrite timeout scales with UTF8 chunks and validated explicit budgets override defaults', async () => {
  assert.equal(providerTimeout({ operation: 'rewrite', text: 'x'.repeat(4096) }, {}), 1320000);
  assert.equal(providerTimeout({ operation: 'rewrite', text: 'ع'.repeat(200) }, {}), 240000);
  assert.equal(providerTimeout({ operation: 'rewrite', text: 'x'.repeat(100000) }, {}), 1800000);
  assert.equal(providerTimeout({ operation: 'image' }, {}), 120000);
  assert.equal(providerTimeout({ operation: 'capabilities' }, {}), 120000);
  assert.equal(providerTimeout({ operation: 'rewrite', text: 'x' }, { REA_OUTPUT_TIMEOUT_MS: '1800000' }), 1800000);
  for (const value of ['', '999', '1800001', 'Infinity', '1e4', '1000.5', ' 1000']) assert.throws(() => providerTimeout({}, { REA_OUTPUT_TIMEOUT_MS: value }), /REA_OUTPUT_TIMEOUT_MS/);
  let received;
  const result = await rewriteWithReweave('x'.repeat(800), { env: {}, run: async options => {
    received = options;
    return { ok: true, result: { text: 'result', semantic_similarity: 0.9, fact_check_passed: true } };
  } });
  assert.equal(received.timeoutMs, 360000);
  assert.equal(result.timeout_ms, 360000);
});

test('automatic interpreter lookup skips WindowsApps aliases but explicit absolute selection works', async () => {
  const root = await mkdtemp(join(process.cwd(), '.rea-test-'));
  try {
    const aliases = join(root, 'WindowsApps'); await mkdir(aliases);
    const executable = join(aliases, process.platform === 'win32' ? 'python.exe' : 'python');
    await writeFile(executable, 'alias', { mode: 0o755 });
    await assert.rejects(resolvePythonExecutable({ python: 'python', env: { PATH: aliases } }), /not found/i);
    assert.equal(await resolvePythonExecutable({ python: executable }), executable);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('fixed bridge receives rewrite content as JSON data, never executable arguments', async () => {
  let received;
  const result = await rewriteWithReweave('Arabic عربي; $(danger)', { python: 'configured-python', run: async options => {
    received = options;
    return { ok: true, result: { text: 'A candidate.', status: 'model_rewrite_best_effort', statistical_removal: 'statistical_removal_not_verified', semantic_similarity: 0.9, fact_check_passed: true } };
  } });
  assert.equal(received.python, 'configured-python');
  assert.equal(received.payload.operation, 'rewrite');
  assert.equal(received.payload.text, 'Arabic عربي; $(danger)');
  assert.equal(received.payload.model, 'gemma3:4b');
  assert.equal(received.timeoutMs, 120000);
  assert.equal(result.text, 'A candidate.');
  assert.equal('args' in received, false);
});

test('provider failures and failed gates do not fall back to original text', async () => {
  await assert.rejects(rewriteWithReweave('Original.', { run: async () => ({ ok: false, error: { code: 'unavailable', message: 'Ollama is not running' } }) }), /Ollama/);
  await assert.rejects(rewriteWithReweave('Original.', { run: async () => ({ ok: true, result: { text: 'Changed', semantic_similarity: 0.2, fact_check_passed: true } }) }), /gate|similarity/i);
  await assert.rejects(rewriteWithReweave('Original.', { run: async () => ({ ok: true, result: { text: 'Changed', semantic_similarity: 0.99, fact_check_passed: false } }) }), /gate|fact/i);
});

test('protected-only passthrough does not claim model rewriting', async () => {
  const result = await rewriteWithReweave('⟦REA_PROTECTED_abc_0⟧', { run: async () => ({ ok: true, result: { text: '⟦REA_PROTECTED_abc_0⟧', status: 'protected_text_unchanged', verified_chunks: 0, semantic_similarity: 1, fact_check_passed: true } }) });
  assert.equal(result.status, 'protected_text_unchanged');
  assert.equal(result.verified_chunks, 0);
});

test('capabilities distinguish missing interpreter without claiming provider readiness', async () => {
  const result = await providerCapabilities({ python: 'missing-python', run: async () => { throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT', syscall: 'spawn missing-python' }); } });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reweave.ready, false);
  assert.equal(result.lama.ready, false);
});

test('interpreter resolution ignores cwd and relative PATH entries', async () => {
  const root = await mkdtemp(join(process.cwd(), '.rea-test-'));
  try {
    const filename = process.platform === 'win32' ? 'python.exe' : 'python';
    await writeFile(join(root, filename), 'untrusted', { mode: 0o755 });
    await assert.rejects(resolvePythonExecutable({ python: 'python', cwd: root, env: { PATH: ['.', '', root].join(delimiter) } }), /not found/i);
    await assert.rejects(resolvePythonExecutable({ python: './python', cwd: root }), /absolute/i);
    assert.equal(await resolvePythonExecutable({ python: process.execPath }), process.execPath);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('bridge crash is an error rather than missing optional dependencies', async () => {
  await assert.rejects(providerCapabilities({ run: async () => { throw new Error('Python bridge exited 7'); } }), /exited 7/);
  await assert.rejects(providerCapabilities({ run: async () => ({ ok: false, error: { message: 'bridge defect' } }) }), /bridge defect/);
});

test('runner strips proxies, reports interpreter and tolerates verbose stderr', async () => {
  let childOptions;
  const result = await defaultRun({ python: process.execPath, payload: {}, env: { ...process.env, HTTP_PROXY: 'secret', https_proxy: 'secret', All_Proxy: 'secret' }, spawnProcess: (file, args, options) => {
    childOptions = options;
    assert.equal(file, process.execPath);
    return spawn(process.execPath, ['-e', "process.stderr.write('x'.repeat(200000));process.stdout.write(JSON.stringify({ok:true,result:{status:'available'}}))"], options);
  } });
  assert.equal(result.resolved_python, process.execPath);
  assert.equal(childOptions.env.NO_PROXY, 'localhost,127.0.0.1');
  assert.equal(childOptions.env.no_proxy, 'localhost,127.0.0.1');
  assert.ok(!Object.keys(childOptions.env).some(key => /^(http|https|all)_proxy$/i.test(key)));
});

test('image adapter requires explicit paths and passes configured model only', async () => {
  let received;
  const result = await restoreWithLama({ input_path: 'source.png', mask_path: 'mask.png', output_path: 'new.png' }, { modelPath: 'weights.pt', run: async options => { received = options; return { ok: true, result: { status: 'image_inpainted', output_path: 'new.png' } }; } });
  assert.equal(received.payload.operation, 'image');
  assert.equal(received.payload.model_path, 'weights.pt');
  assert.equal(result.status, 'image_inpainted');
  await assert.rejects(restoreWithLama({ input_path: 'a.png', output_path: 'b.png' }), /mask_path/);
  await assert.rejects(restoreWithLama({ input_path: 'a.png', mask_path: 'mask.png', output_path: 'b.png' }, { modelPath: '' }), /model/i);
});

test('input validation rejects remote models, huge text and malformed provider responses', async () => {
  await assert.rejects(rewriteWithReweave('x', { model: 'https://remote/model' }), /model/i);
  await assert.rejects(rewriteWithReweave('x'.repeat(1024 * 1024 + 1)), /1 MiB/);
  await assert.rejects(rewriteWithReweave('x', { run: async () => 'not JSON' }), /response/i);
});

test('real Python bridge capability probe returns honest local readiness', async () => {
  const result = await providerCapabilities();
  let python;
  try { python = await resolvePythonExecutable(); } catch (error) { if (error.code !== 'REA_INTERPRETER_MISSING') throw error; }
  assert.equal(result.status, python ? 'available' : 'unavailable');
  if (python) assert.equal(result.resolved_python, python);
  assert.equal(typeof result.reweave.ready, 'boolean');
  assert.equal(typeof result.lama.ready, 'boolean');
});

test('real fixed bridge runner bounds output and obeys timeout or abort', async t => {
  const capability = await providerCapabilities();
  if (capability.status === 'unavailable') { t.skip('Configured Python is unavailable; capability failure was checked separately.'); return; }
  await assert.rejects(defaultRun({ python: process.env.REA_OUTPUT_PYTHON ?? 'python', payload: { operation: 'capabilities' }, maxOutputBytes: 1 }), /output|limit/i);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(defaultRun({ payload: { operation: 'capabilities' }, signal: controller.signal }), /abort/i);
  await assert.rejects(defaultRun({ payload: { operation: 'capabilities' }, timeoutMs: 1 }), /timeout exceeded \(1 ms budget\)/i);
});

test('real image bridge refuses existing output and leaves all files intact before importing optional dependencies', async t => {
  const capability = await providerCapabilities();
  if (capability.status === 'unavailable') { t.skip('Configured Python unavailable.'); return; }
  const root = await mkdtemp(join(process.cwd(), '.rea-test-'));
  try {
    const input_path = join(root, 'source.png');
    const mask_path = join(root, 'mask.png');
    const output_path = join(root, 'existing.png');
    const modelPath = join(root, 'weights.pt');
    for (const path of [input_path, mask_path, output_path, modelPath]) await writeFile(path, 'original bytes');
    await assert.rejects(restoreWithLama({ input_path, mask_path, output_path }, { modelPath }), /never overwrite/);
    for (const path of [input_path, mask_path, output_path, modelPath]) assert.equal(await readFile(path, 'utf8'), 'original bytes');
  } finally { await rm(root, { recursive: true, force: true }); }
});
