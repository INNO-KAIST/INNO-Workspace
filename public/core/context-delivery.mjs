import {ValidationError} from './tasks.mjs';
import {isProviderId,usesTransport} from './providers.mjs';

// Per-execution record of how task context was delivered. Byte counts only:
// providers do not report per-part tokens here, so token fields stay null.
const READINESS = new Set(['full_ready', 'full_over_budget', 'selected_ready', 'blocked']);
const KEYS = ['version','provider','unit','readiness','contextBytes','originalBytes','selectionSavedBytes','omittedMessages','maxBytes','hardMaxBytes','reader','promptBytes','materialBytes','inputTokens','cachedTokens'];
// Scoped re-reads made during the execution: read calls that reached the reader
// (calls rejected before it are not counted; failed reads count with 0 bytes) and
// returned response bytes. Present only as a measured pair; absent means not measured.
const RETRIEVAL_KEYS = ['retrievalRequests','retrievalBytes'];
const retrievalPair = usage => Number.isSafeInteger(usage?.requests) && usage.requests >= 0 && Number.isSafeInteger(usage?.bytes) && usage.bytes >= 0
  ? {retrievalRequests: usage.requests, retrievalBytes: usage.bytes} : null;

export function contextDelivery(packet, {provider, promptBytes = null, materialBytes = null, reader = false, retrieval} = {}) {
  const budget = packet.manifest.budget, metrics = packet.metrics, selected = packet.readiness === 'selected_ready';
  return boundedContextDelivery({
    version: 1, provider, unit: 'utf8_bytes', readiness: packet.readiness,
    contextBytes: metrics.inputBytes, originalBytes: metrics.uncompressedBytes,
    selectionSavedBytes: selected ? metrics.selectionSavedBytes : 0, omittedMessages: packet.manifest.omissions.length,
    maxBytes: budget.maxBytes, hardMaxBytes: budget.hardMaxBytes, reader,
    promptBytes, materialBytes, inputTokens: null, cachedTokens: null,
    ...(retrieval === undefined ? {} : retrievalPair(retrieval) ?? {}),
  });
}

// Attach measured re-reads to an existing record; invalid usage leaves it unchanged.
export function withRetrieval(delivery, usage) {
  const pair = delivery ? retrievalPair(usage) : null;
  return pair ? boundedContextDelivery({...delivery, ...pair}) : delivery;
}

export function boundedContextDelivery(value) {
  if (value == null) return null;
  const fail = field => { throw new ValidationError(`context delivery ${field} is invalid`); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('record');
  if (Object.keys(value).some(key => !KEYS.includes(key) && !RETRIEVAL_KEYS.includes(key)) || KEYS.some(key => !Object.hasOwn(value, key))) fail('shape');
  const measured = RETRIEVAL_KEYS.filter(key => Object.hasOwn(value, key)).length;
  if (measured === 1) fail('retrieval');
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
    ...(measured ? {retrievalRequests: count('retrievalRequests'), retrievalBytes: count('retrievalBytes')} : {}),
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
  // The remainder after task history and excerpts is guidance and formatting;
  // tool definitions inside the CLI are not part of this prompt and are not measured.
  const guidance = d.promptBytes === null || d.materialBytes === null ? null : d.promptBytes - d.contextBytes - d.materialBytes;
  const prompt = d.promptBytes === null ? ''
    : guidance !== null && guidance >= 0
      ? ` 전체 프롬프트 ${kb(d.promptBytes)} (작업 이력 ${kb(d.contextBytes)}, 첨부 발췌 ${kb(d.materialBytes)}, 지침·형식 ${kb(guidance)}).`
      : ` 전체 프롬프트 ${kb(d.promptBytes)}.`;
  const reread = !d.reader || d.readiness === 'blocked' ? ''
    : d.retrievalRequests === undefined ? ' 원문 재조회 미측정.'
      : ` 원문 재조회 ${d.retrievalRequests}회, 응답 ${kb(d.retrievalBytes)}.`;
  return main + prompt + reread;
}

// One line per execution of this task, newest first, from the delivery records kept in
// its usage history. Bytes and reported tokens are shown as observed; no savings are
// claimed, and nothing is compared across tasks.
const READINESS_NAMES = {full_ready: '전문', full_over_budget: '전문', selected_ready: '선택', blocked: '차단'};
export function contextHistoryRows(task, limit = 10) {
  const history = Array.isArray(task?.checkpoint?.usageHistory) ? task.checkpoint.usageHistory : [];
  const rows = [];
  for (const entry of history) {
    let d;
    try { d = boundedContextDelivery(entry?.contextDelivery); } catch { continue; }
    if (!d) continue;
    const at = String(entry.completedAt ?? '');
    const over = d.readiness !== 'blocked' && d.contextBytes > d.maxBytes ? '(예산 초과)' : '';
    const reread = !d.reader || d.readiness === 'blocked' ? ''
      : d.retrievalRequests === undefined ? ' · 재조회 미측정' : ` · 재조회 ${d.retrievalRequests}회 ${kb(d.retrievalBytes)}`;
    const prompt = d.promptBytes === null ? '프롬프트 미전송' : `프롬프트 ${kb(d.promptBytes)}`;
    const input = Number.isSafeInteger(entry.inputTokens) ? entry.inputTokens : null;
    const cached = Number.isSafeInteger(entry.cachedInputTokens) ? ` (캐시 ${entry.cachedInputTokens})` : '';
    const tokens = input === null ? '입력 토큰 미보고' : `입력 토큰 ${input}${cached}`;
    const phase = entry.phase === 'review' ? ' 검토' : entry.phase === 'child' ? ' 하위' : '';
    const ending = entry.transition === 'failure' ? ' · 실패' : '';
    rows.push({at, text: `${at.slice(0, 16).replace('T', ' ')} UTC · ${d.provider}${phase}${ending} · ${READINESS_NAMES[d.readiness]} ${kb(d.contextBytes)}${over}${reread} · ${prompt} · ${tokens}`});
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit).map(row => row.text);
}

// A delivery record supplied with a result. Only an executor holding the reader lease
// (the desktop bridge) measures its own re-reads; for a remote execution only the
// Worker's counter may supply them, so a supplied pair is dropped.
export function suppliedContextDelivery(task, value) {
  const delivery = ownedContextDelivery(task, value);
  if (!delivery || delivery.retrievalRequests === undefined || usesTransport(task?.checkpoint?.provider, 'desktop_bridge')) return delivery;
  const {retrievalRequests, retrievalBytes, ...rest} = delivery;
  return rest;
}

// Keep delivery evidence only when it validates and comes from the provider that
// owns the execution. It is optional: invalid evidence is dropped, never the result.
export function ownedContextDelivery(task, value) {
  let delivery;
  try { delivery = boundedContextDelivery(value); } catch { return null; }
  return delivery && delivery.provider === task?.checkpoint?.provider ? delivery : null;
}
