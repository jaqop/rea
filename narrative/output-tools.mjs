import { digest } from './core.mjs';
import { validateArguments } from './contracts.mjs';
import { inspectOutput, finalizeOutput } from './text-output.mjs';
import { providerCapabilities, rewriteWithReweave, restoreWithLama } from './output-providers.mjs';
import { outputDefinitions } from './output-contracts.mjs';

export { outputDefinitions } from './output-contracts.mjs';

function verifyRewriteCoverage(original, candidate) {
  const ratio = candidate.trim().length / Math.max(1, original.trim().length);
  if (ratio < 0.65 || ratio > 1.6) throw new Error('Rewrite coverage length gate failed; no replacement returned.');
  const separators = value => value.match(/\r\n|[\r\n\u000B\u000C\u001C-\u001F\u0085\u2028\u2029]/gu) ?? [];
  if (JSON.stringify(separators(original)) !== JSON.stringify(separators(candidate))) throw new Error('Rewrite paragraph/line coverage gate failed; no replacement returned.');
  const script = value => {
    value = value.replace(/⟦REA_PROTECTED_[0-9a-fx]+_\d+⟧/gu, '');
    const letters = [...value.matchAll(/\p{L}/gu)].length;
    if (!letters) return null;
    if ([...value.matchAll(/(?=\p{L})\p{Script=Arabic}/gu)].length / letters > 0.6) return 'Arabic';
    if ([...value.matchAll(/(?=\p{L})\p{Script=Latin}/gu)].length / letters > 0.6) return 'Latin';
    return null;
  };
  const expected = script(original);
  if (expected && script(candidate) !== expected) throw new Error('Rewrite language gate failed; no replacement returned.');
}

function structuralPrefixes(text) {
  const ranges = [];
  for (const line of text.matchAll(/[^\n]+/gu)) {
    let visible = '';
    const offsets = [];
    for (let index = 0; index < line[0].length; index++) {
      if (/[\uFEFF\u200B\u00AD\u0000-\u0008\u000E-\u001B\u007F]/u.test(line[0][index])) continue;
      offsets.push(index);
      visible += line[0][index];
    }
    const marker = /^(?: {0,3}#{1,6}[ \t]+|[ \t]*(?:[-+*]|\d+[.)])[ \t]+)/u.exec(visible);
    if (marker) ranges.push({ start: line.index + offsets[0], end: line.index + offsets[marker[0].length - 1] + 1 });
  }
  return ranges;
}

function protect(text, ranges) {
  let nonce = digest(text).slice(0, 20);
  while (text.includes(`⟦REA_PROTECTED_${nonce}_`)) nonce += 'x';
  const parts = [];
  const protectedSpans = [];
  let cursor = 0;
  for (const [index, range] of ranges.entries()) {
    const token = `⟦REA_PROTECTED_${nonce}_${index}⟧`;
    parts.push(text.slice(cursor, range.start), token);
    protectedSpans.push({ token, text: text.slice(range.start, range.end) });
    cursor = range.end;
  }
  parts.push(text.slice(cursor));
  return { masked: parts.join(''), protectedSpans, prefix: `⟦REA_PROTECTED_${nonce}_` };
}

function restore(candidate, protectedSpans, prefix) {
  const parts = [];
  const ranges = [];
  let cursor = 0;
  let length = 0;
  for (const span of protectedSpans) {
    const start = candidate.indexOf(span.token);
    if (start < cursor || start < 0 || candidate.indexOf(span.token, start + span.token.length) >= 0) throw new Error('Rewrite failed: each protected placeholder must occur exactly once in its original order. No replacement returned.');
    const prose = candidate.slice(cursor, start);
    if (prose.includes(prefix)) throw new Error('Rewrite returned an unexpected protected placeholder. No replacement returned.');
    parts.push(prose, span.text);
    length += prose.length;
    ranges.push({ start: length, end: length + span.text.length });
    length += span.text.length;
    cursor = start + span.token.length;
  }
  const tail = candidate.slice(cursor);
  if (tail.includes(prefix)) throw new Error('Rewrite returned an unexpected protected placeholder. No replacement returned.');
  parts.push(tail);
  return { text: parts.join(''), ranges };
}

/** Named output tools; only configured providers run, and provider/gate failures propagate. */
export async function handleOutput(name, args = {}, providerOptions = {}) {
  const definition = outputDefinitions.find(item => item.name === name);
  if (!definition) return undefined;
  validateArguments(args, definition.inputSchema);
  if (name === 'output_capabilities') return { ...await providerCapabilities(providerOptions), unicode_cleanup: { ready: true, languages: 'Unicode text including Arabic and English', scope: 'Selected character cleanup only; protected spans and meaningful shaping/direction characters remain intact.' } };
  if (name === 'restore_output_image') return restoreWithLama(args, providerOptions);
  const { text, format = 'markdown', protected_ranges = [], model } = args;
  const options = { format, protected_ranges };
  if (name === 'inspect_output_text') return inspectOutput(text, options);
  if (name === 'finalize_output_text') return finalizeOutput(text, options);
  if (Buffer.byteLength(text, 'utf8') > 4096) throw new Error('Rewrite input exceeds 4096 UTF8 bytes (4 KiB); use smaller reviewed units.');
  const audit = inspectOutput(text, options);
  const structural = format === 'markdown' ? structuralPrefixes(text) : [];
  const ranges = inspectOutput(text, { ...options, protected_ranges: [...audit.report.protected_ranges, ...structural] }).report.protected_ranges;
  const { masked, protectedSpans, prefix } = protect(text, ranges);
  if (Buffer.byteLength(masked, 'utf8') > 4096) throw new Error('Rewrite masked input including protected placeholders exceeds 4096 UTF8 bytes; use smaller units.');
  if ([...masked.matchAll(/\S+/gu)].some(match => Buffer.byteLength(match[0], 'utf8') > 512)) throw new Error('Rewrite masked token exceeds 512 UTF8 bytes; separate protected spans or use smaller units.');
  const result = await rewriteWithReweave(masked, { ...providerOptions, ...(model === undefined ? {} : { model }) });
  // Bound provider output before restoration, then bound restored text again in the finalizer.
  if (result.text.length > 1048576 || Buffer.byteLength(result.text, 'utf8') > 1048576) throw new Error('Rewrite candidate exceeds the 1 MiB output limit.');
  const restored = restore(result.text, protectedSpans, prefix);
  verifyRewriteCoverage(masked, result.text);
  const finalized = finalizeOutput(restored.text, { format, protected_ranges: restored.ranges });
  return { ...finalized, status: result.verified_chunks === 0 ? 'protected_text_unchanged' : 'model_rewrite_best_effort', model: result.model ?? model ?? 'gemma3:4b', semantic_similarity: result.semantic_similarity, fact_check_passed: result.fact_check_passed, semantic_fidelity_guaranteed: false, requires_human_review: result.verified_chunks !== 0, verified_chunks: result.verified_chunks, timeout_ms: result.timeout_ms, protected_spans_preserved: true, protected_span_count: protectedSpans.length, report_offsets_reference: 'rewritten text before selected Unicode removals', limitations: ['The model rewrites prose; similarity and fact gates do not prove meaning, voice, statistical watermark removal or detector outcomes.', 'Protected spans were restored exactly once in their original order. Their placement relative to rewritten prose still requires human review.', ...(Array.isArray(result.limitations) ? result.limitations.filter(item => typeof item === 'string').slice(0, 20) : [])] };
}

export function createOutputTools(providerOptions = {}) {
  return { definitions: outputDefinitions, call: (name, args = {}) => handleOutput(name, args, providerOptions) };
}
