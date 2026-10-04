import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createWorker} from '../../worker/index.mjs';
import {D1TaskStore} from '../../worker/store.mjs';
import {createCodexRunner} from '../../server/runners.mjs';
import {createDesktopBridge} from '../../server/desktop-bridge.mjs';
import {createCloudRequest} from '../../server/delivery-binding.mjs';
import {createFileOutbox} from '../../server/file-outbox.mjs';
import {prepareRequest} from '../../scripts/inno-mcp.mjs';
import {approvePlugin, buildPluginRecord} from '../../public/core/plugins.mjs';
import {TestD1} from './d1.mjs';

// Conformance harnesses (contract in tests/helpers/provider-conformance.mjs):
// production transport, Worker entry points, store and adapter; only the
// provider's external process or API is faked. No real network is allowed.
const ORIGIN = 'https://inno.test';
const ACCESS_TOKEN = 'conformance-access-token-0123456789abcdef';
const tempRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.inno/tmp');
const noNetwork = async () => { throw new Error('conformance forbids external network'); };
const LOST = 'result response lost';

// Bounded waits: a broken adapter fails the check instead of hanging the suite.
async function within(promise, label, ms = 5000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out waiting for ' + label)), ms); })]); }
  finally { clearTimeout(timer); }
}

async function until(predicate, label, ms = 3000) {
  const end = Date.now() + ms;
  while (!(await predicate())) {
    if (Date.now() > end) throw new Error('timed out waiting for ' + label);
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}

function workerHarness(t, {fetchFn = noNetwork, env = {}, deliveryReceiptVersion = 0} = {}) {
  // Harness parts close first (registration order), then the database.
  const DB = new TestD1(), closers = [];
  t.after(async () => { for (const close of closers) await close(); DB.close(); });
  const store = new D1TaskStore(DB), worker = createWorker({fetchFn, deliveryReceiptVersion});
  const workerEnv = {DB, ACCESS_TOKEN, ...env};
  const send = (url, init) => worker.fetch(new Request(url, init), workerEnv);
  const call = (route, body) => send(ORIGIN + route, {method: 'POST', headers: {authorization: 'Bearer ' + ACCESS_TOKEN, 'content-type': 'application/json'}, body: JSON.stringify(body)});
  // A running desktop renews its lease (a new task version) concurrently; retry a lost race.
  const action = async (id, name) => {
    for (let attempt = 0; ; attempt++) {
      const task = await store.requireTask(id);
      const response = await call(`/api/tasks/${id}/actions`, {action: name, expectedVersion: task.version});
      if (response.status === 409 && attempt < 5) continue;
      assert.equal(response.status, 200, name);
      return store.requireTask(id);
    }
  };
  return {
    store, send, call, action, onClose: close => closers.push(close),
    async create(prompt, {sources = []} = {}) {
      return (await (await call('/api/tasks', {prompt, attachments: sources.map((name, index) => ({id: `source-${index}`, name, source: 'file'}))})).json()).task;
    },
    read: id => store.requireTask(id),
    pause: id => action(id, 'pause'),
    // Plugins are seeded as already reviewed and approved; selection and disabling use the user API.
    async installPlugin(name) {
      const marker = `conformance-plugin-marker-${name}`;
      const files = [{path: 'SKILL.md', text: `---\nname: ${name}\ndescription: Conformance plugin.\n---\n\n${marker}\n`}];
      const built = await buildPluginRecord({source: {catalog: 'anthropics', path: `skills/${name}`, commit: '0'.repeat(40)}, files, now: store.now()});
      const record = approvePlugin(built, {contentHash: built.contentHash, now: store.now()});
      await store.db.batch([
        store.db.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2)').bind('plugin:' + record.id, JSON.stringify(record)),
        store.db.prepare('INSERT INTO metadata(key,value) VALUES(?1,?2)').bind('plugin_content:' + record.id, JSON.stringify({contentHash: record.contentHash, files})),
      ]);
      return {id: record.id, contentHash: record.contentHash, marker};
    },
    async selectPlugins(id, plugins) {
      const task = await store.requireTask(id);
      assert.equal((await call(`/api/tasks/${id}/plugins`, {expectedVersion: task.version, plugins})).status, 200);
    },
    async disablePlugin(id) { assert.equal((await call('/api/plugins/disable', {id})).status, 200); },
    async dump() {
      const rows = [];
      for (const table of ['tasks', 'usage', 'metadata']) rows.push(...(await DB.prepare(`SELECT * FROM ${table}`).all()).results);
      return JSON.stringify(rows);
    },
  };
}

// Codex: desktop connector (file outbox, workspace binding; delivery receipts at
// the given protocol version) -> real Codex runner with the production prompt
// mode -> fake CLI process that answers when released. Version 0 is the
// production gate today; version 1 loses each first result response so the
// resend goes through a connector restart, receipt replay and acknowledgment.
export async function createCodexHarness(t, {receipts = 0} = {}) {
  const API_KEY = 'sk-conformance-openai-secret-0123456789abcdef';
  await mkdir(tempRoot, {recursive: true});
  const dir = await mkdtemp(path.join(tempRoot, 'conformance-codex-'));
  const base = workerHarness(t, {deliveryReceiptVersion: receipts});
  const outbound = [], children = [], completions = new Map(), lostOnce = new Set();
  let forging = false;
  const request = createCloudRequest({endpoint: ORIGIN, token: ACCESS_TOKEN, fetchFn: async (url, init) => {
    const complete = url.pathname.endsWith('/complete') && !forging, taskId = decodeURIComponent(url.pathname.split('/')[3]);
    if (complete) completions.set(taskId, init);
    const response = await base.send(url.toString(), init);
    if (receipts === 1 && complete && response.ok && !lostOnce.has(taskId)) { lostOnce.add(taskId); throw new Error(LOST); }
    return response;
  }});
  const readDeliveryBinding = async () => ({origin: ORIGIN, workspaceId: (await request('/api/desktop/identity')).workspaceId});
  const spawnProcess = (_command, args, options) => {
    // A runner that passes no env lets the process inherit everything; record that too.
    outbound.push(JSON.stringify(args), JSON.stringify(options?.env ?? process.env));
    const child = new EventEmitter();
    children.push(child);
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.prompt = null; child.closed = false;
    const close = (code, signal) => { if (child.closed) return; child.closed = true; child.stdout.end(); child.stderr.end(); child.emit('close', code, signal); };
    child.kill = () => { child.killed = true; setImmediate(() => close(null, 'SIGTERM')); return true; };
    let input = '';
    child.stdin.on('data', chunk => { input += chunk; });
    child.stdin.on('finish', () => { child.prompt = input; outbound.push(input); });
    child.release = ({content, usage, fail}) => {
      if (child.closed) return;
      if (fail) { child.stderr.write('Error: Not logged in. Run codex login.\n'); return close(1, null); }
      if (usage) child.stdout.write(JSON.stringify({type: 'turn.completed', usage: {input_tokens: usage.inputTokens, output_tokens: usage.outputTokens}}) + '\n');
      child.stdout.write(JSON.stringify({type: 'item.completed', item: {type: 'agent_message', text: JSON.stringify({summary: content})}}) + '\n');
      close(0, null);
    };
    return child;
  };
  const runner = createCodexRunner({spawnProcess, cwd: dir, managedDelivery: true, processEnv: {PATH: process.env.PATH ?? '', OPENAI_API_KEY: API_KEY}, modelCatalog: async () => []});
  const errors = [];
  const connector = () => createDesktopBridge({deliveryReceiptVersion: receipts, request, outbox: createFileOutbox(path.join(dir, 'pending.json')), readDeliveryBinding, runner, heartbeatMs: 5, onError: error => errors.push(error)});
  let bridge = connector();
  const settle = () => within(bridge.settled(), 'the desktop connector to settle');
  base.onClose(async () => {
    bridge.stop();
    for (const child of children) child.release({fail: true});
    await settle().catch(() => {});
    await rm(dir, {recursive: true, force: true});
  });
  // After a lost response the version 1 connector pauses for recovery; restarting it
  // replays the outbox (receipt replay, then acknowledgment) before new work.
  const recoverPending = async () => {
    if (receipts !== 1 || !bridge.status().pending) return;
    bridge.stop(); await settle().catch(() => {});
    bridge = connector(); await within(bridge.tick(), 'the restarted connector to replay'); await settle();
  };
  async function start(task, {materials = [], content, usage} = {}) {
    await recoverPending();
    const before = children.length;
    await bridge.startTask(task.id, {expectedVersion: task.version, materials});
    await until(() => children.length > before && children.at(-1).prompt !== null, 'the Codex process to receive its prompt');
    const child = children.at(-1), running = await base.read(task.id);
    return {taskId: task.id, executionId: running.checkpoint.executionId, generation: running.checkpoint.generation, prompt: child.prompt, child, content, usage};
  }
  // A stale or forged desktop posts through the same authenticated transport and protocol
  // version. Only an ownership conflict (409) counts as a refusal; anything else is a harness fault.
  async function post(owner, overrides) {
    const {workspaceId} = await readDeliveryBinding();
    const body = {executionId: overrides.executionId ?? owner.executionId, generation: overrides.generation ?? owner.generation, content: owner.content ?? 'Late answer', ...(overrides.usage ? {usage: overrides.usage} : {})};
    forging = true;
    try { await request(`/api/desktop/${encodeURIComponent(owner.taskId)}/complete`, body, {workspaceId, ...(receipts === 1 ? {deliveryReceiptVersion: 1} : {})}); return {accepted: true}; }
    catch (error) { if (error?.status === 409) return {accepted: false}; throw error; }
    finally { forging = false; }
  }
  return {
    ...base, provider: 'codex', secrets: [ACCESS_TOKEN, API_KEY], outbound: () => outbound,
    launch: start,
    async deliver(owner, overrides = {}) {
      if (Object.keys(overrides).length || owner.child.closed && !owner.delivered) return post(owner, overrides);
      if (!owner.delivered) {
        owner.delivered = true;
        const seen = errors.length;
        owner.child.release({content: owner.content, usage: owner.usage});
        await settle();
        const unexpected = errors.slice(seen).filter(error => error?.message !== LOST);
        if (unexpected.length) throw unexpected[0];
        const task = await base.read(owner.taskId);
        return {accepted: task.status === 'completed' && task.checkpoint.executionId === owner.executionId && task.checkpoint.generation === owner.generation};
      }
      // A resend after a lost response: version 1 restarts the connector, which replays
      // the outbox record; version 0 posts the exact recorded request again.
      if (receipts === 1) {
        if (!bridge.status().pending) return {accepted: false};
        try { await recoverPending(); } catch { return {accepted: false}; }
        return {accepted: !bridge.status().pending};
      }
      const sent = completions.get(owner.taskId);
      return {accepted: !!sent && (await base.send(`${ORIGIN}/api/desktop/${encodeURIComponent(owner.taskId)}/complete`, sent)).ok};
    },
    async restart(taskId, options = {}) {
      await settle();
      return start(await base.action(taskId, 'resume'), options);
    },
    async launchFailing(task) {
      const owner = await start(task);
      owner.child.release({fail: true});
      await settle();
      return owner;
    },
    async terminated(owner) {
      try { await until(() => owner.child.killed === true && owner.child.closed, 'the stopped Codex process to terminate'); } catch { return false; }
      await settle();
      return true;
    },
  };
}

// Claude: Worker /run -> real Routine adapter (fake fire API) -> MCP checkpoint_task
// built with the repository helper and the scoped capability found in the prompt.
export async function createClaudeHarness(t) {
  const ROUTINE_TOKEN = 'conformance-routine-token-secret-0123456789';
  const outbound = [];
  let rejectNext = false;
  const fetchFn = async (url, init) => {
    assert.equal(String(url), 'https://api.anthropic.com/v1/fire');
    outbound.push(String(init.body));
    if (rejectNext) { rejectNext = false; return Response.json({error: 'unauthorized'}, {status: 401}); }
    return Response.json({claude_code_session_id: 'conformance-session', claude_code_session_url: 'https://claude.ai/code/conformance-session'});
  };
  const base = workerHarness(t, {fetchFn, env: {CLAUDE_ROUTINE_URL: 'https://api.anthropic.com/v1/fire', CLAUDE_ROUTINE_TOKEN: ROUTINE_TOKEN}});
  async function start(task, {materials = [], content, usage} = {}) {
    assert.equal((await base.call(`/api/tasks/${task.id}/run`, {provider: 'claude', expectedVersion: task.version, materials})).status, 202);
    const prompt = JSON.parse(outbound.at(-1)).text, current = await base.read(task.id);
    return {taskId: task.id, executionId: current.checkpoint.executionId, generation: current.checkpoint.generation, prompt, capability: /Capability: (\S+)/.exec(prompt)?.[1], content, usage};
  }
  return {
    ...base, provider: 'claude', secrets: [ACCESS_TOKEN, ROUTINE_TOKEN], outbound: () => outbound,
    launch: start,
    async deliver(owner, {executionId = owner.executionId, generation = owner.generation, usage = owner.usage} = {}) {
      const request = prepareRequest('checkpoint_task', {taskId: owner.taskId, executionId, generation, status: 'completed', content: owner.content, ...(usage ? {usage} : {}), executionCapability: owner.capability}, `${ORIGIN}/mcp`);
      const response = await base.send(`${ORIGIN}/mcp`, {method: 'POST', headers: {authorization: 'Bearer ' + ACCESS_TOKEN, 'content-type': 'application/json'}, body: request.input});
      const body = await response.json();
      return {accepted: response.status === 200 && !body.error && body.result?.isError !== true};
    },
    async restart(taskId, options = {}) {
      const stopped = await base.read(taskId);
      const response = await base.call(`/api/tasks/${taskId}/execution/recover`, {confirmedStopped: true, expectedVersion: stopped.version, executionId: stopped.checkpoint.executionId, generation: stopped.checkpoint.generation});
      assert.equal(response.status, 200, 'confirmed recovery');
      return start(await base.read(taskId), options);
    },
    async launchFailing(task) { rejectNext = true; return start(task); },
  };
}

export const PROVIDER_HARNESSES = Object.freeze({codex: createCodexHarness, claude: createClaudeHarness});
