import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBook } from './core.mjs';
import { selectSourceWindows, extractMechanisms } from './engine-extraction.mjs';
const book = () => buildBook(Array.from({ length: 30 }, (_, i) => `Scene ${i}: The guard watched the gate, tracked fresh footprints and drew a sword. A costly choice changed the pursuit. ${'Distance matters. '.repeat(24)}`).join('\n\n'));
const data = request => JSON.parse(request.prompt.split('SOURCE_DATA ')[1]);
const card = (request, index = 0, patch = {}) => ({ title: 'A trace constrains a choice', focus: data(request).primary_focus, conditions: ['A trace is available'], steps: ['Notice trace', 'Choose direction'], claimed_effect: 'Pursuit gains a constrained direction', transfer_rule: 'When partial evidence narrows available options, a costly decision exposes which uncertainty the actor accepts.', alternative: 'Direction was already known', test: 'Remove the trace and compare choice', evidence_ids: [data(request).snippets[index].id], source_entities: ['guard'], ...patch });
const answer = cards => ({ text: JSON.stringify({ mechanisms: cards }), provider: 'synthetic' });
test('schema binds canonical snippet IDs and cycles focus with two cards per window', async () => {
 const b=book(); const seen=[];
 const result=await extractMechanisms({book:b,focuses:['tracking','combat','plot'],max_windows:3,call:async request=>{
  const source=data(request);seen.push(source.primary_focus);
  assert.equal(request.schema.properties.mechanisms.maxItems,2);
  assert.match(request.system,/untrusted/i);
  for(const s of source.snippets){assert.ok(s.quote.length>=20&&s.quote.length<=350);assert.equal(b.text.slice(s.start,s.end),s.quote);assert.ok(b.passages.some(p=>p.id===s.passage_id&&p.start<=s.start&&p.end>=s.end));}
  return answer([card(request),card(request,1)]);
 }});
 assert.deepEqual(seen,['tracking','combat','plot']);assert.equal(result.mechanisms.length,6);assert.equal(new Set(result.mechanisms.map(m=>m.source_window_id)).size,3);
 assert.deepEqual(result.coverage.missing_focuses,[]);assert.ok(result.coverage.fraction<1);assert.equal(result.coverage.full_book_read,false);
 for(const m of result.mechanisms)for(const c of m.evidence)assert.equal(b.text.slice(c.start,c.end),c.quote);
});
test('forged, foreign-window IDs and model-typed quotes reject with bounded repairs',async()=>{
 for(const patch of [{evidence_ids:['forged']},{evidence_ids:['window_999_snippet_001']},{evidence:[{quote:'Invented source words'}]}]){
  let calls=0;await assert.rejects(extractMechanisms({book:book(),focuses:['tracking'],max_windows:2,call:async request=>{calls++;return answer([card(request,0,patch)]);}}),/two|insufficient/i);assert.equal(calls,6);
 }
});
test('repairs retain failures and missing requested focuses',async()=>{
 let calls=0;const r=await extractMechanisms({book:book(),focuses:['tracking','combat','plot'],max_windows:3,call:async request=>{calls++;if(calls===1)return{text:'{invalid'};if(calls===2)assert.match(request.prompt,/repair/i);if(data(request).primary_focus==='plot')return{text:'{}'};return answer([card(request)]);}});
 assert.equal(r.mechanisms.length,2);assert.equal(r.errors.length,1);assert.deepEqual(r.coverage.missing_focuses,['plot']);
});
test('deterministic windows and Arabic emoji CRLF snippet offsets stay exact',async()=>{
 const b=buildBook(Array.from({length:20},(_,i)=>`مشهد ${i}: قال الحارس 😀 إن الطريق مراقب.\r\n${'هذه قرينة ظاهرة ولا تثبت الدافع. '.repeat(20)}`).join('\r\n\r\n'));
 const opts={focuses:['tracking'],max_windows:3};assert.deepEqual(selectSourceWindows(b,opts),selectSourceWindows(b,opts));
 const r=await extractMechanisms({book:b,...opts,call:async request=>answer([card(request)])});
 for(const m of r.mechanisms)for(const c of m.evidence){assert.equal(b.text.slice(c.start,c.end),c.quote);assert.ok(!/^[\uDC00-\uDFFF]/u.test(c.quote));assert.ok(!/[\uD800-\uDBFF]$/u.test(c.quote));}
});
test('ranking uses only each primary focus rather than pooled combat frequency',()=>{
 const combat=('sword '.repeat(20)).padEnd(128,'.');
 const tracking=('footprints '.repeat(8)).padEnd(128,'.');
 const watching=('watched '.repeat(10)).padEnd(128,'.');
 const b=buildBook([tracking,combat,combat,combat,tracking,combat,combat,watching,combat].join(''));
 const windows=selectSourceWindows(b,{focuses:['tracking','combat','surveillance'],max_windows:3,window_size:128});
 assert.deepEqual(windows.map(w=>w.selection_reason.primary_focus),['tracking','combat','surveillance']);
 assert.match(windows[0].text,/footprints/);assert.match(windows[1].text,/sword/);assert.match(windows[2].text,/watched/);
 const fallback=selectSourceWindows(b,{focuses:['plot'],max_windows:1,window_size:128});
 assert.equal(fallback[0].selection_reason.fallback,'no-primary-focus-lexical-match');
});
test('six-card cap reserves coverage for a later fourth focus',async()=>{
 const r=await extractMechanisms({book:book(),focuses:['combat','surveillance','tracking','character'],max_windows:4,call:async request=>answer([card(request),card(request,1)])});
 assert.equal(r.mechanisms.length,6);
 assert.deepEqual(r.coverage.missing_focuses,[]);
 assert.deepEqual(new Set(r.mechanisms.map(m=>m.focus)),new Set(['combat','surveillance','tracking','character']));
 assert.equal(r.mechanisms.filter(m=>m.focus==='character').length,1);
 assert.equal(r.windows.length,4);
});
test('portable transfer rules reject source names and copied six-word sequences',async()=>{
 for(const [transfer_rule,source_entities,message] of [
  ['When Logen chooses, an uncertain cost limits available options.',['Logen'],'source entity'],
  ['When سليم chooses, an uncertain cost limits available options.',['سليم'],'source entity'],
  ['The guard watched the gate tracked fresh footprints and drew a sword.',['guard'],'source entity'],
  ['Distance matters distance matters distance matters.',[],'six-word'],
 ]){
  await assert.rejects(extractMechanisms({book:book(),focuses:['tracking'],max_windows:2,call:async request=>answer([card(request,0,{transfer_rule,source_entities})])}),error=>error.errors.every(e=>e.error.includes(message)));
 }
});
test('source-entity matching uses whole Unicode terms rather than substrings',async()=>{
 const r=await extractMechanisms({book:book(),focuses:['tracking'],max_windows:2,call:async request=>answer([card(request,0,{source_entities:['Ash'],transfer_rule:'A clash between obligations makes the price of an apparently neutral choice visible.'})])});
 assert.equal(r.mechanisms.length,2);
});
test('coverage separates selected windows from actual attempted model submissions',async()=>{
 const b=buildBook('A'.repeat(999)+'\n\n'+('Hi\n\n'.repeat(250))+'\n'+'B'.repeat(1000));
 assert.equal(b.text.length,3002);
 let calls=0;
 const r=await extractMechanisms({book:b,focuses:['tracking'],max_windows:3,call:async request=>{calls++;return answer([card(request)]);}});
 assert.equal(calls,2);
 assert.equal(r.coverage.read_units,2001);
 assert.equal(r.coverage.ranges.length,2);
 assert.equal(r.coverage.selected_units,3002);
 assert.equal(r.coverage.selected_ranges.length,3);
 assert.equal(r.coverage.fraction,2001/3002);
 assert.equal(r.errors[0].attempts,0);
 assert.equal(r.coverage.submission_scope,'attempted_submission');
});
