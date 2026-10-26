import {mkdir,writeFile,readFile,rename} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {digest} from './core.mjs';
import {validateArguments} from './contracts.mjs';
import {readBounded} from './store.mjs';
import {generateLocal} from './model-runtime.mjs';
import {extractMechanisms} from './engine-extraction.mjs';
import {generateAdaptation} from './engine-generation.mjs';
import {finalizeOutput} from './text-output.mjs';
import {createBorrowingGuard} from './engine-guards.mjs';

const text={type:'string',minLength:1,maxLength:32768};
const properties={book_id:{type:'string',pattern:'^book_[a-f0-9]{64}$'},target_path:text,output_directory:text,model:{type:'string',maxLength:128},focuses:{type:'array',minItems:1,maxItems:8,items:{enum:['combat','surveillance','tracking','character','plot','worldbuilding','character-development','characterisation']}},constraints:{type:'array',maxItems:50,items:{type:'string',minLength:1,maxLength:2000}},must_keep:{type:'array',maxItems:100,items:{type:'string',minLength:1,maxLength:1000}},preserve_names:{type:'array',maxItems:100,items:{type:'string',minLength:1,maxLength:100}},context_paths:{type:'array',maxItems:5,items:text},max_windows:{type:'integer',minimum:2,maximum:18}};
export const executionDefinitions=[
  {name:'execute_narrative_experiment',description:'Execute local-model source sampling, exact-evidence mechanism extraction, adaptation planning and generated experimental chapter. Creates a new private output directory and auditable raw model logs; never overwrites source/target. Sampling and structural gates do not verify literary quality, semantics or originality.',inputSchema:{type:'object',properties,required:['book_id','target_path','output_directory','focuses'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}},
  {name:'inspect_narrative_run',description:'Inspect a saved execution manifest and check its candidate hash; no model inference or source text returned.',inputSchema:{type:'object',properties:{run_directory:text},required:['run_directory'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
];
const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
const tokens=text=>(text.toLowerCase().match(/[\p{L}\p{N}]+/gu)??[]);
function literalOverlap(source,candidate) {
  const size=12,s=tokens(source),d=tokens(candidate),index=new Set();
  for(let i=0;i+size<=s.length;i++)index.add(s.slice(i,i+size).join(' '));
  const matches=[];
  for(let i=0;i+size<=d.length&&matches.length<30;i++){const phrase=d.slice(i,i+size).join(' ');if(index.has(phrase))matches.push({draft_word_index:i,phrase});}
  return{ngram_size:size,matches,scope:'Case-insensitive Unicode word sequences only; overlap may be ordinary language, and zero overlap is not proof of originality.'};
}

export function createExecutionTools(home,store,{call=generateLocal,extract=extractMechanisms,generate=generateAdaptation}={}) {
  return{definitions:executionDefinitions,async call(name,args={}){
    const definition=executionDefinitions.find(x=>x.name===name);if(!definition)throw Error(`Unknown execution tool: ${name}`);
    validateArguments(args,definition.inputSchema);
    if(name==='inspect_narrative_run'){
      const directory=resolve(args.run_directory),m=JSON.parse(await readBounded(join(directory,'manifest.json')));
      if(m.schema!=='NarrativeExecution/1')throw Error('Unsupported execution manifest.');
      if(!['running','failed','candidate_for_review'].includes(m.status))throw Error('Invalid execution status.');
      if(m.status==='candidate_for_review'&&(typeof m.draft_sha256!=='string'||! /^[a-f0-9]{64}$/u.test(m.draft_sha256)))throw Error('Review-ready candidate requires a valid draft hash.');
      if(m.draft_sha256){const candidate=await readBounded(join(directory,'draft.experimental.md'));if(hash(candidate)!==m.draft_sha256)throw Error('Candidate hash no longer matches saved run.');}
      return m;
    }
    const model=args.model??'gemma3:4b',directory=resolve(args.output_directory),targetPath=resolve(args.target_path);
    if(!['.md','.txt','.markdown'].includes(extname(targetPath).toLowerCase()))throw Error('Target chapter must be UTF8 TXT or Markdown.');
    const project=await store.load(args.book_id),targetText=await readBounded(targetPath);
    if(Buffer.byteLength(targetText)>65536)throw Error('Target chapter exceeds the 64 KiB execution limit.');
    const contextInputs=[];
    for(const path of args.context_paths??[]){const content=await readBounded(path);if(Buffer.byteLength(content)>16384)throw Error('Each context input is limited to 16 KiB; supply focused continuity context.');contextInputs.push({path:resolve(path),sha256:hash(content),text:content});}
    const context=contextInputs.map(x=>x.text).join('\n\n');if(Buffer.byteLength(context)>16384)throw Error('Combined context exceeds 16 KiB.');
    await mkdir(directory); // Exclusive directory creation refuses previous runs and source directories.
    await mkdir(join(directory,'model-requests'));
    const manifest={schema:'NarrativeExecution/1',run_id:randomUUID(),status:'running',stage:'initializing',started_at:new Date().toISOString(),book_id:project.book.id,source_sha256:project.book.source_sha256,target_path:targetPath,target_sha256:hash(targetText),context_inputs:contextInputs.map(({text,...x})=>x),model,focuses:args.focuses,constraints:args.constraints??[],preserve_names:args.preserve_names??[],must_keep:args.must_keep??[],original_target_included_as_input:true,host_prose_supplied:false,injected_runtime_for_testing:call!==generateLocal,requires_human_review:true,model_calls:[],limitations:['The program selects evidence windows, not a full-book model reading.','Validated citations establish exact source location, not literary truth.','Plans, adaptations and semantic interpretations are model outputs requiring author review.','No proof of authorial intent, semantic equivalence, originality or watermark removal.']};
    manifest.engine_files=await Promise.all(['execution.mjs','model-runtime.mjs','engine-extraction.mjs','engine-generation.mjs','engine-guards.mjs'].map(async name=>({name,sha256:hash(await readFile(new URL(name,import.meta.url),'utf8'))})));
    const saveManifest=async()=>{const temporary=join(directory,'manifest.pending.json');await writeFile(temporary,JSON.stringify(manifest,null,2),'utf8');await rename(temporary,join(directory,'manifest.json'));};
    const event=async(type,payload)=>{const line=JSON.stringify({time:new Date().toISOString(),type,payload})+'\n';await writeFile(join(directory,'events.jsonl'),line,{encoding:'utf8',flag:'a'});};
    const wrappedCall=async input=>{
      const id=String(manifest.model_calls.length+1).padStart(4,'0'),prefix=join(directory,'model-requests',id);
      const record={id,stage:manifest.stage,output_kind:input.json||input.schema?'structured':'prose',request_path:prefix+'.request.json',request_sha256:digest(input),status:'running'};manifest.model_calls.push(record);
      await writeFile(record.request_path,JSON.stringify(input,null,2),{encoding:'utf8',flag:'wx'});await saveManifest();
      try{const response=await call(input);record.response_path=prefix+'.response.json';record.status='completed';record.response_sha256=hash(response.text);record.model=response.model??model;record.transport_request_sha256=response.request_sha256??null;await writeFile(record.response_path,JSON.stringify(response,null,2),{encoding:'utf8',flag:'wx'});await saveManifest();return response;}
      catch(error){record.status='failed';record.error=error.message;await saveManifest();throw error;}
    };
    try{
      await writeFile(join(directory,'target.original.md'),targetText,{encoding:'utf8',flag:'wx'});await saveManifest();
      manifest.stage='extracting';await saveManifest();
      const extraction=await extract({book:project.book,focuses:args.focuses,model,call:wrappedCall,max_windows:args.max_windows??9,emit:async(type,payload)=>event(`extraction:${type}`,payload)});
      manifest.coverage=extraction.coverage;manifest.extraction_errors=extraction.errors??[];
      await writeFile(join(directory,'mechanisms.private.json'),JSON.stringify(extraction,null,2),{encoding:'utf8',flag:'wx'});
      manifest.stage='generating';await saveManifest();
      const adaptation=await generate({targetText,mechanisms:extraction.mechanisms,model,constraints:args.constraints??[],preserve_names:args.preserve_names??[],must_keep:args.must_keep??[],checkProse:createBorrowingGuard(project.book.text,targetText),context,call:wrappedCall,emit:async payload=>event('generation',payload)});
      const completed=[];
      for(const record of manifest.model_calls.filter(x=>x.status==='completed'&&x.stage==='generating'&&x.output_kind==='prose'))completed.push(JSON.parse(await readFile(record.response_path,'utf8')).text.trim());
      if(!Array.isArray(adaptation.segments)||!adaptation.segments.length||adaptation.segments.some(x=>!completed.includes(x.text.trim()))||adaptation.text!==adaptation.segments.map(x=>x.text).join('\n\n'))throw Error('Generation provenance failed: candidate must consist only of logged model-produced fragments.');
      await writeFile(join(directory,'adaptation.private.json'),JSON.stringify(adaptation,null,2),{encoding:'utf8',flag:'wx'});
      const protectedRanges=[];
      for(const phrase of [...(args.must_keep??[]),...(args.preserve_names??[])])for(let start=adaptation.text.indexOf(phrase);start>=0;start=adaptation.text.indexOf(phrase,start+phrase.length))protectedRanges.push({start,end:start+phrase.length});
      const finalized=finalizeOutput(adaptation.text,{format:'markdown',protected_ranges:protectedRanges});
      manifest.cleanup=finalized.report;manifest.literal_overlap=literalOverlap(project.book.text,finalized.cleaned_text);manifest.checks=adaptation.checks;
      manifest.context_unchanged=(await Promise.all(contextInputs.map(async x=>hash(await readBounded(x.path))===x.sha256))).every(Boolean);
      manifest.inputs_unchanged=manifest.context_unchanged&&hash(await readBounded(targetPath))===manifest.target_sha256&&(await store.load(args.book_id)).book.source_sha256===manifest.source_sha256;
      if(!manifest.inputs_unchanged)throw Error('Input changed during execution; candidate not published.');
      manifest.draft_sha256=hash(finalized.cleaned_text);manifest.draft_path=join(directory,'draft.experimental.md');
      await writeFile(manifest.draft_path,finalized.cleaned_text,{encoding:'utf8',flag:'wx'});
      manifest.status='candidate_for_review';manifest.stage='complete';manifest.finished_at=new Date().toISOString();await saveManifest();
      return{status:manifest.status,run_directory:directory,draft_path:manifest.draft_path,manifest_path:join(directory,'manifest.json'),coverage:manifest.coverage,mechanism_count:extraction.mechanisms.length,model_calls:manifest.model_calls.length,host_prose_supplied:false,requires_human_review:true,literal_overlap:manifest.literal_overlap};
    }catch(error){manifest.status='failed';manifest.error=error.message;manifest.stage_failed=manifest.stage;manifest.finished_at=new Date().toISOString();await saveManifest();throw error;}
  }};
}
