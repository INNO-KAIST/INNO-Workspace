import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.mjs';
import {createWorker} from '../worker/index.mjs';
import {D1TaskStore} from '../worker/store.mjs';
import {AUTO_PROVIDER, AUTO_SWITCH_AFTER_MS, autoRoutingBlocker, chooseAutoProvider, routingText} from '../public/core/cloud-routing.mjs';
import {autoExecutorText, fallbackProvider, pickProvider, providerOptions, statusProvider} from '../public/provider-ui.mjs';

// CR-010: a source-free top-level task can run on "auto". It goes to this PC's desktop runner
// when that runner is ready, otherwise to the cloud Claude Routine; a task sent to the PC that
// has not started after AUTO_SWITCH_AFTER_MS moves once, before it starts, to the Routine.
// Tasks with originals, children, explicit choices, running or uncertain work never move.
const token = 'test-cloud-routing-0123456789abcdef';
const settings = (disabled = []) => ({version: 1, disabled});
const online = {online: true, lastSeen: 1, providers: {ready: ['codex'], notReady: {}}};

test('auto picks the PC when its runner is ready and the cloud otherwise, and waits only when nothing else can run', () => {
  assert.equal(AUTO_PROVIDER, 'auto');
  assert.equal(AUTO_SWITCH_AFTER_MS, 600_000);
  const pick = (desktop, disabled, cloudConfigured = true) => chooseAutoProvider({desktop, settings: settings(disabled), cloudConfigured});
  assert.deepEqual(pick(online, []), {provider: 'codex', reason: 'desktop_ready'});
  assert.deepEqual(pick({online: false, lastSeen: null}, []), {provider: 'claude', reason: 'desktop_offline'});
  assert.deepEqual(pick({online: true, providers: {ready: [], notReady: {codex: 'codex_login'}}}, []), {provider: 'claude', reason: 'desktop_not_ready'});
  assert.deepEqual(pick({online: true, notReady: 'run_storage'}, []), {provider: 'claude', reason: 'desktop_not_ready'});
  assert.deepEqual(pick({online: true, providers: {ready: ['claude-code'], notReady: {}}}, []), {provider: 'claude', reason: 'desktop_not_ready'}, 'only the desktop runner auto uses counts');
  assert.deepEqual(pick({online: true}, []), {provider: 'codex', reason: 'desktop_ready'}, 'an older connector that reports nothing counts as ready while online');
  assert.deepEqual(pick(online, ['codex']), {provider: 'claude', reason: 'desktop_off'});
  assert.deepEqual(pick({online: false}, [], false), {provider: 'codex', reason: 'cloud_unavailable'}, 'with no Routine it waits for the PC');
  assert.deepEqual(pick({online: false}, ['claude']), {provider: 'codex', reason: 'cloud_unavailable'});
  assert.throws(() => pick({online: false}, ['codex'], false), /사용할 수 있는 실행기/);
});

test('only source-free top-level tasks can run on auto', () => {
  const base = {id: 't', status: 'ready', attachments: [], checkpoint: {}};
  assert.equal(autoRoutingBlocker(base), null);
  assert.match(autoRoutingBlocker({...base, attachments: [{id: 'a', name: 'paper.pdf', source: 'file'}]}), /원본/);
  assert.match(autoRoutingBlocker({...base, parentTaskId: 'p'}), /하위 작업/);
  assert.match(autoRoutingBlocker({...base, delegation: {state: 'waiting_children'}}), /하위 작업/);
  assert.equal(autoRoutingBlocker({...base, delegation: {state: 'superseded'}}), null);
  assert.match(autoRoutingBlocker({...base, evaluationBudget: {version: 1}}), /비교 평가/);
});

test('the run picker offers auto first in the cloud workspace, never for tasks with originals', () => {
  const cloud = {cloud: true, cloudCodex: true, claudeRoutine: true};
  assert.deepEqual(providerOptions(cloud)[0], {value: 'auto', label: '자동 · PC 우선, 꺼져 있으면 클라우드 Claude'});
  assert.equal(providerOptions(cloud, {task: {attachments: [{id: 'a'}]}})[0].disabled, true);
  assert.equal(providerOptions({localCodex: true})[0].disabled, true, 'the local server mode has no cloud to fall back to');
  assert.match(routingText({mode: 'auto', provider: 'codex', reason: 'desktop_ready', switchAfter: '2026-10-07T10:10:00.000Z'}), /이 PC.*10분/);
  assert.match(routingText({mode: 'auto', provider: 'claude', reason: 'desktop_offline'}), /클라우드.*PC 오프라인/);
  assert.match(routingText({mode: 'auto', provider: 'claude', reason: 'desktop_waited', switchedAt: '2026-10-07T10:10:00.000Z'}), /10분.*옮겼습니다/);
  assert.equal(routingText(undefined), '');
  // While running, the line says where it runs and promises no move; a task given originals is not promised a move.
  const routed = {mode: 'auto', provider: 'codex', reason: 'desktop_ready', switchAfter: '2026-10-07T10:10:00.000Z'};
  assert.doesNotMatch(autoExecutorText({status: 'running', checkpoint: {routing: routed}}, 'auto'), /10분|옮깁니다/);
  assert.match(autoExecutorText({status: 'running', checkpoint: {routing: routed}}, 'auto'), /실행 중/);
  assert.doesNotMatch(autoExecutorText({status: 'queued', attachments: [{id: 'a'}], checkpoint: {routing: routed}}, 'auto'), /옮깁니다/);
  // A task already waiting or running without an auto record shows its own state, not what auto would do.
  assert.equal(autoExecutorText({status: 'queued', checkpoint: {provider: 'codex'}}, 'auto'), '');
  assert.equal(autoExecutorText({status: 'running', checkpoint: {provider: 'claude'}}, 'auto'), '');
  assert.match(autoExecutorText({status: 'ready', checkpoint: {}}, 'auto'), /PC 실행기가 준비돼/);
  // With auto selected, the state line of a task describes the runner it actually waits for or runs on.
  assert.equal(statusProvider('auto', {status: 'queued', checkpoint: {provider: 'codex'}}), 'codex');
  assert.equal(statusProvider('auto', {status: 'ready', checkpoint: {}}), 'auto');
  assert.equal(statusProvider('claude', {status: 'queued', checkpoint: {provider: 'codex'}}), 'claude', 'a chosen runner is kept');
  // When auto cannot be used, the PC runner is preferred over the cloud.
  assert.equal(fallbackProvider([{value: 'auto', disabled: true}, {value: 'claude'}, {value: 'codex'}]), 'codex');
  assert.equal(fallbackProvider([{value: 'auto', disabled: true}, {value: 'codex', disabled: true}, {value: 'claude'}]), 'claude');
  // Until the person picks a runner, the picker follows auto: back to auto as soon as it can be used.
  const offline=[{value: 'auto', disabled: true}, {value: 'codex'}, {value: 'claude'}], connected=[{value: 'auto'}, {value: 'codex'}, {value: 'claude'}];
  assert.equal(pickProvider(offline, 'auto', false), 'codex');
  assert.equal(pickProvider(connected, 'codex', false), 'auto');
  assert.equal(pickProvider(connected, 'codex', true), 'codex', 'a person-chosen runner stays');
  assert.equal(pickProvider(offline, 'auto', true), 'codex', 'a chosen auto that cannot be used falls back');
});

function cloudWorker(t, {routine = true} = {}) {
  const db = new TestD1(); t.after(() => db.close());
  const fires = [];
  const worker = createWorker({fetchFn: async (url, init) => {
    if (new URL(String(url)).hostname !== 'api.anthropic.com') return new Response('unavailable', {status: 503});
    fires.push(JSON.parse(init.body));
    return Response.json({claude_code_session_id: `s${fires.length}`, claude_code_session_url: `https://claude.ai/code/s${fires.length}`});
  }});
  const env = {DB: db, ACCESS_TOKEN: token, ...(routine ? {CLAUDE_ROUTINE_URL: 'https://api.anthropic.com/v1/fire', CLAUDE_ROUTINE_TOKEN: 'routine-token-0123456789'} : {})};
  const store = new D1TaskStore(db);
  const call = async (path, body) => {
    const response = await worker.fetch(new Request('https://inno.test' + path, {method: body === undefined ? 'GET' : 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)}), env);
    return {status: response.status, body: await response.json()};
  };
  const run = async (task, provider = 'auto') => call(`/api/tasks/${task.id}/run`, {provider, expectedVersion: (await store.requireTask(task.id)).version});
  return {store, call, run, fires, scheduled: () => worker.scheduled({}, env, {})};
}

test('auto sends a task to the ready PC and records why; an offline PC sends it to the cloud at once', async t => {
  const {store, call, run, fires} = cloudWorker(t);
  assert.equal((await call('/api/desktop/poll', {providers: ['codex']})).status, 200);
  const first = await store.createTask({prompt: 'Summarise the meeting'});
  assert.equal((await run(first)).status, 202);
  const queued = await store.requireTask(first.id);
  assert.deepEqual([queued.status, queued.checkpoint.provider, queued.checkpoint.routing.mode, queued.checkpoint.routing.reason], ['queued', 'codex', 'auto', 'desktop_ready']);
  assert.ok(Date.parse(queued.checkpoint.routing.switchAfter) - Date.parse(queued.checkpoint.routing.decidedAt) === 600_000);
  assert.equal(fires.length, 0);
  // The desktop goes quiet: the next auto run goes to the cloud.
  await store.db.prepare("UPDATE metadata SET value=?1 WHERE key='desktop_seen'").bind(Date.now() - 600_000).run();
  const second = await store.createTask({prompt: 'Draft an outline'});
  assert.equal((await run(second)).status, 202);
  const fired = await store.requireTask(second.id);
  assert.deepEqual([fired.status, fired.checkpoint.provider, fired.checkpoint.routing.reason], ['running', 'claude', 'desktop_offline']);
  assert.equal(fires.length, 1);
});

test('auto is refused for a task with originals, and an explicit choice clears an earlier auto record', async t => {
  const {store, call, run} = cloudWorker(t);
  const withSource = await store.createTask({prompt: 'Read my paper', attachments: [{id: 'a', name: 'paper.pdf', source: 'file'}]});
  const refused = await run(withSource);
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /원본/);
  await call('/api/desktop/poll', {providers: ['codex']});
  const task = await store.createTask({prompt: 'Plan the week'});
  await run(task);
  await call(`/api/tasks/${task.id}/actions`, {action: 'pause', expectedVersion: (await store.requireTask(task.id)).version});
  await call(`/api/tasks/${task.id}/actions`, {action: 'resume', expectedVersion: (await store.requireTask(task.id)).version});
  assert.equal((await run(task, 'codex')).status, 202);
  assert.equal((await store.requireTask(task.id)).checkpoint.routing, undefined, 'a person-chosen run is never moved');
});

test('a task that waited past its time on the PC moves once to the cloud before it starts', async t => {
  const {store, call, run, fires, scheduled} = cloudWorker(t);
  await call('/api/desktop/poll', {providers: ['codex']});
  const task = await store.createTask({prompt: 'Write the summary'});
  await run(task);
  const age = async id => {
    const current = await store.requireTask(id);
    await store.replaceTask(id, current.version, value => ({...value, version: value.version + 1, checkpoint: {...value.checkpoint, routing: {...value.checkpoint.routing, switchAfter: new Date(Date.now() - 1000).toISOString()}}}));
  };
  await scheduled();
  assert.equal((await store.requireTask(task.id)).checkpoint.provider, 'codex', 'not before its time');
  await age(task.id);
  await scheduled();
  const moved = await store.requireTask(task.id);
  assert.deepEqual([moved.status, moved.checkpoint.provider, moved.checkpoint.routing.reason, typeof moved.checkpoint.routing.switchedAt], ['running', 'claude', 'desktop_waited', 'string']);
  assert.equal(fires.length, 1);
  await scheduled();
  assert.equal(fires.length, 1, 'once only');
  // A task the desktop already claimed, an explicit choice, or one with the cloud turned off stays.
  const claimed = await store.createTask({prompt: 'Claimed task'});
  await run(claimed); await age(claimed.id);
  assert.equal((await call('/api/desktop/poll', {providers: ['codex']})).body.claim.task.id, claimed.id);
  const explicit = await store.createTask({prompt: 'Explicit task'});
  await run(explicit, 'codex');
  const offCloud = await store.createTask({prompt: 'Cloud off'});
  await run(offCloud); await age(offCloud.id);
  const current = await call('/api/state');
  assert.equal((await call('/api/providers/settings', {disabled: ['claude'], expectedVersion: current.body.capabilities.providerSettingsVersion ?? 0})).status, 200);
  await scheduled();
  assert.equal((await store.requireTask(claimed.id)).checkpoint.provider, 'codex');
  assert.equal((await store.requireTask(explicit.id)).checkpoint.provider, 'codex');
  assert.equal((await store.requireTask(offCloud.id)).checkpoint.provider, 'codex', 'a turned-off cloud is never chosen');
  assert.equal(fires.length, 1);
});

test('a task the PC has started never moves, even if it waits again later', async t => {
  const {store, call, run, fires, scheduled} = cloudWorker(t);
  await call('/api/desktop/poll', {providers: ['codex']});
  const task = await store.createTask({prompt: 'Started on the PC'});
  await run(task);
  assert.equal((await call('/api/desktop/poll', {providers: ['codex']})).body.claim.task.id, task.id);
  const claimed = await store.requireTask(task.id);
  assert.equal(claimed.checkpoint.routing.switchAfter, undefined, 'starting on the PC ends the waiting period');
  assert.equal(claimed.checkpoint.routing.mode, 'auto', 'the decision itself is kept');
  // Back in the queue (for example after a handoff to a desktop provider): still not moved.
  await store.replaceTask(task.id, claimed.version, current => ({...current, status: 'queued', version: current.version + 1, checkpoint: {...current.checkpoint, status: 'queued', routing: {...current.checkpoint.routing, switchAfter: new Date(Date.now() - 1000).toISOString()}}}));
  await scheduled();
  assert.equal((await store.requireTask(task.id)).checkpoint.provider, 'codex');
  assert.equal(fires.length, 0);
});

test('tasks given originals while they wait are not moved and do not hold up the others', async t => {
  const {store, call, run, fires, scheduled} = cloudWorker(t);
  await call('/api/desktop/poll', {providers: ['codex']});
  const past = new Date(Date.now() - 1000).toISOString();
  for (let i = 0; i < 11; i++) {
    const task = await store.createTask({prompt: `Blocked ${i}`});
    await run(task);
    const queued = await store.requireTask(task.id);
    await store.replaceTask(task.id, queued.version, current => ({...current, version: current.version + 1, attachments: [{id: 'a', name: 'paper.pdf', path: 'paper.pdf', size: 1, lastModified: 1, type: 'application/pdf', source: 'file'}], checkpoint: {...current.checkpoint, routing: {...current.checkpoint.routing, switchAfter: past}}}));
  }
  const free = await store.createTask({prompt: 'Free to move'});
  await run(free);
  const queued = await store.requireTask(free.id);
  await store.replaceTask(free.id, queued.version, current => ({...current, version: current.version + 1, checkpoint: {...current.checkpoint, routing: {...current.checkpoint.routing, switchAfter: past}}}));
  await scheduled();
  assert.equal((await store.requireTask(free.id)).checkpoint.provider, 'claude');
  assert.equal(fires.length, 1, 'only the source-free task moved');
});

test('a task handed off long ago and later re-run on auto still moves when it waits too long', async t => {
  const {store, call, run, fires, scheduled} = cloudWorker(t);
  await call('/api/desktop/poll', {providers: ['codex']});
  const task = await store.createTask({prompt: 'Handed off before'});
  // An earlier stage handed this task off; the record stays in the checkpoint (dispatched).
  await store.replaceTask(task.id, task.version, current => ({...current, status: 'failed', version: current.version + 1, checkpoint: {...current.checkpoint, status: 'failed', handoff: {from: 'codex', to: 'claude', dispatched: true}, claimedAt: new Date(Date.now() - 86_400_000).toISOString()}}));
  await run(task);
  const queued = await store.requireTask(task.id);
  await store.replaceTask(task.id, queued.version, current => ({...current, version: current.version + 1, checkpoint: {...current.checkpoint, routing: {...current.checkpoint.routing, switchAfter: new Date(Date.now() - 1000).toISOString()}}}));
  await scheduled();
  assert.equal((await store.requireTask(task.id)).checkpoint.provider, 'claude');
  assert.equal(fires.length, 1);
});

test('a moved task whose first dispatch did not happen is sent by the scheduled drain', async t => {
  const {store, fires, scheduled} = cloudWorker(t);
  const task = await store.createTask({prompt: 'Moved but not sent'});
  const now = new Date().toISOString();
  await store.replaceTask(task.id, task.version, current => ({...current, status: 'queued', version: current.version + 1, checkpoint: {...current.checkpoint, provider: 'claude', status: 'queued', routing: {mode: 'auto', provider: 'claude', reason: 'desktop_waited', decidedAt: now, switchedAt: now}}}));
  await scheduled();
  assert.equal((await store.requireTask(task.id)).status, 'running');
  assert.equal(fires.length, 1);
});

test('without a configured Routine, auto waits for the PC and is never moved', async t => {
  const {store, run, scheduled, fires} = cloudWorker(t, {routine: false});
  const task = await store.createTask({prompt: 'Offline task'});
  assert.equal((await run(task)).status, 202);
  const queued = await store.requireTask(task.id);
  assert.deepEqual([queued.status, queued.checkpoint.provider, queued.checkpoint.routing.reason, queued.checkpoint.routing.switchAfter ?? null], ['queued', 'codex', 'cloud_unavailable', null]);
  await scheduled();
  assert.equal(fires.length, 0);
});
