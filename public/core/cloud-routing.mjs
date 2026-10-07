import {providerLabel, providersByTransport, usesTransport} from './providers.mjs';
import {providerEnabled} from './provider-settings.mjs';
import {ValidationError} from './tasks.mjs';

// CR-010: the "auto" runner for a source-free top-level task. The task goes to this PC's desktop
// runner when the connector reports it ready, otherwise to the cloud Routine; one sent to the PC
// that has not started after AUTO_SWITCH_AFTER_MS moves once, before it starts, to the Routine.
// The decision and its reason are kept in checkpoint.routing. Tasks with originals, children and
// delegated work, explicit choices, and running or uncertain executions are never moved.
export const AUTO_PROVIDER = 'auto';
export const AUTO_SWITCH_AFTER_MS = 600_000;
const desktopProvider = () => providersByTransport('desktop_bridge')[0];
const cloudProvider = () => providersByTransport('routine_fire')[0];

export function autoRoutingBlocker(task) {
  if (!task) return null;
  if (task.attachments?.length) return '원본 파일이 연결된 작업은 자동 배정을 쓸 수 없습니다. 이 PC 실행기를 고르세요.';
  if (task.evaluationBudget) return '비교 평가 작업은 자동 배정을 쓸 수 없습니다.';
  if (task.parentTaskId || (task.delegation && !['superseded', 'cancelled'].includes(task.delegation.state))) return '하위 작업이나 병렬 작업은 자동 배정을 쓸 수 없습니다.';
  return null;
}

// PC first: the desktop runner when it is on and ready; otherwise the cloud Routine when it is on
// and configured; otherwise wait for the PC. A connector that reports no runners counts as ready
// while it is online and not reporting a problem.
export function chooseAutoProvider({desktop, settings, cloudConfigured}) {
  const desktopId = desktopProvider(), cloudId = cloudProvider();
  const desktopOn = providerEnabled(settings, desktopId), cloudOn = Boolean(cloudConfigured) && providerEnabled(settings, cloudId);
  const desktopReady = Boolean(desktop?.online) && !desktop.notReady && (!desktop.providers || Boolean(desktop.providers.ready?.includes(desktopId)));
  if (desktopOn && desktopReady) return {provider: desktopId, reason: 'desktop_ready'};
  if (cloudOn) return {provider: cloudId, reason: !desktopOn ? 'desktop_off' : desktop?.online ? 'desktop_not_ready' : 'desktop_offline'};
  if (desktopOn) return {provider: desktopId, reason: 'cloud_unavailable'};
  throw new ValidationError('사용할 수 있는 실행기가 없습니다. 연결 앱의 AI 실행기 설정을 확인하세요.');
}

// The stored record. Only a task sent to a ready PC may move later.
export function autoRouting({provider, reason}, now) {
  const movable = usesTransport(provider, 'desktop_bridge') && reason === 'desktop_ready';
  return {mode: 'auto', provider, reason, decidedAt: now, ...(movable ? {switchAfter: new Date(Date.parse(now) + AUTO_SWITCH_AFTER_MS).toISOString()} : {})};
}

// Only a task that has not started since the decision (no claim at or after it). A handoff
// clears the record, so an old handoff record left in the checkpoint does not matter here.
export function autoSwitchDue(task, nowMs) {
  const routing = task?.checkpoint?.routing;
  return task?.status === 'queued' && routing?.mode === 'auto' && !routing.switchedAt && typeof routing.switchAfter === 'string'
    && Date.parse(routing.switchAfter) <= nowMs && usesTransport(task.checkpoint.provider, 'desktop_bridge') && !autoRoutingBlocker(task)
    && !(Date.parse(task.checkpoint.claimedAt) >= Date.parse(routing.decidedAt));
}

const REASONS = {desktop_offline: 'PC 오프라인', desktop_not_ready: 'PC 실행기 준비 안 됨', desktop_off: 'PC 실행기 사용 중지'};
export function routingText(routing) {
  if (routing?.mode !== 'auto') return '';
  const cloud = providerLabel(cloudProvider()), label = providerLabel(routing.provider);
  if (routing.switchedAt) return `자동 배정: PC에서 10분 동안 시작되지 않아 클라우드 ${cloud}로 옮겼습니다.`;
  if (usesTransport(routing.provider, 'desktop_bridge')) return routing.reason === 'desktop_ready'
    ? `자동 배정: 이 PC(${label}) — PC 실행기가 준비돼 있어 보냈습니다. 10분 안에 시작되지 않으면 클라우드 ${cloud}로 한 번 옮깁니다.`
    : `자동 배정: 이 PC(${label}) — 클라우드 Routine을 쓸 수 없어 PC를 기다립니다.`;
  return `자동 배정: 클라우드 ${label} — ${REASONS[routing.reason] ?? '클라우드로 보냄'}.`;
}
