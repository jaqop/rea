const text = { type: 'string', maxLength: 1048576 };
const path = { type: 'string', minLength: 1, maxLength: 32768 };
const integer = { type: 'integer', minimum: 0, maximum: 1048576 };
const range = { type: 'object', properties: { start: integer, end: integer }, required: ['start', 'end'], additionalProperties: false };
const options = { text, format: { enum: ['plain', 'markdown'] }, protected_ranges: { type: 'array', items: range, maxItems: 10000 } };
const spec = (name, description, properties, required, write = false) => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations: { readOnlyHint: !write, destructiveHint: false, idempotentHint: !write, openWorldHint: false } });
export const outputDefinitions = [
  spec('output_capabilities', 'Check configured local rewrite/image providers. Missing dependencies remain unavailable; this tool installs nothing.', {}, []),
  spec('inspect_output_text', 'Audit selected Unicode characters in new output without returning modified text. Preserve exact citations with original UTF16 protected_ranges. No watermark or authorship verdict.', options, ['text']),
  spec('finalize_output_text', 'Finalize new output by conservative selected-character removal while preserving code, URLs, quotes and caller ranges. Does not modify source files or rewrite style.', options, ['text']),
  spec('rewrite_output_text', 'Request a local model rewrite of authorized new output, at most 4096 UTF8 bytes per call. Protected spans must survive exactly once in order or the operation fails. Bounded chunks and coverage/similarity/fact gates do not establish statistical watermark removal or meaning preservation.', { ...options, text: { ...text, maxLength: 4096, minLength: 1 }, model: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$', maxLength: 128 } }, ['text']),
  spec('restore_output_image', 'Restore an explicitly supplied image region using an explicit mask and configured local LaMa model. Writes a new output file; no authenticity or provenance-removal guarantee.', { input_path: path, mask_path: path, output_path: path }, ['input_path', 'mask_path', 'output_path'], true),
];
outputDefinitions.find(tool => tool.name === 'rewrite_output_text').annotations.idempotentHint = false;
