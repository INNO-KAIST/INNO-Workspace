import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import {TestD1} from './helpers/d1.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
import {createDesktopReadiness} from '../server/desktop-readiness.mjs';
import {providersByTransport} from '../public/core/providers.mjs';

// CR-006 S2a: a connector may hold several desktop runners. It tells the cloud which of
// them can take work now (and why the others cannot); the cloud hands it only tasks of
// those providers, and the connector runs a claim only on the runner of the claim's own
// provider. A connector that predates this says nothing and runs the first desktop provider.
const token = 'test-desktop-providers-0123456789abc';
const box = () => { let value = null; return {read: () => value, write: v => { value = v; }, clear: () => { value = null; }}; };

function cloud(t) {
  const db = new TestD1(); t.after(() => db.close());
  const env = {DB: db, ACCESS_TOKEN: token}, store = new D1TaskStore(db);
  const call = async (path, body) => {
    const response = await worker.fetch(new Request('https://inno.test' + path, {method: body === undefined ? 'GET' : 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)}), env);
    return {status: response.status, body: await response.json()};
  };
  const queue = async (provider = 'codex') => {
    const task = await store.createTask({prompt: 'Summarise the notes'});
    assert.equal((await call(`/api/tasks/${task.id}/run`, {provider, expectedVersion: task.version})).status, 202);
    return task.id;
  };
  return {store, call, queue, desktop: async () => (await call('/api/state')).body.desktop};
}

test('an older connector runs every claim on its one Codex runner, so Codex must stay the first desktop provider', () => {
  // Reordering the manifests would send other desktop providers' tasks to older connectors' Codex runner.
  assert.equal(providersByTransport('desktop_bridge')[0], 'codex');
});

test('a desktop is handed only tasks of the providers it announces; an older desktop runs the first desktop provider', async t => {
  const {call, queue} = cloud(t);
  const first = await queue();
  assert.equal((await call('/api/desktop/poll', {providers: []})).body.claim, null, 'no runner ready, no claim');
  assert.equal((await call('/api/desktop/poll', {providers: ['provider-from-the-future']})).body.claim, null, 'an id this cloud does not know is ignored');
  for (const providers of ['codex', [1], [{}], Array.from({length: 9}, (_, i) => `p${i}`)])
    assert.equal((await call('/api/desktop/poll', {providers})).status, 400, JSON.stringify(providers));
  assert.equal((await call('/api/desktop/poll', {providers: ['codex']})).body.claim.task.id, first);
  const second = await queue();
  assert.equal((await call('/api/desktop/poll', {})).body.claim.task.id, second, 'a desktop that announces nothing runs the first desktop provider');
});

test('the desktop shows which of its providers are not ready and why, until a poll without that report', async t => {
  const {call, desktop} = cloud(t);
  assert.equal((await call('/api/desktop/poll', {providers: [], notReadyProviders: [{provider: 'codex', reason: 'codex_login'}]})).status, 200);
  assert.deepEqual((await desktop()).providers, {ready: [], notReady: {codex: 'codex_login'}});
  for (const notReadyProviders of [[{provider: 'codex'}], 'codex', [{provider: 'codex', reason: 'codex_login', detail: 'x'}], [{provider: 'codex', reason: 7}]])
    assert.equal((await call('/api/desktop/poll', {providers: [], notReadyProviders})).status, 400, JSON.stringify(notReadyProviders));
  // A reason or provider a newer connector adds is skipped, not refused: the poll still runs.
  assert.equal((await call('/api/desktop/poll', {providers: [], notReadyProviders: [{provider: 'codex', reason: 'reason_from_the_future'}, {provider: 'other', reason: 'claude_login'}]})).status, 200);
  assert.deepEqual((await desktop()).providers, {ready: [], notReady: {}});
  assert.equal((await call('/api/desktop/poll', {notReadyProviders: [{provider: 'codex', reason: 'codex_login'}]})).status, 400, 'a readiness report always names the ready providers');
  assert.equal((await call('/api/desktop/poll', {providers: ['codex']})).status, 200);
  assert.deepEqual((await desktop()).providers, {ready: ['codex'], notReady: {}});
  // When nothing can run, the presence report carries the same per-provider reasons.
  assert.equal((await call('/api/desktop/presence', {state: 'not_ready', reason: 'codex_login', notReadyProviders: [{provider: 'codex', reason: 'codex_login'}]})).status, 200);
  const shown = await desktop();
  assert.deepEqual([shown.notReady, shown.providers], ['codex_login', {ready: [], notReady: {codex: 'codex_login'}}]);
  assert.equal((await call('/api/desktop/presence', {state: 'not_ready', reason: 'codex_login', detail: 'x'})).status, 400);
  assert.equal((await call('/api/desktop/poll', {})).status, 200);
  assert.equal(Object.hasOwn(await desktop(), 'providers'), false, 'an older poll clears the per-provider report');
});

test('readiness checks each runner and names the ones that cannot take work', async () => {
  const runners = [{provider: 'codex', available: async () => true}, {provider: 'beta', available: async () => false, notReadyReason: 'claude_login'}];
  const readiness = createDesktopReadiness({runners, runRoot: 'unused', checkStorage: async () => {}});
  assert.deepEqual(await readiness(), {ready: ['codex'], notReady: [{provider: 'beta', reason: 'claude_login'}]});
  const none = createDesktopReadiness({runners: [{...runners[0], available: async () => false}, runners[1]], runRoot: 'unused', checkStorage: async () => {}});
  await assert.rejects(none(), error => error.code === 'DESKTOP_NOT_READY' && error.reason === 'codex_login'
    && JSON.stringify(error.notReady) === JSON.stringify([{provider: 'codex', reason: 'codex_login'}, {provider: 'beta', reason: 'claude_login'}]));
});

function connector({readiness = async () => ({ready: ['codex', 'beta'], notReady: []}), claim = null, refuse = () => false} = {}) {
  const requests = [], runs = [];
  const runner = provider => ({provider, run: async () => { runs.push(provider); return {content: `${provider} done`}; }});
  const request = async (route, body) => {
    requests.push({route, body});
    if (refuse(route, body)) throw Object.assign(Error('refused'), {status: 400});
    if (route.endsWith('/poll') || route.endsWith('/start')) return {claim: typeof claim === 'function' ? claim(route, body) : claim};
    return {task: {status: 'completed'}};
  };
  const bridge = createDesktopBridge({request, outbox: box(), runners: [runner('codex'), runner('beta')], beforeClaim: readiness});
  return {bridge, requests, runs};
}
const claimFor = provider => ({task: {id: 't', checkpoint: {provider}}, executionId: 'e', generation: 1});

test('a connector with several runners announces the ready ones and runs a claim only on the runner of its provider', async () => {
  const {bridge, requests, runs} = connector({claim: claimFor('beta')});
  assert.equal(await bridge.tick(), true);
  await bridge.settled();
  const poll = requests.find(r => r.route === '/api/desktop/poll');
  assert.deepEqual(poll.body.providers, ['codex', 'beta']);
  assert.equal(Object.hasOwn(poll.body, 'notReadyProviders'), false);
  assert.deepEqual(runs, ['beta']);
  assert.equal(requests.at(-1).route, '/api/desktop/t/complete');
  // A claim for a provider this connector has no runner for is never run on another runner.
  const other = connector({claim: claimFor('gamma')});
  await other.bridge.tick();
  assert.deepEqual(other.runs, []);
  const failed = other.requests.at(-1);
  assert.equal(failed.route, '/api/desktop/t/fail');
  assert.equal(failed.body.failure.kind, 'unavailable');
});

test('a connector reports the runners that are not ready with its poll, and all of them when none is ready', async () => {
  const partly = connector({readiness: async () => ({ready: ['codex'], notReady: [{provider: 'beta', reason: 'claude_login'}]})});
  await partly.bridge.tick();
  assert.deepEqual(partly.requests[0].body, {providers: ['codex'], notReadyProviders: [{provider: 'beta', reason: 'claude_login'}]});
  const notReady = Object.assign(Error('not ready'), {code: 'DESKTOP_NOT_READY', reason: 'codex_login', notReady: [{provider: 'codex', reason: 'codex_login'}, {provider: 'beta', reason: 'claude_login'}]});
  const none = connector({readiness: async () => { throw notReady; }});
  await assert.rejects(none.bridge.tick(), {code: 'DESKTOP_NOT_READY'});
  assert.deepEqual(none.requests, [{route: '/api/desktop/presence', body: {state: 'not_ready', reason: 'codex_login', notReadyProviders: notReady.notReady}}]);
  // A Worker that predates per-provider reports refuses the extra field; the plain report is sent again.
  const older = connector({readiness: async () => { throw notReady; }, refuse: (route, body) => route === '/api/desktop/presence' && body.notReadyProviders !== undefined});
  await assert.rejects(older.bridge.tick(), {code: 'DESKTOP_NOT_READY'});
  assert.deepEqual(older.requests.map(r => r.body), [{state: 'not_ready', reason: 'codex_login', notReadyProviders: notReady.notReady}, {state: 'not_ready', reason: 'codex_login'}]);
});

test('a real claim from the cloud runs on the runner of its provider', async t => {
  const {call, queue} = cloud(t);
  const taskId = await queue();
  const runs = [];
  const request = async (route, body) => {
    const response = await call(route, body ?? {});
    if (response.status >= 400) throw Object.assign(Error(response.body.error ?? 'refused'), {status: response.status});
    return response.body;
  };
  const bridge = createDesktopBridge({request, outbox: box(), runners: [{provider: 'codex', run: async ({task}) => { runs.push(task.id); return {content: 'done'}; }}]});
  assert.equal(await bridge.tick(), true);
  assert.deepEqual(runs, [taskId]);
  assert.equal((await call('/api/state')).body.tasks.find(task => task.id === taskId).status, 'completed');
});

test('a direct start names the chosen provider and is refused here when that runner is not ready', async () => {
  const {bridge, requests, runs} = connector({claim: (route, body) => claimFor(body.provider)});
  await bridge.startTask('t', {expectedVersion: 1, materials: [], provider: 'beta'});
  await bridge.settled();
  assert.equal(requests[0].route, '/api/desktop/t/start');
  assert.equal(requests[0].body.provider, 'beta');
  assert.deepEqual(runs, ['beta']);
  const blocked = connector({readiness: async () => ({ready: ['codex'], notReady: [{provider: 'beta', reason: 'claude_login'}]})});
  await assert.rejects(blocked.bridge.startTask('t', {expectedVersion: 1, materials: [], provider: 'beta'}), {status: 409});
  await assert.rejects(blocked.bridge.startTask('t', {expectedVersion: 1, materials: [], provider: 'gamma'}), {status: 409});
  assert.deepEqual(blocked.requests, [], 'nothing is claimed for a runner that cannot take it');
});

test('the Codex runner names its provider and the reason it is not ready, for the connector runner table', async () => {
  const {createCodexRunner} = await import('../server/runners.mjs');
  const {providersByTransport} = await import('../public/core/providers.mjs');
  const runner = createCodexRunner({availability: async () => false});
  assert.deepEqual([runner.provider, runner.notReadyReason], [providersByTransport('desktop_bridge')[0], 'codex_login']);
});

test('a Claude Code task waits for a connector that announces Claude Code, and the screen learns that runner exists', async t => {
  const {call, queue} = cloud(t);
  const capabilities = async () => (await call('/api/state')).body.capabilities;
  assert.notEqual((await capabilities()).localClaudeCode, true);
  const claudeTask = await queue('claude-code');
  assert.equal((await call('/api/desktop/poll', {})).body.claim, null, 'an older connector never takes it');
  assert.equal((await call('/api/desktop/poll', {providers: ['codex']})).body.claim, null);
  assert.equal((await call('/api/desktop/poll', {providers: ['codex'], notReadyProviders: [{provider: 'claude-code', reason: 'claude_login'}]})).body.claim, null);
  assert.equal((await capabilities()).localClaudeCode, true, 'a connector with that runner was seen');
  const claim = (await call('/api/desktop/poll', {providers: ['codex', 'claude-code']})).body.claim;
  assert.deepEqual([claim.task.id, claim.task.checkpoint.provider], [claudeTask, 'claude-code']);
});

test('the screen shows each desktop runner with its own readiness', async () => {
  const {providerCards} = await import('../public/provider-management-ui.mjs');
  const {executorStatusText} = await import('../public/provider-ui.mjs');
  const capabilities = {cloudCodex: true, localClaudeCode: true};
  const providers = {ready: ['codex'], notReady: {'claude-code': 'claude_login'}};
  const status = (desktop, caps = capabilities) => Object.fromEntries(providerCards({capabilities: caps, desktop}).map(card => [card.id, card.status]));
  const shown = status({online: true, lastSeen: Date.now(), providers});
  assert.equal(shown.codex, '연결됨');
  assert.match(shown['claude-code'], /^연결됨 · Claude Code 로그인 필요/);
  assert.match(status({online: true, lastSeen: Date.now(), providers: {ready: ['codex'], notReady: {}}})['claude-code'], /이 PC 연결기에서 쓸 수 없음/);
  assert.match(status({online: true, lastSeen: Date.now()}, {cloudCodex: true})['claude-code'], /연결되지 않음/, 'an older connector never reported it');
  assert.match(status({online: true, lastSeen: Date.now(), notReady: 'run_storage', providers})['codex'], /저장 공간/);
  assert.match(executorStatusText('claude-code', capabilities, {desktopOnline: true, desktopProviders: providers}), /Claude Code 로그인.*claude auth login/);
  assert.doesNotMatch(executorStatusText('codex', capabilities, {desktopOnline: true, desktopNotReady: 'codex_login', desktopProviders: providers}), /로그인/, 'a per-runner report wins over the whole-desktop reason');
  assert.match(executorStatusText('claude-code', capabilities, {desktopOnline: true, desktopProviders: {ready: [], notReady: {'claude-code': 'claude_cli'}}}), /CLI를 찾지 못했습니다/);
});
