import {officeFixture} from './helpers/office.mjs';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { test } from 'node:test';

import { createInnoServer } from '../server/http.mjs';
import { localOnboardingUrl, readServerConfig } from '../server/config.mjs';
import { createClaudeRoutineRunner, createCodexRunner } from '../server/runners.mjs';
import { SqliteTaskStore } from '../server/store.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createWorker } from '../worker/index.mjs';
import { D1_SCHEMA, D1TaskStore } from '../worker/store.mjs';

async function fixture(options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'inno-server-'));
  const databasePath = path.join(directory, 'tasks.sqlite');
  const store = new SqliteTaskStore(databasePath, options.now ? {now: options.now} : {});
  const instance = createInnoServer({
    store,
    token: 'test-token-0123456789abcdef',
    corsOrigins: ['https://workspace.example'],
    publicDir: path.join(directory, 'public'),
    ...options,
  });
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  const {port} = instance.server.address();
  return {
    ...instance,
    directory,
    databasePath,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise(resolve => instance.server.close(resolve));
      store.close();
      await rm(directory, {recursive: true, force: true});
    },
  };
}

async function json(response) {
  const body = await response.json();
  return {response, body};
}

async function waitFor(check, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('timed out waiting for state');
}

const auth = {authorization: 'Bearer test-token-0123456789abcdef', 'content-type': 'application/json'};

test('health is public while state and mutation routes require the bearer token', async t => {
  const app = await fixture();
  t.after(() => app.close());

  assert.equal((await fetch(`${app.baseUrl}/api/health`)).status, 200);
  assert.equal((await fetch(`${app.baseUrl}/api/state`)).status, 401);
  const state = await json(await fetch(`${app.baseUrl}/api/state`, {headers: auth}));
  assert.equal(state.response.status, 200);
  assert.deepEqual(state.body.tasks, []);
  assert.deepEqual(state.body.usage, []);
  assert.equal(state.body.capabilities.connected, true);
});

test('CORS only reflects configured origins', async t => {
  const app = await fixture();
  t.after(() => app.close());

  const allowed = await fetch(`${app.baseUrl}/api/health`, {headers: {origin: 'https://workspace.example'}});
  const denied = await fetch(`${app.baseUrl}/api/health`, {headers: {origin: 'https://attacker.example'}});
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://workspace.example');
  assert.equal(denied.headers.has('access-control-allow-origin'), false);
});

test('static serving rejects a junction that resolves outside the public directory', async t => {
  const app = await fixture();
  t.after(() => app.close());
  const publicDir = path.join(app.directory, 'public');
  const outsideDir = path.join(app.directory, 'outside');
  await mkdir(publicDir, {recursive: true});
  await mkdir(outsideDir, {recursive: true});
  await writeFile(path.join(outsideDir, 'secret.txt'), 'outside-public-root');
  await symlink(outsideDir, path.join(publicDir, 'escape'), 'junction');

  const response = await fetch(`${app.baseUrl}/escape/secret.txt`);
  assert.equal(response.status, 404);
  assert.equal((await response.text()).includes('outside-public-root'), false);
});

test('task writes are durable, metadata-only, and reject stale actions', async t => {
  const app = await fixture();
  t.after(() => app.close());

  const created = await json(await fetch(`${app.baseUrl}/api/tasks`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      prompt: 'Inspect source',
      type: 'analysis',
      attachments: [{id: 'a', name: 'source.txt', path: 'source.txt', size: 9, lastModified: 1, type: 'text/plain', source: 'file', content: 'never-store-this'}],
    }),
  }));
  assert.equal(created.response.status, 201);
  assert.equal(JSON.stringify(created.body).includes('never-store-this'), false);

  const stale = await fetch(`${app.baseUrl}/api/tasks/${created.body.task.id}/actions`, {
    method: 'POST', headers: auth, body: JSON.stringify({action: 'pause', expectedVersion: 0}),
  });
  assert.equal(stale.status, 409);

  const rawDatabase = await readFile(app.databasePath);
  assert.equal(rawDatabase.includes(Buffer.from('never-store-this')), false);
});

test('run validates capability and records a waiting state when no provider is connected', async t => {
  const app = await fixture({runners: {}});
  t.after(() => app.close());
  const created = await json(await fetch(`${app.baseUrl}/api/tasks`, {
    method: 'POST', headers: auth, body: JSON.stringify({prompt: 'Run me'}),
  }));
  const result = await json(await fetch(`${app.baseUrl}/api/tasks/${created.body.task.id}/run`, {
    method: 'POST', headers: auth, body: JSON.stringify({provider: 'codex', materials: [], expectedVersion: 1}),
  }));

  assert.equal(result.response.status, 503);
  assert.equal(result.body.task.status, 'waiting_connection');
  assert.match(result.body.error, /codex|connected|available/i);
});

test('run passes transient materials to the runner and stores only the generated answer', async t => {
  let received;
  const runner = {
    available: async () => true,
    run: async input => {
      received = input;
      return {content: 'Grounded result', usage: {inputTokens: 12, outputTokens: 3}};
    },
  };
  const app = await fixture({runners: {codex: runner}});
  t.after(() => app.close());
  const created = await json(await fetch(`${app.baseUrl}/api/tasks`, {
    method: 'POST', headers: auth, body: JSON.stringify({prompt: 'Analyze source'}),
  }));
  const result = await json(await fetch(`${app.baseUrl}/api/tasks/${created.body.task.id}/run`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({provider: 'codex', expectedVersion: 1, materials: [{name: 'source.txt', text: 'transient-secret'}]}),
  }));

  assert.equal(result.response.status, 202);
  assert.equal(received.materials[0].text, 'transient-secret');
  assert.equal(result.body.task.status, 'running');
  const completed = await waitFor(() => {
    const task = app.store.getTask(created.body.task.id);
    return task.status === 'completed' ? task : null;
  });
  assert.equal(completed.messages.at(-1).content, 'Grounded result');
  assert.equal(completed.artifacts.at(-1).content, 'Grounded result');
  assert.equal(completed.artifacts.at(-1).mime, 'text/markdown');
  assert.equal(JSON.stringify(completed).includes('transient-secret'), false);
});

test('cancelling an in-flight run prevents its late result from overwriting the task', async t => {
  let start;
  const started = new Promise(resolve => { start = resolve; });
  let finish;
  const blocked = new Promise(resolve => { finish = resolve; });
  const runner = {
    available: async () => true,
    run: async () => {
      start();
      await blocked;
      return {content: 'late answer',usage:{inputTokens:99,outputTokens:1}};
    },
  };
  const app = await fixture({runners: {codex: runner}});
  t.after(() => app.close());
  const created = await json(await fetch(`${app.baseUrl}/api/tasks`, {
    method: 'POST', headers: auth, body: JSON.stringify({prompt: 'Long run'}),
  }));
  const runResponse = fetch(`${app.baseUrl}/api/tasks/${created.body.task.id}/run`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({provider: 'codex', expectedVersion: 1, materials: []}),
  });
  const accepted = await Promise.race([
    runResponse,
    new Promise((_, reject) => setTimeout(() => reject(new Error('run acknowledgement was not immediate')), 250)),
  ]);
  assert.equal(accepted.status, 202);
  await started;

  const cancelled = await json(await fetch(`${app.baseUrl}/api/tasks/${created.body.task.id}/actions`, {
    method: 'POST', headers: auth, body: JSON.stringify({action: 'cancel', expectedVersion: 2}),
  }));
  assert.equal(cancelled.body.task.status, 'cancelled');
  finish();

  await new Promise(resolve => setTimeout(resolve, 10));
  const persisted = app.store.getTask(created.body.task.id);
  assert.equal(persisted.status, 'cancelled');
  assert.equal(JSON.stringify(persisted).includes('late answer'), false);
  assert.deepEqual(app.store.getState().usage, []);
});

test('a new message during a run supersedes and blocks the stale result', async t => {
  let finish;
  const blocked = new Promise(resolve => { finish = resolve; });
  const runner = {available: async () => true, run: async () => { await blocked; return {content: 'old answer'}; }};
  const app = await fixture({runners: {codex: runner}});
  t.after(() => app.close());
  const created = await json(await fetch(`${app.baseUrl}/api/tasks`, {
    method: 'POST', headers: auth, body: JSON.stringify({prompt: 'First request'}),
  }));
  const accepted = await fetch(`${app.baseUrl}/api/tasks/${created.body.task.id}/run`, {
    method: 'POST', headers: auth, body: JSON.stringify({provider: 'codex', expectedVersion: 1, materials: []}),
  });
  assert.equal(accepted.status, 202);
  const revised = await json(await fetch(`${app.baseUrl}/api/tasks/${created.body.task.id}/actions`, {
    method: 'POST', headers: auth, body: JSON.stringify({action: 'message', expectedVersion: 2, content: 'Use the revised method'}),
  }));
  assert.equal(revised.body.task.status, 'ready');
  finish();
  await new Promise(resolve => setTimeout(resolve, 10));
  const persisted = app.store.getTask(created.body.task.id);
  assert.equal(persisted.messages.at(-1).content, 'Use the revised method');
  assert.equal(JSON.stringify(persisted).includes('old answer'), false);
});

test('expired execution leases may be reclaimed but active leases have one owner', async t => {
  let now = Date.parse('2026-09-13T00:00:00Z');
  const app = await fixture({now: () => new Date(now).toISOString()});
  t.after(() => app.close());
  const task = app.store.createTask({prompt: 'Lease me'});

  const first = app.store.claimExecution(task.id, {provider: 'codex', expectedVersion: 1, leaseMs: 1_000});
  assert.throws(
    () => app.store.claimExecution(task.id, {provider: 'claude', expectedVersion: first.task.version, leaseMs: 1_000}),
    /owned|lease|running/i,
  );
  now += 1_001;
  const second = app.store.claimExecution(task.id, {provider: 'claude', expectedVersion: first.task.version, leaseMs: 1_000});
  assert.equal(second.generation, first.generation + 1);

  assert.throws(
    () => app.store.finishExecution(task.id, {executionId: first.executionId, generation: first.generation, content: 'stale'}),
    /stale|owner|execution/i,
  );
});

test('Codex runner uses stdin without a shell, strips API credentials, and parses usage events', async () => {
  let invocation;
  let stdin = '';
  const spawnProcess = (command, args, options) => {
    invocation = {command, args, options};
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({write(chunk, encoding, callback) { stdin += chunk.toString(); callback(); }});
    child.kill = () => true;
    queueMicrotask(() => {
      child.stdout.write('{"type":"thread.started","thread_id":"thread-1"}\n');
      child.stdout.write('{"type":"item.completed","item":{"type":"agent_message","text":"Verified answer"}}\n');
      child.stdout.write('{"type":"turn.completed","usage":{"input_tokens":17,"cached_input_tokens":12,"output_tokens":5}}\n');
      child.stdout.end();
      child.emit('close', 0, null);
    });
    return child;
  };
  const runner = createCodexRunner({
    spawnProcess,
    cwd: 'C:\\workspace',
    runDirectory: () => 'C:\\workspace\\run-t1',
    ensureDirectory: () => {},
    mcpUrl: 'http://127.0.0.1:4173/mcp',
    mcpToken: 'mcp-secret-token-0123456789abcdef',
    processEnv: {PATH: 'bin', CODEX_HOME: 'auth-home', OPENAI_API_KEY: 'remove', ANTHROPIC_API_KEY: 'remove-too'},
    availability: async () => true,
  });
  const result = await runner.run({
    task: {
      id: 't1', title: 'Review', prompt: 'Review the evidence', type: 'literature', plan: [],
      messages: [
        {role: 'user', content: 'Review the evidence'},
        {role: 'assistant', content: 'Earlier draft'},
        {role: 'user', content: 'Focus the revision on methods'},
      ],
      checkpoint: {content: 'Sources already collected'},
    },
    materials: [{name: 'paper.txt', text: 'evidence'}],
  });

  assert.equal(result.usage.cachedInputTokens, 12);
  assert.equal(invocation.command, 'codex');
  assert.deepEqual(invocation.args, [
    'exec', '--json', '--color', 'never', '--approve-for-me',
    '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--disable', 'multi_agent',
    '-c', 'mcp_servers.inno.url="http://127.0.0.1:4173/mcp"',
    '-c', 'mcp_servers.inno.bearer_token_env_var="INNO_MCP_TOKEN"', '-'
  ]);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.cwd, 'C:\\workspace\\run-t1');
  assert.equal(invocation.options.env.OPENAI_API_KEY, undefined);
  assert.equal(invocation.options.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(invocation.options.env.CODEX_HOME, 'auth-home');
  assert.equal(invocation.options.env.INNO_MCP_TOKEN, 'mcp-secret-token-0123456789abcdef');
  assert.equal(invocation.args.join(' ').includes('mcp-secret-token'), false);
  assert.match(stdin, /DELIVERY AND VERIFICATION/);
  assert.match(stdin, /Distinguish abstract-only/);
  assert.match(stdin, /Review the evidence/);
  assert.match(stdin, /Focus the revision on methods/);
  assert.match(stdin, /Sources already collected/);
  assert.match(stdin, /paper\.txt/);
  assert.match(stdin, /evidence/);
  assert.equal(result.content, 'Verified answer');
  assert.deepEqual(result.usage, {inputTokens: 17, cachedInputTokens: 12, outputTokens: 5, source: 'codex_exec'});
});

test('Codex capability requires subscription login rather than an API-key login', async () => {
  let loginText = 'Logged in using API key';
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    queueMicrotask(() => { child.stdout.end(loginText); child.emit('close', 0, null); });
    return child;
  };
  const runner = createCodexRunner({spawnProcess, processEnv: {PATH: 'bin'}});
  assert.equal(await runner.available(), false);
  loginText = 'Logged in using ChatGPT';
  assert.equal(await runner.available(), true);
});

test('Codex runner extracts validated structured generated artifacts when supplied', async () => {
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => true;
    queueMicrotask(() => {
      child.stdout.write(`${JSON.stringify({
        type: 'item.completed',
        item: {type: 'agent_message', text: JSON.stringify({
          summary: 'Report generated',
          checkpoint: 'Reviewed and rendered',
          artifacts: [{name: 'report.md', mime: 'text/markdown', content: '# Verified report', encoding: 'utf-8', checks:[{check:'render',status:'not_run',evidence:'Text draft only'}]}],
        })},
      })}\n`);
      child.stdout.end();
      child.emit('close', 0, null);
    });
    return child;
  };
  const runner = createCodexRunner({spawnProcess, availability: async () => true});
  const result = await runner.run({
    task: {id: 't1', title: 'Report', prompt: 'Create report', type: 'writing', plan: []}, materials: [],
  });

  assert.equal(result.content, 'Report generated');
  assert.equal(result.checkpoint, 'Reviewed and rendered');
  assert.deepEqual(result.artifacts.slice(0,1), [{name: 'report.md', mime: 'text/markdown', content: '# Verified report', encoding: 'utf-8', checks:[{check:'render',status:'not_run',evidence:'Text draft only'}]}]);
});

test('Codex runner reads a real generated file from its isolated run directory', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'inno-codex-output-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  await mkdir(path.join(directory, 'output'));
  const officeBytes=await officeFixture();
  await writeFile(path.join(directory, 'output', 'report.docx'), officeBytes);
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => true;
    queueMicrotask(() => {
      child.stdout.write(`${JSON.stringify({type: 'item.completed', item: {type: 'agent_message', text: JSON.stringify({
        summary: 'Document generated', artifacts: [{name: 'report.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', path: 'output/report.docx'}],
      })}})}\n`);
      child.stdout.end(); child.emit('close', 0, null);
    });
    return child;
  };
  const runner = createCodexRunner({spawnProcess, runDirectory: () => directory, ensureDirectory: () => {}, availability: async () => true});
  const result = await runner.run({task: {id: 't', title: 'Doc', prompt: 'Make docx', type: 'writing', plan: []}, materials: []});

  assert.equal(result.artifacts[0].encoding, 'base64');
  assert.deepEqual(Buffer.from(result.artifacts[0].content, 'base64'), Buffer.from(officeBytes));
  assert.equal('path' in result.artifacts[0], false);
});

test('Codex runner rejects generated artifact paths outside the isolated run directory', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'inno-codex-traversal-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => true;
    queueMicrotask(() => {
      child.stdout.write(`${JSON.stringify({type: 'item.completed', item: {type: 'agent_message', text: JSON.stringify({
        summary: 'Unsafe', artifacts: [{name: 'escape.txt', mime: 'text/plain', path: '../escape.txt'}],
      })}})}\n`);
      child.stdout.end(); child.emit('close', 0, null);
    });
    return child;
  };
  const runner = createCodexRunner({spawnProcess, runDirectory: () => directory, ensureDirectory: () => {}, availability: async () => true});
  await assert.rejects(
    runner.run({task: {id: 't', title: 'Unsafe', prompt: 'Unsafe', type: 'general', plan: []}, materials: []}),
    /outside the isolated run directory/i,
  );
});

test('Claude Routine runner calls the documented fire endpoint with server-side bearer auth', async () => {
  let request;
  const runner = createClaudeRoutineRunner({
    url: 'https://api.anthropic.com/v1/claude_code/routines/trig_123/fire',
    token: 'routine-secret',
    fetchFn: async (url, options) => {
      request = {url, options};
      return new Response(JSON.stringify({
        type: 'routine_fire',
        claude_code_session_id: 'session_123',
        claude_code_session_url: 'https://claude.ai/code/session_123',
      }), {status: 200, headers: {'content-type': 'application/json'}});
    },
  });
  const result = await runner.run({
    task: {id: 't1', title: 'Review', prompt: 'Review the evidence', type: 'literature', plan: []},
    materials: [{name: 'paper.txt', text: 'transient evidence'}],
  });

  assert.equal(request.url, 'https://api.anthropic.com/v1/claude_code/routines/trig_123/fire');
  assert.match(JSON.parse(request.options.body).text, /CLAUDE MASTER-FIRST/);
  assert.equal(request.options.headers.authorization, 'Bearer routine-secret');
  assert.equal(request.options.headers['anthropic-beta'], 'experimental-cc-routine-2026-04-01');
  assert.equal(request.options.headers['anthropic-version'], '2023-06-01');
  assert.match(JSON.parse(request.options.body).text, /transient evidence/);
  assert.equal(result.sessionUrl, 'https://claude.ai/code/session_123');
});

test('MCP exposes authenticated task tools and enforces execution ownership on writes', async t => {
  const app = await fixture();
  t.after(() => app.close());
  const task = app.store.createTask({prompt: 'MCP task'});

  const unauthorized = await fetch(`${app.baseUrl}/mcp`, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list'}),
  });
  assert.equal(unauthorized.status, 401);

  const listed = await json(await fetch(`${app.baseUrl}/mcp`, {
    method: 'POST', headers: auth, body: JSON.stringify({jsonrpc: '2.0', id: 2, method: 'tools/list'}),
  }));
  assert.equal(listed.response.status, 200);
  assert.ok(listed.body.result.tools.some(tool => tool.name === 'list_tasks'));
  assert.ok(listed.body.result.tools.some(tool => tool.name === 'claim_execution'));
  assert.ok(listed.body.result.tools.some(tool => tool.name === 'checkpoint_task'));

  const claimed = await json(await fetch(`${app.baseUrl}/mcp`, {
    method: 'POST', headers: auth, body: JSON.stringify({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: {name: 'claim_execution', arguments: {taskId: task.id, provider: 'claude', expectedVersion: 1, leaseMs: 60_000}},
    }),
  }));
  const ownership = JSON.parse(claimed.body.result.content[0].text);
  assert.equal(ownership.task.status, 'running');

  const stale = await json(await fetch(`${app.baseUrl}/mcp`, {
    method: 'POST', headers: auth, body: JSON.stringify({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: {name: 'checkpoint_task', arguments: {taskId: task.id, executionId: 'wrong', generation: ownership.generation, content: 'late'}},
    }),
  }));
  assert.equal(stale.body.result.isError, true);
  assert.equal(JSON.stringify(app.store.getTask(task.id)).includes('late'), false);

  const written = await json(await fetch(`${app.baseUrl}/mcp`, {
    method: 'POST', headers: auth, body: JSON.stringify({
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: {name: 'checkpoint_task', arguments: {...ownership, task: undefined, taskId: task.id, content: 'evidence collected'}},
    }),
  }));
  assert.equal(written.body.result.isError, undefined);
  assert.equal(app.store.getTask(task.id).checkpoint.content, 'evidence collected');

  const completed = await json(await fetch(`${app.baseUrl}/mcp`, {
    method: 'POST', headers: auth, body: JSON.stringify({
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: {name: 'checkpoint_task', arguments: {
        taskId: task.id, executionId: ownership.executionId, generation: ownership.generation,
        content: 'review verified', status: 'completed', summary: 'Cloud review complete',
      }},
    }),
  }));
  assert.equal(completed.body.result.isError, undefined);
  const finalTask = app.store.getTask(task.id);
  assert.equal(finalTask.status, 'completed');
  assert.equal(finalTask.messages.at(-1).content, 'Cloud review complete');

  const decisionTask = app.store.createTask({prompt: 'Choose method'});
  const decisionClaim = app.store.claimExecution(decisionTask.id, {provider: 'claude', expectedVersion: 1, leaseMs: 60_000});
  const invalidDecision = await json(await fetch(`${app.baseUrl}/mcp`, {
    method: 'POST', headers: auth, body: JSON.stringify({
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: {name: 'request_decision', arguments: {
        taskId: decisionTask.id, executionId: decisionClaim.executionId, generation: decisionClaim.generation,
        prompt: 'Which method?', options: [{label: 'Only option', pros: 'fast', cons: 'biased'}],
      }},
    }),
  }));
  assert.equal(invalidDecision.body.result.isError, true);
  assert.equal(app.store.getTask(decisionTask.id).status, 'running');

  const requested = await json(await fetch(`${app.baseUrl}/mcp`, {
    method: 'POST', headers: auth, body: JSON.stringify({
      jsonrpc: '2.0', id: 8, method: 'tools/call',
      params: {name: 'request_decision', arguments: {
        taskId: decisionTask.id, executionId: decisionClaim.executionId, generation: decisionClaim.generation,
        prompt: 'Which method?', options: [
          {label: 'Method A', pros: 'Faster', cons: 'Less precise'},
          {label: 'Method B', pros: 'More precise', cons: 'Slower'},
        ],
      }},
    }),
  }));
  assert.equal(requested.body.result.isError, undefined);
  const waiting = app.store.getTask(decisionTask.id);
  assert.equal(waiting.status, 'waiting_user');
  assert.equal(waiting.decision.options[1].pros, 'More precise');
  assert.equal(waiting.checkpoint.status, 'waiting_user');
});

class TestD1Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new TestD1Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return {success: true, results: this.database.prepare(this.sql).all(...this.values)}; }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return {success: true, results: [], meta: {changes: Number(result.changes)}};
  }
}

class TestD1Database {
  constructor() { this.database = new DatabaseSync(':memory:'); this.database.exec(D1_SCHEMA); }
  prepare(sql) { return new TestD1Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

test('D1 adapter uses the shared reducer and compare-and-swap versions', async () => {
  const store = new D1TaskStore(new TestD1Database(), {
    now: () => '2026-09-13T00:00:00.000Z',
    id: (() => { let id = 0; return () => `d1-${++id}`; })(),
  });
  const task = await store.createTask({
    prompt: 'Cloud task',
    attachments: [{id: 'a', name: 'input.txt', path: 'input.txt', size: 6, lastModified: 1, type: 'text/plain', source: 'file', content: 'cloud-secret'}],
  });
  assert.equal(JSON.stringify(task).includes('cloud-secret'), false);

  const paused = await store.applyAction(task.id, {action: 'pause', expectedVersion: 1});
  assert.equal(paused.version, 2);
  await assert.rejects(
    store.applyAction(task.id, {action: 'resume', expectedVersion: 1}),
    /version|conflict/i,
  );
  const state = await store.getState({localCodex: false, claudeRoutine: true, cloud: true, connected: true});
  assert.equal(state.revision, 2);
  assert.equal(state.tasks[0].status, 'paused');
});

test('Worker serves the shared authenticated API and dispatches configured Claude Routine', async () => {
  const database = new TestD1Database();
  let routineRequest;
  const worker = createWorker({fetchFn: async (url, options) => {
    routineRequest = {url, options};
    return Response.json({
      type: 'routine_fire', claude_code_session_id: 'session-cloud',
      claude_code_session_url: 'https://claude.ai/code/session-cloud',
    });
  }});
  const env = {
    DB: database,
    ACCESS_TOKEN: 'worker-secret-token-0123456789',
    CORS_ORIGINS: 'https://workspace.example',
    CLAUDE_ROUTINE_URL: 'https://api.anthropic.com/v1/claude_code/routines/trig_cloud/fire',
    CLAUDE_ROUTINE_TOKEN: 'routine-token',
  };

  assert.equal((await worker.fetch(new Request('https://api.example/api/health'), env)).status, 200);
  assert.equal((await worker.fetch(new Request('https://api.example/api/state'), env)).status, 401);
  const headers = {authorization: 'Bearer worker-secret-token-0123456789', 'content-type': 'application/json'};
  const createdResponse = await worker.fetch(new Request('https://api.example/api/tasks', {
    method: 'POST', headers,
    body: JSON.stringify({prompt: 'Cloud review', attachments: [{name: 'x.txt', content: 'do-not-store', source: 'file'}]}),
  }), env);
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 201);
  assert.equal(JSON.stringify(created).includes('do-not-store'), false);

  const continuedResponse = await worker.fetch(new Request(`https://api.example/api/tasks/${created.task.id}/actions`, {
    method: 'POST', headers,
    body: JSON.stringify({action: 'message', expectedVersion: 1, content: 'Use the new comparison method'}),
  }), env);
  const continued = await continuedResponse.json();
  assert.equal(continued.task.version, 2);

  const pending = [];
  const runResponse = await worker.fetch(new Request(`https://api.example/api/tasks/${created.task.id}/run`, {
    method: 'POST', headers,
    body: JSON.stringify({provider: 'claude', expectedVersion: 2, materials: [{name: 'x.txt', text: 'transient cloud source'}]}),
  }), env, {waitUntil: promise => pending.push(promise)});
  const run = await runResponse.json();
  assert.equal(runResponse.status, 202);
  assert.equal(run.task.status, 'running');
  await Promise.all(pending);
  assert.match(JSON.parse(routineRequest.options.body).text, /CLAUDE MASTER-FIRST/);
  assert.match(JSON.parse(routineRequest.options.body).text, /checkpoint_task BEFORE/);
  assert.match(JSON.parse(routineRequest.options.body).text, /inno-haiku/);
  assert.match(JSON.parse(routineRequest.options.body).text, /transient cloud source/);
  assert.match(JSON.parse(routineRequest.options.body).text, /Use the new comparison method/);
  await Promise.all(pending);
  const persisted = await new D1TaskStore(database).getTask(created.task.id);
  assert.equal(persisted.checkpoint.sessionUrl, 'https://claude.ai/code/session-cloud');
  assert.equal(JSON.stringify(persisted).includes('transient cloud source'), false);
});

test('local startup config creates a strong session token and puts it only in the URL fragment', () => {
  const config = readServerConfig({}, {randomToken: () => 'generated-token-0123456789abcdef'});
  assert.equal(config.token, 'generated-token-0123456789abcdef');
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 4173);
  const url = localOnboardingUrl({...config, host: '0.0.0.0'});
  assert.equal(url, 'http://127.0.0.1:4173/#token=generated-token-0123456789abcdef');
  assert.equal(url.includes('?token='), false);
});


test('Codex nonzero JSON failure preserves quota classification without leaking diagnostic text', async () => {
 const spawnProcess=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();queueMicrotask(()=>{child.stdout.write(JSON.stringify({type:'turn.failed',usage:{input_tokens:9,cached_input_tokens:7,output_tokens:2},error:{message:'You have hit your usage limit. PRIVATE_DIAGNOSTIC'}})+'\n');child.stderr.write('PRIVATE_DIAGNOSTIC');child.emit('close',1);});return child;};
 const runner=createCodexRunner({spawnProcess,ensureDirectory:()=>{}});
 await assert.rejects(()=>runner.run({task:{id:'t',prompt:'hello'}}), e=>e.code==='QUOTA_EXCEEDED'&&e.usage.inputTokens===9&&e.usage.cachedInputTokens===7&&e.usage.outputTokens===2&&!e.message.includes('PRIVATE_DIAGNOSTIC'));
});

test('Claude authentication rejection has safe diagnostics and quota retry hint stays informational', async () => {
 for(const status of [401,429]){
  const runner=createClaudeRoutineRunner({url:'https://api.anthropic.com/v1/routines/example/fire',token:'test',fetchFn:async()=>new Response(JSON.stringify({error:{message:'PRIVATE_DIAGNOSTIC'}}),{status,headers:{'Retry-After':'60'}})});
  await assert.rejects(()=>runner.run({task:{id:'t',prompt:'hello'}}),e=>e.code===(status===429?'QUOTA_EXCEEDED':'AUTH_REQUIRED')&&!e.message.includes('PRIVATE_DIAGNOSTIC')&&(status!==429||Number.isFinite(Date.parse(e.retryNotBefore))));
 }
});

test('SQLite keeps verified checkpoint across failed execution and explicit resume', async t => {
 const app=await fixture();t.after(()=>app.close());let task=app.store.createTask({prompt:'work'});
 task=app.store.applyAction(task.id,{action:'checkpoint',expectedVersion:task.version,content:'Verified stage one'});
 const claim=app.store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version});
 task=app.store.failExecution(task.id,{...claim,failure:{kind:'quota'},error:'PRIVATE_DIAGNOSTIC',status:'waiting_quota'});
 assert.equal(task.checkpoint.content,'Verified stage one');assert.equal(task.checkpoint.failure.kind,'quota');assert.equal(JSON.stringify(task).includes('PRIVATE_DIAGNOSTIC'),false);
 task=app.store.applyAction(task.id,{action:'resume',expectedVersion:task.version});const next=app.store.claimExecution(task.id,{provider:'codex',expectedVersion:task.version});
 assert.equal(next.task.checkpoint.content,'Verified stage one');assert.equal(next.task.checkpoint.failure,undefined);
 assert.throws(()=>app.store.failExecution(task.id,{...claim,error:'late'}),/stale/);
});


test('SQLite remote session launch retains existing checkpoint',async t=>{
 const app=await fixture();t.after(()=>app.close());let task=app.store.createTask({prompt:'work'});task=app.store.applyAction(task.id,{action:'checkpoint',expectedVersion:task.version,content:'Verified stage one'});
 const c=app.store.claimExecution(task.id,{provider:'claude',expectedVersion:task.version});task=app.store.leaveExecutionRunning(task.id,{...c,sessionUrl:'https://claude.ai/code/test',checkpoint:'Session started'});
 assert.equal(task.checkpoint.content,'Verified stage one');assert.equal(task.checkpoint.sessionUrl,'https://claude.ai/code/test');
});

test('SQLite unavailable executor preserves verified progress',async t=>{const app=await fixture();t.after(()=>app.close());let task=app.store.createTask({prompt:'work'});task=app.store.applyAction(task.id,{action:'checkpoint',expectedVersion:task.version,content:'Verified stage one'});task=app.store.markWaiting(task.id,{expectedVersion:task.version,provider:'codex',reason:'unavailable'});assert.equal(task.checkpoint.content,'Verified stage one');assert.equal(task.checkpoint.failure.kind,'unavailable');});


test('plain-answer execution removes only its empty run directory',async t=>{
 const parent=await mkdtemp(path.join(tmpdir(),'inno-empty-run-'));t.after(()=>rm(parent,{recursive:true,force:true}));const directory=path.join(parent,'run');
 const spawnProcess=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();queueMicrotask(()=>{child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Verified answer'}})+'\n');child.emit('close',0);});return child;};
 const runner=createCodexRunner({spawnProcess,runDirectory:()=>directory});const result=await runner.run({task:{id:'t',prompt:'work'}});assert.equal(result.content,'Verified answer');await assert.rejects(()=>readFile(path.join(directory,'missing')),{code:'ENOENT'});const {stat}=await import('node:fs/promises');await assert.rejects(()=>stat(directory),{code:'ENOENT'});
});

test('execution retains nonempty run directory even when answer has no artifact reference',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'inno-keep-run-'));t.after(()=>rm(directory,{recursive:true,force:true}));await writeFile(path.join(directory,'work.txt'),'work in progress');
 const spawnProcess=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();queueMicrotask(()=>{child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Verified answer'}})+'\n');child.emit('close',0);});return child;};
 const runner=createCodexRunner({spawnProcess,runDirectory:()=>directory});await runner.run({task:{id:'t',prompt:'work'}});assert.equal(await readFile(path.join(directory,'work.txt'),'utf8'),'work in progress');
});

test('oversized output stops runner and waits for close before releasing execution',async()=>{
 let closed=false,killed=false;const spawnProcess=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{killed=true;setImmediate(()=>{closed=true;child.emit('close',1);});};queueMicrotask(()=>child.stdout.write('x'.repeat(16*1024*1024+1)));return child;};
 const runner=createCodexRunner({spawnProcess,ensureDirectory:()=>{}});await assert.rejects(()=>runner.run({task:{id:'t',prompt:'work'}}),{code:'OUTPUT_LIMIT'});assert.equal(killed,true);assert.equal(closed,true);
});

test('abort during output-limit teardown cannot release runner before process close',async()=>{const controller=new AbortController();let closed=false;const spawnProcess=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{queueMicrotask(()=>controller.abort());setImmediate(()=>{closed=true;child.emit('close',1);});};queueMicrotask(()=>child.stdout.write('x'.repeat(16*1024*1024+1)));return child;};const runner=createCodexRunner({spawnProcess,ensureDirectory:()=>{}});await assert.rejects(()=>runner.run({task:{id:'t',prompt:'work'},signal:controller.signal}));assert.equal(closed,true);});

test('SQLite unchanged state skips task reads and preserves changed full responses',async t=>{const app=await fixture();t.after(()=>app.close());const s=app.store.getState();const list=app.store.listTasks;app.store.listTasks=()=>{throw Error('must not read tasks');};const small=app.store.getState({localCodex:true},s.revision);assert.equal(small.unchanged,true);assert.equal(small.tasks,undefined);app.store.listTasks=list;app.store.createTask({prompt:'new'});assert.equal(app.store.getState({},s.revision).tasks.length,1);});

test('ordinary abort retains runner ownership until the child actually closes',async()=>{
 const controller=new AbortController();let closeChild,started;const ready=new Promise(resolve=>{started=resolve;});let killed=false,settled=false;
 const spawnProcess=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{killed=true;return true;};closeChild=()=>child.emit('close',null,'SIGTERM');started();return child;};
 const runner=createCodexRunner({spawnProcess,ensureDirectory:()=>{}});
 const run=runner.run({task:{id:'abort-owner',prompt:'work'},signal:controller.signal});const observed=run.then(()=>{settled=true;},e=>{settled=true;return e;});
 await ready;controller.abort();await new Promise(resolve=>setImmediate(resolve));const early=settled;closeChild();const error=await observed;
 assert.equal(killed,true);assert.equal(early,false);assert.equal(error.name,'AbortError');
});

test('failed termination signal cannot release a still-existing Codex process',async()=>{
 const controller=new AbortController();let closeChild,started;const ready=new Promise(r=>{started=r;});let settled=false;
 const runner=createCodexRunner({ensureDirectory:()=>{},spawnProcess:()=>{const child=new EventEmitter();child.pid=123;child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{child.emit('error',Error('kill failed'));return false;};closeChild=()=>child.emit('close',0);started();return child;}});
 const result=runner.run({task:{id:'failed-kill',prompt:'work'},signal:controller.signal}).catch(e=>{settled=true;return e;});await ready;controller.abort();await new Promise(setImmediate);const early=settled;closeChild();const error=await result;assert.equal(early,false);assert.equal(error.name,'AbortError');
});

import {WorkspaceClient} from '../public/core/client.mjs';
test('two HTTP clients converge after acknowledged offline write and reject a stale follow-up',async t=>{
 const app=await fixture();t.after(()=>app.close());const options={baseUrl:app.baseUrl,remote:true,token:'test-token-0123456789abcdef'};const first=new WorkspaceClient(options),second=new WorkspaceClient(options);
 await Promise.all([first.refresh(),second.refresh()]);const transport=first.request.bind(first);let failReads=true,creates=0;
 first.request=(route,input)=>{if(route==='/api/tasks'&&input)creates++;if(failReads&&route.startsWith('/api/state'))return Promise.reject(Error('simulated network outage'));return transport(route,input);};
 const task=await first.create({prompt:'independent cross-device request'});assert.equal(first.state.tasks[0].id,task.id);assert.ok(first.syncError);await second.refresh();assert.equal(second.state.tasks.length,1);
 await second.action(task.id,{action:'message',expectedVersion:task.version,content:'second device direction'});
 await assert.rejects(()=>first.action(task.id,{action:'message',expectedVersion:task.version,content:'stale first device direction'}),{status:409});
 failReads=false;await first.refresh();assert.equal(first.syncError,null);assert.equal(first.state.tasks[0].messages.at(-1).content,'second device direction');
 const current=first.state.tasks[0];await first.action(task.id,{action:'message',expectedVersion:current.version,content:'reviewed follow-up'});await second.refresh();assert.deepEqual(first.state.tasks,second.state.tasks);assert.equal(creates,1);assert.equal(second.state.tasks.length,1);
});

test('lost HTTP creation response retries after client reload without duplicating server task',async t=>{
 const app=await fixture();t.after(()=>app.close());const saved=new Map(),retryStorage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};const options={baseUrl:app.baseUrl,remote:true,token:'test-token-0123456789abcdef',retryStorage};const first=new WorkspaceClient(options),transport=first.request.bind(first);
 first.request=async(route,input)=>{const result=await transport(route,input);if(route==='/api/tasks')throw Error('response lost after server commit');return result;};
 await assert.rejects(()=>first.create({prompt:'retry after lost response'}),/response lost/);assert.equal(app.store.listTasks().length,1);const original=app.store.listTasks()[0];const second=new WorkspaceClient(options);const replay=await second.create({prompt:'retry after lost response'});assert.equal(replay.id,original.id);assert.equal(app.store.listTasks().length,1);assert.equal(second.state.tasks.length,1);assert.equal(saved.size,0);
});

test('missing ordinary source prevents Codex process spawn',async()=>{let spawned=false;const runner=createCodexRunner({spawnProcess:()=>{spawned=true;throw Error('must not spawn');},ensureDirectory:()=>{}});await assert.rejects(()=>runner.run({task:{id:'source-required',prompt:'analyze evidence',attachments:[{name:'measurements.csv',source:'file'}]},materials:[]}),/Reconnect/);assert.equal(spawned,false);});
