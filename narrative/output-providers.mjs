import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, resolve, delimiter, basename } from 'node:path';

const bridge = fileURLToPath(new URL('./adapters/output_bridge.py', import.meta.url));
const DEFAULT_TIMEOUT = 120000;
const MAX_TIMEOUT = 1800000;
const MAX_OUTPUT = 8 * 1024 * 1024;
const MAX_INPUT = 1024 * 1024;
const configuredPython = () => process.env.REA_OUTPUT_PYTHON ?? 'python';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value, name) => { if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error(`${name} must be nonempty text.`); };

/** Deployment configuration only; never read timeout settings from submitted text. */
export function providerTimeout(payload, env = process.env) {
  const configured = env.REA_OUTPUT_TIMEOUT_MS;
  if (configured !== undefined) {
    if (typeof configured !== 'string' || !/^\d+$/u.test(configured) || !Number.isSafeInteger(Number(configured)) || Number(configured) < 1000 || Number(configured) > MAX_TIMEOUT) throw new Error('REA_OUTPUT_TIMEOUT_MS must be an integer from 1000 to 1800000 milliseconds.');
    return Number(configured);
  }
  return payload?.operation === 'rewrite' ? Math.min(MAX_TIMEOUT, DEFAULT_TIMEOUT * Math.max(1, Math.ceil(Buffer.byteLength(payload.text ?? '', 'utf8') / 384))) : DEFAULT_TIMEOUT;
}

/** Never delegate executable lookup to Windows' cwd-first CreateProcess search. */
export async function resolvePythonExecutable({ python = configuredPython(), env = process.env, cwd = process.cwd() } = {}) {
  nonempty(python, 'Configured Python executable');
  const usable = async path => {
    try { if (!(await stat(path)).isFile()) return false; await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return true; }
    catch (error) { if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) return false; throw error; }
  };
  let candidates;
  if (isAbsolute(python)) candidates = [python];
  else {
    if (basename(python) !== python || /[\\/]/u.test(python)) throw new Error('Configured Python path must be absolute.');
    const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
    const equal = value => process.platform === 'win32' ? value.toLowerCase() : value;
    const directories = pathValue.split(delimiter).filter(value => isAbsolute(value) && equal(resolve(value)) !== equal(resolve(cwd)) && !/[\\/]WindowsApps(?:[\\/]|$)/iu.test(value));
    const names = process.platform === 'win32' && !/\.exe$/iu.test(python) ? [`${python}.exe`] : [python];
    candidates = directories.flatMap(directory => names.map(name => join(directory, name)));
  }
  for (const candidate of candidates) if (await usable(candidate)) return candidate;
  throw Object.assign(new Error(`Python interpreter not found in the configured absolute path or eligible absolute PATH entries: ${python}`), { code: 'REA_INTERPRETER_MISSING' });
}

function childEnvironment(env) {
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => !/^(?:http|https|all|no)_proxy$/iu.test(key)));
  return { ...clean, NO_PROXY: 'localhost,127.0.0.1', no_proxy: 'localhost,127.0.0.1' };
}

/** Fixed script and argument vector; caller content travels only on stdin. */
export async function defaultRun({ python = configuredPython(), payload, timeoutMs, maxOutputBytes = MAX_OUTPUT, signal, env = process.env, spawnProcess = spawn } = {}) {
  if (signal?.aborted) throw new Error('Provider operation aborted.');
  const budget = timeoutMs ?? providerTimeout(payload, env);
  const resolvedPython = await resolvePythonExecutable({ python, env });
  const input = JSON.stringify(payload) + '\n';
  if (Buffer.byteLength(input) > MAX_INPUT + 16384) throw new Error('Provider input exceeds the 1 MiB text limit.');
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnProcess(resolvedPython, ['-I', '-u', bridge], { shell: false, windowsHide: true, env: childEnvironment(env), stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (cause) { reject(cause); return; }
    let failure;
    let stdout = [];
    let stderr = Buffer.alloc(0);
    let bytes = 0;
    const stop = message => { failure ??= new Error(message); child.kill('SIGKILL'); };
    const abort = () => stop('Provider operation aborted.');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => stop(`Provider timeout exceeded (${budget} ms budget).`), budget);
    timer.unref();
    child.on('error', cause => { failure ??= cause; });
    child.stdin.on('error', cause => { if (cause.code !== 'EPIPE') failure ??= cause; });
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) { stdout = []; stop('Provider output exceeds its byte limit.'); }
      else if (!failure) stdout.push(chunk);
    });
    child.stderr.on('data', chunk => {
      // Retain only the diagnostic tail, without killing verbose model libraries.
      stderr = chunk.length >= 65536 ? Buffer.from(chunk.subarray(chunk.length - 65536)) : Buffer.concat([stderr.subarray(Math.max(0, stderr.length + chunk.length - 65536)), chunk]);
    });
    child.on('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure) { reject(failure); return; }
      if (code !== 0) { reject(new Error(`Python bridge exited ${code}: ${stderr.toString('utf8').slice(-2000)}`)); return; }
      try { const response = JSON.parse(Buffer.concat(stdout).toString('utf8')); if (object(response)) { response.resolved_python = resolvedPython; response.timeout_ms = budget; } resolve(response); }
      catch { reject(new Error('Python bridge returned an invalid JSON response.')); }
    });
    child.stdin.end(input);
  });
}

async function invoke(payload, { python = configuredPython(), run = defaultRun, signal, env = process.env } = {}) {
  const timeoutMs = providerTimeout(payload, env);
  const response = await run({ python, payload, timeoutMs, maxOutputBytes: MAX_OUTPUT, signal, env });
  if (!object(response) || typeof response.ok !== 'boolean') throw new Error('Invalid provider response.');
  if (!response.ok) throw new Error(response.error?.message ?? 'Provider failed without a usable result.');
  if (!object(response.result)) throw new Error('Invalid provider result response.');
  return { ...response.result, ...(response.resolved_python ? { resolved_python: response.resolved_python } : {}), timeout_ms: timeoutMs };
}

export async function providerCapabilities(options = {}) {
  try { return await invoke({ operation: 'capabilities', model_path: process.env.REA_LAMA_MODEL ?? null }, options); }
  catch (cause) {
    if (cause.code !== 'REA_INTERPRETER_MISSING' && !(cause.code === 'ENOENT' && cause.syscall?.startsWith('spawn '))) throw cause;
    return { status: 'unavailable', reason: cause.message, interpreter_status: 'missing', reweave: { ready: false, installed: false, import_status: 'unknown' }, lama: { ready: false, installed: false, import_status: 'unknown' }, statistical_removal: 'statistical_removal_not_verified' };
  }
}

export async function rewriteWithReweave(text, { model = 'gemma3:4b', ...options } = {}) {
  nonempty(text, 'Rewrite text');
  if (Buffer.byteLength(text) > MAX_INPUT) throw new Error('Rewrite text exceeds 1 MiB.');
  if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/.test(model) || model.includes('://')) throw new Error('Invalid local model name.');
  const result = await invoke({ operation: 'rewrite', text, model }, options);
  if (typeof result.text !== 'string' || !result.text.trim() || !Number.isFinite(result.semantic_similarity) || result.semantic_similarity < 0.82 || result.fact_check_passed !== true) throw new Error('Rewrite candidate failed the similarity/fact gate; no replacement returned.');
  return { ...result, status: result.verified_chunks === 0 && result.status === 'protected_text_unchanged' ? 'protected_text_unchanged' : 'model_rewrite_best_effort', statistical_removal: 'statistical_removal_not_verified', semantic_fidelity_guaranteed: false };
}

export async function restoreWithLama(paths, { modelPath = process.env.REA_LAMA_MODEL, ...options } = {}) {
  if (!object(paths)) throw new Error('Image input_path, mask_path and output_path are required.');
  for (const key of ['input_path', 'mask_path', 'output_path']) nonempty(paths[key], key);
  nonempty(modelPath, 'Configured local LaMa model path (REA_LAMA_MODEL)');
  return invoke({ operation: 'image', input_path: paths.input_path, mask_path: paths.mask_path, output_path: paths.output_path, model_path: modelPath }, options);
}
