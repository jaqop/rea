import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBook, validateBook, getPassage, searchBook, validateCitation, buildClaim, digest } from './core.mjs';

test('preserves Arabic, CRLF and non-BMP source offsets and title-independent identity', () => {
  const text = '# الفصل الأول\r\n\r\n  عاد 😀 سالماً.\r\nسطر ثان.  \r\n\r\nChapter 2\r\n\r\nEnd.';
  const book = buildBook(text, 'رواية');
  assert.equal(book.text, text);
  assert.equal(book.offset_unit, 'utf16-code-unit');
  assert.equal(book.passages.length, 4);
  assert.equal(book.passages[1].text, '  عاد 😀 سالماً.\r\nسطر ثان.  ');
  for (const p of book.passages) assert.equal(text.slice(p.start, p.end), p.text);
  assert.equal(book.passages[1].chapter, 'الفصل الأول');
  assert.equal(book.passages[3].chapter, 'Chapter 2');
  assert.equal(buildBook(text, 'Another title').id, book.id);
  assert.deepEqual(validateBook(JSON.parse(JSON.stringify(book))), book);
});

test('rejects changed source, passage metadata and malformed books', () => {
  const b = buildBook('One.\n\nTwo.');
  for (const changed of [{ ...b, text: 'Changed' }, { ...b, source_sha256: '0'.repeat(64) }, { ...b, passages: [{ ...b.passages[0], start: 1 }, b.passages[1]] }]) assert.throws(() => validateBook(changed));
  for (const bad of [null, {}, '', 1]) assert.throws(() => validateBook(bad));
  for (const bad of ['', ' \r\n\t', null, 12]) assert.throws(() => buildBook(bad));
  assert.throws(() => buildBook('Text', ''));
  assert.throws(() => getPassage(b, 'missing'));
});

test('literal search pages complete passage matches without interpreting regex', () => {
  const b = buildBook('A [x]\n\na [x]\n\nArabic عربي');
  const page = searchBook(b, '[X]', { limit: 1 });
  assert.equal(page.total, 2);
  assert.equal(page.next_offset, 1);
  assert.equal(searchBook(b, '[x]', { offset: 1 }).items[0].id, 'p000002');
  assert.equal(searchBook(b, 'عربي').total, 1);
  assert.equal(searchBook(b, '.*').total, 0);
  for (const options of [{ limit: 0 }, { limit: 201 }, { offset: -1 }, { offset: 0.5 }]) assert.throws(() => searchBook(b, 'a', options));
  assert.throws(() => searchBook(b, ''));
});

test('citations verify exact source and absolute UTF16 spans', () => {
  const b = buildBook('Heading\n\nقال 😀 نعم.');
  const p = b.passages[1];
  const c = { passage_id: p.id, start: p.start + 4, end: p.start + 6, quote: '😀' };
  const enriched = validateCitation(b, c);
  assert.equal(enriched.book_id, b.id);
  assert.equal(enriched.source_sha256, b.source_sha256);
  assert.deepEqual(validateCitation(b, enriched), enriched);
  for (const bad of [{ ...c, quote: 'لا' }, { ...c, start: 0 }, { ...c, end: c.start }, { ...enriched, book_id: 'wrong' }, { ...enriched, source_sha256: 'wrong' }]) assert.throws(() => validateCitation(b, bad));
});

test('claims retain disagreement and require falsifiable interpretive support', () => {
  const b = buildBook('He left.\n\nShe stayed.');
  const p = b.passages[0];
  const support = [{ passage_id: p.id, start: p.start, end: p.end, quote: p.text }];
  const observation = buildClaim(b, { id: 'departure', kind: 'observation', statement: 'He leaves.', support });
  assert.equal(observation.support[0].book_id, b.id);
  const input = { id: 'constraint', kind: 'hypothesis', statement: 'Departure constrains her options.', support, alternatives: ['Departure is incidental.'], test: 'Check later choices for dependency.' };
  assert.equal(buildClaim(b, input).alternatives.length, 1);
  for (const patch of [{ id: '../bad' }, { support: [] }, { alternatives: [] }, { test: '' }, { kind: 'fact' }]) assert.throws(() => buildClaim(b, { ...input, ...patch }));
});

test('canonical digest ignores key ordering but preserves prototype-named data', () => {
  assert.equal(digest({ b: 2, a: [1, 3] }), digest({ a: [1, 3], b: 2 }));
  assert.notEqual(digest(JSON.parse('{"__proto__":{"x":1}}')), digest({}));
  for (const bad of [undefined, NaN, { x: undefined }, new Date()]) assert.throws(() => digest(bad));
});
