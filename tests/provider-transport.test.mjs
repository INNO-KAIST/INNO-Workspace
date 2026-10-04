import test from 'node:test';
import assert from 'node:assert/strict';
import {ConflictError, ValidationError} from '../public/core/tasks.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {CloudBridge} from '../worker/bridge.mjs';
import {D1EvaluationBudgets} from '../worker/evaluation-budgets.mjs';
import {dispatchClaude} from '../worker/dispatch.mjs';
import {TestD1} from './helpers/d1.mjs';
import {createRemoteAdapters} from '../worker/remote-adapters.mjs';

// CR-006 S1 WU3: these pin the transport behaviors that used to be written as
// provider-id comparisons. Codex = desktop bridge, Claude = cloud routine fire.
function setup(t) {
  const DB = new TestD1(); t.after(() => DB.close());
  const store = new D1TaskStore(DB);
  return {DB, store, bridge: new CloudBridge(store)};
}
const running = async (store, provider, prompt = 'Run') => {
  const task = await store.createTask({prompt});
  return store.claimExecution(task.id, {provider, expectedVersion: task.version});
};
const queuedFor = async (store, provider, prompt) => {
  const task = await store.createTask({prompt});
  return store.replaceTask(task.id, task.version, current => ({...current, status: 'queued', version: current.version + 1, checkpoint: {...current.checkpoint, provider, status: 'queued'}}));
};
const message = (type, text) => error => error instanceof type && error.message === text;

test('pausing a running cloud execution records a confirmation; a desktop one does not', async t => {
  const {store} = setup(t);
  for (const [provider, confirmation] of [['claude', true], ['codex', false]]) {
    const claim = await running(store, provider);
    const paused = await store.applyAction(claim.task.id, {action: 'pause', expectedVersion: claim.task.version});
    assert.equal(paused.status, 'paused', provider);
    assert.equal(Boolean(paused.checkpoint.confirmationRequired), confirmation, provider);
    if (confirmation) assert.equal(paused.checkpoint.confirmationRequired.reason, 'parent_pause');
  }
});

test('a running cloud execution cannot be reclaimed and only cloud fires await confirmation', async t => {
  const {store} = setup(t);
  const cloud = await running(store, 'claude');
  await assert.rejects(() => store.claimExecution(cloud.task.id, {provider: 'claude', expectedVersion: cloud.task.version}),
    message(ConflictError, 'Remote execution is still owned; confirm its outcome before reclaiming'));
  const owner = claim => ({executionId: claim.executionId, generation: claim.generation, reason: 'uncertain_fire'});
  const uncertain = await store.markExecutionUncertain(cloud.task.id, owner(cloud));
  assert.equal(uncertain.checkpoint.confirmationRequired.reason, 'uncertain_fire');
  const desktop = await running(store, 'codex');
  await assert.rejects(() => store.markExecutionUncertain(desktop.task.id, owner(desktop)),
    message(ValidationError, 'Only remote Claude executions require fire confirmation'));
});

test('delivery receipts and evaluation budgets are desktop-only claim options', async t => {
  const {DB, store} = setup(t);
  const task = await store.createTask({prompt: 'Receipt'});
  const workspaceId = '00000000-0000-4000-8000-000000000001';
  await assert.rejects(() => store.claimExecution(task.id, {provider: 'claude', expectedVersion: task.version}, {deliveryReceiptVersion: 1, workspaceId}),
    message(ValidationError, 'Invalid desktop claim reservation'));
  await new D1EvaluationBudgets(DB, {now: () => Date.now()}).create({jobId: 'transport-budget', maxExecutions: 1, totalDurationMs: 100});
  const budgeted = await store.createTask({prompt: 'Budget'});
  const bound = await store.attachEvaluationBudget(budgeted.id, {jobId: 'transport-budget', phase: 'candidate', maxDurationMs: 100, expectedVersion: budgeted.version});
  await assert.rejects(() => store.claimExecution(bound.id, {provider: 'claude', expectedVersion: bound.version, executionBudgetVersion: 1}),
    message(ValidationError, 'evaluation execution requires Codex budget capability version 1'));
});

test('the desktop bridge claims only desktop work and the cloud dispatcher only cloud work', async t => {
  const {store, bridge} = setup(t);
  const cloud = await queuedFor(store, 'claude', 'Cloud work');
  const desktop = await queuedFor(store, 'codex', 'Desktop work');
  const claim = await bridge.claim();
  assert.equal(claim.task.id, desktop.id);
  assert.equal(claim.task.checkpoint.provider, 'codex');
  assert.equal(await bridge.claim(), null);
  let fired = 0;
  const untouched = await dispatchClaude({store, taskId: desktop.id, hasRoutine: true, fire: async () => { fired++; }});
  assert.equal(untouched.status, 'running');
  const dispatched = await dispatchClaude({store, taskId: cloud.id, hasRoutine: true, fire: async () => { fired++; return {claude_code_session_url: 'https://example.test/s'}; }});
  assert.equal(dispatched.status, 'running');
  assert.equal(dispatched.checkpoint.provider, 'claude');
  assert.equal(fired, 1);
});

test('desktop enqueue assigns the desktop provider and CLI evidence is refused for cloud owners', async t => {
  const {store, bridge} = setup(t);
  const task = await store.createTask({prompt: 'Queue on desktop'});
  const queued = await bridge.enqueue(task.id, {provider: 'codex', expectedVersion: task.version, materials: []});
  assert.equal(queued.checkpoint.provider, 'codex');
  assert.equal(queued.status, 'queued');
  const cloud = await running(store, 'claude');
  const evidence = {provider: 'codex', source: 'cli_arguments', requestedModel: 'gpt-5.4', requestedEffort: 'high', actualModelVersion: null};
  await assert.rejects(() => bridge.complete(cloud.task.id, {executionId: cloud.executionId, generation: cloud.generation, content: 'done', executionEvidence: evidence}),
    message(ValidationError, 'execution evidence provider does not match owner'));
});

test('every cloud-transport manifest has exactly one registered remote adapter', () => {
  const adapterFor = createRemoteAdapters({env: {}, fetchFn: async () => { throw new Error('no fire expected'); }});
  const claude = adapterFor('claude');
  assert.equal(claude.provider, 'claude');
  assert.equal(claude.configured, false);
  assert.equal(claude.unavailableReason, 'Claude Routine is not configured.');
  assert.equal(typeof claude.launch, 'function');
  assert.equal(adapterFor('codex'), null);
  assert.equal(adapterFor('gemini'), null);
  const configured = createRemoteAdapters({env: {CLAUDE_ROUTINE_URL: 'https://api.anthropic.com/v1/fire', CLAUDE_ROUTINE_TOKEN: 'secret'}})('claude');
  assert.equal(configured.configured, true);
  const adapter = provider => () => ({provider, configured: false, unavailableReason: 'x', launch: async () => ({})});
  assert.throws(() => createRemoteAdapters({}, []), /missing remote adapter: claude/);
  assert.throws(() => createRemoteAdapters({}, [adapter('claude'), adapter('claude')]), /duplicate remote adapter: claude/);
  assert.throws(() => createRemoteAdapters({}, [adapter('claude'), adapter('codex')]), /not a cloud provider: codex/);
});
