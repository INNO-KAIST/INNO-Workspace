import {usageCounts} from '../public/core/execution-usage.mjs';
import {parseRevision} from '../public/core/sync.mjs';
import {failureInput,runnerError} from '../public/core/failures.mjs';
import {boundedContextDelivery} from '../public/core/context-delivery.mjs';
import {assertProviderId,providerHas} from '../public/core/providers.mjs';
// Optional evidence: drop invalid delivery records rather than failing a result.
const deliveryOf=value=>{try{const delivery=boundedContextDelivery(value);return delivery?{contextDelivery:delivery}:{};}catch{return {};}};
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';

import { ConflictError, ValidationError, sanitizeMaterials } from '../public/core/tasks.mjs';
import { handleMcp } from './mcp.mjs';
import { ExecutionConflictError, NotFoundError } from './store.mjs';

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function sendJson(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), ...headers});
  response.end(body);
}

function equalToken(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function bearer(request) {
  const value = request.headers.authorization;
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : null;
}

async function readJson(request, maxBytes = 750_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new ValidationError('request body is too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('request body must be valid JSON');
  }
}

function publicPath(publicDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const root = path.resolve(publicDir);
  const candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
  return candidate;
}

function contained(root, candidate) {
  return candidate !== root && candidate.startsWith(`${root}${path.sep}`);
}

async function runnerAvailable(runner) {
  if (!runner || typeof runner.run !== 'function') return false;
  return typeof runner.available === 'function' ? Boolean(await runner.available()) : true;
}

export function createInnoServer({
  store,
  token,
  corsOrigins = [],
  publicDir,
  runners = {},
  now,
}) {
  if (!store) throw new Error('store is required');
  if (!token || token.length < 24) throw new Error('a strong access token is required');
  const allowedOrigins = new Set(corsOrigins);
  const activeRuns = new Map();

  async function capabilities() {
    const [localCodex, claudeRoutine] = await Promise.all([
      runnerAvailable(runners.codex).catch(() => false),
      runnerAvailable(runners.claude).catch(() => false),
    ]);
    return {localCodex, claudeRoutine, cloud: claudeRoutine, connected: true};
  }

  function corsHeaders(request) {
    const origin = request.headers.origin;
    return origin && allowedOrigins.has(origin)
      ? {'access-control-allow-origin': origin, vary: 'Origin'}
      : {};
  }

  async function runTask(request, response, taskId, provider, input, cors) {
    assertProviderId(provider);
    if (!Number.isInteger(input.expectedVersion)) throw new ValidationError('expectedVersion is required');
    const materials = sanitizeMaterials(input.materials);
    const runner = runners[provider];
    if (!await runnerAvailable(runner)) {
      const task = store.markWaiting(taskId, {
        expectedVersion: input.expectedVersion,
        provider,
        reason: `${provider} is not connected or available.`,
      });
      sendJson(response, 503, {error: `${provider} is not connected or available`, task}, cors);
      return;
    }

    const claim = store.claimExecution(taskId, {provider, expectedVersion: input.expectedVersion});
    const controller = new AbortController();
    activeRuns.set(taskId, {controller, executionId: claim.executionId, generation: claim.generation});
    const execution = (async () => {
      try {
        const result = await runner.run({
          task: claim.task,
          materials,
          executionId: claim.executionId,
          generation: claim.generation,
          signal: controller.signal,
        });
        if (result?.sessionUrl) {
          store.leaveExecutionRunning(taskId, {
            executionId: claim.executionId,
            generation: claim.generation,
            sessionUrl: result.sessionUrl,
            checkpoint: result.checkpoint,
          });
        } else {
          store.finishExecution(taskId, {
            executionId: claim.executionId,
            generation: claim.generation,
            content: result?.content,
            checkpoint: result?.checkpoint,
            artifacts: result?.artifacts,
            usage: result?.usage,
            executionEvidence:result?.executionEvidence,
            ...deliveryOf(result?.contextDelivery),
          },{allowDesktopEvidence:providerHas(provider,'executionEvidence','cli_arguments')});
        }
      } catch (error) {
        const current = store.requireTask(taskId);
        const stillOwner = current.status === 'running'
          && current.checkpoint?.executionId === claim.executionId
          && current.checkpoint?.generation === claim.generation;
        if (stillOwner && !(error instanceof ConflictError || error instanceof ExecutionConflictError)) {
          store.failExecution(taskId, {
            executionId: claim.executionId,
            generation: claim.generation,
            usage:usageCounts(error?.usage),
            ...failureInput(error?.code ? error : runnerError(error)),
            ...deliveryOf(error?.contextDelivery),
          });
        }
      } finally {
        const active = activeRuns.get(taskId);
        if (active?.executionId === claim.executionId) activeRuns.delete(taskId);
      }
    })();
    execution.catch(() => {});
    sendJson(response, 202, {task: claim.task}, cors);
  }

  async function handler(request, response) {
    const cors = corsHeaders(request);
    try {
      const url = new URL(request.url, 'http://localhost');
      const pathname = url.pathname;

      if (request.method === 'OPTIONS') {
        if (!request.headers.origin || !allowedOrigins.has(request.headers.origin)) {
          sendJson(response, 403, {error: 'origin is not allowed'});
          return;
        }
        response.writeHead(204, {
          ...cors,
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-max-age': '600',
        });
        response.end();
        return;
      }

      if (request.method === 'GET' && pathname === '/api/health') {
        sendJson(response, 200, {status: 'ok'}, cors);
        return;
      }

      if (pathname.startsWith('/api/') || pathname === '/mcp') {
        if (!equalToken(bearer(request), token)) {
          sendJson(response, 401, {error: 'unauthorized'}, {...cors, 'www-authenticate': 'Bearer'});
          return;
        }
      }

      if (request.method === 'GET' && pathname === '/api/state') {
        sendJson(response, 200, store.getState(await capabilities(),parseRevision(url.searchParams.get('since'))), cors);
        return;
      }

      if (request.method === 'POST' && pathname === '/mcp') {
        sendJson(response, 200, await handleMcp(store, await readJson(request)), cors);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/tasks') {
        const task = store.createTask(await readJson(request));
        sendJson(response, 201, {task}, cors);
        return;
      }

      const actionMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/actions$/);
      if (request.method === 'POST' && actionMatch) {
        const taskId = decodeURIComponent(actionMatch[1]);
        const input = await readJson(request);
        const task = store.applyAction(taskId, input);
        if (['cancel', 'pause', 'message', 'decide'].includes(input.action)) {
          activeRuns.get(taskId)?.controller.abort(new Error('task execution superseded'));
        }
        sendJson(response, 200, {task}, cors);
        return;
      }

      const runMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/run$/);
      if (request.method === 'POST' && runMatch) {
        const taskId = decodeURIComponent(runMatch[1]);
        const input = await readJson(request);
        await runTask(request, response, taskId, input.provider, input, cors);
        return;
      }

      if ((request.method === 'GET' || request.method === 'HEAD') && publicDir && !pathname.startsWith('/api/')) {
        const candidate = publicPath(publicDir, pathname);
        if (candidate) {
          const [resolvedRoot, resolvedCandidate] = await Promise.all([
            realpath(path.resolve(publicDir)).catch(() => null),
            realpath(candidate).catch(() => null),
          ]);
          const safeCandidate = resolvedRoot && resolvedCandidate && contained(resolvedRoot, resolvedCandidate)
            ? resolvedCandidate
            : null;
          const info = safeCandidate ? await stat(safeCandidate).catch(() => null) : null;
          if (info?.isFile()) {
            response.writeHead(200, {
              'content-type': MIME[path.extname(safeCandidate).toLowerCase()] ?? 'application/octet-stream',
              'content-length': info.size,
              'x-content-type-options': 'nosniff',
              'cache-control': path.basename(safeCandidate) === 'index.html' ? 'no-cache' : 'public, max-age=3600',
              ...cors,
            });
            if (request.method === 'HEAD') response.end();
            else createReadStream(safeCandidate).pipe(response);
            return;
          }
        }
      }

      sendJson(response, 404, {error: 'not found'}, cors);
    } catch (error) {
      const status = error?.statusCode ?? 500;
      const body = {error: status === 500 ? 'internal server error' : error.message};
      if (error instanceof ConflictError && Number.isInteger(error.currentVersion)) body.currentVersion = error.currentVersion;
      sendJson(response, status, body, cors);
    }
  }

  const server = createServer((request, response) => {
    handler(request, response).catch(error => sendJson(response, 500, {error: 'internal server error'}));
  });
  return {server, store, capabilities, activeRuns};
}
