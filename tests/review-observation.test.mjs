import test from 'node:test';
import assert from 'node:assert/strict';
import {delegationProfile} from '../worker/allocation-policy.mjs';
import {verifyReviewObservation} from '../worker/review-observation.mjs';
import {createSelectionState,recordObservation} from '../public/core/model-selection.mjs';

const at='2026-09-27T00:00:00.000Z';
const complete='2026-09-27T00:00:02.000Z';
const reviewed='2026-09-27T00:00:04.000Z';
const assignment={provider:'codex',requestedModel:'gpt-test',effort:'high',role:'analyst',instructions:'Check the bounded input',acceptanceCriteria:['Correct calculation','Cites provided material'],sourceIds:['source-1']};
async function fixture(){
 const profile=await delegationProfile(assignment);
 const selected={...assignment,selection:{status:'fallback',profile,modelVersion:null}};
 const peer={...assignment,provider:'claude',requestedModel:'sonnet',role:'reviewer',acceptanceCriteria:['Check answer'],selection:{status:'fallback',profile:{...profile,family:'delegation_claude'},modelVersion:null}};
 const report=[{childTaskId:'child',criteria:[{criterion:'Correct calculation',status:'pass',evidence:'Recomputed'},{criterion:'Cites provided material',status:'unverifiable',evidence:'No source citation'}]},{childTaskId:'peer',criteria:[{criterion:'Check answer',status:'pass',evidence:'Checked'}]}];
 const attachment={id:'source-1',name:'input.txt',path:'input.txt',size:3,lastModified:1,source:'file',view:{kind:'text-byte-range',start:0,end:3,sha256:'a'.repeat(64)}};
 const parent={id:'parent',status:'completed',attachments:[structuredClone(attachment)],checkpoint:{provider:'claude',executionId:'review-execution',generation:3,claimedAt:complete,completedAt:reviewed},delegation:{state:'completed',batchId:'batch-1',epoch:2,masterProvider:'claude',children:[{taskId:'child',...selected},{taskId:'peer',...peer}],review:{children:[{taskId:'child',summary:'Result',artifacts:[]},{taskId:'peer',summary:'Peer',artifacts:[]}]},reviewReport:report}};
 const child={id:'child',status:'completed',parentTaskId:'parent',batchId:'batch-1',parentEpoch:2,prompt:assignment.instructions,assignment:selected,attachments:[structuredClone(attachment)],checkpoint:{provider:'codex',executionId:'child-execution',generation:1,claimedAt:at,completedAt:complete,usage:{provider:'codex',executionId:'child-execution',generation:1,source:'executor_report',inputTokens:10,outputTokens:5},executionEvidence:{source:'cli_arguments',provider:'codex',requestedModel:'gpt-test',actualModelVersion:null}}};
 const state={profile,candidates:[{id:'unknown-route',provider:'codex',model:'gpt-test',effort:'high',modelVersion:null}]};
 const ref={parentTaskId:'parent',childTaskId:'child',reviewExecutionId:'review-execution',reviewGeneration:3,childExecutionId:'child-execution',childGeneration:1};
 const tasks={parent,child};const store={requireTask:async id=>tasks[id]};
 return {parent,child,state,ref,tasks,store};
}

test('derives every quality criterion from a separate completed parent review and owner-tied measurements',async()=>{
 const f=await fixture();const result=await verifyReviewObservation(f.store,f.ref,f.state);
 assert.equal(result.status,'verified');
 assert.deepEqual(result.observation.quality,{source:'independent_review',critical:false,criteria:[{id:f.state.profile.criteria[0],status:'pass'},{id:f.state.profile.criteria[1],status:'unverifiable'}]});
 assert.deepEqual(result.observation.usage,{source:'executor_report',inputTokens:10,outputTokens:5,latencyMs:2000});
 assert.equal(result.observation.modelVersion,null);
 assert.equal(result.observation.candidateId,'unknown-route');
 assert.equal(result.observation.source,'normal_execution');
 assert.equal(result.observation.observedAt,Date.parse(reviewed));
 assert.equal(result.verdict,'independent_reviewed_model_judgment');
});

test('only a genuine missing evidence task becomes a terminal missing diagnostic',async()=>{
 const f=await fixture();
 const missing={requireTask:async id=>{if(id==='child')throw Object.assign(Error('missing'),{statusCode:404});return f.tasks[id];}};
 assert.deepEqual(await verifyReviewObservation(missing,f.ref,f.state),{status:'not_attributable',reason:'evidence_task_missing'});
 const unavailable={requireTask:async id=>{if(id==='child')throw Error('D1 unavailable');return f.tasks[id];}};
 await assert.rejects(verifyReviewObservation(unavailable,f.ref,f.state),/D1 unavailable/);
});

test('uses durable data only and gives deterministic bounded identifiers',async()=>{
 const f=await fixture();const a=await verifyReviewObservation(f.store,{...f.ref,quality:{criteria:[]},modelVersion:'forged',usage:{inputTokens:0}},f.state);
 assert.equal(a.status,'not_attributable');assert.equal(a.reason,'invalid_evidence_reference');
 const b=await verifyReviewObservation(f.store,f.ref,f.state),c=await verifyReviewObservation(f.store,f.ref,f.state);
 assert.deepEqual(b,c);assert.match(b.observation.id,/^[A-Za-z0-9._:-]{1,100}$/);assert.ok(b.observation.comparisonId.length<=100);
 const other=await fixture();other.parent.id='another-parent';other.child.parentTaskId='another-parent';other.ref.parentTaskId='another-parent';other.tasks={'another-parent':other.parent,child:other.child};other.store={requireTask:async id=>other.tasks[id]};
 const d=await verifyReviewObservation(other.store,other.ref,other.state);assert.notEqual(b.observation.comparisonId,d.observation.comparisonId);
});

test('selected source view hash and bounds enter comparable identity without storing source text',async()=>{
 const first=await fixture(),second=await fixture();
 second.parent.attachments[0].view.sha256='b'.repeat(64);second.child.attachments[0].view.sha256='b'.repeat(64);
 const a=await verifyReviewObservation(first.store,first.ref,first.state),b=await verifyReviewObservation(second.store,second.ref,second.state);
 assert.equal(a.status,'verified');assert.equal(b.status,'verified');
 assert.notEqual(a.observation.comparisonId,b.observation.comparisonId);
 assert.equal(JSON.stringify(a.observation).includes('input.txt'),false);
});

test('missing or invalid saved source view cannot yield comparable observation',async()=>{
 for(const change of [f=>{delete f.child.attachments[0].view;},f=>{f.child.attachments[0].view.sha256='not-a-hash';},f=>{f.child.attachments[0].view.end=4;}]){
  const f=await fixture();change(f);const result=await verifyReviewObservation(f.store,f.ref,f.state);
  assert.equal(result.status,'not_attributable');assert.equal(result.reason,'invalid_comparable_input');
 }
});

test('source-bearing executions without any saved view remain execution-specific',async()=>{
 const first=await fixture(),second=await fixture();
 for(const f of [first,second]){delete f.parent.attachments[0].view;delete f.child.attachments[0].view;}
 second.child.checkpoint.executionId='different-execution';second.ref.childExecutionId='different-execution';second.child.checkpoint.usage.executionId='different-execution';
 const a=await verifyReviewObservation(first.store,first.ref,first.state),b=await verifyReviewObservation(second.store,second.ref,second.state);
 assert.equal(a.status,'verified');assert.equal(b.status,'verified');
 assert.notEqual(a.observation.comparisonId,b.observation.comparisonId);
});

test('duplicate child or parent source references cannot form a comparable input',async()=>{
 for(const change of [f=>{f.child.attachments.push(structuredClone(f.child.attachments[0]));},f=>{f.parent.attachments.push(structuredClone(f.parent.attachments[0]));}]){
  const f=await fixture();change(f);const result=await verifyReviewObservation(f.store,f.ref,f.state);
  assert.equal(result.status,'not_attributable');assert.equal(result.reason,'invalid_comparable_input');
 }
});

test('rejects stale owners, batch, epoch, self review, and incomplete tasks',async()=>{
 const changes=[
  f=>{f.ref.reviewGeneration=2;},f=>{f.ref.childExecutionId='old';},f=>{f.child.batchId='old';},
  f=>{f.child.parentEpoch=1;},f=>{f.parent.status='running';},f=>{f.child.status='running';},
  f=>{f.parent.checkpoint.executionId='child-execution';f.ref.reviewExecutionId='child-execution';},
 ];
 for(const change of changes){const f=await fixture();change(f);const result=await verifyReviewObservation(f.store,f.ref,f.state);assert.equal(result.status,'not_attributable');}
});

test('cannot bind requested model to a versioned route without trusted actual proof',async()=>{
 const f=await fixture();f.state.candidates=[{...f.state.candidates[0],modelVersion:'v1'}];
 f.child.checkpoint.executionEvidence.actualModelVersion='v1';
 const result=await verifyReviewObservation(f.store,f.ref,f.state);
 assert.equal(result.status,'not_attributable');assert.equal(result.reason,'unverified_model_version');
});

test('profile, assignment, and review criterion mismatches fail closed',async()=>{
 const changes=[
  f=>{f.child.assignment.selection.profile.criteria[0]='wrong';},
  f=>{f.parent.delegation.children[0].requestedModel='other';},
  f=>{f.parent.delegation.reviewReport[0].criteria[0].criterion='Wrong';},
  f=>{f.parent.delegation.reviewReport[0].criteria.pop();},
  f=>{f.parent.delegation.reviewReport[0].criteria[0].status='unknown';},
  f=>{f.parent.delegation.reviewReport[1].criteria[0].criterion='Wrong peer criterion';},
  f=>{f.parent.delegation.review.children[1].taskId='unrelated';},
  f=>{f.parent.checkpoint.claimedAt=at;},
 ];
 for(const change of changes){const f=await fixture();change(f);assert.equal((await verifyReviewObservation(f.store,f.ref,f.state)).status,'not_attributable');}
});

test('same-provider parent review is independent when execution ownership differs',async()=>{
 const f=await fixture();f.parent.delegation.masterProvider='codex';f.parent.checkpoint.provider='codex';
 const result=await verifyReviewObservation(f.store,f.ref,f.state);
 assert.equal(result.status,'verified');assert.equal(result.observation.quality.source,'independent_review');
});

test('unimplemented proof labels cannot bind a versioned candidate',async()=>{
 const f=await fixture();f.state.candidates=[{...f.state.candidates[0],modelVersion:'v1'}];
 f.child.checkpoint.executionEvidence={source:'provider_attestation',attestedBy:'server',provider:'codex',executionId:'child-execution',generation:1,actualModelVersion:'v1'};
 const result=await verifyReviewObservation(f.store,f.ref,f.state);
 assert.equal(result.status,'not_attributable');assert.equal(result.reason,'unsupported_model_evidence_source');
});

test('usage from another execution cannot be assigned to this child',async()=>{
 const f=await fixture();f.child.checkpoint.usage.executionId='old-owner';
 const result=await verifyReviewObservation(f.store,f.ref,f.state);
 assert.deepEqual(result.observation.usage,{source:'server_metered',inputTokens:null,outputTokens:null,latencyMs:2000});
});

test('missing usage remains null and latency is unavailable without owner timestamps',async()=>{
 const f=await fixture();f.child.checkpoint.usage=null;delete f.child.checkpoint.claimedAt;
 const result=await verifyReviewObservation(f.store,f.ref,f.state);
 assert.equal(result.status,'verified');assert.deepEqual(result.observation.usage,{source:'server_metered',inputTokens:null,outputTokens:null,latencyMs:null});
});

test('verified null-version evidence records in policy without upgrading an unverifiable criterion',async()=>{
 const f=await fixture();const result=await verifyReviewObservation(f.store,f.ref,f.state);
 const state=createSelectionState({profile:f.state.profile,baseline:f.state.candidates[0]});
 const recorded=recordObservation(state,result.observation,{now:Date.parse(reviewed)+1});
 assert.equal(recorded.recorded,true);
 assert.equal(recorded.state.observations[0].quality.criteria[1].status,'unverifiable');
 assert.equal(recorded.state.observations[0].modelVersion,null);
});
