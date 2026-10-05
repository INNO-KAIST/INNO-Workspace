import {ValidationError} from './tasks.mjs';
import {isProviderId} from './providers.mjs';

// Per-execution record of how task context was delivered. Byte counts only:
// providers do not report per-part tokens here, so token fields stay null.
const READINESS = new Set(['full_ready', 'full_over_budget', 'selected_ready', 'blocked']);
const KEYS = ['version','provider','unit','readiness','contextBytes','originalBytes','selectionSavedBytes','omittedMessages','maxBytes','hardMaxBytes','reader','promptBytes','materialBytes','inputTokens','cachedTokens'];

export function contextDelivery(packet, {provider, promptBytes = null, materialBytes = null, reader = false} = {}) {
  const budget = packet.manifest.budget, metrics = packet.metrics, selected = packet.readiness === 'selected_ready';
  return boundedContextDelivery({
    version: 1, provider, unit: 'utf8_bytes', readiness: packet.readiness,
    contextBytes: metrics.inputBytes, originalBytes: metrics.uncompressedBytes,
    selectionSavedBytes: selected ? metrics.selectionSavedBytes : 0, omittedMessages: packet.manifest.omissions.length,
    maxBytes: budget.maxBytes, hardMaxBytes: budget.hardMaxBytes, reader,
    promptBytes, materialBytes, inputTokens: null, cachedTokens: null,
  });
}

export function boundedContextDelivery(value) {
  if (value == null) return null;
  const fail = field => { throw new ValidationError(`context delivery ${field} is invalid`); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('record');
  if (Object.keys(value).some(key => !KEYS.includes(key)) || KEYS.some(key => !Object.hasOwn(value, key))) fail('shape');
  const count = (field, nullable = false) => {
    const n = value[field];
    if (nullable && n === null) return null;
    if (!Number.isSafeInteger(n) || n < 0) fail(field);
    return n;
  };
  if (value.version !== 1) fail('version');
  if (!isProviderId(value.provider)) fail('provider');
  if (value.unit !== 'utf8_bytes') fail('unit');
  if (!READINESS.has(value.readiness)) fail('readiness');
  if (typeof value.reader !== 'boolean') fail('reader');
  if (value.inputTokens !== null) fail('inputTokens');
  if (value.cachedTokens !== null) fail('cachedTokens');
  return {
    version: 1, provider: value.provider, unit: 'utf8_bytes', readiness: value.readiness,
    contextBytes: count('contextBytes'), originalBytes: count('originalBytes'), selectionSavedBytes: count('selectionSavedBytes'),
    omittedMessages: count('omittedMessages'), maxBytes: count('maxBytes'), hardMaxBytes: count('hardMaxBytes'), reader: value.reader,
    promptBytes: count('promptBytes', true), materialBytes: count('materialBytes', true), inputTokens: null, cachedTokens: null,
  };
}

const kb = bytes => `${Math.round(bytes / 100) / 10}KB`;

export function contextDeliveryText(value) {
  let d;
  try { d = boundedContextDelivery(value); } catch { return null; }
  if (!d) return null;
  const main = d.readiness === 'blocked'
    ? `문맥 전달 차단: 필수 문맥 ${kb(d.contextBytes)}가 상한 ${kb(d.hardMaxBytes)}를 넘어 실행하지 않았습니다.`
    : d.readiness === 'selected_ready'
      ? `문맥 전달: 선택 ${kb(d.contextBytes)} (원문 ${d.omittedMessages}건 생략, ${kb(d.selectionSavedBytes)} 감소, 필요 시 원문 재조회).${d.contextBytes > d.maxBytes ? ` 전문이 상한을 넘어 선택해 전달했습니다(예산 ${kb(d.maxBytes)} 초과, 상한 ${kb(d.hardMaxBytes)} 이내).` : ''}`
      : d.readiness === 'full_over_budget'
        ? `문맥 전달: 전문 ${kb(d.contextBytes)} — 예산 ${kb(d.maxBytes)} 초과, 상한 ${kb(d.hardMaxBytes)} 이내라 잘라내지 않고 전달했습니다.`
        : `문맥 전달: 전문 ${kb(d.contextBytes)} (예산 ${kb(d.maxBytes)} 이내).`;
  return d.promptBytes === null ? main : `${main} 전체 프롬프트 ${kb(d.promptBytes)}.`;
}

// Keep delivery evidence only when it validates and comes from the provider that
// owns the execution. It is optional: invalid evidence is dropped, never the result.
export function ownedContextDelivery(task, value) {
  let delivery;
  try { delivery = boundedContextDelivery(value); } catch { return null; }
  return delivery && delivery.provider === task?.checkpoint?.provider ? delivery : null;
}
