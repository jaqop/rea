import { mkdir, open, rename, unlink, rmdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, validateBook, buildClaim, getPassage } from './core.mjs';
import { toolDefinitions, validateArguments } from './contracts.mjs';

export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export async function readBounded(path) {
  const handle = await open(resolve(path), 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error('Expected a regular file no larger than 16 MiB.');
    const buffer = Buffer.alloc(info.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size !== info.size) throw new Error('File changed during read; retry with a stable copy.');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, size));
  } finally { await handle.close(); }
}

export function projectState(project) {
  return { schema: project.schema, book: project.book, claims: project.claims, scenes: project.scenes, mechanisms: project.mechanisms, unknowns: project.unknowns };
}

export function validateProject(project) {
  if (!project || project.schema !== 'NarrativeInvestigation/1') throw new Error('Unsupported investigation format.');
  validateBook(project.book);
  for (const key of ['claims', 'scenes', 'mechanisms', 'unknowns', 'ledger']) {
    if (!Array.isArray(project[key])) throw new Error(`Invalid ${key}.`);
  }
  if (project.state_sha256 !== digest(projectState(project))) throw new Error('Investigation state digest mismatch.');
  let previous = null;
  for (const [index, entry] of project.ledger.entries()) {
    const { hash, ...payload } = entry;
    if (typeof payload.operation !== 'string' || !payload.operation || !/^[a-f0-9]{64}$/.test(payload.state_sha256) || payload.sequence !== index + 1 || payload.previous !== previous || hash !== digest(payload)) throw new Error('Broken evidence history.');
    previous = hash;
  }
  if (!project.ledger.length || project.ledger.at(-1).state_sha256 !== project.state_sha256) throw new Error('History does not bind current state.');
  for (const key of ['claims', 'scenes', 'mechanisms', 'unknowns']) {
    const ids = project[key].map(item => item.id);
    if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${key} identities.`);
    for (const id of ids) checkId(id);
  }
  const allIds = [...project.claims, ...project.scenes, ...project.mechanisms, ...project.unknowns].map(item => item.id);
  if (new Set(allIds).size !== allIds.length) throw new Error('Identities must be unique across record types.');
  for (const claim of project.claims) {
    if (digest(buildClaim(project.book, claim)) !== digest(claim)) throw new Error('Stored claim is not canonical.');
  }
  const validateRecord = (tool, record) => validateArguments({ book_id: project.book.id, ...record }, toolDefinitions.find(item => item.name === tool).inputSchema);
  for (const scene of project.scenes) {
    const { authority, ...record } = scene;
    if (authority !== 'analyst-inference') throw new Error('Scene authority must remain analyst-inference.');
    validateRecord('record_scene', record);
    scene.passage_ids.forEach(id => getPassage(project.book, id));
    scene.depends_on.forEach(id => requireRecord(project, 'scenes', id));
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(scene) {
    if (visiting.has(scene.id)) throw new Error('Scene dependencies contain a cycle.');
    if (visited.has(scene.id)) return;
    visiting.add(scene.id);
    scene.depends_on.forEach(id => visit(requireRecord(project, 'scenes', id)));
    visiting.delete(scene.id);
    visited.add(scene.id);
  }
  project.scenes.forEach(visit);
  for (const mechanism of project.mechanisms) {
    const { authority, tested, ...record } = mechanism;
    if (authority !== 'hypothesis' || tested !== false) throw new Error('Mechanisms are untested hypotheses; no empirical verification is provided.');
    validateRecord('record_mechanism', record);
    mechanism.claim_ids.forEach(id => requireRecord(project, 'claims', id));
  }
  for (const unknown of project.unknowns) {
    const { status, resolution, ...record } = unknown;
    validateRecord('record_unknown', record);
    if (!['open', 'resolved'].includes(status) || (status === 'open' && resolution !== null) || (status === 'resolved' && !resolution)) throw new Error('Invalid unknown resolution state.');
    if (resolution) {
      const { authority, ...details } = resolution;
      if (authority !== 'analyst-inference') throw new Error('Resolution is an analyst inference.');
      validateRecord('resolve_unknown', { id: unknown.id, ...details });
    }
    [...unknown.supporting_claim_ids, ...unknown.contradicting_claim_ids, ...(unknown.resolution?.claim_ids ?? [])].forEach(id => requireRecord(project, 'claims', id));
  }
  return project;
}

export function checkId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(id)) throw new Error('Record ID must start with an ASCII letter and contain only letters, digits, _ or -.');
}
export function requireRecord(project, collection, id) {
  const record = project[collection].find(item => item.id === id);
  if (!record) throw new Error(`Unknown ${collection === 'claims' ? 'claim' : collection}: ${id}`);
  return record;
}
export function addRecord(project, collection, record) {
  checkId(record.id);
  if (['claims', 'scenes', 'mechanisms', 'unknowns'].some(key => project[key].some(item => item.id === record.id))) throw new Error(`Duplicate record ID: ${record.id}`);
  project[collection].push(record);
  return record;
}

function seal(project, operation) {
  project.state_sha256 = digest(projectState(project));
  const payload = { sequence: project.ledger.length + 1, previous: project.ledger.at(-1)?.hash ?? null, operation, state_sha256: project.state_sha256 };
  project.ledger.push({ ...payload, hash: digest(payload) });
  return validateProject(project);
}

export class ProjectStore {
  constructor(home) { this.home = resolve(home); }
  path(id) {
    if (typeof id !== 'string' || !/^book_[a-f0-9]{64}$/.test(id)) throw new Error('Invalid book ID.');
    return join(this.home, `${id}.json`);
  }
  async load(id) {
    const project = validateProject(JSON.parse(await readBounded(this.path(id))));
    if (project.book.id !== id) throw new Error('Stored book identity does not match requested book ID.');
    return project;
  }
  async locked(id, run) {
    const path = this.path(id);
    await mkdir(this.home, { recursive: true });
    const lock = `${path}.lock`;
    try { await mkdir(lock); } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`Investigation is being written elsewhere. Retry; after a crashed writer, inspect and remove ${lock}.`);
      throw error;
    }
    try { return await run(path); } finally { await rmdir(lock); }
  }
  async save(path, project) {
    const serialized = JSON.stringify(project, null, 2) + '\n';
    if (Buffer.byteLength(serialized) > MAX_FILE_BYTES) throw new Error('Investigation exceeds the current 16 MiB storage limit. Split the corpus.');
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx');
      try { await handle.writeFile(serialized, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, path);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async create(book) {
    return this.locked(book.id, async path => {
      try { await stat(path); return this.load(book.id); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const project = seal({ schema: 'NarrativeInvestigation/1', book, claims: [], scenes: [], mechanisms: [], unknowns: [], ledger: [] }, 'import_book');
      await this.save(path, project);
      return project;
    });
  }
  async mutate(id, operation, run) {
    return this.locked(id, async path => {
      const project = await this.load(id);
      const result = await run(project);
      seal(project, operation);
      await this.save(path, project);
      return result;
    });
  }
  async restore(project) {
    validateProject(project);
    return this.locked(project.book.id, async path => {
      try { await stat(path); throw new Error('Investigation already exists; import into a new home to avoid replacing local work.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await this.save(path, project);
      return { book_id: project.book.id, imported: true };
    });
  }
}
