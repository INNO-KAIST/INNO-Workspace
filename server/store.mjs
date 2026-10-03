import {sanitizeResumeState} from '../public/core/context-resume.mjs';
import {createHash} from 'node:crypto';
import {creationId,creationPayload} from '../public/core/create-requests.mjs';
import {validateOfficeArtifact} from '../public/core/office-container.mjs';
import {sanitizeArtifactChecks} from '../public/core/artifact-checks.mjs';
import {executionUsage,usageHistory} from '../public/core/execution-usage.mjs';
import {validateOwnedExecutionEvidence,wallElapsedMs} from '../public/core/execution-evidence.mjs';
import {ownedContextDelivery} from '../public/core/context-delivery.mjs';
import {failureRecord} from '../public/core/failures.mjs';
import {assertEvaluationAttachable,assertEvaluationBindingPreserved,evaluationBinding,reserveClaimBudget} from '../public/core/evaluation-claim.mjs';
import {encodeStoredEvaluationBudget,parseStoredEvaluationBudget} from '../worker/evaluation-budgets.mjs';
import { DatabaseSync } from 'node:sqlite';

import {
  ConflictError,
  ValidationError,
  applyAction,
  applyOwnedExecutionAction,
  createTask,
  sanitizeDecision,
  TERMINAL_STATUSES,
} from '../public/core/tasks.mjs';

export class NotFoundError extends Error {
  constructor(message = 'task not found') {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

export class ExecutionConflictError extends ConflictError {
  constructor(message, currentVersion) {
    super(message, currentVersion);
    this.name = 'ExecutionConflictError';
  }
}

const EVALUATION_ATTACH=Symbol('evaluation attach');
const BUDGET_COMMIT=Symbol('budget commit');

export class SqliteTaskStore {
  constructor(filename = ':memory:', options = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? (() => crypto.randomUUID());
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        body TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS usage (
        provider TEXT PRIMARY KEY,
        body TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO metadata (key, value) VALUES ('revision', 0);
    `);
    this.insertTask = this.db.prepare('INSERT INTO tasks (id, version, updated_at, body) VALUES (?, ?, ?, ?)');
    this.selectTask = this.db.prepare('SELECT body FROM tasks WHERE id = ?');
    this.selectTasks = this.db.prepare('SELECT body FROM tasks ORDER BY updated_at DESC, id ASC');
    this.updateTaskStatement = this.db.prepare('UPDATE tasks SET version = ?, updated_at = ?, body = ? WHERE id = ? AND version = ?');
    this.incrementRevision = this.db.prepare("UPDATE metadata SET value = value + 1 WHERE key = 'revision'");
    this.selectRevision = this.db.prepare("SELECT value FROM metadata WHERE key = 'revision'");
    this.selectUsage = this.db.prepare('SELECT body FROM usage ORDER BY provider');
    this.upsertUsage = this.db.prepare('INSERT INTO usage (provider, body) VALUES (?, ?) ON CONFLICT(provider) DO UPDATE SET body = excluded.body');
  }

  close() {
    this.db.close();
  }

  transaction(operation) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  createTask(input) {
    const task = createTask(input, {now: this.now, id: this.id});
    const requestTaskId=creationId(input);
    if(requestTaskId){task.id=requestTaskId;task.creationRequestHash=createHash('sha256').update(creationPayload(input)).digest('hex');}
    return this.transaction(() => {
      if(requestTaskId){const existing=this.getTask(requestTaskId);if(existing){if(existing.creationRequestHash!==task.creationRequestHash)throw new ConflictError('Creation request was already used with different content',existing.version);return existing;}}
      this.insertTask.run(task.id, task.version, task.updatedAt, JSON.stringify(task));
      this.incrementRevision.run();
      return task;
    });
  }

  getTask(id) {
    const row = this.selectTask.get(id);
    return row ? JSON.parse(row.body) : null;
  }

  requireTask(id) {
    const task = this.getTask(id);
    if (!task) throw new NotFoundError();
    return task;
  }

  listTasks() {
    return this.selectTasks.all().map(row => JSON.parse(row.body));
  }

  getState(capabilities = {}, since) {
    const revision=Number(this.selectRevision.get().value);
    if(Number.isSafeInteger(since)&&since>=0&&since===revision)return {revision,unchanged:true,capabilities};
    return {
      revision,
      tasks: this.listTasks(),
      usage: this.selectUsage.all().map(row => JSON.parse(row.body)),
      capabilities,
    };
  }

  replaceTask(id, expectedVersion, updater, authorization) {
    return this.transaction(() => {
      const current = this.requireTask(id);
      if (!Number.isInteger(expectedVersion)) throw new ValidationError('expectedVersion is required');
      if (current.version !== expectedVersion) {
        throw new ConflictError(`version conflict: expected ${expectedVersion}, current ${current.version}`, current.version);
      }
      const next = updater(structuredClone(current));
      if (!next || next.id !== current.id || next.version !== current.version + 1) {
        throw new Error('task updater must return the same task with version incremented once');
      }
      assertEvaluationBindingPreserved(current,next,authorization===EVALUATION_ATTACH);
      const result = this.updateTaskStatement.run(next.version, next.updatedAt, JSON.stringify(next), id, expectedVersion);
      if (result.changes !== 1) throw new ConflictError('task changed during update', this.requireTask(id).version);
      const budget=authorization?.[BUDGET_COMMIT];
      if(budget){
        const saved=this.db.prepare('UPDATE metadata SET value=? WHERE key=? AND value=?').run(budget.nextRaw,budget.key,budget.raw);
        if(saved.changes!==1)throw new ConflictError('stale evaluation budget state conflict',current.version);
      }
      this.incrementRevision.run();
      return next;
    });
  }

  attachEvaluationBudget(taskId,input){
    const raw=this.db.prepare('SELECT value FROM metadata WHERE key=?').get('evaluation_budget:'+input?.jobId)?.value;
    const state=parseStoredEvaluationBudget(raw,input?.jobId);
    const binding=evaluationBinding(input,state);
    return this.replaceTask(taskId,input.expectedVersion,current=>{
      assertEvaluationAttachable(current);
      return {...current,evaluationBudget:binding,version:current.version+1,updatedAt:this.now()};
    },EVALUATION_ATTACH);
  }

  applyAction(id, input) {
    return this.replaceTask(id, input?.expectedVersion, current => applyAction(current, input, {now: this.now, id: this.id}));
  }

  applyExecutionAction(id, input) {
    const snapshot = this.requireTask(id);
    return this.replaceTask(id, snapshot.version, current => {
      this.assertExecution(current, input);
      return applyOwnedExecutionAction(current, {...input, expectedVersion: current.version}, {now: this.now, id: this.id});
    });
  }

  requestDecision(id, input) {
    const snapshot = this.requireTask(id);
    return this.replaceTask(id, snapshot.version, current => {
      this.assertExecution(current, input);
      const now = this.now();
      const decision = sanitizeDecision(input);
      return {
        ...current,
        status: 'waiting_user',
        version: current.version + 1,
        updatedAt: now,
        decision: {...decision, createdAt: now},
        checkpoint: {...current.checkpoint, status: 'waiting_user', usageHistory:usageHistory(current.checkpoint,input.usage,now,{task:current,transition:'decision'}), content: decision.prompt, updatedAt: now},
      };
    });
  }

  markWaiting(id, {expectedVersion, provider, reason}) {
    return this.replaceTask(id, expectedVersion, current => {
      if (TERMINAL_STATUSES.includes(current.status)) throw new ConflictError('task is terminal', current.version);
      const now = this.now();
      return {
        ...current,
        status: 'waiting_connection',
        version: current.version + 1,
        updatedAt: now,
        checkpoint: {
          ...(current.checkpoint ?? {}),
          provider,
          status: 'waiting_connection',
          content: current.checkpoint?.content ?? reason,
          failure: failureRecord({failure:{kind:'unavailable'}},now),
          updatedAt: now,
        },
      };
    });
  }

  claimExecution(id, input) {
    const {provider, expectedVersion, leaseMs = 15 * 60_000, executionBudgetVersion} = input;
    if (!['codex', 'claude'].includes(provider)) throw new ValidationError('provider must be codex or claude');
    if (!Number.isFinite(leaseMs) || leaseMs < 1_000 || leaseMs > 60 * 60_000) {
      throw new ValidationError('leaseMs must be between 1000 and 3600000');
    }
    if(Object.keys(input).some(key=>key!=='executionBudgetVersion'&&(/budget|grant|reservation/i.test(key)||['jobId','phase','maxDurationMs','deadlineAtMs'].includes(key))))throw new ValidationError('unsupported execution budget option');
    const authorization={};
    let claim;
    const task = this.replaceTask(id, expectedVersion, current => {
      let budget;
      if(current.evaluationBudget){
        if(executionBudgetVersion!==1||provider!=='codex')throw new ValidationError('evaluation execution requires Codex budget capability version 1');
        const key='evaluation_budget:'+current.evaluationBudget.jobId;
        const raw=this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value;
        budget={key,raw,state:parseStoredEvaluationBudget(raw,current.evaluationBudget.jobId)};
      }else if(executionBudgetVersion!==undefined)throw new ValidationError('unsupported execution budget option');
      if (TERMINAL_STATUSES.includes(current.status) || current.status === 'paused') {
        throw new ExecutionConflictError(`task cannot run from ${current.status}`, current.version);
      }
      const now = this.now();
      const nowMs = Date.parse(now);
      const previous = current.checkpoint ?? {};
      const leaseActive = current.status === 'running'
        && Number.isFinite(Date.parse(previous.expiresAt))
        && Date.parse(previous.expiresAt) > nowMs;
      if (leaseActive) throw new ExecutionConflictError('execution lease is already owned', current.version);
      const generation = Number.isInteger(previous.generation) ? previous.generation + 1 : 1;
      const executionId = this.id();
      claim = {executionId, generation};
      const reserved=budget?reserveClaimBudget(current,input,claim,budget.state,nowMs):null;
      if(reserved)authorization[BUDGET_COMMIT]={key:budget.key,raw:budget.raw,nextRaw:encodeStoredEvaluationBudget(reserved.state)};
      return {
        ...current,
        status: 'running',
        version: current.version + 1,
        updatedAt: now,
        checkpoint: {
          ...previous, failure: undefined, executionEvidence: undefined, contextDelivery: undefined, wallElapsedMs: undefined, completedAt: undefined,
          executionId,
          generation,
          provider,
          status: 'running',
          claimedAt: now,
          expiresAt: new Date(nowMs + leaseMs).toISOString(),
          ...(reserved?{evaluationBudget:reserved.checkpoint}:{}),
          updatedAt: now,
        },
      };
    },authorization);
    return {...claim, task};
  }

  assertExecution(current, input) {
    const checkpoint = current.checkpoint ?? {};
    if (
      current.status !== 'running'
      || checkpoint.executionId !== input.executionId
      || checkpoint.generation !== input.generation
    ) {
      throw new ExecutionConflictError('stale execution owner cannot write this task', current.version);
    }
  }

  finishExecution(id, input, {allowDesktopEvidence = false} = {}) {
    const current = this.requireTask(id);
    return this.replaceTask(id, current.version, task => {
      this.assertExecution(task, input);
      const checkpoint={...task.checkpoint};
      if(input.resumeState===null)delete checkpoint.resumeState;
      else if(input.resumeState!==undefined){
        const resumeState=sanitizeResumeState(input.resumeState);
        if(resumeState.taskId!==task.id)throw new ValidationError('Resume state task scope mismatch');
        checkpoint.resumeState=resumeState;
      }
      const now = this.now();
      const elapsed=wallElapsedMs(task.checkpoint?.claimedAt,now);
      const executionEvidence=allowDesktopEvidence&&input.executionEvidence?validateOwnedExecutionEvidence(task,input.executionEvidence):null;
      const delivery=ownedContextDelivery(task,input.contextDelivery);
      const content = typeof input.content === 'string' ? input.content.trim() : '';
      if (!content) throw new ValidationError('execution result content is required');
      const generatedArtifacts = Array.isArray(input.artifacts) && input.artifacts.length
        ? input.artifacts
        : [{name: 'final.md', mime: 'text/markdown', content, encoding: 'utf-8'}];
      if (generatedArtifacts.length > 10) throw new ValidationError('execution returned too many artifacts');
      let artifactBytes = 0;
      const artifacts = generatedArtifacts.map(item => {
        if (!item || typeof item !== 'object') throw new ValidationError('execution artifact is invalid');
        const artifactContent = typeof item.content === 'string' ? item.content : '';
        artifactBytes += artifactContent.length;
        if (artifactBytes > 10_000_000) throw new ValidationError('execution artifacts are too large');
        const encoding = item.encoding ?? 'utf-8';
        validateOfficeArtifact({...item,encoding});
        if (!['utf-8', 'base64'].includes(encoding)) throw new ValidationError('execution artifact encoding is invalid');
        return {
          id: this.id(),
          name: typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 500) : 'artifact.txt',
          mime: typeof item.mime === 'string' && item.mime.trim() ? item.mime.trim().slice(0, 255) : 'text/plain',
          content: artifactContent,
          checks: sanitizeArtifactChecks(item.checks),
          encoding,
          createdAt: now,
        };
      });
      return {
        ...task,
        status: 'completed',
        version: task.version + 1,
        updatedAt: now,
        messages: [...task.messages, {id: this.id(), role: 'assistant', content, createdAt: now}],
        artifacts: [...task.artifacts, ...artifacts],
        checkpoint: {
          ...checkpoint,
          ...(delivery?{contextDelivery:delivery}:{}),
          resultArtifactIds: [...task.artifacts.filter(a => a.executionId === input.executionId && a.generation === input.generation), ...artifacts].map(a => a.id),
          usage: executionUsage(task.checkpoint,input.usage,now), usageHistory: usageHistory(task.checkpoint,input.usage,now,{task,transition:'completion'}),
          status: 'completed',
          failure: undefined,
          content: input.checkpoint ?? 'Execution completed.',
          updatedAt: now,
          completedAt: now,
          wallElapsedMs:elapsed,
          ...(executionEvidence?{executionEvidence:{...executionEvidence,wallElapsedMs:elapsed}}:{}),
        },
      };
    });
  }

  leaveExecutionRunning(id, input) {
    const current = this.requireTask(id);
    return this.replaceTask(id, current.version, task => {
      this.assertExecution(task, input);
      const now = this.now();
      return {
        ...task,
        status: 'running',
        version: task.version + 1,
        updatedAt: now,
        checkpoint: {
          ...task.checkpoint,
          status: 'running',
          content: task.checkpoint?.content ?? input.checkpoint ?? 'Remote session started; awaiting durable checkpoints.',
          sessionUrl: input.sessionUrl,
          updatedAt: now,
        },
      };
    });
  }

  failExecution(id, input) {
    const current = this.requireTask(id);
    return this.replaceTask(id, current.version, task => {
      this.assertExecution(task, input);
      const delivery = ownedContextDelivery(task, input.contextDelivery);
      const now = this.now();
      const failure = failureRecord(input, now);
      const status = failure.kind === 'quota' ? 'waiting_quota' : failure.kind === 'authentication' ? 'waiting_connection' : 'failed';
      return {
        ...task,
        status,
        version: task.version + 1,
        updatedAt: now,
        checkpoint: {
          ...task.checkpoint,
          ...(delivery?{contextDelivery:delivery}:{}),
          status,
          failure,
          usageHistory:usageHistory(task.checkpoint,input.usage,now,{task,transition:'failure'}),
          updatedAt: now,
        },
      };
    });
  }

  recordUsage(provider, usage = {}) {
    const record = {
      provider,
      usedPercent: Number.isFinite(usage.usedPercent) ? usage.usedPercent : null,
      resetAt: usage.resetAt ?? null,
      inputTokens: Number.isFinite(usage.inputTokens) ? usage.inputTokens : null,
      outputTokens: Number.isFinite(usage.outputTokens) ? usage.outputTokens : null,
      updatedAt: this.now(),
      source: usage.source ?? 'executor_event',
    };
    this.transaction(() => {
      this.upsertUsage.run(provider, JSON.stringify(record));
      this.incrementRevision.run();
    });
    return record;
  }
}
