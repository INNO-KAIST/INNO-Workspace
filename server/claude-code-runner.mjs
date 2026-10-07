import {spawn} from 'node:child_process';
import {constants, mkdirSync} from 'node:fs';
import {access, readdir, rm, rmdir} from 'node:fs/promises';
import path from 'node:path';
import {projectInstructionsBlock} from '../public/core/projects.mjs';
import {contextDelivery} from '../public/core/context-delivery.mjs';
import {usageCounts} from '../public/core/execution-usage.mjs';
import {runnerError} from '../public/core/failures.mjs';
import {verifyMaterialViews} from '../public/core/source-coverage.mjs';
import {boundedOfferedPlugins, boundedPluginDelivery, pluginDeliveryRecord} from '../public/core/plugins.mjs';
import {collectProcess, executionMode, materialBytes, materializeArtifacts, structuredResult, taskPromptWithContext, withoutApiEnvironment} from './runners.mjs';

// CR-006 S2b: the Claude Code CLI on this PC as a desktop runner (pilot). It runs a top-level
// task non-interactively with the person's Claude subscription login:
// - no API key or alternative provider: those variables are removed, and a run whose first
//   event reports another credential source is stopped at once;
// - no customizations (--safe-mode: CLAUDE.md, skills, plugins, hooks, MCP servers) and no
//   settings files (--restricted), so nothing outside this call shapes the run;
// - file tools only (--tools), confined to the run directory (--restricted), approved without
//   prompts only inside it (Read(./**), Edit(./**)) while anything else is refused (dontAsk); no
//   shell, web or MCP (--strict-mcp-config);
// - the first event must report the subscription login and exactly these settings, and a run
//   that would continue on extra paid usage, or hits the subscription limit, is stopped at once;
// - no saved session. Delegation, handoff, child, review, evaluation and image runs stay with
//   the other providers in this pilot.
const PROVIDER = 'claude-code';
const TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];
export const CLAUDE_CODE_ARGS = Object.freeze(['-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--safe-mode', '--restricted', '--strict-mcp-config', '--disable-slash-commands', '--tools', TOOLS.join(','), '--allowedTools', 'Read(./**),Edit(./**)', '--permission-mode', 'dontAsk']);
export const CLAUDE_CODE_REQUIRED_FLAGS = Object.freeze(CLAUDE_CODE_ARGS.filter(arg => arg.startsWith('--')));
const flagListed = (text, flag) => new RegExp(`(?:^|[\\s,])${flag}(?=[\\s,<]|$)`, 'm').test(text);
// A ready CLI is re-checked every 5 minutes, a missing CLI or login every minute.
const READY_CACHE_MS = 300_000, NOT_READY_CACHE_MS = 60_000, PROBE_TIMEOUT_MS = 15_000;
// During the pilot the connector adds this runner only when INNO_CLAUDE_CODE is 1.
export const claudeCodePilotEnabled = env => env?.INNO_CLAUDE_CODE === '1';
const CLAUDE_CODE_POLICY = [
  'CLAUDE CODE ON THIS PC:',
  'Work directly in this process. You can read, create and edit files only inside the current run directory; shell commands, web access and MCP tools are not available, so do not plan to run code.',
  'Do not split, delegate, or hand off the task. Return the final answer, and any generated files as relative paths inside the run directory.',
].join('\n');

// API keys, tokens and alternative-provider switches would bypass the subscription login.
export function claudeCodeEnvironment(processEnv = process.env) {
  return Object.fromEntries(Object.entries(withoutApiEnvironment(processEnv)).filter(([key]) => {
    const name = key.toUpperCase();
    return !name.startsWith('ANTHROPIC_') && !name.startsWith('CLAUDE_CODE_USE_') && name !== 'CLAUDE_CODE_OAUTH_TOKEN';
  }));
}

const defaultExists = async file => { try { await access(file, constants.F_OK); return true; } catch { return false; } };
const defaultList = async dir => { try { return await readdir(dir); } catch { return []; } };
const versionParts = name => name.split('.').map(Number);
const newerFirst = (a, b) => { const x = versionParts(a), y = versionParts(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; };

// The CLI: the explicit INNO_CLAUDE_CLI setting (an absolute path; when set, nothing else is
// tried), then PATH, then the newest copy bundled with the Claude desktop app. Only an
// executable is used, never a shell script shim.
export async function findClaudeCli({env = process.env, exists = defaultExists, list = defaultList, platform = process.platform} = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix, executable = platform === 'win32' ? 'claude.exe' : 'claude';
  if (env.INNO_CLAUDE_CLI !== undefined) {
    const configured = String(env.INNO_CLAUDE_CLI);
    return paths.isAbsolute(configured) && await exists(configured) ? configured : null;
  }
  // Relative entries would resolve against the connector's folder; quoted entries are unquoted.
  for (const entry of String(env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':')) {
    const dir = entry.trim().replace(/^"(.*)"$/, '$1');
    if (!dir || !paths.isAbsolute(dir)) continue;
    const candidate = paths.join(dir, executable);
    if (await exists(candidate)) return candidate;
  }
  if (platform !== 'win32' || !env.APPDATA) return null;
  const root = paths.join(env.APPDATA, 'Claude', 'claude-code');
  for (const version of (await list(root)).filter(name => /^\d+\.\d+\.\d+$/.test(name)).sort(newerFirst)) {
    for (const build of (await list(paths.join(root, version))).sort()) {
      const candidate = paths.join(root, version, build, executable);
      if (await exists(candidate)) return candidate;
    }
  }
  return null;
}

// Keeps the first event's settings check and the final result; nothing else of the transcript.
export function createClaudeEventCollector({maxLineChars = 16 * 1024 * 1024} = {}) {
  let pending = '', started = false, final = null;
  const allowed = new Set(TOOLS);
  function checkStart(event) {
    // A missing source stops the run without asking the person to sign in again; another source is a sign-in problem.
    if (event.apiKeySource === undefined) throw new Error('Claude Code did not report its credential source.');
    if (event.apiKeySource !== 'none') throw Object.assign(new Error('Claude Code is not using the Claude subscription login.'), {code: 'AUTH_REQUIRED'});
    if (!Array.isArray(event.tools) || event.tools.some(tool => !allowed.has(tool))) throw new Error('Claude Code started with tools outside the allowed set.');
    if (event.mcp_servers !== undefined && (!Array.isArray(event.mcp_servers) || event.mcp_servers.length)) throw new Error('Claude Code started with MCP servers.');
    if (event.permissionMode !== 'dontAsk') throw new Error('Claude Code started in another permission mode.');
  }
  // Extra paid usage is never used: a run that would continue on it, or is refused at the
  // subscription limit, stops here and waits for the limit like any quota failure.
  function checkLimit(info) {
    if (info?.isUsingOverage === true) throw Object.assign(new Error('Claude Code would continue on extra paid usage; the run was stopped.'), {code: 'QUOTA_EXCEEDED'});
    if (info?.status === 'rejected') throw Object.assign(new Error('The Claude subscription usage limit was reached.'), {code: 'QUOTA_EXCEEDED'});
  }
  function consume(line) {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (!event || typeof event !== 'object') return;
    // Nothing is trusted before the start settings: the first event must be system/init.
    if (!started) {
      if (event.type !== 'system' || event.subtype !== 'init') throw new Error('Claude Code reported something before its start settings.');
      started = true;
      checkStart(event);
      return;
    }
    if (event.type === 'rate_limit_event') checkLimit(event.rate_limit_info);
    if (event.type === 'result') final = {subtype: typeof event.subtype === 'string' ? event.subtype : null, isError: event.is_error === true, text: typeof event.result === 'string' ? event.result : null, usage: event.usage && typeof event.usage === 'object' ? event.usage : null};
  }
  function append(fragment) {
    if (pending.length + fragment.length > maxLineChars) { pending = ''; throw Object.assign(Error('Executor output record exceeds the processing limit. Generated files are retained.'), {code: 'OUTPUT_LIMIT'}); }
    pending += fragment;
  }
  return {
    write(chunk) { let start = 0, end; while ((end = chunk.indexOf('\n', start)) !== -1) { append(chunk.slice(start, end)); consume(pending); pending = ''; start = end + 1; } append(chunk.slice(start)); },
    finish() { if (pending) { consume(pending); pending = ''; } return {started, result: final}; },
  };
}

// Claude reports uncached input, cache writes and cache reads separately; the record keeps total
// input with the cache reads as its cached part, like the Codex record.
function claudeUsage(usage) {
  if (!usage) return null;
  const parts = [usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens].filter(Number.isSafeInteger);
  const counts = usageCounts({inputTokens: parts.length ? parts.reduce((total, value) => total + value, 0) : null, outputTokens: usage.output_tokens, cachedInputTokens: usage.cache_read_input_tokens});
  return counts ? {...counts, source: 'claude_code_cli'} : null;
}
const abortError = () => Object.assign(new Error('execution aborted'), {name: 'AbortError'});

export function createClaudeCodeRunner({
  probeTimeoutMs = PROBE_TIMEOUT_MS,
  spawnProcess = spawn,
  cwd = process.cwd(),
  processEnv = process.env,
  locate = () => findClaudeCli({env: processEnv}),
  runDirectory = ({task, executionId, generation}) => path.join(cwd, `${task.id}-${generation ?? 0}-${executionId ?? crypto.randomUUID()}`.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180)),
  ensureDirectory = directory => mkdirSync(directory, {recursive: true}),
  processTree,
  now = Date.now,
} = {}) {
  const env = claudeCodeEnvironment(processEnv);
  let checked = null, inFlight = null, reason = 'claude_cli';
  // A probe that hangs (sign-in refresh, network) is stopped, so it cannot hold up the connector.
  const probe = async (cli, args) => collectProcess(spawnProcess(cli, args, {env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']}), {timeoutMs: probeTimeoutMs});
  async function check() {
    let cli = null;
    try { cli = await locate(); } catch {}
    if (!cli) return {ok: false, reason: 'claude_cli'};
    try {
      const help = await probe(cli, ['--help']), text = `${help.stdout}\n${help.stderr}`;
      if (help.code !== 0 || !CLAUDE_CODE_REQUIRED_FLAGS.every(flag => flagListed(text, flag))) return {ok: false, reason: 'claude_cli'};
    } catch { return {ok: false, reason: 'claude_cli'}; }
    try {
      const status = await probe(cli, ['auth', 'status', '--json']);
      let parsed = null;
      try { parsed = JSON.parse(status.stdout); } catch {}
      return parsed?.authMethod === 'claude.ai' ? {ok: true, reason: null} : {ok: false, reason: 'claude_login'};
    } catch { return {ok: false, reason: 'claude_login'}; }
  }
  return {
    provider: PROVIDER,
    get notReadyReason() { return reason; },
    sourceDelegationVersion: 0,
    // The CLI, its isolation options and the subscription login; a result is reused briefly.
    async available() {
      if (checked && now() - checked.at < (checked.ok ? READY_CACHE_MS : NOT_READY_CACHE_MS)) return checked.ok;
      inFlight ??= check().then(result => {
        checked = {...result, at: now()};
        reason = result.reason ?? reason;
        return result.ok;
      }).finally(() => { inFlight = null; });
      return inFlight;
    },
    async run({task, project, materials = [], executionId, generation, signal, executionBudgetVersion, plugins: offeredPlugins, pluginsSkipped = []}) {
      const plugins = boundedOfferedPlugins(offeredPlugins), pluginDelivery = boundedPluginDelivery(pluginDeliveryRecord(plugins, pluginsSkipped));
      let delivery, tracker, sampler, executionDirectory, observedUsage, delivered = false;
      try {
        if (executionMode(task) !== 'root') throw new Error('Claude Code on this PC runs only top-level tasks in this pilot.');
        if (task?.evaluationBudget || executionBudgetVersion !== undefined) throw new Error('Claude Code on this PC does not run evaluation-budget tasks.');
        if (materials.some(material => material?.image)) throw new Error('Images go only to Codex on this PC.');
        await verifyMaterialViews(task, materials);
        const cli = await locate();
        if (!cli) throw Object.assign(new Error('Claude Code CLI was not found on this PC.'), {code: 'RUNNER_UNAVAILABLE'});
        if (signal?.aborted) throw abortError();
        const ownership = {provider: PROVIDER, plainResult: true, managedDelivery: true, mode: 'root', projectBlock: projectInstructionsBlock(project), plugins, executionId, generation, contextGuidance: '', contextReaderAvailable: false, sourceContext: '', evaluationBound: false, allowDelegation: false, allowHandoff: false, modelPolicy: CLAUDE_CODE_POLICY};
        const {text: input, context} = await taskPromptWithContext(task, materials, ownership);
        delivery = contextDelivery(context, {provider: PROVIDER, promptBytes: Buffer.byteLength(input), materialBytes: materialBytes(materials), reader: false});
        executionDirectory = runDirectory({task, executionId, generation});
        ensureDirectory(executionDirectory);
        if (signal?.aborted) throw abortError();
        const spawnedAt = Date.now();
        const child = spawnProcess(cli, [...CLAUDE_CODE_ARGS], {cwd: executionDirectory, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
        if (processTree && child.pid) {
          let releasedAt;
          child.once?.('exit', () => { releasedAt = Date.now(); });
          tracker = processTree.track(child.pid, {spawnedAt, heldUntil: () => child.exitCode === null && child.signalCode === null ? Infinity : releasedAt ?? -Infinity});
          tracker.sample().catch(() => {});
          sampler = setInterval(() => { tracker.sample().catch(() => {}); }, 60_000); sampler.unref?.();
        }
        const result = await collectProcess(child, {input, signal, onTerminate: () => { Promise.resolve().then(() => tracker?.terminate()).catch(() => {}); }, stdoutCollector: createClaudeEventCollector()});
        const outcome = result.stdout?.result ?? null;
        observedUsage = claudeUsage(outcome?.usage);
        if (result.code !== 0 || !outcome || outcome.isError || outcome.subtype !== 'success') {
          // The CLI reports sign-in and usage-limit problems as text; only the category is kept.
          // Only an error result's text is a diagnostic; an answer is never read for a category.
          throw runnerError(new Error([outcome?.isError ? outcome.text : null, String(result.stderr ?? '').slice(-2000)].filter(Boolean).join('\n') || `Claude Code ended without a usable result (${outcome?.subtype ?? 'no result'}, exit ${result.code})`));
        }
        if (!result.stdout.started) throw new Error('Claude Code did not report its start settings.');
        const content = outcome.text?.trim() ?? '';
        if (!content) throw new Error('Claude Code completed without an answer.');
        const structured = structuredResult(content);
        if (structured?.delegation || structured?.handoff) throw new Error('Claude Code on this PC cannot delegate or hand off in this pilot.');
        if (structured && Object.hasOwn(structured, 'resumeState') && structured.resumeState !== null && structured.resumeState.taskId !== task.id) throw new Error('Invalid resume state task binding');
        const artifacts = structured ? await materializeArtifacts(structured.artifacts, executionDirectory) : [];
        delivered = true;
        return {
          content: structured?.content ?? content,
          checkpoint: structured?.checkpoint ?? 'Claude Code execution completed.',
          artifacts,
          ...(observedUsage ? {usage: observedUsage} : {}),
          contextDelivery: delivery,
          ...(pluginDelivery ? {pluginDelivery} : {}),
          ...(structured && Object.hasOwn(structured, 'resumeState') ? {resumeState: structured.resumeState} : {}),
        };
      } catch (error) {
        if (error && typeof error === 'object') {
          if (observedUsage && error.usage === undefined) error.usage = observedUsage;
          if (delivery && error.contextDelivery === undefined) error.contextDelivery = delivery;
          if (delivery && pluginDelivery && error.pluginDelivery === undefined) error.pluginDelivery = pluginDelivery;
        }
        throw error;
      } finally {
        if (sampler !== undefined) clearInterval(sampler);
        tracker?.stop?.();
        // After a delivered result its files travel with it, so the run directory is removed, and a
        // file written there (an injected CLAUDE.md, say) does not stay in the repository. After a
        // failure only an empty directory is removed; generated files stay for review, as for Codex.
        if (executionDirectory) await (delivered ? rm(executionDirectory, {recursive: true, force: true, maxRetries: 3, retryDelay: 200}) : rmdir(executionDirectory)).catch(() => {});
      }
    },
  };
}
