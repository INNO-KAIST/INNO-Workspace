import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdir, mkdtemp, readdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CLAUDE_CODE_ARGS, CLAUDE_CODE_REQUIRED_FLAGS, claudeCodeEnvironment, createClaudeCodeRunner, findClaudeCli} from '../server/claude-code-runner.mjs';
import {failureInput} from '../public/core/failures.mjs';

// CR-006 S2b: the Claude Code CLI on this PC runs a root task non-interactively with the
// person's Claude subscription login: no API key or paid path, no shell, web or MCP, no
// customizations (CLAUDE.md, hooks, plugins, settings), files only inside the run directory.
const tempRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.inno/tmp');
const CLI = 'C:\\Claude\\claude.exe';
const HELP = CLAUDE_CODE_REQUIRED_FLAGS.join('\n');

function fakeClaude({help = HELP, auth = {loggedIn: true, authMethod: 'claude.ai'}, run = () => {}, hangProbe = false} = {}) {
  const calls = [];
  const spawnProcess = (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.pid = 4242;
    const call = {command, args, options, child, prompt: null};
    calls.push(call);
    const close = (code) => { if (child.closed) return; child.closed = true; child.stdout.end(); child.stderr.end(); setImmediate(() => child.emit('close', code, null)); };
    child.kill = () => { child.killed = true; close(null); return true; };
    child.event = event => child.stdout.write(JSON.stringify(event) + '\n');
    child.finish = close;
    let input = '';
    child.stdin.on('data', chunk => { input += chunk; });
    child.stdin.on('finish', () => {
      call.prompt = input;
      if (hangProbe && args[0] !== '-p') return;
      if (args[0] === '--version') { child.stdout.write('2.1.286 (Claude Code)\n'); close(0); }
      else if (args[0] === '--help') { child.stdout.write(help); close(0); }
      else if (args[0] === 'auth') { child.stdout.write(JSON.stringify(auth)); close(auth.authMethod === 'none' ? 1 : 0); }
      else run(child, call);
    });
    return child;
  };
  return {spawnProcess, calls, runs: () => calls.filter(call => call.args[0] === '-p')};
}
const init = (extra = {}) => ({type: 'system', subtype: 'init', apiKeySource: 'none', model: 'claude-opus-5-5', permissionMode: 'dontAsk', tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'], mcp_servers: [], ...extra});
const result = (text, extra = {}) => ({type: 'result', subtype: 'success', is_error: false, result: text, num_turns: 2, usage: {input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 300, output_tokens: 50}, ...extra});
const answer = (text, extra) => child => { child.event(init()); child.event(result(text, extra)); child.finish(0); };
const task = (extra = {}) => ({id: 'task-1', version: 3, title: 'Summarise', type: 'general', prompt: 'Summarise the attached notes in three bullets.', messages: [], attachments: [], checkpoint: {}, ...extra});

async function runnerFor(t, fake, options = {}) {
  await mkdir(tempRoot, {recursive: true});
  const cwd = await mkdtemp(path.join(tempRoot, 'claude-code-'));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  return {cwd, runner: createClaudeCodeRunner({spawnProcess: fake.spawnProcess, cwd, locate: async () => CLI, processEnv: {PATH: 'C:\\Windows', ANTHROPIC_API_KEY: 'sk-ant-secret', ANTHROPIC_BASE_URL: 'https://proxy.example', CLAUDE_CODE_OAUTH_TOKEN: 'oauth-secret', CLAUDE_CODE_USE_BEDROCK: '1', USERPROFILE: 'C:\\Users\\me'}, ...options})};
}

test('the CLI is found from the explicit setting, then PATH, then the newest copy bundled with the desktop app', async () => {
  const files = new Set(['D:\\tools\\claude.exe', 'C:\\bin\\claude.exe', 'C:\\bin\\claude.cmd',
    'C:\\AppData\\Claude\\claude-code\\2.1.284\\aa\\claude.exe', 'C:\\AppData\\Claude\\claude-code\\2.1.286\\bb\\claude.exe', 'C:\\AppData\\Claude\\claude-code\\2.1.30\\cc\\claude.exe']);
  const dirs = {'C:\\AppData\\Claude\\claude-code': ['2.1.284', '2.1.286', '2.1.30', 'notes.txt'], 'C:\\AppData\\Claude\\claude-code\\2.1.284': ['aa'], 'C:\\AppData\\Claude\\claude-code\\2.1.286': ['bb'], 'C:\\AppData\\Claude\\claude-code\\2.1.30': ['cc']};
  const fs = {exists: async file => files.has(file), list: async dir => dirs[dir] ?? []};
  const env = {APPDATA: 'C:\\AppData', PATH: 'C:\\Windows;C:\\bin'};
  assert.equal(await findClaudeCli({env: {...env, INNO_CLAUDE_CLI: 'D:\\tools\\claude.exe'}, ...fs, platform: 'win32'}), 'D:\\tools\\claude.exe');
  assert.equal(await findClaudeCli({env, ...fs, platform: 'win32'}), 'C:\\bin\\claude.exe');
  assert.equal(await findClaudeCli({env: {...env, PATH: 'C:\\Windows'}, ...fs, platform: 'win32'}), 'C:\\AppData\\Claude\\claude-code\\2.1.286\\bb\\claude.exe', 'versions compare by number');
  assert.equal(await findClaudeCli({env: {...env, INNO_CLAUDE_CLI: 'D:\\missing\\claude.exe', PATH: ''}, exists: async () => false, list: async () => [], platform: 'win32'}), null);
  assert.equal(await findClaudeCli({env: {...env, INNO_CLAUDE_CLI: 'relative\\claude.exe', PATH: ''}, ...fs, platform: 'win32'}), null, 'a relative setting is not used');
  // A relative PATH entry would resolve against the connector's folder; a quoted one is unquoted.
  const local = {exists: async file => file === 'bin\\claude.exe' || file === 'C:\\bin\\claude.exe', list: async () => []};
  assert.equal(await findClaudeCli({env: {PATH: 'bin;"C:\\bin"'}, ...local, platform: 'win32'}), 'C:\\bin\\claude.exe');
  assert.equal(await findClaudeCli({env: {PATH: 'bin'}, ...local, platform: 'win32'}), null);
});

test('readiness needs the CLI, every isolation option, and a Claude subscription login', async t => {
  const missing = createClaudeCodeRunner({locate: async () => null, spawnProcess: fakeClaude().spawnProcess});
  assert.deepEqual([await missing.available(), missing.notReadyReason], [false, 'claude_cli']);
  const old = await runnerFor(t, fakeClaude({help: CLAUDE_CODE_REQUIRED_FLAGS.filter(flag => flag !== '--safe-mode').join('\n')}));
  assert.deepEqual([await old.runner.available(), old.runner.notReadyReason], [false, 'claude_cli'], 'a CLI without the isolation options is not used');
  for (const authMethod of ['none', 'api_key', 'oauth_token', 'third_party']) {
    const {runner} = await runnerFor(t, fakeClaude({auth: {loggedIn: authMethod !== 'none', authMethod}}));
    assert.deepEqual([await runner.available(), runner.notReadyReason], [false, 'claude_login'], authMethod);
  }
  const fake = fakeClaude(), {runner} = await runnerFor(t, fake);
  assert.equal(await runner.available(), true);
  const checks = fake.calls.length;
  assert.equal(await runner.available(), true);
  assert.equal(fake.calls.length, checks, 'a recent check is reused instead of starting the CLI again');
  for (const call of fake.calls) assert.equal(Object.hasOwn(call.options.env, 'ANTHROPIC_API_KEY'), false);
});

test('a readiness check that hangs is cut off, and checks running at the same time share one probe', async t => {
  const hung = fakeClaude({hangProbe: true}), {runner} = await runnerFor(t, hung, {probeTimeoutMs: 30});
  const [first, second] = await Promise.all([runner.available(), runner.available()]);
  assert.deepEqual([first, second, runner.notReadyReason], [false, false, 'claude_cli']);
  assert.equal(hung.calls.length, 1, 'one probe for both checks');
  assert.equal(hung.calls[0].child.killed, true, 'the hung probe is stopped');
});

test('a run uses the isolation options, the subscription environment and stdin, and reports the answer and tokens', async t => {
  const fake = fakeClaude({run: answer('Three bullets.')}), {cwd, runner} = await runnerFor(t, fake);
  const done = await runner.run({task: task(), executionId: 'e1', generation: 1, materials: [{name: 'notes.txt', text: 'alpha beta gamma'}]});
  const [call] = fake.runs();
  assert.equal(call.command, CLI);
  assert.deepEqual(call.args, CLAUDE_CODE_ARGS);
  for (const flag of ['--safe-mode', '--restricted', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands']) assert.ok(call.args.includes(flag), flag);
  assert.equal(call.args[call.args.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.equal(call.args[call.args.indexOf('--tools') + 1], 'Read,Write,Edit,Glob,Grep');
  // Approval rules cover only the run directory, so file access outside it never rests on one option.
  assert.equal(call.args[call.args.indexOf('--allowedTools') + 1], 'Read(./**),Edit(./**)');
  assert.ok(!call.args.some(arg => /bare|bypass|dangerously|Bash|WebFetch|WebSearch/i.test(arg)));
  assert.equal(call.options.shell, false);
  assert.equal(path.dirname(call.options.cwd), cwd);
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK']) assert.equal(Object.hasOwn(call.options.env, key), false, key);
  assert.equal(call.options.env.USERPROFILE, 'C:\\Users\\me', 'the stored login stays reachable');
  assert.match(call.prompt, /Summarise the attached notes/);
  assert.match(call.prompt, /alpha beta gamma/);
  assert.match(call.prompt, /shell commands, web access and MCP tools are not available/);
  assert.equal(done.content, 'Three bullets.');
  assert.deepEqual([done.usage.inputTokens, done.usage.cachedInputTokens, done.usage.outputTokens], [420, 300, 50]);
  assert.equal(done.contextDelivery.provider, 'claude-code');
  assert.equal(done.executionEvidence, undefined, 'no CLI route evidence is claimed for this provider');
});

test('a run with originals asks for claims and returns each quote checked against the original', async t => {
  const claims = [{text: 'The notes list alpha.', sources: [{source: 1, locator: 'line 1', quote: 'alpha beta gamma'}]}];
  const fake = fakeClaude({run: answer(JSON.stringify({summary: 'Alpha.', claims}))}), {runner} = await runnerFor(t, fake);
  const done = await runner.run({task: task(), executionId: 'e1', generation: 1, materials: [{name: 'notes.txt', text: 'alpha beta gamma'}]});
  assert.ok(fake.runs()[0].prompt.includes('claims:[{"text"'));
  assert.deepEqual(done.sourceEvidence, {version: 1, claims: [{text: 'The notes list alpha.', sources: [{name: 'notes.txt', locator: 'line 1', quote: 'alpha beta gamma', found: true}]}]});
});

test('a run that is not on the subscription login, or has more tools than allowed, is stopped at its first event', async t => {
  const {apiKeySource, ...noSource} = init(), {permissionMode, ...noMode} = init();
  const firstEvents = [init({apiKeySource: 'ANTHROPIC_API_KEY'}), init({tools: ['Read', 'Bash']}), init({mcp_servers: [{name: 'x', status: 'connected'}]}),
    noSource, noMode, init({permissionMode: 'acceptEdits'}),
    // Anything before the start settings is not trusted either.
    {type: 'assistant', message: {content: [{type: 'text', text: 'hi'}]}}, result('early'), {type: 'system', subtype: 'hook_started'}];
  for (const event of firstEvents) {
    const fake = fakeClaude({run: child => { child.event(event); }}), {runner} = await runnerFor(t, fake);
    const error = await runner.run({task: task(), executionId: 'e1', generation: 1}).then(() => null, e => e);
    assert.ok(error, JSON.stringify(event));
    assert.equal(fake.runs()[0].child.killed, true, JSON.stringify(event));
    assert.equal(failureInput(error).failure.kind, event.apiKeySource === 'ANTHROPIC_API_KEY' ? 'authentication' : 'unknown', JSON.stringify(event));
  }
});

test('a run that would continue on extra paid usage, or hits the subscription limit, is stopped at once', async t => {
  for (const info of [{status: 'allowed', isUsingOverage: true}, {status: 'allowed_warning', isUsingOverage: true}, {status: 'rejected', rateLimitType: 'five_hour'}]) {
    const fake = fakeClaude({run: child => { child.event(init()); child.event({type: 'rate_limit_event', rate_limit_info: info}); }}), {runner} = await runnerFor(t, fake);
    const error = await runner.run({task: task(), executionId: 'e1', generation: 1}).then(() => null, e => e);
    assert.equal(fake.runs()[0].child.killed, true, JSON.stringify(info));
    assert.equal(failureInput(error).failure.kind, 'quota', JSON.stringify(info));
  }
  const fine = fakeClaude({run: child => { child.event(init()); child.event({type: 'rate_limit_event', rate_limit_info: {status: 'allowed', isUsingOverage: false}}); child.event(result('ok')); child.finish(0); }});
  assert.equal((await (await runnerFor(t, fine)).runner.run({task: task(), executionId: 'e1', generation: 1})).content, 'ok');
});

test('sign-in and usage-limit failures are classified, and other failures stay unknown', async t => {
  const cases = [
    [child => { child.stderr.write('Not logged in · Please run /login\n'); child.finish(1); }, 'authentication'],
    [child => { child.event(init()); child.event(result('Login expired · Please run /login', {is_error: true, subtype: 'error_during_execution'})); child.finish(1); }, 'authentication'],
    [child => { child.event(init()); child.event(result("You've hit your limit · resets 3pm", {is_error: true})); child.finish(1); }, 'quota'],
    [child => { child.event(init()); child.event(result('5-hour limit reached ∙ resets 9pm', {is_error: true})); child.finish(1); }, 'quota'],
    [child => { child.event(init()); child.event(result('', {is_error: true, subtype: 'error_max_turns'})); child.finish(1); }, 'unknown'],
    [child => { child.stderr.write('API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired."}}\n'); child.finish(1); }, 'authentication'],
    // The answer itself is never read as a diagnostic, even when the exit code is not 0.
    [child => { child.event(init()); child.event(result('The study notes that the weekly limit reached its cap.')); child.finish(1); }, 'unknown'],
  ];
  for (const [run, kind] of cases) {
    const {runner} = await runnerFor(t, fakeClaude({run}));
    const error = await runner.run({task: task(), executionId: 'e1', generation: 1}).then(() => null, e => e);
    assert.equal(failureInput(error).failure.kind, kind);
    assert.ok(error.usage === undefined || Number.isSafeInteger(error.usage.inputTokens));
  }
});

test('generated files inside the run directory are returned; delegation, handoff and escapes are refused', async t => {
  const fake = fakeClaude({run: async (child, call) => {
    await writeFile(path.join(call.options.cwd, 'summary.md'), '# Summary\n');
    answer(JSON.stringify({summary: 'Done.', artifacts: [{name: 'summary.md', mime: 'text/markdown', path: 'summary.md'}]}))(child);
  }});
  const {runner} = await runnerFor(t, fake);
  const done = await runner.run({task: task(), executionId: 'e1', generation: 1});
  assert.equal(done.content, 'Done.');
  assert.equal(Buffer.from(done.artifacts[0].content, 'base64').toString(), '# Summary\n');
  assert.equal((await readdir(path.dirname(fake.runs()[0].options.cwd))).length, 0, 'after a delivered result the run directory is removed');
  for (const text of [JSON.stringify({summary: 'x', delegation: {children: []}}), JSON.stringify({summary: 'x', handoff: {provider: 'codex'}}), JSON.stringify({summary: 'x', artifacts: [{name: 'a', mime: 'text/plain', path: '../outside.txt'}]})]) {
    const {runner: other} = await runnerFor(t, fakeClaude({run: answer(text)}));
    await assert.rejects(other.run({task: task(), executionId: 'e1', generation: 1}));
  }
});

test('child, review, evaluation and image runs are refused before the CLI starts, and a stop ends the process', async t => {
  const fake = fakeClaude({run: child => child.event(init())}), {runner} = await runnerFor(t, fake);
  for (const input of [{task: task({parentTaskId: 'p', assignment: {provider: 'claude-code'}})}, {task: task({delegation: {state: 'reviewing'}})}, {task: task({evaluationBudget: {version: 1}})}, {task: task(), materials: [{name: 'a.png', image: {mime: 'image/png', data: 'AAAA'}}]}])
    await assert.rejects(runner.run({executionId: 'e1', generation: 1, ...input}));
  assert.equal(fake.runs().length, 0);
  const controller = new AbortController();
  const running = runner.run({task: task(), executionId: 'e1', generation: 1, signal: controller.signal});
  while (!fake.runs().length) await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(running, {name: 'AbortError'});
  assert.equal(fake.runs()[0].child.killed, true);
});

test('the run environment drops every API and alternative-provider variable', () => {
  const env = claudeCodeEnvironment({ANTHROPIC_API_KEY: 'a', anthropic_auth_token: 'b', ANTHROPIC_MODEL: 'c', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_USE_FOUNDRY: '1', CLAUDE_CODE_OAUTH_TOKEN: 'd', OPENAI_API_KEY: 'e', INNO_CONTEXT_TOKEN: 'f', PATH: 'p', APPDATA: 'q'});
  assert.deepEqual(env, {PATH: 'p', APPDATA: 'q'});
});

test('during the pilot the connector adds the Claude Code runner only when INNO_CLAUDE_CODE is 1', async () => {
  const {claudeCodePilotEnabled} = await import('../server/claude-code-runner.mjs');
  assert.equal(claudeCodePilotEnabled({INNO_CLAUDE_CODE: '1'}), true);
  for (const value of [undefined, '', '0', 'true', 'yes']) assert.equal(claudeCodePilotEnabled({INNO_CLAUDE_CODE: value}), false, String(value));
});
