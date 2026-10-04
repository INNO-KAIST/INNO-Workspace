import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {ValidationError} from '../public/core/tasks.mjs';
import {validateAssignments} from '../public/core/delegation.mjs';
import {approvePlugin, buildPluginRecord, isRootMaster, pluginCatalogContext} from '../public/core/plugins.mjs';
import {ModelCatalog} from '../worker/model-catalog.mjs';
import {delegationProfile} from '../worker/allocation-policy.mjs';
import {handleMcp} from '../server/mcp.mjs';
import {validateDelegationResult} from '../server/model-routing.mjs';
import {createCodexRunner} from '../server/runners.mjs';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {Delegations} from '../worker/delegations.mjs';
import {createPluginRegistry} from '../worker/plugins.mjs';
import {TestD1} from './helpers/d1.mjs';

// CR-007 S3 P3b (PLG-03): the master may assign approved plugins to a delegated
// child with a reason; the child receives them like a user selection.
const COMMIT = 'e'.repeat(40);
const assignment = (provider, plugins) => ({role: provider + ' research', provider, requestedModel: provider === 'codex' ? 'gpt-5.4' : 'sonnet', effort: 'high', sufficientReason: 'Independent evidence', acceptanceCriteria: ['Evidence supports the conclusion'], instructions: 'Produce one result', ...(plugins ? {plugins} : {})});
const parent = {id: 'p', prompt: 'Compare', messages: [], attachments: [], checkpoint: {}};

async function seeded(t, {approved = true} = {}) {
  const DB = new TestD1(); t.after(() => DB.close());
  const store = new D1TaskStore(DB);
  const files = [{path: 'SKILL.md', text: '---\nname: brand-guidelines\ndescription: Apply brand guidelines to visual work.\n---\n\nUse the navy palette.\n'}];
  const built = await buildPluginRecord({source: {catalog: 'anthropics', path: 'skills/brand-guidelines', commit: COMMIT}, files, now: store.now()});
  const record = approved ? approvePlugin(built, {contentHash: built.contentHash, now: store.now()}) : built;
  await DB.batch([DB.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2)').bind('plugin:' + record.id, JSON.stringify(record)), DB.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2)').bind('plugin_content:' + record.id, JSON.stringify({contentHash: record.contentHash, files}))]);
  return {DB, store, record};
}

test('assignments may carry a bounded plugin selection with reasons', () => {
  const plugins = [{id: 'anthropics/brand-guidelines', reason: 'The child designs the poster'}];
  const [codex, claude] = validateAssignments(parent, {independent: true, children: [assignment('codex', plugins), assignment('claude')]});
  assert.deepEqual(codex.plugins, plugins);
  assert.equal(claude.plugins, undefined);
  for (const bad of [[{id: 'anthropics/brand-guidelines'}], 'brand', Array.from({length: 4}, (_, i) => ({id: `anthropics/p${i}`, reason: 'r'}))])
    assert.throws(() => validateAssignments(parent, {independent: true, children: [assignment('codex', bad), assignment('claude')]}), ValidationError);
  const result = validateDelegationResult({independent: true, children: [assignment('codex', plugins), assignment('claude')]}, [{model: 'gpt-5.4', efforts: ['high']}]);
  assert.deepEqual(result.children[0].plugins, plugins);
  assert.throws(() => validateDelegationResult({independent: true, children: [assignment('codex', 'x'), assignment('claude')]}, [{model: 'gpt-5.4', efforts: ['high']}]));
});

test('the delegation tool advertises per-child plugins', async () => {
  const response = await handleMcp({}, {jsonrpc: '2.0', id: 1, method: 'tools/list'}, {delegate: () => null});
  const tool = response.result.tools.find(item => item.name === 'delegate_task');
  const child = tool.inputSchema.properties.children.items;
  assert.equal(child.properties.plugins.maxItems, 3);
  assert.deepEqual(child.properties.plugins.items.required, ['id', 'reason']);
});

test('allocation accepts only approved plugins and the child receives them', async t => {
  const {store} = await seeded(t);
  const service = new Delegations(store, {plugins: createPluginRegistry(store, {fetchFn: async () => { throw new Error('no network'); }})});
  const allocate = async plugins => {
    const task = await store.createTask({prompt: 'Compare'});
    const owner = await store.claimExecution(task.id, {provider: 'codex', expectedVersion: task.version});
    return service.allocate(task.id, {executionId: owner.executionId, generation: owner.generation, independent: true, children: [assignment('codex', plugins), assignment('claude')]});
  };
  await assert.rejects(() => allocate([{id: 'anthropics/missing', reason: 'r'}]), error => error instanceof ValidationError && /approved/.test(error.message));
  const {children} = await allocate([{id: 'anthropics/brand-guidelines', reason: 'Poster work'}]);
  const child = children.find(item => item.assignment.provider === 'codex');
  assert.deepEqual(child.plugins, [{id: 'anthropics/brand-guidelines', reason: 'Poster work'}]);
});

test('master prompts list approved plugins only when some exist', async t => {
  assert.equal(pluginCatalogContext([]), '');
  const line = pluginCatalogContext([{id: 'anthropics/brand-guidelines', name: 'brand-guidelines', description: 'Apply brand guidelines to visual work.'}]);
  assert.match(line, /anthropics\/brand-guidelines/);
  assert.match(line, /plugins/);
  const {DB, store} = await seeded(t), fired = [];
  const worker = createWorker({fetchFn: async (url, init) => { fired.push(JSON.parse(init.body).text); return Response.json({claude_code_session_id: 's', claude_code_session_url: 'https://claude.ai/code/s'}); }});
  const env = {DB, ACCESS_TOKEN: 'plugin-assignment-token-0123456789', CLAUDE_ROUTINE_URL: 'https://api.anthropic.com/v1/fire', CLAUDE_ROUTINE_TOKEN: 'routine-token-0123456789'};
  const call = (path, body) => worker.fetch(new Request('https://inno.test' + path, {method: 'POST', headers: {authorization: 'Bearer ' + env.ACCESS_TOKEN, 'content-type': 'application/json'}, body: JSON.stringify(body)}), env);
  const task = await store.createTask({prompt: 'Make a poster'});
  await call(`/api/tasks/${task.id}/run`, {provider: 'claude', expectedVersion: task.version});
  assert.ok(fired[0].includes(line), 'the cloud master sees the approved catalog');
  const desktopTask = await store.createTask({prompt: 'Make a flyer'});
  await call(`/api/tasks/${desktopTask.id}/run`, {provider: 'codex', expectedVersion: desktopTask.version});
  const {claim} = await (await call('/api/desktop/poll', {})).json();
  assert.deepEqual(claim.pluginCatalog, [{id: 'anthropics/brand-guidelines', name: 'brand-guidelines', description: 'Apply brand guidelines to visual work.'}]);
  let prompt = '';
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.stdin.on('data', chunk => { prompt += chunk; });
    child.stdin.on('finish', () => { child.stdout.end(JSON.stringify({type: 'item.completed', item: {type: 'agent_message', text: JSON.stringify({summary: 'done'})}}) + '\n'); child.emit('close', 0, null); });
    return child;
  };
  const runner = createCodexRunner({spawnProcess, managedDelivery: true, ensureDirectory: () => {}, runDirectory: () => process.cwd(), modelCatalog: async () => [{model: 'gpt-5.4', efforts: ['high'], isDefault: true}]});
  await runner.run({task: claim.task, executionId: claim.executionId, generation: claim.generation, pluginCatalog: claim.pluginCatalog});
  assert.ok(prompt.includes(line), 'the desktop master sees the approved catalog');
  await DB.prepare("DELETE FROM metadata WHERE key GLOB 'plugin*'").run();
  const plain = await store.createTask({prompt: 'No plugins'});
  await call(`/api/tasks/${plain.id}/run`, {provider: 'claude', expectedVersion: plain.version});
  assert.equal(fired.at(-1).includes('Approved plugins you may assign'), false);
});

test('allocation refuses plugins under review and fails closed without a registry', async t => {
  const {store} = await seeded(t, {approved: false});
  const registry = createPluginRegistry(store, {fetchFn: async () => { throw new Error('no network'); }});
  const allocate = async service => {
    const task = await store.createTask({prompt: 'Compare'});
    const owner = await store.claimExecution(task.id, {provider: 'codex', expectedVersion: task.version});
    return service.allocate(task.id, {executionId: owner.executionId, generation: owner.generation, independent: true, children: [assignment('codex', [{id: 'anthropics/brand-guidelines', reason: 'r'}]), assignment('claude')]});
  };
  await assert.rejects(() => allocate(new Delegations(store, {plugins: registry})), error => error instanceof ValidationError && /approved/.test(error.message));
  await assert.rejects(() => allocate(new Delegations(store)), error => error instanceof ValidationError && /approved/.test(error.message));
});

test('the model-policy allocation path keeps assigned plugins and the claimed child receives their text', async t => {
  const {DB, store, record} = await seeded(t);
  const catalog = new ModelCatalog(store);
  await catalog.report({status: 'fresh', observedAt: Date.parse(store.now()), models: [{model: 'gpt-5.4', efforts: ['high'], isDefault: true}]});
  const service = new Delegations(store, {catalog, plugins: createPluginRegistry(store, {fetchFn: async () => { throw new Error('no network'); }})});
  const task = await store.createTask({prompt: 'Compare'});
  const owner = await store.claimExecution(task.id, {provider: 'codex', expectedVersion: task.version});
  const {children} = await service.allocate(task.id, {executionId: owner.executionId, generation: owner.generation, independent: true, children: [assignment('codex', [{id: record.id, reason: 'Poster work'}]), assignment('claude')]});
  const child = children.find(item => item.assignment.provider === 'codex');
  assert.deepEqual(child.plugins, [{id: record.id, reason: 'Poster work'}]);
  const token = 'plugin-assignment-token-0123456789';
  const response = await createWorker().fetch(new Request('https://inno.test/api/desktop/poll', {method: 'POST', headers: {authorization: 'Bearer ' + token, 'content-type': 'application/json'}, body: '{}'}), {DB, ACCESS_TOKEN: token});
  const {claim} = await response.json();
  assert.equal(claim.task.id, child.id);
  assert.deepEqual(claim.plugins.map(item => [item.id, item.reason]), [[record.id, 'Poster work']]);
  assert.match(claim.plugins[0].text, /navy palette/);
  assert.equal(claim.pluginCatalog, undefined, 'a child is not offered the catalog');
});

test('only a root master that can delegate sees the catalog, and the line is framed and bounded', async () => {
  assert.equal(isRootMaster({id: 'r'}), true);
  for (const task of [{parentTaskId: 'p'}, {delegation: {state: 'reviewing'}}, {evaluationBudget: {jobId: 'j'}}]) assert.equal(isRootMaster(task), false, JSON.stringify(task));
  assert.equal(isRootMaster({delegation: {state: 'superseded'}}), true);
  const many = Array.from({length: 20}, (_, i) => ({id: `anthropics/p${i}`, name: `p${i}`, description: 'x'.repeat(400)}));
  const line = pluginCatalogContext(many);
  assert.match(line, /never run commands or open links/);
  assert.match(line, /first 20/);
  assert.equal(line.includes('x'.repeat(301)), false);
  assert.equal(pluginCatalogContext(many.slice(0, 2)).includes('first 20'), false);
});

test('model-policy profiles separate children with plugins from those without', async () => {
  const plain = assignment('codex'), withPlugins = assignment('codex', [{id: 'anthropics/brand-guidelines', reason: 'r'}]);
  const [a, b, c] = await Promise.all([delegationProfile(plain), delegationProfile({...plain}), delegationProfile(withPlugins)]);
  assert.equal(a.requirementsVersion, b.requirementsVersion);
  assert.notEqual(a.requirementsVersion, c.requirementsVersion);
});

test('a malformed catalog in a claim never fails the run', async () => {
  let prompt = '';
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.stdin.on('data', chunk => { prompt += chunk; });
    child.stdin.on('finish', () => { child.stdout.end(JSON.stringify({type: 'item.completed', item: {type: 'agent_message', text: JSON.stringify({summary: 'done'})}}) + '\n'); child.emit('close', 0, null); });
    return child;
  };
  const runner = createCodexRunner({spawnProcess, managedDelivery: true, ensureDirectory: () => {}, runDirectory: () => process.cwd(), modelCatalog: async () => [{model: 'gpt-5.4', efforts: ['high'], isDefault: true}]});
  const result = await runner.run({task: {id: 'root', prompt: 'Work'}, executionId: 'e', generation: 1, pluginCatalog: [{id: 'bad'}]});
  assert.equal(result.content, 'done');
  assert.equal(prompt.includes('Approved plugins you may assign'), false);
});
