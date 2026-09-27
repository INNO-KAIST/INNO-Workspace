import {createEvaluationBudget, reserveEvaluation, settleEvaluation, validateEvaluationBudget} from '../public/core/evaluation-budget.mjs';

const PREFIX = 'evaluation_budget:';
const MAX_JOBS = 32; // Temporary safe ceiling; lifecycle archival must be designed before broad UI exposure.
const MAX_STATE_BYTES = 256 * 1024;
const encoder = new TextEncoder();

function shape(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).some(field => !fields.includes(field))) throw new TypeError(`invalid ${label}`);
}
function identifier(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new TypeError(`invalid ${label}`);
  return value;
}
function version(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('invalid expectedStateVersion');
  return value;
}
function textFor(state) {
  const text = JSON.stringify(state);
  if (encoder.encode(text).length > MAX_STATE_BYTES) throw new RangeError('evaluation budget capacity exceeded');
  return text;
}
function parse(raw, jobId) {
  if (typeof raw !== 'string' || encoder.encode(raw).length > MAX_STATE_BYTES) throw new TypeError('invalid stored budget size');
  let state;
  try { state = JSON.parse(raw); } catch { throw new TypeError('invalid stored budget JSON'); }
  validateEvaluationBudget(state);
  if (state.jobId !== jobId) throw new TypeError('invalid stored budget identity');
  return state;
}
function boundEvidence(evidence, state, reservation) {
  shape(evidence, ['jobId', 'executionId', 'generation', 'phase', 'confirmed', 'elapsedMs'], 'completion evidence');
  if (evidence.confirmed !== true || evidence.jobId !== state.jobId ||
      evidence.executionId !== reservation.executionId || evidence.generation !== reservation.generation ||
      evidence.phase !== reservation.phase || !Number.isSafeInteger(evidence.elapsedMs) || evidence.elapsedMs < 0)
    throw new TypeError('completion evidence does not match reserved execution');
  return evidence.elapsedMs;
}

// Internal ledger methods are not an execution permit. The future claim path must atomically
// commit task ownership and reserve() against the same authoritative transaction/CAS.
export function createEvaluationBudgetMethods(adapter, {now = Date.now, verifyCompletion} = {}) {
  if (typeof now !== 'function') throw new TypeError('invalid trusted clock');
  if (verifyCompletion !== undefined && typeof verifyCompletion !== 'function') throw new TypeError('invalid completion verifier');
  const rawFor = async jobId => adapter.read(PREFIX + jobId);
  const load = async jobId => {
    identifier(jobId, 'jobId');
    const raw = await rawFor(jobId);
    if (raw === null || raw === undefined) throw new Error('evaluation budget not found');
    return {raw, state: parse(raw, jobId)};
  };
  return {
    async create(input) {
      const state = createEvaluationBudget(input);
      const key = PREFIX + state.jobId;
      const inserted = await adapter.create(key, textFor(state), MAX_JOBS);
      if (inserted) return state;
      const existingRaw = await adapter.read(key);
      if (existingRaw === null || existingRaw === undefined) throw new Error('evaluation budget capacity exceeded');
      const existing = parse(existingRaw, state.jobId);
      if (existing.maxExecutions !== state.maxExecutions || existing.totalDurationMs !== state.totalDurationMs)
        throw new Error('evaluation budget creation conflict');
      return existing;
    },
    async read(jobId) {
      return (await load(jobId)).state;
    },
    async reserve(jobId, input) {
      shape(input, ['executionId', 'generation', 'phase', 'maxDurationMs', 'expectedStateVersion'], 'reservation request');
      version(input.expectedStateVersion);
      const {raw, state} = await load(jobId);
      const request = {executionId: input.executionId, generation: input.generation,
        phase: input.phase, maxDurationMs: input.maxDurationMs};
      const prior = state.reservations.find(item => item.executionId === input.executionId);
      if (prior) return reserveEvaluation(state, request, {now: 0}); // Exact replay ignores current clock and version.
      if (state.stateVersion !== input.expectedStateVersion) throw new Error('stale evaluation budget state conflict');
      const next = reserveEvaluation(state, request, {now: now()});
      if (!await adapter.compareAndSwap(PREFIX + jobId, raw, textFor(next)))
        throw new Error('stale evaluation budget state conflict');
      return next;
    },
    async settle(jobId, input) {
      shape(input, ['executionId', 'generation', 'expectedStateVersion'], 'settlement request');
      version(input.expectedStateVersion);
      const {raw, state} = await load(jobId);
      const reservation = state.reservations.find(item => item.executionId === input.executionId);
      if (!reservation || reservation.generation !== input.generation) throw new Error('execution conflict');
      if (reservation.status !== 'settled' && state.stateVersion !== input.expectedStateVersion)
        throw new Error('stale evaluation budget state conflict');
      if (!verifyCompletion) throw new Error('trusted completion verifier required');
      const evidence = await verifyCompletion({jobId: state.jobId, executionId: reservation.executionId,
        generation: reservation.generation, phase: reservation.phase, reservation});
      const elapsedMs = boundEvidence(evidence, state, reservation);
      const request = {executionId: reservation.executionId, generation: reservation.generation, elapsedMs};
      if (reservation.status === 'settled') return settleEvaluation(state, request, {now: 0});
      const next = settleEvaluation(state, request, {now: now()});
      if (!await adapter.compareAndSwap(PREFIX + jobId, raw, textFor(next)))
        throw new Error('stale evaluation budget state conflict');
      return next;
    },
  };
}

export class D1EvaluationBudgets {
  constructor(db, options = {}) {
    if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') throw new TypeError('D1 database required');
    const adapter = {
      read: async key => (await db.prepare('SELECT value FROM metadata WHERE key=?1').bind(key).first())?.value ?? null,
      create: async (key, raw, limit) => {
        const results = await db.batch([
          db.prepare(`INSERT INTO metadata(key,value) SELECT ?1,?2 WHERE
            (SELECT COUNT(*) FROM metadata WHERE key GLOB 'evaluation_budget:*') < ?3
            ON CONFLICT(key) DO NOTHING`).bind(key, raw, limit),
          db.prepare("UPDATE metadata SET value=value+1 WHERE key='revision' AND changes()=1"),
        ]);
        return Number(results[0].meta.changes) === 1;
      },
      compareAndSwap: async (key, prior, next) => {
        const results = await db.batch([
          db.prepare('UPDATE metadata SET value=?1 WHERE key=?2 AND value=?3').bind(next, key, prior),
          db.prepare("UPDATE metadata SET value=value+1 WHERE key='revision' AND changes()=1"),
        ]);
        return Number(results[0].meta.changes) === 1;
      },
    };
    Object.assign(this, createEvaluationBudgetMethods(adapter, options));
  }
}
