const MAX_UNITS = 1048576;
const DETAIL_LIMIT = 200;
const splitPair = (text, offset) => offset > 0 && offset < text.length && /[\uD800-\uDBFF]/u.test(text[offset - 1]) && /[\uDC00-\uDFFF]/u.test(text[offset]);

function mergeRanges(ranges) {
  const sorted = ranges.map(({ start, end }) => ({ start, end })).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push(range);
  }
  return merged;
}

function markdownRanges(text) {
  const ranges = [];
  let fence;
  let lazyQuote = false;
  for (const line of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    if (!line[0]) continue;
    const content = line[0].replace(/\r?\n$/u, '');
    // Detect syntax as it would appear after removable leading characters are
    // gone, but protect original offsets. Never clean protected body content.
    let leading = 0;
    while (leading < content.length && removable(content.codePointAt(leading))) leading++;
    let prefixEnd = leading;
    let indentation = '';
    while (prefixEnd < content.length) {
      const char = content[prefixEnd];
      if (char === ' ' || char === '\t') { indentation += char; prefixEnd++; }
      else if (removable(content.codePointAt(prefixEnd))) prefixEnd++;
      else break;
    }
    const visible = indentation + content.slice(prefixEnd);
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(visible);
    const start = line.index + leading;
    const end = line.index + line[0].length;
    if (fence) {
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) {
        ranges.push({ start: fence.start, end });
        fence = undefined;
      }
    } else if (!visible.trim()) lazyQuote = false;
    else if (/^[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?>/u.test(visible)) {
      ranges.push({ start, end });
      lazyQuote = true;
    } else if (lazyQuote) ranges.push({ start: line.index, end });
    else if (marker) fence = { start, char: marker[1][0], length: marker[1].length };
    else if (/^(?: {4}| {0,3}\t)/u.test(visible)) ranges.push({ start, end });
  }
  if (fence) ranges.push({ start: fence.start, end: text.length });
  // HTML code containers are opaque, including attributes and multiline bodies.
  // Conservatively protect an unclosed container through the end of the output.
  const htmlOpen = /<(pre|code)\b[^>]*>/giu;
  let htmlMatch;
  while ((htmlMatch = htmlOpen.exec(text))) {
    const closer = new RegExp(`</${htmlMatch[1]}[ \\t\\r\\n]*>`, 'giu');
    closer.lastIndex = htmlOpen.lastIndex;
    const close = closer.exec(text);
    const end = close ? close.index + close[0].length : text.length;
    ranges.push({ start: htmlMatch.index, end });
    htmlOpen.lastIndex = end;
  }
  // Match equal backtick runs, avoiding partial matches against longer delimiters.
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('`', cursor);
    if (start < 0) break;
    let openEnd = start + 1;
    while (text[openEnd] === '`') openEnd++;
    const delimiter = text.slice(start, openEnd);
    let close = text.indexOf(delimiter, openEnd);
    while (close >= 0 && (text[close - 1] === '`' || text[close + delimiter.length] === '`')) close = text.indexOf(delimiter, close + delimiter.length);
    if (close >= 0) { ranges.push({ start, end: close + delimiter.length }); cursor = close + delimiter.length; }
    else cursor = openEnd;
  }
  // Protect complete parenthesized targets, including nested or escaped parentheses.
  cursor = 0;
  while (cursor < text.length) {
    const opener = text.indexOf('](', cursor);
    if (opener < 0) break;
    let depth = 1;
    let end = opener + 2;
    for (; end < text.length && depth; end++) {
      if (text[end] === '\\') { end++; continue; }
      if (text[end] === '(') depth++;
      else if (text[end] === ')') depth--;
    }
    if (!depth) ranges.push({ start: opener + 2, end: end - 1 });
    else ranges.push({ start: opener + 2, end: text.length });
    cursor = end;
  }
  for (const line of text.matchAll(/^ {0,3}\[[^\]\r\n]+\]:[^\r\n]*/gm)) ranges.push({ start: line.index, end: line.index + line[0].length });
  return ranges;
}

function prepare(text, { format = 'markdown', protected_ranges = [] } = {}) {
  if (typeof text !== 'string' || text.length > MAX_UNITS) throw new TypeError('Output must be text of at most 1048576 UTF16 code units.');
  if (!['plain', 'markdown'].includes(format)) throw new Error('Output format must be plain or markdown.');
  if (!Array.isArray(protected_ranges)) throw new TypeError('Protected ranges must be an array.');
  const ranges = [];
  for (const range of protected_ranges) {
    if (!range || typeof range !== 'object' || Array.isArray(range) || Object.keys(range).some(key => !['start', 'end'].includes(key)) || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end <= range.start || range.end > text.length || splitPair(text, range.start) || splitPair(text, range.end)) throw new Error('Protected range must be a nonempty valid UTF16 interval without split surrogate pairs.');
    ranges.push({ start: range.start, end: range.end });
  }
  if (format === 'markdown') ranges.push(...markdownRanges(text));
  for (const url of text.matchAll(/(?:https?|ftp):\/\/[^\s<>"`]+/giu)) ranges.push({ start: url.index, end: url.index + url[0].length });
  return mergeRanges(ranges);
}

function removable(cp) {
  if (cp === 0x200B) return 'zero-width-space';
  if (cp === 0xFEFF) return 'byte-order-mark-or-zero-width-no-break-space';
  if (cp === 0xAD) return 'soft-hyphen';
  if ((cp < 0x20 && ![9, 10, 11, 12, 13, 28, 29, 30, 31].includes(cp)) || cp === 0x7F) return 'non-layout-control';
  return undefined;
}
function retainReason(cp) {
  if (cp === 0x0B || (cp >= 0x1C && cp <= 0x1F)) return 'layout-or-bidi-separator';
  if (cp === 0x200C || cp === 0x200D) return 'shaping-or-emoji-joiner';
  if ([0x61C, 0x200E, 0x200F].includes(cp) || (cp >= 0x202A && cp <= 0x202E) || (cp >= 0x2066 && cp <= 0x2069)) return 'text-direction-control';
  if ((cp >= 0xFE00 && cp <= 0xFE0F) || (cp >= 0xE0100 && cp <= 0xE01EF)) return 'variation-selector';
  if (cp >= 0xE0020 && cp <= 0xE007F) return 'emoji-tag-sequence';
  return undefined;
}

function scan(text, options, finalize) {
  const ranges = prepare(text, options);
  const report = { removed_count: 0, removed: [], removed_omitted_count: 0, preserved_count: 0, preserved: [], preserved_omitted_count: 0, protected_ranges: ranges, statistical_watermark_removal: 'not_verified', meaning_verified: false, source_modified: false, limitations: ['Selected Unicode hygiene only; invisible characters are not proof of a watermark.', 'No statistical watermark, human authorship or detector outcome is verified.', 'Protected ranges, code, quotations, URLs, shaping and direction controls are preserved; Markdown protection is conservative, not a complete parser.', 'No normalization, rewriting, punctuation or whitespace conversion is performed. Offsets refer to the original input; source files are not modified.'] };
  const chunks = [];
  let sliceStart = 0;
  let rangeIndex = 0;
  for (let start = 0; start < text.length;) {
    const cp = text.codePointAt(start);
    const end = start + (cp > 0xFFFF ? 2 : 1);
    while (rangeIndex < ranges.length && ranges[rangeIndex].end <= start) rangeIndex++;
    const protectedHere = rangeIndex < ranges.length && ranges[rangeIndex].start < end && ranges[rangeIndex].end > start;
    const removeReason = removable(cp);
    const preservedReason = retainReason(cp);
    if (removeReason && !protectedHere) {
      report.removed_count++;
      if (report.removed.length < DETAIL_LIMIT) report.removed.push({ start, end, codepoint: `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`, reason: removeReason });
      if (finalize) { chunks.push(text.slice(sliceStart, start)); sliceStart = end; }
    } else if (removeReason || preservedReason) {
      report.preserved_count++;
      if (report.preserved.length < DETAIL_LIMIT) report.preserved.push({ start, end, codepoint: `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`, reason: protectedHere ? `protected-span:${removeReason ?? preservedReason}` : preservedReason });
    }
    start = end;
  }
  report.removed_omitted_count = report.removed_count - report.removed.length;
  report.preserved_omitted_count = report.preserved_count - report.preserved.length;
  if (!finalize) return { report, changed: report.removed_count > 0 };
  chunks.push(text.slice(sliceStart));
  return { cleaned_text: chunks.join(''), report };
}

/** Audit proposed removals without returning or mutating source text. */
export const inspectOutput = (text, options = {}) => scan(text, options, false);
/** Finalize a new output string; callers must protect verbatim citations by range. */
export const finalizeOutput = (text, options = {}) => scan(text, options, true);
