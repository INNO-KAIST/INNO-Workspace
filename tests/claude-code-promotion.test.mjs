import test from 'node:test';
import assert from 'node:assert/strict';
import {ASSIGNABLE_PROVIDER_IDS, PROVIDER_MANIFESTS, createProviderRegistry, isAssignableProvider, providerHas} from '../public/core/providers.mjs';
import {validateAssignments} from '../public/core/delegation.mjs';
import {validateDelegationResult} from '../server/model-routing.mjs';
import {handoffTask} from '../public/core/provider-handoff.mjs';
import {crossCheckVerifier} from '../public/core/cross-check.mjs';
import {providerOptions} from '../public/provider-ui.mjs';
import {assertProviderTakes} from '../public/core/providers.mjs';
import {nextProviderSettings, normalizeProviderSettings} from '../public/core/provider-settings.mjs';
import {claudeCodeEnvironment} from '../server/claude-code-runner.mjs';
import {TestD1} from './helpers/d1.mjs';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {CloudBridge} from '../worker/bridge.mjs';

function cloud(t) {
  const db = new TestD1(); t.after(() => db.close());
  const worker = createWorker({fetchFn: async () => new Response('no', {status: 503})});
  const env = {DB: db, ACCESS_TOKEN: 'test-promotion-0123456789abcdef'};
  const store = new D1TaskStore(db);
  const call = async (route, body) => {
    const response = await worker.fetch(new Request('https://inno.test' + route, {method: 'POST', headers: {authorization: `Bearer ${env.ACCESS_TOKEN}`, 'content-type': 'application/json'}, body: JSON.stringify(body)}), env);
    return {status: response.status, body: await response.json()};
  };
  return {store, call, bridge: new CloudBridge(store)};
}

// CR-006 S2d (2026-10-08): after its conformance suite and two real-subscription checks, Claude
// Code on this PC may be chosen for a top-level task. Its runner takes top-level tasks only, so
// delegation children and handoffs never go to it.
test('Claude Code is assignable, for top-level tasks only', () => {
  assert.equal(isAssignableProvider('claude-code'), true);
  assert.deepEqual(ASSIGNABLE_PROVIDER_IDS, ['codex', 'claude', 'claude-code']);
  assert.deepEqual(PROVIDER_MANIFESTS.map(manifest => [manifest.id, manifest.capabilities.assignment]), [['codex', 'any'], ['claude', 'any'], ['claude-code', 'top_level']]);
  assert.equal(providerHas('claude-code', 'assignment', 'any'), false);
  const odd = structuredClone(PROVIDER_MANIFESTS[2]);
  odd.capabilities.assignment = 'children';
  assert.throws(() => createProviderRegistry([PROVIDER_MANIFESTS[0], odd]), /assignment/);
});

const child = (provider, requestedModel, role) => ({role, provider, requestedModel, effort: 'high', sufficientReason: 'Enough for the bounded work', acceptanceCriteria: ['Evidence is cited'], instructions: 'Do the bounded work.'});
test('delegation children and handoffs never go to a top-level-only runner', () => {
  const parent = {id: 'p', prompt: 'Plan the work', messages: [], attachments: [], checkpoint: {}};
  assert.throws(() => validateAssignments(parent, {independent: true, children: [child('codex', 'gpt-5.4', 'a'), child('claude-code', 'sonnet', 'b')]}), {message: 'Invalid delegation provider'});
  assert.throws(() => validateDelegationResult({independent: true, children: [child('codex', 'gpt-5.4', 'a'), child('claude-code', 'sonnet', 'b')]}, [{model: 'gpt-5.4', efforts: ['high'], isDefault: true}]), {message: 'Invalid delegation provider'});
  const running = {id: 't', version: 2, status: 'running', attachments: [], messages: [], artifacts: [], checkpoint: {provider: 'codex', executionId: 'e1', generation: 1}};
  assert.throws(() => handoffTask(running, {executionId: 'e1', generation: 1, content: 'draft', handoff: {provider: 'claude-code', instructions: 'Review', reason: 'Review', acceptance: 'Check'}}), /other provider/);
});

test('it can be chosen for a task and can cross-check a Codex result', () => {
  const option = providerOptions({cloud: true}).find(item => item.value === 'claude-code');
  assert.equal(option.disabled, undefined);
  assert.doesNotMatch(option.label, /준비 중/);
  const done = {status: 'completed', messages: [{role: 'user', content: 'Q'}, {role: 'assistant', content: 'A'}], attachments: [], artifacts: [], checkpoint: {provider: 'codex', executionId: 'e1'}};
  assert.deepEqual(crossCheckVerifier(done, {available: id => id === 'claude-code'}), {provider: 'claude-code'});
});

// Review 2026-10-08: a run requested by name (API or an old page) must not reach the runner either.
test('a run request sends only top-level tasks to a top-level-only runner', async t => {
  for (const task of [{parentTaskId: 'p'}, {assignment: {role: 'r'}}, {evaluationBudget: {limitMs: 1}}, {delegation: {state: 'reviewing'}}, {delegation: {state: 'waiting_children'}}])
    assert.throws(() => assertProviderTakes('claude-code', task), /최상위 작업/, JSON.stringify(task));
  for (const task of [{}, {delegation: {state: 'superseded'}}, {delegation: {state: 'cancelled'}}]) assertProviderTakes('claude-code', task);
  assertProviderTakes('codex', {parentTaskId: 'p'});
  const {store, call} = cloud(t);
  const made = await store.createTask({prompt: 'Child work'});
  const child = await store.replaceTask(made.id, made.version, current => ({...current, version: current.version + 1, parentTaskId: 'parent-1'}));
  const refused = await call(`/api/tasks/${child.id}/run`, {provider: 'claude-code', expectedVersion: child.version});
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /최상위 작업/);
  assert.equal((await store.requireTask(child.id)).status, 'ready');
  const direct = await call(`/api/desktop/${child.id}/start`, {provider: 'claude-code', expectedVersion: child.version, sourceNames: []});
  assert.equal(direct.status, 400, 'nor through a direct start on this PC');
  const top = await store.createTask({prompt: 'Top-level work'});
  assert.equal((await call(`/api/tasks/${top.id}/run`, {provider: 'claude-code', expectedVersion: top.version})).status, 202);
});

test('cross-check picks Claude Code only when this PC reports it ready', async t => {
  const {store, call, bridge} = cloud(t);
  const completed = async () => {
    const task = await store.createTask({prompt: 'Summarise'});
    return store.replaceTask(task.id, task.version, current => ({...current, status: 'completed', version: current.version + 1, messages: [...current.messages, {id: 'm2', role: 'assistant', content: 'A', createdAt: current.createdAt}], checkpoint: {...current.checkpoint, provider: 'codex', status: 'completed', executionId: 'e1'}}));
  };
  const first = await completed();
  const refused = await call(`/api/tasks/${first.id}/cross-check`, {expectedVersion: first.version});
  assert.equal(refused.status, 400, 'no Routine and no Claude Code reported: nothing would ever run it');
  assert.match(refused.body.error, /다른 회사/);
  await bridge.reportProviders({providers: ['codex', 'claude-code']}); await bridge.seen();
  const second = await completed();
  const sent = await call(`/api/tasks/${second.id}/cross-check`, {expectedVersion: second.version});
  assert.equal(sent.status, 202);
  assert.equal(sent.body.crossCheck.checkpoint.provider, 'claude-code');
});

test('a provider that takes any work stays on, so auto routing and delegation always have one', () => {
  const settings = normalizeProviderSettings(null);
  assert.throws(() => nextProviderSettings(settings, {disabled: ['codex', 'claude'], expectedVersion: 0}), /At least one/);
  assert.deepEqual(nextProviderSettings(settings, {disabled: ['claude-code'], expectedVersion: 0}).disabled, ['claude-code']);
});

test('the run keeps the Git Bash location Claude Code may need on Windows', () => {
  assert.deepEqual(claudeCodeEnvironment({CLAUDE_CODE_GIT_BASH_PATH: 'D:/Git/bin/bash.exe', CLAUDE_CODE_SESSION_ID: 's'}), {CLAUDE_CODE_GIT_BASH_PATH: 'D:/Git/bin/bash.exe'});
});
