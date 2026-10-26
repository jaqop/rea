import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {buildBook} from './core.mjs';
import {ProjectStore} from './store.mjs';
import {createExecutionTools} from './execution.mjs';

async function setup() {
  const root=await mkdtemp(join(process.cwd(),'.rea-test-execution-'));
  const store=new ProjectStore(join(root,'home'));
  const p=await store.create(buildBook('A synthetic source with an action and a consequence.\n\nAnother independent synthetic scene.','Synthetic'));
  const target=join(root,'target.md'); await writeFile(target,'I cross the yard. I stop at the gate.');
  return {root,store,book:p.book,target};
}
const hooks={
  call:async input=>({text:input.prompt==='draft'?'I cross\u200b the yard. I stop at the gate.':'{}',model:'fake-local-test'}),
  extract:async({call})=>{await call({model:'fake',prompt:'extract'});return{mechanisms:[{title:'A choice',steps:['Choose'],conditions:['Cost'],evidence:[]}],coverage:{full_book_read:false,fraction:0.1},errors:[]};},
  generate:async({call})=>{const r=await call({model:'fake',prompt:'draft'});return{text:r.text,segments:[{text:r.text}],plan:{strategy:'Synthetic'},checks:{semantic_verified:false}};},
};
test('execution creates a separate auditable model-produced candidate and preserves inputs',async()=>{
  const f=await setup();try{
    const api=createExecutionTools(join(f.root,'home'),f.store,hooks);
    const result=await api.call('execute_narrative_experiment',{book_id:f.book.id,target_path:f.target,output_directory:join(f.root,'run'),focuses:['combat']});
    assert.equal(result.status,'candidate_for_review');
    assert.equal(await readFile(f.target,'utf8'),'I cross the yard. I stop at the gate.');
    assert.equal(await readFile(result.draft_path,'utf8'),'I cross the yard. I stop at the gate.');
    const manifest=JSON.parse(await readFile(result.manifest_path,'utf8'));
    assert.equal(manifest.host_prose_supplied,false);assert.equal(manifest.model_calls.length,2);
    assert.equal(manifest.requires_human_review,true);assert.equal(manifest.inputs_unchanged,true);
    assert.equal((await api.call('inspect_narrative_run',{run_directory:join(f.root,'run')})).status,'candidate_for_review');
    const tampered={...manifest};delete tampered.draft_sha256;await writeFile(result.manifest_path,JSON.stringify(tampered));
    await assert.rejects(api.call('inspect_narrative_run',{run_directory:join(f.root,'run')}),/hash|digest/i);
    await assert.rejects(api.call('execute_narrative_experiment',{book_id:f.book.id,target_path:f.target,output_directory:join(f.root,'run'),focuses:['combat']}),/exist/i);
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test('failed inference retains a failure record and never creates a pretend draft',async()=>{
  const f=await setup();try{
    const api=createExecutionTools('',f.store,{...hooks,call:async()=>{throw Error('inference unavailable');}});
    await assert.rejects(api.call('execute_narrative_experiment',{book_id:f.book.id,target_path:f.target,output_directory:join(f.root,'failed'),focuses:['combat']}),/unavailable/);
    const m=JSON.parse(await readFile(join(f.root,'failed','manifest.json'),'utf8'));
    assert.equal(m.status,'failed');assert.match(m.error,/unavailable/);
    await assert.rejects(readFile(join(f.root,'failed','draft.experimental.md')),{code:'ENOENT'});
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test('generation cannot smuggle unlogged host-written prose into the candidate',async()=>{
  const f=await setup();try{
    const api=createExecutionTools('',f.store,{...hooks,generate:async()=>({text:'Unlogged prose.',segments:[{text:'Unlogged prose.'}]})});
    await assert.rejects(api.call('execute_narrative_experiment',{book_id:f.book.id,target_path:f.target,output_directory:join(f.root,'bad'),focuses:['combat']}),/provenance|logged/);
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test('context changes and structured plan text cannot masquerade as valid draft provenance',async()=>{
  const f=await setup();try{
    const context=join(f.root,'context.txt');await writeFile(context,'Original context.');
    const api=createExecutionTools('',f.store,{...hooks,generate:async x=>{const r=await hooks.generate(x);await writeFile(context,'Changed context.');return r;}});
    await assert.rejects(api.call('execute_narrative_experiment',{book_id:f.book.id,target_path:f.target,output_directory:join(f.root,'context-change'),focuses:['combat'],context_paths:[context]}),/Input changed/);
    const planOnly=createExecutionTools('',f.store,{...hooks,generate:async({call})=>{const r=await call({model:'fake',prompt:'draft',json:true});return{text:r.text,segments:[{text:r.text}]};}});
    await assert.rejects(planOnly.call('execute_narrative_experiment',{book_id:f.book.id,target_path:f.target,output_directory:join(f.root,'plan-only'),focuses:['combat']}),/provenance/);
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test('final cleanup preserves exact operator-protected phrases including invisible characters',async()=>{
  const f=await setup();try{
    await writeFile(f.target,'I cross\u200b the yard. I stop at the gate.');
    const api=createExecutionTools('',f.store,hooks);
    const result=await api.call('execute_narrative_experiment',{book_id:f.book.id,target_path:f.target,output_directory:join(f.root,'protected'),focuses:['combat'],must_keep:['cross\u200b the']});
    assert.match(await readFile(result.draft_path,'utf8'),/cross\u200b the/u);
  }finally{await rm(f.root,{recursive:true,force:true});}
});
