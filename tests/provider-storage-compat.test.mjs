import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ValidationError} from '../public/core/tasks.mjs';
import {ASSIGNABLE_PROVIDER_IDS, PROVIDER_IDS} from '../public/core/providers.mjs';
import {sanitizeUsageHistory, usageHistory, usageSummary} from '../public/core/execution-usage.mjs';
import {boundedContextDelivery} from '../public/core/context-delivery.mjs';
import {createSelectionState} from '../public/core/model-selection.mjs';
import {validateAssignments} from '../public/core/delegation.mjs';
import {handoffTask} from '../public/core/provider-handoff.mjs';
import {handleMcp} from '../server/mcp.mjs';
import {createInnoServer} from '../server/http.mjs';
import {SqliteTaskStore} from '../server/store.mjs';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {TestD1} from './helpers/d1.mjs';

// CR-006 S1 keeps the stored provider representation unchanged: plain strings
// in task JSON bodies and the usage table key. No D1 migration is needed and a
// rollback reads the same data. These tests pin that contract.
const at = '2026-10-01T00:00:00.000Z';
const usage = (provider, executionId) => ({provider, executionId, generation: 1, completedAt: at, inputTokens: 10, outputTokens: 2, source: 'executor_report'});
const delivery = provider => ({version: 1, provider, unit: 'utf8_bytes', readiness: 'full_ready', contextBytes: 10, originalBytes: 10, selectionSavedBytes: 0, omittedMessages: 0, maxBytes: 96000, hardMaxBytes: 384000, reader: false, promptBytes: 100, materialBytes: 0, inputTokens: null, cachedTokens: null});

test('stored provider values round-trip through the cloud task store unchanged', async t => {
  const DB = new TestD1(); t.after(() => DB.close());
  const store = new D1TaskStore(DB);
  const created = await store.createTask({prompt: 'Legacy provider record'});
  const legacy = {
    provider: 'claude', status: 'completed', executionId: 'e2', generation: 2,
    usageHistory: [usage('codex', 'e1'), usage('claude', 'e2')],
    handoffHistory: [{executionId: 'e1', generation: 1, from: 'codex', to: 'claude', reason: 'r', instructions: 'i', acceptance: 'a', createdAt: at}],
    contextDelivery: delivery('claude'),
  };
  await store.replaceTask(created.id, created.version, current => ({...current, version: current.version + 1, status: 'completed', checkpoint: legacy, assignment: {provider: 'codex', requestedModel: 'gpt-5.4', effort: 'high'}}));
  const read = await store.requireTask(created.id);
  assert.deepEqual(read.checkpoint, legacy);
  assert.deepEqual(sanitizeUsageHistory(read.checkpoint.usageHistory).map(row => [row.provider, row.executionId]), [['codex', 'e1'], ['claude', 'e2']]);
  assert.deepEqual(boundedContextDelivery(read.checkpoint.contextDelivery), legacy.contextDelivery);
  assert.equal(read.assignment.provider, 'codex');
  await store.recordUsage('codex', {usedPercent: 12});
  await store.recordUsage('claude', {usedPercent: 34});
  const state = await store.getState();
  assert.deepEqual(state.usage.map(row => [row.provider, row.usedPercent]), [['claude', 34], ['codex', 12]]);
  await assert.rejects(() => store.claimExecution(created.id, {provider: 'gemini', expectedVersion: read.version}), error => error instanceof ValidationError && error.message === 'provider must be codex or claude or claude-code');
});

test('stored provider values round-trip through the local task store unchanged', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'inno-provider-store-'));
  const store = new SqliteTaskStore(path.join(directory, 'tasks.sqlite'));
  t.after(async () => { store.close(); await rm(directory, {recursive: true, force: true}); });
  const created = store.createTask({prompt: 'Legacy local record'});
  const checkpoint = {provider: 'codex', status: 'completed', executionId: 'e1', generation: 1, usageHistory: [usage('codex', 'e1')], contextDelivery: delivery('codex')};
  store.replaceTask(created.id, created.version, current => ({...current, version: current.version + 1, status: 'completed', checkpoint}));
  const read = store.requireTask(created.id);
  assert.deepEqual(read.checkpoint, checkpoint);
  store.recordUsage('claude', {usedPercent: 5});
  assert.deepEqual(store.getState().usage.map(row => row.provider), ['claude']);
  assert.throws(() => store.claimExecution(created.id, {provider: 'gemini', expectedVersion: read.version}), error => error instanceof ValidationError && error.message === 'provider must be codex or claude or claude-code');
});

test('usage records keep registered providers and drop unknown ones as before', () => {
  const kept = sanitizeUsageHistory([usage('codex', 'a'), usage('claude', 'b'), usage('gemini', 'c'), usage('Codex', 'd'), usage(undefined, 'e')]);
  assert.deepEqual(kept.map(row => row.provider), ['codex', 'claude']);
  const unchanged = usageHistory({provider: 'gemini', executionId: 'x', generation: 1, usageHistory: [usage('codex', 'a')]}, {inputTokens: 1}, at);
  assert.deepEqual(unchanged.map(row => row.executionId), ['a']);
  const summary = usageSummary([]);
  assert.deepEqual(Object.keys(summary), ['codex', 'claude', 'claude-code']);
});

test('records naming an unknown provider are rejected at every validation boundary', () => {
  assert.equal(boundedContextDelivery(delivery('codex')).provider, 'codex');
  assert.throws(() => boundedContextDelivery(delivery('gemini')), error => error instanceof ValidationError && error.message === 'context delivery provider is invalid');
  const profile = {family: 'analysis', requirementsVersion: 'r1', evaluationVersion: 'e1', criteria: ['correct'], requiredCapabilities: ['tools'], contextClass: 'large'};
  const baseline = {id: 'base', provider: 'codex', model: 'm', modelVersion: null, effort: 'high'};
  assert.equal(createSelectionState({profile, baseline, minSamples: 3}).candidates[0].provider, 'codex');
  assert.throws(() => createSelectionState({profile, baseline: {...baseline, provider: 'gemini'}, minSamples: 3}), error => error instanceof TypeError && error.message === 'Invalid model selection provider');
  const child = provider => ({role: provider + ' role', provider, requestedModel: 'sonnet', effort: 'high', sufficientReason: 'r', acceptanceCriteria: ['c'], instructions: 'i'});
  const parent = {id: 'p', prompt: 'Compare', messages: [], attachments: [], checkpoint: {}};
  assert.throws(() => validateAssignments(parent, {independent: true, children: [child('codex'), child('gemini')]}), error => error instanceof ValidationError && error.message === 'Invalid delegation provider');
  const running = {id: 't', status: 'running', version: 3, attachments: [], messages: [], artifacts: [], checkpoint: {provider: 'codex', executionId: 'e', generation: 1}};
  for (const provider of ['gemini', 'codex'])
    assert.throws(() => handoffTask(running, {executionId: 'e', generation: 1, content: 'progress', handoff: {provider, instructions: 'i', reason: 'r', acceptance: 'a'}}), error => error instanceof ValidationError && error.message === 'Handoff must target the other provider.');
  assert.equal(handoffTask(running, {executionId: 'e', generation: 1, content: 'progress', handoff: {provider: 'claude', instructions: 'i', reason: 'r', acceptance: 'a'}}).checkpoint.provider, 'claude');
});

test('advertised MCP provider enums list exactly the registered providers', async () => {
  const response = await handleMcp({}, {jsonrpc: '2.0', id: 1, method: 'tools/list'}, {handoff: () => null, delegate: () => null});
  const enums = [];
  const walk = (value, tool) => {
    if (!value || typeof value !== 'object') return;
    if (value.provider?.enum) enums.push([tool, value.provider.enum]);
    for (const item of Object.values(value)) walk(item, tool);
  };
  for (const tool of response.result.tools) walk(tool, tool.name);
  assert.equal(enums.length, 3);
  // Claiming names any registered provider; handing off and delegating only assignable ones.
  for (const [tool, values] of enums) assert.deepEqual(values, tool === 'claim_execution' ? [...PROVIDER_IDS] : [...ASSIGNABLE_PROVIDER_IDS], tool);
  assert.deepEqual([...ASSIGNABLE_PROVIDER_IDS], ['codex', 'claude'], 'the Claude Code pilot is not assignable yet');
});

test('run requests naming an unknown provider fail with the existing message', async t => {
  const DB = new TestD1(); t.after(() => DB.close());
  const store = new D1TaskStore(DB);
  const env = {DB, ACCESS_TOKEN: 'test-provider-compat-0123456789012345'};
  const task = await store.createTask({prompt: 'Run me'});
  const worker = createWorker({fetchFn: async () => { throw new Error('no external call expected'); }});
  const cloud = await worker.fetch(new Request(`https://inno.test/api/tasks/${task.id}/run`, {method: 'POST', headers: {authorization: 'Bearer ' + env.ACCESS_TOKEN, 'content-type': 'application/json'}, body: JSON.stringify({provider: 'gemini', expectedVersion: task.version})}), env);
  assert.equal(cloud.status, 400);
  assert.deepEqual(await cloud.json(), {error: 'provider must be codex or claude or claude-code'});

  const directory = await mkdtemp(path.join(tmpdir(), 'inno-provider-compat-'));
  const local = new SqliteTaskStore(path.join(directory, 'tasks.sqlite'));
  const instance = createInnoServer({store: local, token: 'test-token-0123456789abcdef', corsOrigins: [], publicDir: path.join(directory, 'public')});
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => instance.server.close(resolve)); local.close(); await rm(directory, {recursive: true, force: true}); });
  const localTask = local.createTask({prompt: 'Run me locally'});
  const response = await fetch(`http://127.0.0.1:${instance.server.address().port}/api/tasks/${localTask.id}/run`, {method: 'POST', headers: {authorization: 'Bearer test-token-0123456789abcdef', 'content-type': 'application/json'}, body: JSON.stringify({provider: 'gemini', expectedVersion: localTask.version})});
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {error: 'provider must be codex or claude or claude-code'});
});
