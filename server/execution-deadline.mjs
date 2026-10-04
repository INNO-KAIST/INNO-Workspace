import {providerHas} from '../public/core/providers.mjs';

const PHASES = new Set(['master','baseline','candidate','review','retry','handoff']);
const ID = /^[A-Za-z0-9._:-]{1,128}$/;

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validateExecutionDeadline(task, {executionId,generation,executionBudgetVersion}, wallNow, monotonicNow) {
  if (!task?.evaluationBudget) {
    if (executionBudgetVersion !== undefined) throw new Error('unsupported execution budget version');
    return null;
  }
  const binding=task.evaluationBudget;
  const checkpoint=task.checkpoint;
  const budget=checkpoint?.evaluationBudget;
  const claimedAtMs=Date.parse(checkpoint?.claimedAt);
  if (executionBudgetVersion !== 1 || task.status !== 'running' ||
      task.parentTaskId || task.assignment || task.delegation ||
      !executionId || checkpoint?.executionId !== executionId ||
      !Number.isSafeInteger(generation) || generation < 1 || checkpoint?.generation !== generation ||
      !providerHas(checkpoint?.provider, 'evaluationBudget', true) || binding.provider !== checkpoint.provider ||
      typeof binding.jobId !== 'string' || !ID.test(binding.jobId) || !PHASES.has(binding.phase) ||
      !Number.isSafeInteger(binding.maxDurationMs) || binding.maxDurationMs < 1 || binding.maxDurationMs > 86_400_000 ||
      budget?.jobId !== binding.jobId || budget?.phase !== binding.phase ||
      budget?.maxDurationMs !== binding.maxDurationMs ||
      !validTime(claimedAtMs) || !validTime(budget?.deadlineAtMs) ||
      !Number.isSafeInteger(claimedAtMs + binding.maxDurationMs) ||
      budget.deadlineAtMs !== claimedAtMs + binding.maxDurationMs)
    throw new Error('invalid evaluation budget claim or ownership');
  if (!validTime(wallNow) || wallNow < claimedAtMs || !Number.isFinite(monotonicNow))
    throw new Error('invalid evaluation budget clock');
  if (wallNow >= budget.deadlineAtMs) throw new Error('evaluation deadline expired');
  return {deadlineAtMs:budget.deadlineAtMs,wallAtEntry:wallNow,monoAtEntry:monotonicNow,
    maxDurationMs:binding.maxDurationMs};
}

export function remainingExecutionMs(deadline, wallNow, monotonicNow) {
  if (!validTime(wallNow) || wallNow < deadline.wallAtEntry ||
      !Number.isFinite(monotonicNow) || monotonicNow < deadline.monoAtEntry)
    throw new Error('invalid evaluation budget clock');
  const elapsed=monotonicNow-deadline.monoAtEntry;
  const remaining=Math.min(deadline.deadlineAtMs-wallNow,
    deadline.deadlineAtMs-deadline.wallAtEntry-elapsed);
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error('evaluation deadline expired');
  return remaining;
}

export function localExecutionObservation(startedAt, closedAt, {rootProcessClosed=false,deadlineExceeded=false}={}) {
  // Local root close is not proof that descendants or remote inference stopped; never settle a ledger from this.
  const elapsedMs=Number.isFinite(startedAt)&&Number.isFinite(closedAt)&&closedAt>=startedAt&&
    Number.isSafeInteger(Math.ceil(closedAt-startedAt))?Math.ceil(closedAt-startedAt):null;
  return {started:startedAt!==null,rootProcessClosed,elapsedMs,deadlineExceeded};
}
