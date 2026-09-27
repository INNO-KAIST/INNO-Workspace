// Internal accounting only. An execution claim must be committed atomically with a reservation.
const PHASES = new Set(['master', 'baseline', 'candidate', 'review', 'retry', 'handoff']);
const MAX_EXECUTIONS = 100;
const MAX_DURATION_MS = 86_400_000;

function record(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).some(key => !fields.includes(key))) throw new TypeError(`invalid ${label}`);
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`invalid ${label}`);
  return value;
}
function identity(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new TypeError(`invalid ${label}`);
  return value;
}
function instant(options) {
  record(options, ['now'], 'clock');
  return integer(options.now, 0, Number.MAX_SAFE_INTEGER, 'clock time');
}
function freeze(state) {
  for (const reservation of state.reservations) Object.freeze(reservation);
  Object.freeze(state.reservations);
  return Object.freeze(state);
}
function totals(reservations, totalDurationMs) {
  let chargedDurationMs = 0;
  let latestEventAtMs = null;
  let overrun = false;
  for (const item of reservations) {
    chargedDurationMs += item.status === 'reserved' ? item.maxDurationMs : item.elapsedMs;
    if (!Number.isSafeInteger(chargedDurationMs)) throw new RangeError('corrupt budget total');
    latestEventAtMs = Math.max(latestEventAtMs ?? 0, item.reservedAtMs, item.settledAtMs ?? 0);
    if (item.status === 'settled' && item.elapsedMs > item.maxDurationMs) overrun = true;
  }
  return {usedExecutions: reservations.length, chargedDurationMs,
    overrun: overrun || chargedDurationMs > totalDurationMs, latestEventAtMs};
}

export function createEvaluationBudget(input) {
  record(input, ['jobId', 'maxExecutions', 'totalDurationMs'], 'budget');
  const jobId = identity(input.jobId, 'jobId');
  const maxExecutions = integer(input.maxExecutions ?? 0, 0, MAX_EXECUTIONS, 'maxExecutions');
  const totalDurationMs = integer(input.totalDurationMs ?? 0, 0, MAX_DURATION_MS, 'totalDurationMs');
  return freeze({schemaVersion: 1, stateVersion: 1, jobId, maxExecutions, totalDurationMs,
    usedExecutions: 0, chargedDurationMs: 0, overrun: false, latestEventAtMs: null, reservations: []});
}

export function validateEvaluationBudget(state) {
  record(state, ['schemaVersion', 'stateVersion', 'jobId', 'maxExecutions', 'totalDurationMs',
    'usedExecutions', 'chargedDurationMs', 'overrun', 'latestEventAtMs', 'reservations'], 'stored budget');
  if (state.schemaVersion !== 1) throw new TypeError('invalid budget schema');
  identity(state.jobId, 'jobId');
  integer(state.maxExecutions, 0, MAX_EXECUTIONS, 'maxExecutions');
  integer(state.totalDurationMs, 0, MAX_DURATION_MS, 'totalDurationMs');
  if (!Array.isArray(state.reservations) || state.reservations.length > MAX_EXECUTIONS ||
      state.reservations.length > state.maxExecutions) throw new TypeError('invalid reservations');
  const seen = new Set();
  let settled = 0;
  for (const [index, item] of state.reservations.entries()) {
    record(item, ['executionId', 'generation', 'phase', 'maxDurationMs', 'reservedAtMs', 'deadlineAtMs',
      'status', 'elapsedMs', 'settledAtMs'], 'reservation');
    identity(item.executionId, 'executionId');
    if (seen.has(item.executionId)) throw new TypeError('duplicate executionId');
    seen.add(item.executionId);
    integer(item.generation, 1, Number.MAX_SAFE_INTEGER, 'generation');
    if (!PHASES.has(item.phase)) throw new TypeError('invalid phase');
    integer(item.maxDurationMs, 1, MAX_DURATION_MS, 'maxDurationMs');
    if (item.maxDurationMs > state.totalDurationMs) throw new TypeError('invalid reservation limit');
    integer(item.reservedAtMs, 0, Number.MAX_SAFE_INTEGER, 'reservedAtMs');
    if (!Number.isSafeInteger(item.deadlineAtMs) || item.deadlineAtMs !== item.reservedAtMs + item.maxDurationMs)
      throw new TypeError('invalid deadlineAtMs');
    if (item.status === 'reserved') {
      if (item.elapsedMs !== null || item.settledAtMs !== null) throw new TypeError('invalid reserved state');
    } else if (item.status === 'settled') {
      settled++;
      integer(item.elapsedMs, 0, Number.MAX_SAFE_INTEGER, 'elapsedMs');
      integer(item.settledAtMs, item.reservedAtMs, Number.MAX_SAFE_INTEGER, 'settledAtMs');
    } else throw new TypeError('invalid reservation status');
    if (index) {
      const previous = state.reservations[index - 1];
      if (item.reservedAtMs < previous.reservedAtMs) throw new TypeError('invalid reservation order');
      for (const earlier of state.reservations.slice(0, index)) {
        if (earlier.reservedAtMs <= item.reservedAtMs &&
            (earlier.settledAtMs === null || earlier.settledAtMs > item.reservedAtMs) &&
            item.reservedAtMs >= earlier.deadlineAtMs)
          throw new TypeError('corrupt expired reservation history');
      }
    }
  }
  const derived = totals(state.reservations, state.totalDurationMs);
  if (state.stateVersion !== 1 + state.reservations.length + settled ||
      state.usedExecutions !== derived.usedExecutions || state.chargedDurationMs !== derived.chargedDurationMs ||
      state.overrun !== derived.overrun || state.latestEventAtMs !== derived.latestEventAtMs)
    throw new TypeError('corrupt budget totals');
  return freeze(state);
}

export function reserveEvaluation(state, input, options) {
  validateEvaluationBudget(state);
  record(input, ['executionId', 'generation', 'phase', 'maxDurationMs'], 'reservation request');
  const executionId = identity(input.executionId, 'executionId');
  const generation = integer(input.generation, 1, Number.MAX_SAFE_INTEGER, 'generation');
  if (!PHASES.has(input.phase)) throw new TypeError('invalid phase');
  const maxDurationMs = integer(input.maxDurationMs, 1, MAX_DURATION_MS, 'maxDurationMs');
  const existing = state.reservations.find(item => item.executionId === executionId);
  if (existing) {
    if (existing.generation !== generation || existing.phase !== input.phase || existing.maxDurationMs !== maxDurationMs)
      throw new Error('reservation conflict');
    return state;
  }
  const now = instant(options);
  if (state.latestEventAtMs !== null && now < state.latestEventAtMs) throw new Error('clock moved backward');
  if (state.overrun) throw new Error('budget overrun');
  if (state.reservations.some(item => item.status === 'reserved' && now >= item.deadlineAtMs))
    throw new Error('unconfirmed_expired_reservation');
  if (state.usedExecutions >= state.maxExecutions || maxDurationMs > state.totalDurationMs - state.chargedDurationMs)
    throw new Error('evaluation budget limit exceeded');
  const deadlineAtMs = now + maxDurationMs;
  if (!Number.isSafeInteger(deadlineAtMs)) throw new RangeError('deadline overflow');
  const reservations = [...state.reservations, {executionId, generation, phase: input.phase, maxDurationMs,
    reservedAtMs: now, deadlineAtMs, status: 'reserved', elapsedMs: null, settledAtMs: null}];
  return freeze({...state, ...totals(reservations, state.totalDurationMs), stateVersion: state.stateVersion + 1, reservations});
}

export function settleEvaluation(state, input, options) {
  validateEvaluationBudget(state);
  record(input, ['executionId', 'generation', 'elapsedMs'], 'settlement request');
  const executionId = identity(input.executionId, 'executionId');
  const generation = integer(input.generation, 1, Number.MAX_SAFE_INTEGER, 'generation');
  const elapsedMs = integer(input.elapsedMs, 0, Number.MAX_SAFE_INTEGER, 'elapsedMs');
  const index = state.reservations.findIndex(item => item.executionId === executionId);
  if (index < 0 || state.reservations[index].generation !== generation) throw new Error('execution conflict');
  const existing = state.reservations[index];
  if (existing.status === 'settled') {
    if (existing.elapsedMs !== elapsedMs) throw new Error('settlement conflict');
    return state;
  }
  const now = instant(options);
  if (now < existing.reservedAtMs || (state.latestEventAtMs !== null && now < state.latestEventAtMs))
    throw new Error('clock moved backward');
  const reservations = [...state.reservations];
  reservations[index] = {...existing, status: 'settled', elapsedMs, settledAtMs: now};
  return freeze({...state, ...totals(reservations, state.totalDurationMs), stateVersion: state.stateVersion + 1, reservations});
}
