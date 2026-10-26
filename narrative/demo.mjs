import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTools } from './tools.mjs';

const root = await mkdtemp(join(process.cwd(), '.rea-test-'));
try {
  const source = join(root, 'demo.txt');
  await writeFile(source, '# الفصل الأول\n\nعرفت سلمى مكان الرسالة.\n\n# الفصل الثاني\n\nأخفت سلمى الرسالة قبل وصول الحارس.');
  const api = createTools(join(root, 'investigations'));
  const { book_id } = await api.call('import_book', { path: source, title: 'Synthetic demonstration' });
  const { items: [p] } = await api.call('search_passages', { book_id, query: 'عرفت' });
  await api.call('record_claim', { book_id, id: 'knowledge', kind: 'observation', statement: 'The passage explicitly says Salma knows the location.', support: [{ passage_id: p.id, start: p.start, end: p.end, quote: p.text }] });
  await api.call('record_mechanism', { book_id, id: 'information_advantage', title: 'Information enables a choice', claim_ids: ['knowledge'], conditions: ['One participant knows a location'], steps: ['Establish information before a consequential choice'], rivals: ['Opportunity may explain the choice'], prediction: 'Without prior information the choice may be less supported', test: 'Compare reader explanations with and without prior information', transfer_constraints: ['Give a new character an information advantage before a costly choice'] });
  console.log(JSON.stringify({ verification: await api.call('verify_investigation', { book_id }), transfer: await api.call('transfer_brief', { book_id }) }, null, 2));
} finally { await rm(root, { recursive: true, force: true }); }
