import {creationId,creationPayload,digestText} from '../public/core/create-requests.mjs';
import {validateOfficeArtifact} from '../public/core/office-container.mjs';
import {sanitizeArtifactChecks} from '../public/core/artifact-checks.mjs';
import {validateReviewReport} from '../public/core/delegation.mjs';
import {handoffTask,isHandoffReplay} from '../public/core/provider-handoff.mjs';
import {executionUsage,usageHistory} from '../public/core/execution-usage.mjs';
import {failureRecord} from '../public/core/failures.mjs';
import {
  ConflictError,
  ValidationError,
  applyAction,
  applyOwnedExecutionAction,
  createTask,
  sanitizeDecision,
  TERMINAL_STATUSES,
} from '../public/core/tasks.mjs';

// Not exported: generic updates cannot authorize uncertainty recovery.
const REMOTE_RECOVERY = Symbol('remote recovery');

export const D1_SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_updated_at ON tasks(updated_at DESC);
CREATE TABLE IF NOT EXISTS usage (
  provider TEXT PRIMARY KEY,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT OR IGNORE INTO metadata (key, value) VALUES ('revision', 0);
`;

class D1NotFoundError extends Error {
  constructor() { super('task not found'); this.statusCode = 404; }
}

export class D1TaskStore {
  constructor(database, options = {}) {
    if (!database) throw new Error('D1 database binding is required');
    this.db = database;
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? (() => crypto.randomUUID());
  }

  async createTask(input) {
    const task = createTask(input, {now: this.now, id: this.id});
    const requestTaskId=creationId(input);
    if(requestTaskId){
      task.id=requestTaskId;task.creationRequestHash=await digestText(creationPayload(input));
      await this.db.batch([
        this.db.prepare('INSERT INTO tasks (id,version,updated_at,body) VALUES (?1,?2,?3,?4) ON CONFLICT(id) DO NOTHING').bind(task.id,task.version,task.updatedAt,JSON.stringify(task)),
        this.db.prepare("UPDATE metadata SET value=value+1 WHERE key='revision' AND changes()=1"),
      ]);
      const stored=await this.requireTask(requestTaskId);
      if(stored.creationRequestHash!==task.creationRequestHash)throw new ConflictError('Creation request was already used with different content',stored.version);
      return stored;
    }
    await this.db.batch([
      this.db.prepare('INSERT INTO tasks (id, version, updated_at, body) VALUES (?1, ?2, ?3, ?4)')
        .bind(task.id, task.version, task.updatedAt, JSON.stringify(task)),
      this.db.prepare("UPDATE metadata SET value = value + 1 WHERE key = 'revision'"),
    ]);
    return task;
  }

  async getTask(id) {
    const row = await this.db.prepare('SELECT body FROM tasks WHERE id = ?1').bind(id).first();
    return row ? JSON.parse(row.body) : null;
  }

  async requireTask(id) {
    const task = await this.getTask(id);
    if (!task) throw new D1NotFoundError();
    return task;
  }

  async listTasks() {
    const result = await this.db.prepare('SELECT body FROM tasks ORDER BY updated_at DESC, id ASC').all();
    return result.results.map(row => JSON.parse(row.body));
  }

  async getState(capabilities = {}, since) {
    const row=await this.db.prepare("SELECT value FROM metadata WHERE key = 'revision'").first();
    const revision=Number(row?.value??0);
    if(Number.isSafeInteger(since)&&since>=0&&since===revision)return {revision,unchanged:true,capabilities};
    const [tasks,usage]=await Promise.all([this.listTasks(),this.db.prepare('SELECT body FROM usage ORDER BY provider').all()]);
    return {revision,tasks,usage:usage.results.map(row=>JSON.parse(row.body)),capabilities};
  }

  async replaceTask(id, expectedVersion, updater, authorization) {
    const current = await this.requireTask(id);
    if (!Number.isInteger(expectedVersion)) throw new ValidationError('expectedVersion is required');
    if (current.version !== expectedVersion) {
      throw new ConflictError(`version conflict: expected ${expectedVersion}, current ${current.version}`, current.version);
    }
    const next = updater(structuredClone(current));
    if (!next || next.id !== current.id || next.version !== current.version + 1) {
      throw new Error('task updater must increment version exactly once');
    }
    if(current.checkpoint?.confirmationRequired&&authorization!==REMOTE_RECOVERY&&(['ready','queued','queued_for_review','running'].includes(next.status)||JSON.stringify(next.checkpoint?.confirmationRequired)!==JSON.stringify(current.checkpoint.confirmationRequired)))throw new ConflictError('Confirm the previous remote execution through dedicated recovery',current.version);
    if(current.parentTaskId && next.status==='queued' && current.status!=='queued')throw new ConflictError('Child retry requires the delegation coordinator',current.version);
    const guard = current.parentTaskId ? ` AND EXISTS (SELECT 1 FROM tasks p WHERE p.id = ?6 AND json_extract(p.body,'$.status') = 'waiting_children' AND json_extract(p.body,'$.delegation.state') = 'waiting_children' AND json_extract(p.body,'$.delegation.batchId') = ?7 AND json_extract(p.body,'$.delegation.epoch') = ?8)` : '';
    if(current.parentTaskId && TERMINAL_STATUSES.includes(current.status))throw new ConflictError('Completed children are immutable',current.version);
    const bindings=[next.version,next.updatedAt,JSON.stringify(next),id,expectedVersion];
    if(current.parentTaskId)bindings.push(current.parentTaskId,current.batchId,current.parentEpoch);
    const results = await this.db.batch([
      this.db.prepare('UPDATE tasks SET version = ?1, updated_at = ?2, body = ?3 WHERE id = ?4 AND version = ?5' + guard)
        .bind(...bindings),
      this.db.prepare("UPDATE metadata SET value = value + 1 WHERE key = 'revision' AND changes() = 1"),
    ]);
    if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
      const latest = await this.requireTask(id);
      throw new ConflictError('task changed during update', latest.version);
    }
    return next;
  }


  // The parent CAS checks every child snapshot before any row changes. Every
  // subsequent statement is gated by the unique operation token installed by it.
  async replaceDelegation(current,next,records=[],metadataGuards=[]){
    next.delegation={...next.delegation,operationId:this.id()};
    const values=[next.version,next.updatedAt,JSON.stringify(next),current.id,current.version];
    let guard='';
    for(const record of records){if(record.current){const n=values.length;values.push(record.current.id,record.current.version);guard+=` AND EXISTS (SELECT 1 FROM tasks c WHERE c.id = ?${n+1} AND c.version = ?${n+2})`;}}
    for(const check of metadataGuards){
      if(check.expiresAt!==undefined&&Date.parse(this.now())>=check.expiresAt)throw new ConflictError('Allocation evidence expired during update',current.version);
      const n=values.length;values.push(check.key);
      if(check.stateVersion!==undefined){
        if(check.stateVersion===null)guard+=` AND NOT EXISTS (SELECT 1 FROM metadata m WHERE m.key = ?${n+1})`;
        else{values.push(check.stateVersion);guard+=` AND EXISTS (SELECT 1 FROM metadata m WHERE m.key = ?${n+1} AND json_extract(m.value,'$.stateVersion') = ?${n+2})`;}
      }else if(check.value===null)guard+=` AND NOT EXISTS (SELECT 1 FROM metadata m WHERE m.key = ?${n+1})`;
      else{values.push(check.value);guard+=` AND EXISTS (SELECT 1 FROM metadata m WHERE m.key = ?${n+1} AND m.value = ?${n+2})`;}
      if(check.expiresAt!==undefined){const at=values.length;values.push(check.expiresAt);guard+=` AND CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) < ?${at+1}`;}
    }
    const statements=[this.db.prepare('UPDATE tasks SET version = ?1, updated_at = ?2, body = ?3 WHERE id = ?4 AND version = ?5'+guard).bind(...values)];
    for(const {current:before,next:after} of records){
      if(!after)continue;
      const allowed=`EXISTS (SELECT 1 FROM tasks p WHERE p.id = ?5 AND json_extract(p.body,'$.delegation.operationId') = ?6)`;
      statements.push(before
        ? this.db.prepare(`UPDATE tasks SET version = ?2, updated_at = ?3, body = ?4 WHERE id = ?1 AND ${allowed}`).bind(after.id,after.version,after.updatedAt,JSON.stringify(after),next.id,next.delegation.operationId)
        : this.db.prepare(`INSERT INTO tasks (id,version,updated_at,body) SELECT ?1,?2,?3,?4 WHERE ${allowed}`).bind(after.id,after.version,after.updatedAt,JSON.stringify(after),next.id,next.delegation.operationId));
    }
    statements.push(this.db.prepare(`UPDATE metadata SET value = value + 1 WHERE key = 'revision' AND EXISTS (SELECT 1 FROM tasks p WHERE p.id = ?1 AND json_extract(p.body,'$.delegation.operationId') = ?2)`).bind(next.id,next.delegation.operationId));
    const results=await this.db.batch(statements);
    if(Number(results[0]?.meta?.changes??0)!==1)throw new ConflictError('Delegation changed during update',(await this.requireTask(current.id)).version);
    return next;
  }

  applyAction(id, input) {
    return this.replaceTask(id, input?.expectedVersion, current => {
      if(current.parentTaskId)throw new ValidationError('Child user mutations require the parent delegation coordinator');
      const next=applyAction(current,input,{now:this.now,id:this.id});
      if(input.action==='pause'&&current.status==='running'&&(current.checkpoint?.provider==='claude'||current.delegation?.state==='reviewing'))next.checkpoint={...next.checkpoint,status:'paused',confirmationRequired:{reason:'parent_pause',executionId:current.checkpoint.executionId,generation:current.checkpoint.generation,createdAt:next.updatedAt}};
      return next;
    });
  }

  async applyExecutionAction(id, input) {
    const snapshot = await this.requireTask(id);
    return this.replaceTask(id, snapshot.version, current => {
      this.assertExecution(current, input);
      return applyOwnedExecutionAction(current, {...input, expectedVersion: current.version}, {now: this.now, id: this.id});
    });
  }

  async requestDecision(id, input) {
    const snapshot = await this.requireTask(id);
    return this.replaceTask(id, snapshot.version, current => {
      this.assertExecution(current, input);
      const now = this.now();
      const decision = sanitizeDecision(input);
      const reviewReport=input.reviewReport===undefined?undefined:validateReviewReport(current,input,{requirePass:false});
      return {
        ...current, status: 'waiting_user', version: current.version + 1, updatedAt: now,
        decision: {...decision, createdAt: now},
        ...(reviewReport?{delegation:{...current.delegation,reviewReport}}:{}),
        checkpoint: {...current.checkpoint, status: 'waiting_user', usageHistory:usageHistory(current.checkpoint,input.usage,now), content: decision.prompt, updatedAt: now},
      };
    });
  }

  markWaiting(id, {expectedVersion, provider, reason}) {
    return this.replaceTask(id, expectedVersion, current => {
      if (TERMINAL_STATUSES.includes(current.status)) throw new ConflictError('task is terminal', current.version);
      const now = this.now();
      return {
        ...current, status: 'waiting_connection', version: current.version + 1, updatedAt: now,
        checkpoint: {...(current.checkpoint ?? {}), provider, status: 'waiting_connection', content: current.checkpoint?.content ?? reason, failure: failureRecord({failure:{kind:'unavailable'}},now), updatedAt: now},
      };
    });
  }

  claimExecution(id, {provider, expectedVersion, leaseMs = 15 * 60_000, sourceBound = false}) {
    if(typeof sourceBound!=='boolean')throw new ValidationError('sourceBound must be boolean');
    if (!['codex', 'claude'].includes(provider)) throw new ValidationError('provider must be codex or claude');
    if (!Number.isFinite(leaseMs) || leaseMs < 1_000 || leaseMs > 60 * 60_000) throw new ValidationError('invalid execution lease');
    let claim;
    return this.replaceTask(id, expectedVersion, current => {
      if(current.checkpoint?.confirmationRequired)throw new ConflictError('Confirm the previous remote execution before claiming',current.version);
      if(current.delegation && current.delegation.state!=='superseded' && (current.status!=='queued_for_review'||current.delegation.state!=='queued_for_review'))throw new ConflictError('Master can only claim the queued review phase',current.version);
      if(current.status==='running'&&current.checkpoint?.provider==='claude')throw new ConflictError('Remote execution is still owned; confirm its outcome before reclaiming',current.version);
      if(current.parentTaskId && current.status!=='queued')throw new ConflictError('Child must be queued by the delegation retry coordinator',current.version);
      if(current.delegation && current.delegation.state!=='superseded' && provider!==current.delegation.masterProvider)throw new ValidationError('Review provider must match the master provider');
      if(current.parentTaskId && provider !== current.assignment.provider)throw new ValidationError('Child provider cannot change');
      if (TERMINAL_STATUSES.includes(current.status) || ['paused','waiting_children'].includes(current.status)) {
        throw new ConflictError(`task cannot run from ${current.status}`, current.version);
      }
      const now = this.now();
      const nowMs = Date.parse(now);
      const previous = current.checkpoint ?? {};
      if (current.status === 'running' && Date.parse(previous.expiresAt) > nowMs) {
        throw new ConflictError('execution lease is already owned', current.version);
      }
      claim = {
        executionId: this.id(),
        generation: Number.isInteger(previous.generation) ? previous.generation + 1 : 1,
      };
      return {
        ...current, status: 'running', version: current.version + 1, updatedAt: now,
        ...(current.delegation?.state==='queued_for_review'?{delegation:{...current.delegation,state:'reviewing'}}:{}),
        checkpoint: {
          ...previous, ...(previous.handoff?{handoff:{...previous.handoff,dispatched:true}}:{}), failure: undefined, ...claim, provider, sourceBound, status: 'running', claimedAt: now,
          expiresAt: new Date(nowMs + leaseMs).toISOString(), updatedAt: now,
        },
      };
    }).then(task => ({...claim, task}));
  }

  assertExecution(task, input) {
    if (
      task.status !== 'running'
      || task.checkpoint?.executionId !== input.executionId
      || task.checkpoint?.generation !== input.generation
    ) throw new ConflictError('stale execution owner cannot write this task', task.version);
  }

  async handoffExecution(id,input){
    const snapshot=await this.requireTask(id);
    if(snapshot.parentTaskId)throw new ValidationError('A child cannot perform nested handoff');
    if(snapshot.delegation&&snapshot.delegation.state!=='superseded')throw new ValidationError('Active delegation master cannot hand off review');
    for(let attempt=0;attempt<3;attempt++){
      const task=await this.requireTask(id);
      if(isHandoffReplay(task,input))return task;
      try{return await this.replaceTask(id,task.version,current=>handoffTask(current,input,{now:this.now,id:this.id,recoverInterrupted:true}));}
      catch(error){if(!(error instanceof ConflictError)||attempt===2)throw error;}
    }
  }

  async finishExecution(id, input, {recoverInterrupted = false} = {}) {
    const snapshot = await this.requireTask(id);
    return this.replaceTask(id, snapshot.version, current => {
      const sameInterruptedOwner = recoverInterrupted
        && current.status === 'paused'
        && current.checkpoint?.interruptedBy === 'lease_expiry'
        && current.checkpoint?.interruptedVersion === current.version
        && current.checkpoint?.executionId === input.executionId
        && current.checkpoint?.generation === input.generation;
      if (!sameInterruptedOwner) this.assertExecution(current, input);
      const reviewReport=current.delegation&&current.delegation.state!=='superseded'?validateReviewReport(sameInterruptedOwner?{...current,status:'running'}:current,input):undefined;
      const now = this.now();
      const content = typeof input.content === 'string' ? input.content.trim() : '';
      if (!content) throw new ValidationError('execution result content is required');
      const sourceArtifacts = Array.isArray(input.artifacts) && input.artifacts.length
        ? input.artifacts
        : [{name: 'final.md', mime: 'text/markdown', content, encoding: 'utf-8'}];
      if (sourceArtifacts.length > 10) throw new ValidationError('execution returned too many artifacts');
      let total = 0;
      const artifacts = sourceArtifacts.map(item => {
        if (!item || typeof item !== 'object') throw new ValidationError('execution artifact is invalid');
        const artifactContent = typeof item.content === 'string' ? item.content : '';
        total += artifactContent.length;
        if (total > 10_000_000) throw new ValidationError('execution artifacts are too large');
        const encoding = item.encoding ?? 'utf-8';
        validateOfficeArtifact({...item,encoding});
        if (!['utf-8', 'base64'].includes(encoding)) throw new ValidationError('execution artifact encoding is invalid');
        return {
          id: this.id(), name: String(item.name || 'artifact.txt').slice(0, 500),
          mime: String(item.mime || 'text/plain').slice(0, 255), content: artifactContent,
          checks: sanitizeArtifactChecks(item.checks),
          encoding, createdAt: now,
        };
      });
      return {
        ...current, status: 'completed', version: current.version + 1, updatedAt: now,
        ...(reviewReport?{delegation:{...current.delegation,state:'completed',reviewReport}}:{}),
        messages: [...current.messages, {id: this.id(), role: 'assistant', content, createdAt: now}],
        artifacts: [...current.artifacts, ...artifacts],
        checkpoint: {...current.checkpoint, resultArtifactIds:[...current.artifacts.filter(a=>a.executionId===input.executionId&&a.generation===input.generation),...artifacts].map(a=>a.id), usage: executionUsage(current.checkpoint,input.usage,now), usageHistory: usageHistory(current.checkpoint,input.usage,now), failure: undefined, status: 'completed', content: input.checkpoint ?? 'Execution completed.', completedAt: now, updatedAt: now},
      };
    });
  }

  async leaveExecutionRunning(id, input) {
    const snapshot = await this.requireTask(id);
    return this.replaceTask(id, snapshot.version, current => {
      this.assertExecution(current, input);
      const now = this.now();
      return {
        ...current, status: 'running', version: current.version + 1, updatedAt: now,
        checkpoint: {...current.checkpoint, status: 'running', content: current.checkpoint?.content ?? input.checkpoint, sessionUrl: input.sessionUrl, updatedAt: now},
      };
    });
  }

  async failExecution(id, input) {
    const snapshot = await this.requireTask(id);
    return this.replaceTask(id, snapshot.version, current => {
      this.assertExecution(current, input);
      const now = this.now();
      const failure = failureRecord(input, now);
      const status = failure.kind === 'quota' ? 'waiting_quota' : failure.kind === 'authentication' ? 'waiting_connection' : 'failed';
      return {
        ...current, status, version: current.version + 1, updatedAt: now,
        checkpoint: {...current.checkpoint, usageHistory:usageHistory(current.checkpoint,input.usage,now), status, failure, updatedAt: now},
      };
    });
  }

  async recoverRemoteExecution(id,input){
    if(input.confirmedStopped!==true)throw new ValidationError('Confirm that the previous remote execution has stopped');
    const snapshot=await this.requireTask(id);
    if(!Number.isInteger(input.expectedVersion)||snapshot.version!==input.expectedVersion)throw new ConflictError('Remote recovery version conflict',snapshot.version);
    if(snapshot.parentTaskId)throw new ValidationError('Use the child recovery coordinator for a child task');
    const review=snapshot.delegation&&snapshot.delegation.state!=='superseded';
    if(review){
      if(!['reviewing','queued_for_review','paused'].includes(snapshot.delegation.state)||snapshot.delegation.review?.children?.length!==2)throw new ConflictError('Only an existing master review can be recovered',snapshot.version);
      const children=await Promise.all(snapshot.delegation.children.map(c=>this.requireTask(c.taskId)));
      if(children.length!==2||children.some(c=>c.status!=='completed'||c.parentTaskId!==id||c.batchId!==snapshot.delegation.batchId))throw new ConflictError('Review recovery requires both completed children',snapshot.version);
    }
    return this.replaceTask(id,input.expectedVersion,current=>{
      const checkpoint=current.checkpoint??{},confirmation=checkpoint.confirmationRequired;
      if(!['waiting_connection','paused'].includes(current.status)||!(checkpoint.provider==='claude'||(checkpoint.provider==='codex'&&review&&confirmation?.reason==='parent_pause'))||!confirmation||confirmation.executionId!==input.executionId||confirmation.generation!==input.generation||checkpoint.executionId!==input.executionId||checkpoint.generation!==input.generation)throw new ConflictError('Remote recovery owner or confirmation state changed',current.version);
      const now=this.now(),status=review?'queued_for_review':'ready';
      return {...current,status,version:current.version+1,updatedAt:now,...(review?{delegation:{...current.delegation,state:'queued_for_review'}}:{}),checkpoint:{...checkpoint,provider:review?current.delegation.masterProvider:checkpoint.provider,status,confirmationRequired:undefined,failure:undefined,executionId:undefined,expiresAt:undefined,sessionUrl:undefined,claimedAt:undefined,interruptedBy:undefined,interruptedVersion:undefined,updatedAt:now}};
    },REMOTE_RECOVERY);
  }

  async renewExecution(id,input){
    const leaseMs=input.leaseMs??15*60_000;
    if(!Number.isFinite(leaseMs)||leaseMs<1_000||leaseMs>60*60_000)throw new ValidationError('Invalid execution lease');
    const snapshot=await this.requireTask(id);
    return this.replaceTask(id,snapshot.version,current=>{
      this.assertExecution(current,input);
      const now=this.now(),nowMs=Date.parse(now),expires=Date.parse(current.checkpoint?.expiresAt);
      if(!Number.isFinite(expires)||expires<=nowMs)throw new ConflictError('Execution lease expired',current.version);
      return {...current,version:current.version+1,updatedAt:now,checkpoint:{...current.checkpoint,expiresAt:new Date(Math.max(expires,nowMs+leaseMs)).toISOString(),updatedAt:now}};
    });
  }

  async markExecutionUncertain(id,input){
    if(!['uncertain_fire','lease_expiry'].includes(input.reason))throw new ValidationError('Invalid confirmation reason');
    const snapshot=await this.requireTask(id);
    return this.replaceTask(id,snapshot.version,current=>{
      this.assertExecution(current,input);
      if(current.checkpoint?.provider!=='claude')throw new ValidationError('Only remote Claude executions require fire confirmation');
      const now=this.now();
      if(input.reason==='lease_expiry'&&!(Date.parse(current.checkpoint.expiresAt)<=Date.parse(now)))throw new ConflictError('Remote execution lease is still active',current.version);
      return {...current,status:'waiting_connection',version:current.version+1,updatedAt:now,checkpoint:{...current.checkpoint,status:'waiting_connection',confirmationRequired:{reason:input.reason,executionId:input.executionId,generation:input.generation,createdAt:now},failure:failureRecord({failure:{kind:'connection'}},now),updatedAt:now}};
    });
  }

  async recordUsage(provider, usage = {}) {
    const record = {
      provider, usedPercent: Number.isFinite(usage.usedPercent) ? usage.usedPercent : null,
      resetAt: usage.resetAt ?? null, inputTokens: Number.isFinite(usage.inputTokens) ? usage.inputTokens : null,
      outputTokens: Number.isFinite(usage.outputTokens) ? usage.outputTokens : null,
      updatedAt: this.now(), source: usage.source ?? 'executor_event',
    };
    await this.db.batch([
      this.db.prepare('INSERT INTO usage (provider, body) VALUES (?1, ?2) ON CONFLICT(provider) DO UPDATE SET body = excluded.body')
        .bind(provider, JSON.stringify(record)),
      this.db.prepare("UPDATE metadata SET value = value + 1 WHERE key = 'revision'"),
    ]);
    return record;
  }
}
