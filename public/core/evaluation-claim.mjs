import {reserveEvaluation, validateEvaluationBudget} from './evaluation-budget.mjs';
import {ConflictError, ValidationError} from './tasks.mjs';

const PHASES = new Set(['master', 'baseline', 'candidate', 'review', 'retry', 'handoff']);
const ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function evaluationBinding(input, state) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['jobId', 'phase', 'maxDurationMs', 'provider', 'expectedVersion'].includes(key)))
    throw new ValidationError('invalid evaluation budget binding');
  if (typeof input.jobId !== 'string' || !ID.test(input.jobId) || !PHASES.has(input.phase) ||
      !Number.isSafeInteger(input.maxDurationMs) || input.maxDurationMs < 1 ||
      input.provider !== undefined && input.provider !== 'codex')
    throw new ValidationError('invalid evaluation budget binding');
  validateEvaluationBudget(state);
  if (state.jobId !== input.jobId || input.maxDurationMs > state.totalDurationMs)
    throw new ValidationError('evaluation budget binding does not match ledger');
  return {jobId: input.jobId, phase: input.phase, maxDurationMs: input.maxDurationMs, provider: 'codex'};
}

export function assertEvaluationAttachable(task) {
  if (task.status !== 'ready' || task.version !== 1 || task.checkpoint || task.parentTaskId || task.provenance ||
      task.delegation || task.evaluationBudget || task.messages?.length !== 1 ||
      task.messages[0]?.role !== 'user')
    throw new ConflictError('evaluation budget requires a fresh ready root task', task.version);
}

export function assertEvaluationBindingPreserved(current, next, allowAttach = false) {
  if (allowAttach && !current.evaluationBudget && next.evaluationBudget) return;
  if (JSON.stringify(current.evaluationBudget) !== JSON.stringify(next.evaluationBudget))
    throw new ConflictError('evaluation budget binding is immutable', current.version);
}

export function reserveClaimBudget(task, input, claim, rawState, nowMs) {
  if (!task.evaluationBudget) {
    if (input.executionBudgetVersion !== undefined) throw new ValidationError('unsupported execution budget option');
    return null;
  }
  if (input.executionBudgetVersion !== 1 || input.provider !== 'codex' ||
      task.evaluationBudget.provider !== 'codex')
    throw new ValidationError('evaluation execution requires Codex budget capability version 1');
  const binding = evaluationBinding(task.evaluationBudget, rawState);
  if (task.status === 'running') throw new ConflictError('Previous evaluation execution is still owned', task.version);
  if (task.checkpoint?.evaluationBudget) {
    const prior = rawState.reservations.find(item => item.executionId === task.checkpoint.executionId &&
      item.generation === task.checkpoint.generation);
    if (!prior || prior.status !== 'settled')
      throw new ConflictError('Previous evaluation execution requires trusted settlement', task.version);
  }
  if (rawState.reservations.some(item => item.executionId === claim.executionId))
    throw new ConflictError('evaluation execution identifier already reserved', task.version);
  const state = reserveEvaluation(rawState, {...claim, phase: binding.phase,
    maxDurationMs: binding.maxDurationMs}, {now: nowMs});
  const reservation = state.reservations.find(item => item.executionId === claim.executionId);
  return {state, checkpoint: {jobId: binding.jobId, phase: binding.phase,
    maxDurationMs: binding.maxDurationMs, deadlineAtMs: reservation.deadlineAtMs}};
}
