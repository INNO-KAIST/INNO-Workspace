import test from 'node:test';
import assert from 'node:assert/strict';
import {createEvaluationBudget, reserveEvaluation, settleEvaluation, validateEvaluationBudget} from '../public/core/evaluation-budget.mjs';

const request = (executionId, maxDurationMs = 100) => ({executionId, generation: 1, phase: 'candidate', maxDurationMs});
const clock = now => ({now});

test('default zero budget refuses an execution and immutable limits reject invalid bounds', () => {
  const empty = createEvaluationBudget({jobId: 'comparison-1'});
  assert.equal(empty.maxExecutions, 0);
  assert.equal(empty.totalDurationMs, 0);
  assert.throws(() => reserveEvaluation(empty, request('run-1'), clock(10)), /budget|limit/i);
  for (const limits of [{maxExecutions: 101}, {totalDurationMs: 86400001}, {maxExecutions: -1}, {totalDurationMs: 1.5}]) {
    assert.throws(() => createEvaluationBudget({jobId: 'comparison-1', ...limits}), /invalid|range/i);
  }
});

test('the last count and worst-case time are held, and exact retries consume nothing', () => {
  const initial = createEvaluationBudget({jobId: 'job', maxExecutions: 1, totalDurationMs: 100});
  const reserved = reserveEvaluation(initial, request('run-1'), clock(1000));
  assert.equal(reserved.usedExecutions, 1);
  assert.equal(reserved.chargedDurationMs, 100);
  assert.equal(reserved.reservations[0].reservedAtMs, 1000);
  assert.equal(reserved.reservations[0].deadlineAtMs, 1100);
  assert.equal(reserveEvaluation(reserved, request('run-1'), clock(9999)), reserved);
  assert.throws(() => reserveEvaluation(reserved, request('run-2', 1), clock(1001)), /budget|limit/i);
  assert.throws(() => reserveEvaluation(reserved, request('run-1', 99), clock(1001)), /conflict/i);
  assert.throws(() => reserveEvaluation(reserved, {...request('run-1'), generation: 2}, clock(1001)), /conflict/i);
  assert.throws(() => reserveEvaluation(reserved, {...request('run-1'), phase: 'review'}, clock(1001)), /conflict/i);
  assert.equal(initial.usedExecutions, 0);
});

test('settled elapsed time releases only unused time, never the attempt count', () => {
  let state = createEvaluationBudget({jobId: 'job', maxExecutions: 2, totalDurationMs: 100});
  state = reserveEvaluation(state, request('first', 80), clock(100));
  assert.throws(() => reserveEvaluation(state, request('second', 30), clock(101)), /budget|limit/i);
  state = settleEvaluation(state, {executionId: 'first', generation: 1, elapsedMs: 40}, clock(140));
  assert.equal(state.usedExecutions, 1);
  assert.equal(state.chargedDurationMs, 40);
  assert.equal(settleEvaluation(state, {executionId: 'first', generation: 1, elapsedMs: 40}, clock(0)), state);
  assert.throws(() => settleEvaluation(state, {executionId: 'first', generation: 1, elapsedMs: 39}, clock(141)), /conflict/i);
  state = reserveEvaluation(state, request('second', 60), clock(141));
  assert.equal(state.chargedDurationMs, 100);
  assert.throws(() => reserveEvaluation(state, request('third', 1), clock(142)), /budget|limit/i);
});

test('missing completion, backward clock, and unknown elapsed do not refund a reservation', () => {
  const initial = createEvaluationBudget({jobId: 'job', maxExecutions: 2, totalDurationMs: 100});
  const state = reserveEvaluation(initial, request('first'), clock(100));
  assert.throws(() => settleEvaluation(state, {executionId: 'first', generation: 1, elapsedMs: null}, clock(200)), /elapsed|invalid/i);
  assert.throws(() => settleEvaluation(state, {executionId: 'first', generation: 1, elapsedMs: 10}, clock(99)), /clock|time/i);
  assert.throws(() => reserveEvaluation(state, request('second', 1), clock(99)), /clock|time/i);
  assert.equal(state.reservations[0].status, 'reserved');
  const zero = settleEvaluation(state, {executionId: 'first', generation: 1, elapsedMs: 0}, clock(100));
  assert.equal(zero.chargedDurationMs, 0);
});

test('overrun is retained and prevents any later reservation', () => {
  let state = createEvaluationBudget({jobId: 'job', maxExecutions: 3, totalDurationMs: 100});
  state = reserveEvaluation(state, request('first', 50), clock(100));
  state = settleEvaluation(state, {executionId: 'first', generation: 1, elapsedMs: 60}, clock(160));
  assert.equal(state.overrun, true);
  assert.equal(state.chargedDurationMs, 60);
  assert.throws(() => reserveEvaluation(state, request('second', 1), clock(161)), /overrun/i);
});

test('an expired unconfirmed reservation blocks another ID without losing exact replay', () => {
  let state = createEvaluationBudget({jobId: 'job', maxExecutions: 3, totalDurationMs: 100});
  state = reserveEvaluation(state, request('first', 50), clock(100));
  assert.equal(reserveEvaluation(state, request('first', 50), clock(200)), state);
  assert.throws(() => reserveEvaluation(state, request('second', 50), clock(200)), /unconfirmed_expired_reservation/i);
});

test('delayed receipt can settle from trusted elapsed without a false overrun', () => {
  let state = createEvaluationBudget({jobId: 'job', maxExecutions: 3, totalDurationMs: 100});
  state = reserveEvaluation(state, request('first', 50), clock(100));
  state = settleEvaluation(state, {executionId: 'first', generation: 1, elapsedMs: 40}, clock(200));
  assert.equal(state.overrun, false);
  assert.equal(reserveEvaluation(state, request('second', 50), clock(201)).usedExecutions, 2);
});

test('validated stored totals, identities, and reservation shapes cannot be forged', () => {
  const state = reserveEvaluation(createEvaluationBudget({jobId: 'job', maxExecutions: 2, totalDurationMs: 100}), request('first', 50), clock(1));
  for (const changed of [
    {...state, usedExecutions: 0},
    {...state, chargedDurationMs: 0},
    {...state, reservations: [...state.reservations, state.reservations[0]]},
    {...state, reservations: [{...state.reservations[0], elapsedMs: 0}]},
  ]) assert.throws(() => validateEvaluationBudget(changed), /invalid|corrupt|duplicate/i);
});

test('stored history cannot claim a later reservation while an earlier one was already expired and unresolved', () => {
  let state = createEvaluationBudget({jobId: 'job', maxExecutions: 3, totalDurationMs: 100});
  state = reserveEvaluation(state, request('first', 50), clock(100));
  state = reserveEvaluation(state, request('second', 50), clock(149));
  const forged = {...state, reservations: [state.reservations[0], {...state.reservations[1], reservedAtMs: 151, deadlineAtMs: 201}],
    latestEventAtMs: 151};
  assert.throws(() => validateEvaluationBudget(forged), /invalid|corrupt/i);
});

test('stored settled rows cannot conceal a reservation larger than the immutable total', () => {
  let state = createEvaluationBudget({jobId: 'job', maxExecutions: 1, totalDurationMs: 1});
  state = reserveEvaluation(state, request('first', 1), clock(100));
  state = settleEvaluation(state, {executionId: 'first', generation: 1, elapsedMs: 0}, clock(101));
  assert.throws(() => validateEvaluationBudget({...state, totalDurationMs: 0}), /invalid|corrupt/i);
});
