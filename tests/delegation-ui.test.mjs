import test from 'node:test';
import assert from 'node:assert/strict';
import { childRecoveryState, delegationPanel, delegationStateLabel, executionRecoveryState, taskControlState, taskDisplayStatus, taskListGroups } from '../public/delegation-ui.mjs';
import { WorkspaceClient, exportBundle } from '../public/core/client.mjs';

const parent = {
  id:'parent', title:'Parallel review', status:'waiting_children', version:4,
  delegation:{
    batchId:'batch-1', state:'waiting', retryCount:0,
    children:[
      {taskId:'child-codex',role:'분석',provider:'codex',requestedModel:'gpt-5.2-codex',effort:'high',sufficientReason:'코드와 계산 검증',acceptanceCriteria:['계산을 재현한다','오류를 기록한다']},
      {taskId:'child-claude',role:'문헌',provider:'claude',requestedModel:'claude-opus-4-1',effort:'high',sufficientReason:'근거 대조',acceptanceCriteria:['출처를 구분한다']},
    ],
    review:{children:[{taskId:'child-codex',role:'분석',summary:'계산 확인 완료',artifacts:[{id:'artifact-1',name:'check.csv',mime:'text/csv'}]}]},
  },
};
const children = [
  {id:'child-codex',title:'Analysis child',parentTaskId:'parent',batchId:'batch-1',status:'completed',updatedAt:'2026-09-21T01:00:00Z'},
  {id:'child-claude',title:'Literature child',parentTaskId:'parent',batchId:'batch-1',status:'waiting_quota',updatedAt:'2026-09-21T02:00:00Z'},
];

test('task list nests delegated children under their parent without dropping navigation', () => {
  const orphan={id:'orphan',title:'Recoverable orphan',parentTaskId:'missing',status:'failed'};
  const groups=taskListGroups([children[1],orphan,parent,children[0]],'');
  assert.deepEqual(groups.map(group=>group.task.id),['orphan','parent']);
  assert.deepEqual(groups[1].children.map(task=>task.id),['child-codex','child-claude']);
});

test('child search returns the parent group and matching child only', () => {
  const groups=taskListGroups([parent,...children],'literature');
  assert.equal(groups.length,1);
  assert.equal(groups[0].task.id,'parent');
  assert.deepEqual(groups[0].children.map(task=>task.id),['child-claude']);
});

test('delegation panel exposes requested assignment and saved review without claiming actual model use', () => {
  const uncertainChild={...children[1],checkpoint:{confirmationRequired:{reason:'외부 세션 시작 여부 확인 필요',executionId:'private'}}};
  const panel=delegationPanel(parent,[parent,children[0],uncertainChild]);
  assert.equal(panel.children[0].requestedModel,'gpt-5.2-codex');
  assert.equal(panel.children[0].status,'completed');
  assert.equal(panel.children[0].summary,'계산 확인 완료');
  assert.deepEqual(panel.children[0].artifacts,[{id:'artifact-1',name:'check.csv',mime:'text/csv'}]);
  assert.equal('actualModel' in panel.children[0],false);
  assert.equal(panel.children[1].status,'waiting_quota');
  assert.equal(panel.children[1].confirmationReason,'외부 세션 시작 여부 확인 필요');
});

test('review execution is distinguished from an ordinary running task',()=>{
  assert.equal(taskDisplayStatus({...parent,status:'running',delegation:{...parent.delegation,state:'reviewing'}}),'reviewing');
  assert.equal(taskDisplayStatus({...parent,status:'waiting_children'}),'waiting_children');
});

test('durable delegation states have user-facing labels',()=>{
  assert.equal(delegationStateLabel('waiting_children'),'하위 작업 대기');
  assert.equal(delegationStateLabel('queued_for_review'),'검토 대기');
  assert.equal(delegationStateLabel('reviewing'),'결과 검토');
});

test('delegation controls block direct child and waiting parent execution while keeping parent instructions available', () => {
  assert.deepEqual(taskControlState(parent),{
    runDisabled:true, editPlanDisabled:true, composerDisabled:false,
    resumeVisible:false, resumeLabel:'', resumeDisabled:false,
  });
  assert.deepEqual(taskControlState(children[0]),{
    runDisabled:true, editPlanDisabled:true, composerDisabled:true,
    resumeVisible:false, resumeLabel:'', resumeDisabled:false,
  });
});

test('superseded delegation history does not block a newly planned root execution',()=>{
  const replanned={...parent,status:'ready',delegation:{...parent.delegation,state:'superseded'}};
  assert.equal(taskControlState(replanned).runDisabled,false);
  assert.equal(taskControlState(replanned).editPlanDisabled,false);
});

test('uncertain external dispatch cannot be resumed through the ordinary run control',()=>{
  const uncertain={id:'uncertain',status:'waiting_connection',checkpoint:{confirmationRequired:{reason:'외부 세션 시작 여부 확인 필요'}}};
  assert.equal(taskControlState(uncertain).runDisabled,true);
  assert.equal(taskControlState(uncertain).composerDisabled,false);
});

test('delegation resume is offered only for a paused parent or one bounded failed-child retry', () => {
  const paused={...parent,status:'paused'};
  assert.equal(taskControlState(paused).resumeLabel,'완료 결과 유지하고 재개');
  const failed={...parent,delegation:{...parent.delegation,children:[parent.delegation.children[0]],retryCount:0}};
  const failedTasks=[failed,{...children[0],status:'failed'}];
  assert.equal(taskControlState(failed,failedTasks).resumeLabel,'실패 작업만 다시 실행');
  const uncertainFailedTasks=[failed,{...children[0],status:'failed',checkpoint:{confirmationRequired:{reason:'확인 필요'}}}];
  assert.equal(taskControlState(failed,uncertainFailedTasks).resumeDisabled,true);
  assert.equal(taskControlState({...failed,delegation:{...failed.delegation,retryCount:1}},failedTasks).resumeVisible,false);
  assert.equal(taskControlState(failed,[failed,{...children[0],status:'waiting_quota'}]).resumeVisible,false);
  assert.equal(taskControlState({...failed,status:'cancelled'},failedTasks).resumeVisible,false);
});

test('failed review parent exposes resume unless remote execution remains uncertain',()=>{
  const review={...parent,status:'waiting_connection',delegation:{...parent.delegation,state:'reviewing'}};
  assert.equal(taskControlState(review).resumeLabel,'결과 검토 다시 실행');
  const uncertain={...review,checkpoint:{confirmationRequired:{reason:'uncertain_fire'}}};
  assert.equal(taskControlState(uncertain).resumeVisible,false);
  assert.equal(taskControlState({...uncertain,status:'paused'}).resumeVisible,false);
});

test('blocked child recovery is bounded by parent phase but independent of automatic retry budget',()=>{
  const quota={...children[1],version:6,checkpoint:{failure:{kind:'quota'}}};
  assert.deepEqual(childRecoveryState(parent,quota),{
    eligible:true,requiresConfirmation:false,reason:'',sessionUrl:'',
  });
  assert.equal(childRecoveryState({...parent,status:'running'},quota).eligible,false);
  assert.equal(childRecoveryState({...parent,delegation:{...parent.delegation,retryCount:1}},quota).eligible,true);
  assert.equal(childRecoveryState(parent,children[0]).eligible,false);
});

test('uncertain and lease-expired child recovery requires explicit stopped confirmation',()=>{
  const uncertain={...children[1],status:'waiting_connection',checkpoint:{sessionUrl:'https://claude.ai/code/session',failure:{kind:'connection'},confirmationRequired:{reason:'uncertain_fire'}}};
  assert.deepEqual(childRecoveryState(parent,uncertain),{
    eligible:true,requiresConfirmation:true,reason:'uncertain_fire',sessionUrl:'https://claude.ai/code/session',
  });
  const expired={...children[1],status:'paused',checkpoint:{interruptedBy:'lease_expiry',failure:{kind:'interrupted'}}};
  assert.equal(childRecoveryState({...parent,status:'paused'},expired).requiresConfirmation,true);
  const auth={...children[1],status:'waiting_connection',checkpoint:{failure:{kind:'authentication'}}};
  assert.equal(childRecoveryState(parent,auth).requiresConfirmation,false);
  const parentPaused={...children[1],status:'waiting_connection',checkpoint:{confirmationRequired:{reason:'parent_pause'}}};
  assert.equal(childRecoveryState({...parent,status:'paused',delegation:{...parent.delegation,retryCount:1}},parentPaused).reason,'parent_pause');
});

test('non-child uncertain execution exposes only explicit checked recovery metadata',()=>{
  const task={id:'root',status:'waiting_connection',version:9,checkpoint:{provider:'claude',sessionUrl:'https://claude.ai/code/root',confirmationRequired:{reason:'uncertain_fire',executionId:'execution-private',generation:3}}};
  assert.deepEqual(executionRecoveryState(task),{
    eligible:true,reason:'uncertain_fire',sessionUrl:'https://claude.ai/code/root',executionId:'execution-private',generation:3,
  });
  assert.equal(executionRecoveryState({...task,parentTaskId:'parent'}).eligible,false);
  assert.equal(executionRecoveryState({...task,status:'ready'}).eligible,false);
});

test('delegation resume uses the dedicated version-fenced parent endpoint',async()=>{
  const client=new WorkspaceClient({remote:true,baseUrl:'https://example.test'});
  client.request=async(path,body)=>{
    assert.equal(path,'/api/tasks/parent%2Fone/delegation/resume');
    assert.deepEqual(body,{expectedVersion:7});
    return {task:{id:'parent/one',version:8}};
  };
  assert.deepEqual(await client.resumeDelegation('parent/one',7),{id:'parent/one',version:8});
});

test('child recovery uses both row versions and explicit stopped confirmation',async()=>{
  const client=new WorkspaceClient({remote:true,baseUrl:'https://example.test'});
  client.request=async(path,body)=>{
    assert.equal(path,'/api/tasks/parent%2Fone/delegation/recover');
    assert.deepEqual(body,{expectedVersion:7,childTaskId:'child',expectedChildVersion:4,confirmedStopped:true});
    return {parent:{id:'parent/one',version:8},children:[]};
  };
  assert.deepEqual(await client.recoverDelegationChild('parent/one',{expectedVersion:7,childTaskId:'child',expectedChildVersion:4,confirmedStopped:true}),{parent:{id:'parent/one',version:8},children:[]});
});

test('uncertain root recovery uses the stored execution owner and explicit confirmation',async()=>{
  const client=new WorkspaceClient({remote:true,baseUrl:'https://example.test'});
  client.request=async(path,body)=>{
    assert.equal(path,'/api/tasks/root%2Fone/execution/recover');
    assert.deepEqual(body,{expectedVersion:9,executionId:'execution-private',generation:3,confirmedStopped:true});
    return {task:{id:'root/one',status:'ready',version:10}};
  };
  assert.deepEqual(await client.recoverExecution('root/one',{expectedVersion:9,executionId:'execution-private',generation:3,confirmedStopped:true}),{id:'root/one',status:'ready',version:10});
});

test('record export preserves delegation lineage and review metadata',()=>{
  const bundle=exportBundle({tasks:[parent,{...children[0],parentEpoch:2,assignment:parent.delegation.children[0]}]});
  assert.equal(bundle.tasks[0].delegation.batchId,'batch-1');
  assert.equal(bundle.tasks[0].delegation.review.children[0].summary,'계산 확인 완료');
  assert.equal(bundle.tasks[1].parentTaskId,'parent');
  assert.equal(bundle.tasks[1].batchId,'batch-1');
  assert.equal(bundle.tasks[1].parentEpoch,2);
  assert.equal(bundle.tasks[1].assignment.requestedModel,'gpt-5.2-codex');
});

test('queued ordinary source task can reconnect without unlocking child or active execution',()=>{const task={id:'source-root',status:'queued',attachments:[{id:'a',name:'evidence.txt'}]};assert.equal(taskControlState(task).runDisabled,false);assert.equal(taskControlState(task,[],true).runDisabled,true);assert.equal(taskControlState({...task,status:'running'}).runDisabled,true);assert.equal(taskControlState({...task,parentTaskId:'p'}).runDisabled,true);assert.equal(taskControlState({...task,attachments:[]}).runDisabled,true);});
