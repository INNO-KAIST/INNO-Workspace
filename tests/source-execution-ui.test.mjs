import test from 'node:test';
import assert from 'node:assert/strict';
import {collectDirectoryFiles,matchesStoredSource,reconcileSourceSelection,sourceExecutionRows,sourceExecutionMessage,createSourcePickFence} from '../public/source-execution-ui.mjs';

const attachment={id:'att_same',name:'evidence.txt',path:'evidence.txt',size:12,lastModified:1,type:'text/plain',source:'file',view:{kind:'text-byte-range',start:0,end:4,sha256:'a'.repeat(64)}};
const parent={id:'parent',version:3,status:'waiting_children',attachments:[attachment],delegation:{state:'waiting_children',batchId:'batch',epoch:1,masterProvider:'claude',children:[{taskId:'child',provider:'codex',requestedModel:'gpt-test',role:'analysis',sourceIds:[attachment.id]}]}};
const child={id:'child',version:2,status:'queued',parentTaskId:'parent',batchId:'batch',parentEpoch:1,assignment:{provider:'codex',requestedModel:'gpt-test'},attachments:[attachment]};

test('locked child and review reconnect only stored references and never change scope',()=>{
 const same={...attachment};delete same.view;
 const unknown={...same,id:'att_other',name:'other.txt'};
 for(const task of [child,{...parent,status:'queued_for_review',delegation:{...parent.delegation,state:'queued_for_review'}}]){
  const result=reconcileSourceSelection(task,[same,unknown]);
  assert.equal(result.locked,true);assert.equal(result.matched.length,1);assert.equal(result.unmatched.length,1);
  assert.strictEqual(result.attachments,task.attachments);
  assert.deepEqual(result.attachments[0].view,attachment.view);
 }
});

test('reconnect rejects a matching id with changed file metadata',()=>{
 assert.equal(matchesStoredSource(attachment,{...attachment,size:13}),false);
 const result=reconcileSourceSelection(child,[{...attachment,path:'other/evidence.txt'}]);
 assert.equal(result.matched.length,0);assert.equal(result.unmatched.length,1);
});

test('ordinary task may add a new attachment while retaining an existing saved view',()=>{
 const result=reconcileSourceSelection({id:'draft',status:'ready',attachments:[attachment]},[{...attachment,view:undefined},{id:'new',name:'new.txt'}]);
 assert.equal(result.locked,false);assert.equal(result.attachments.length,2);assert.deepEqual(result.attachments[0].view,attachment.view);
});

test('queued child and review rows explain missing originals and stored assignment',()=>{
 const state={tasks:[parent,child],capabilities:{sourceDelegationVersion:1,desktopSources:true,desktopSourceDelegationVersion:1},localDesktop:{busy:false,stopped:false,pending:false}};
 const rows=sourceExecutionRows(parent,state,()=>false,[]);
 assert.equal(rows.length,1);assert.equal(rows[0].taskId,'child');assert.equal(rows[0].provider,'codex');assert.equal(rows[0].model,'gpt-test');
 assert.deepEqual(rows[0].missing.map(a=>a.id),[attachment.id]);assert.match(sourceExecutionMessage(rows[0]),/다시 연결/);
 const review={...parent,status:'queued_for_review',delegation:{...parent.delegation,state:'queued_for_review'}};
 const reviewRow=sourceExecutionRows(review,{...state,tasks:[review,child]},()=>true,[])[0];
 assert.equal(reviewRow.taskId,'parent');assert.equal(reviewRow.provider,'claude');assert.match(reviewRow.model,/서버/);
});

test('submitted and uncertain attempts require server recovery before coordinator release',()=>{
 const state={tasks:[parent,child],capabilities:{sourceDelegationVersion:1,desktopSources:true,desktopSourceDelegationVersion:1},localDesktop:{busy:false,stopped:false,pending:false}};
 for(const status of ['uncertain','submitted']){
  const row=sourceExecutionRows(child,state,()=>true,[{taskId:'child',version:2,status}])[0];
  assert.match(sourceExecutionMessage(row),/복구/);assert.equal(row.recoverable,true);
 }
 const unsupported=sourceExecutionRows(child,{...state,capabilities:{sourceDelegationVersion:0}},()=>true,[])[0];
 assert.match(sourceExecutionMessage(unsupported),/지원하지/);
});

test('file picker fence rejects results after task or account changes',()=>{
 let context={taskId:'child',client:'server-a',epoch:1};const fence=createSourcePickFence(()=>context);
 const token=fence.capture();assert.equal(fence.isCurrent(token),true);
 context={...context,taskId:'parent'};assert.equal(fence.isCurrent(token),false);
 context={taskId:'child',client:'server-b',epoch:1};assert.equal(fence.isCurrent(token),false);
});

test('directory selection stages files and drops them if task changes during a file read',async()=>{
 let current=true,release;
 const file={name:'notes.txt',size:3,lastModified:1,type:'text/plain'};
 const root={kind:'directory',name:'data',async *values(){yield {kind:'file',name:'notes.txt',getFile:()=>new Promise(resolve=>{release=()=>resolve(file);})};}};
 const pending=collectDirectoryFiles(root,()=>current);
 await new Promise(resolve=>setImmediate(resolve));current=false;release();
 assert.deepEqual(await pending,[]);
 current=true;
 const sameRoot={...root,async *values(){yield {kind:'file',name:'notes.txt',getFile:async()=>({...file})};}};
 const result=await collectDirectoryFiles(sameRoot,()=>current);
 assert.equal(result.length,1);assert.equal(result[0].webkitRelativePath,'data/notes.txt');
});
