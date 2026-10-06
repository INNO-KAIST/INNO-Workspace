import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {TestD1} from './helpers/d1.mjs';
import {applyAction,createTask} from '../public/core/tasks.mjs';
import {creationPayload} from '../public/core/create-requests.mjs';
import {exportBundle} from '../public/core/client.mjs';
import {prepareImport} from '../public/core/imports.mjs';
import {projectForTask,PROJECT_LIMITS} from '../public/core/projects.mjs';

// CR-008 Unit 1: projects group tasks, carry shared instructions, and can be renamed; tasks can
// be renamed and moved. Deleting a project keeps its tasks, which then read as "no project".
const token='test-projects-0123456789012345678';
function api(db){
 const env={DB:db,ACCESS_TOKEN:token};
 return async(path,body)=>{const response=await worker.fetch(new Request('https://inno.test'+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env);return {status:response.status,body:await response.json()};};
}

test('projects are created, renamed and deleted from the version read, and the state carries them',async t=>{
 const db=new TestD1();t.after(()=>db.close());const call=api(db);
 const before=(await call('/api/state')).body;
 assert.equal(before.capabilities.projects,true);assert.deepEqual(before.projects,[]);
 const created=await call('/api/projects',{name:'  논문 준비  ',instructions:'모든 결과는 한국어 보고서로.'});
 assert.equal(created.status,200);
 const project=created.body.project;
 assert.equal(project.name,'논문 준비');assert.equal(project.instructions,'모든 결과는 한국어 보고서로.');assert.equal(project.version,1);
 const state=(await call('/api/state')).body;
 assert.ok(state.revision>before.revision);assert.deepEqual(state.projects.map(p=>p.id),[project.id]);
 const delta=(await call(`/api/state?since=${before.revision}&delta=1`)).body;
 assert.equal(delta.delta,true);assert.deepEqual(delta.projects.map(p=>p.id),[project.id]);
 const renamed=await call(`/api/projects/${project.id}`,{action:'update',name:'논문',instructions:'',expectedVersion:1});
 assert.equal(renamed.status,200);assert.equal(renamed.body.project.name,'논문');assert.equal(renamed.body.project.version,2);
 assert.equal((await call(`/api/projects/${project.id}`,{action:'update',name:'x',expectedVersion:1})).status,409);
 for(const input of [{name:''},{name:'a'.repeat(PROJECT_LIMITS.name+1)},{name:'ok',instructions:'b'.repeat(PROJECT_LIMITS.instructions+1)},{name:'ok',instructions:3}])
  assert.equal((await call('/api/projects',input)).status,400,JSON.stringify(input).slice(0,40));
 assert.equal((await call('/api/projects/missing',{action:'update',name:'x',expectedVersion:1})).status,404);
 const deleted=await call(`/api/projects/${project.id}`,{action:'delete',expectedVersion:2});
 assert.equal(deleted.status,200);assert.deepEqual((await call('/api/state')).body.projects,[]);
});

test('tasks start in a project, move in and out, and keep their project reference after a delete',async t=>{
 const db=new TestD1();t.after(()=>db.close());const call=api(db),store=new D1TaskStore(db);
 const a=(await call('/api/projects',{name:'A'})).body.project,b=(await call('/api/projects',{name:'B'})).body.project;
 let task=(await call('/api/tasks',{prompt:'Work',projectId:a.id})).body.task;
 assert.equal(task.projectId,a.id);
 assert.equal((await call('/api/tasks',{prompt:'Work',projectId:'missing'})).status,400);
 task=(await call(`/api/tasks/${task.id}/actions`,{action:'move',projectId:b.id,expectedVersion:task.version})).body.task;
 assert.equal(task.projectId,b.id);
 assert.equal((await call(`/api/tasks/${task.id}/actions`,{action:'move',projectId:'missing',expectedVersion:task.version})).status,400);
 task=(await call(`/api/tasks/${task.id}/actions`,{action:'move',projectId:null,expectedVersion:task.version})).body.task;
 assert.equal(Object.hasOwn(task,'projectId'),false);
 task=(await call(`/api/tasks/${task.id}/actions`,{action:'move',projectId:a.id,expectedVersion:task.version})).body.task;
 const kept=task.version;
 await call(`/api/projects/${a.id}`,{action:'delete',expectedVersion:1});
 const stored=await store.requireTask(task.id);
 assert.equal(stored.version,kept,'no task record is rewritten');
 const projects=(await call('/api/state')).body.projects;
 assert.equal(projectForTask(stored,{projects,tasks:[stored]}),null);
 assert.equal(projectForTask({...stored,projectId:b.id},{projects,tasks:[]})?.id,b.id);
});

test('a task is renamed within limits, even when finished, but a delegation child is not',async t=>{
 const db=new TestD1();t.after(()=>db.close());const call=api(db),store=new D1TaskStore(db);
 let task=(await call('/api/tasks',{prompt:'Work'})).body.task;
 task=(await call(`/api/tasks/${task.id}/actions`,{action:'rename',title:'  새 이름  ',expectedVersion:task.version})).body.task;
 assert.equal(task.title,'새 이름');
 for(const title of ['',' ','x'.repeat(121),7])assert.equal((await call(`/api/tasks/${task.id}/actions`,{action:'rename',title,expectedVersion:task.version})).status,400,String(title).slice(0,5));
 const claim=await store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version});
 task=await store.finishExecution(task.id,{executionId:claim.executionId,generation:claim.generation,content:'done',artifacts:[{name:'a.txt',mime:'text/plain',content:'a'}]});
 const finished=await call(`/api/tasks/${task.id}/actions`,{action:'rename',title:'끝난 작업',expectedVersion:task.version});
 assert.equal(finished.status,200);assert.equal(finished.body.task.status,'completed');
 const child=createTask({prompt:'child'});
 assert.throws(()=>applyAction({...child,parentTaskId:'p'},{action:'rename',title:'x',expectedVersion:child.version}),/parent/i);
});

test('the project reference survives export, import and the creation-retry digest only when present',async()=>{
 const task={...createTask({prompt:'Work'}),projectId:'p1'};
 assert.equal(exportBundle({tasks:[task]}).tasks[0].projectId,'p1');
 assert.equal((await prepareImport(task)).task.projectId,'p1');
 assert.equal(Object.hasOwn((await prepareImport(createTask({prompt:'Work'}))).task,'projectId'),false);
 assert.equal(creationPayload({prompt:'Work'}),JSON.stringify({prompt:'Work',title:'Work',type:'general',attachments:[]}));
 assert.notEqual(creationPayload({prompt:'Work',projectId:'p1'}),creationPayload({prompt:'Work'}));
});

test('a delegation child belongs to its parent project',()=>{
 const projects=[{id:'p1',name:'A',instructions:'i',version:1}];
 const parent={id:'parent',projectId:'p1'},child={id:'child',parentTaskId:'parent'};
 assert.equal(projectForTask(child,{projects,tasks:[parent,child]})?.id,'p1');
 assert.equal(projectForTask({id:'x'},{projects,tasks:[]}),null);
});

test('at most 100 projects, and the project routes need the workspace token',async t=>{
 const db=new TestD1();t.after(()=>db.close());const call=api(db);
 const created=[];for(let i=0;i<100;i++)created.push(await call('/api/projects',{name:'p'+i}));
 assert.ok(created.every(response=>response.status===200));
 assert.equal((await call('/api/projects',{name:'one more'})).status,400);
 assert.equal((await call('/api/state')).body.projects.length,100);
 const unauthorized=await worker.fetch(new Request('https://inno.test/api/projects',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'x'})}),{DB:db,ACCESS_TOKEN:token});
 assert.equal(unauthorized.status,401);
});
