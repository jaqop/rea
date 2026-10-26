import { createHash } from 'node:crypto';

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const object = (value, name) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
};
const nonempty = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be nonempty text`);
  return value;
};

/** Canonical JSON commitment, rejecting lossy or non-JSON values. */
export function digest(value) {
  const seen = new Set();
  const encode = (item) => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== 'object' || seen.has(item)) throw new TypeError('Digest requires acyclic JSON data');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new TypeError('Digest requires plain JSON objects');
    seen.add(item);
    let result;
    if (Array.isArray(item)) {
      const parts = [];
      for (let i = 0; i < item.length; i++) {
        if (!Object.hasOwn(item, i)) throw new TypeError('Sparse arrays are not JSON data');
        parts.push(encode(item[i]));
      }
      result = `[${parts.join(',')}]`;
    } else result = `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${encode(item[key])}`).join(',')}}`;
    seen.delete(item);
    return result;
  };
  return sha256(encode(value));
}

function passagesFor(text) {
  const passages = [];
  let chapter = null;
  // Blank lines separate paragraphs; content spaces and original newline bytes remain intact.
  const separator = /\r?\n[\t ]*\r?\n(?:[\t ]*\r?\n)*/g;
  let start = 0;
  const append = (end) => {
    const content = text.slice(start, end);
    if (!content.trim()) return;
    const heading = content.trim();
    if (!/[\r\n]/u.test(heading)) {
      const markdown = /^#{1,6}[\t ]+(.+?)(?:[\t ]+#+)?$/u.exec(heading);
      if (markdown) chapter = markdown[1];
      else if (/^(?:chapter\b|الفصل(?:\s|$)|فصل(?:\s|$))/iu.test(heading)) chapter = heading;
    }
    passages.push({ id: `p${String(passages.length + 1).padStart(6, '0')}`, index: passages.length, start, end, text: content, chapter });
  };
  for (const match of text.matchAll(separator)) {
    append(match.index);
    start = match.index + match[0].length;
  }
  append(text.length);
  return passages;
}

export function buildBook(text, title = 'Untitled') {
  nonempty(text, 'Source');
  nonempty(title, 'Title');
  const hash = sha256(text);
  return { schema: 'NarrativeBook/1', id: `book_${hash}`, title, source_sha256: hash, offset_unit: 'utf16-code-unit', text, passages: passagesFor(text), limitations: ['Chapter labels are heading heuristics, not verified narrative boundaries.'] };
}

export function validateBook(book) {
  object(book, 'Book');
  const expected = buildBook(book.text, book.title);
  for (const key of ['schema', 'id', 'source_sha256', 'offset_unit']) if (book[key] !== expected[key]) throw new Error(`Book ${key} does not match source`);
  if (digest(book.passages) !== digest(expected.passages)) throw new Error('Book passages do not match source');
  return book;
}

export function getPassage(book, id) {
  const passage = book.passages.find((item) => item.id === id);
  if (!passage) throw new Error(`Unknown passage: ${String(id)}`);
  return passage;
}

export function searchBook(book, query, { offset = 0, limit = 20 } = {}) {
  nonempty(query, 'Query');
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError('Offset must be a nonnegative integer');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new RangeError('Limit must be between 1 and 200');
  const needle = query.toLowerCase();
  const matches = book.passages.filter((p) => p.text.toLowerCase().includes(needle));
  const items = matches.slice(offset, offset + limit);
  return { items, total: matches.length, next_offset: offset + items.length < matches.length ? offset + items.length : null, coverage: { status: 'complete', examined_passages: book.passages.length, scope: 'literal-passage-search', limitations: ['Literal matching does not establish semantic presence or absence.'] } };
}

export function validateCitation(book, citation) {
  object(citation, 'Citation');
  const passage = getPassage(book, citation.passage_id);
  const { start, end, quote } = citation;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < passage.start || end > passage.end || end <= start) throw new Error('Citation offsets must lie within its passage');
  if (typeof quote !== 'string' || book.text.slice(start, end) !== quote) throw new Error('Citation quote does not match source');
  for (const [key, expected] of [['book_id', book.id], ['source_sha256', book.source_sha256]]) if (Object.hasOwn(citation, key) && citation[key] !== expected) throw new Error(`Citation ${key} does not match source`);
  return { passage_id: passage.id, start, end, quote, book_id: book.id, source_sha256: book.source_sha256 };
}

export function buildClaim(book, input) {
  object(input, 'Claim');
  if (typeof input.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/u.test(input.id)) throw new Error('Claim id must be a safe identifier');
  if (!['observation', 'inference', 'hypothesis'].includes(input.kind)) throw new Error('Invalid claim kind');
  nonempty(input.statement, 'Claim statement');
  if (!Array.isArray(input.support) || input.support.length === 0) throw new Error('Claim requires source support');
  const against = input.against ?? [];
  const alternatives = input.alternatives ?? [];
  if (!Array.isArray(against) || !Array.isArray(alternatives)) throw new TypeError('Against and alternatives must be arrays');
  for (const item of alternatives) nonempty(item, 'Alternative');
  if (input.kind !== 'observation' && alternatives.length === 0) throw new Error('Interpretive claims require alternatives');
  if (input.kind !== 'observation' || input.test !== undefined) nonempty(input.test, 'Claim test');
  return { id: input.id, kind: input.kind, statement: input.statement, support: input.support.map((c) => validateCitation(book, c)), against: against.map((c) => validateCitation(book, c)), alternatives: [...alternatives], ...(input.test === undefined ? {} : { test: input.test }) };
}
