const invalid = () => { throw Object.assign(new Error('Invalid resume state'), {statusCode: 400}); };
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const digestValue = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const modes = ['root', 'child', 'review'];
const kinds = ['goal', 'constraint', 'decision', 'completed', 'pending', 'evidence'];
const exact = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => !keys.includes(key))) invalid();
};
const list = (value, max) => {
  if (!Array.isArray(value) || !value.length || value.length > max || Object.keys(value).length !== value.length) invalid();
  for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) invalid();
};

/** Strict bounded data only; normalization does not establish source authority. */
export function sanitizeResumeState(input) {
  exact(input, ['version', 'taskId', 'mode', 'basis', 'items']);
  if (input.version !== 1 || !safeId(input.taskId) || !modes.includes(input.mode)) invalid();
  exact(input.basis, ['requestDigest', 'historyDigest', 'messageCount', 'scopeDigest']);
  const {requestDigest, historyDigest, messageCount, scopeDigest} = input.basis;
  if (![requestDigest, historyDigest, scopeDigest].every(digestValue) || !integer(messageCount)) invalid();
  list(input.items, 48);
  const items = input.items.map(item => {
    exact(item, ['kind', 'text', 'references']);
    if (!kinds.includes(item.kind) || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 2000) invalid();
    list(item.references, 8);
    const references = item.references.map(ref => {
      const section = ref?.section;
      if (!['request', 'message'].includes(section)) invalid();
      exact(ref, section === 'request' ? ['section', 'digest'] : ['section', 'messageIndex', 'digest']);
      if (!digestValue(ref.digest)) invalid();
      if (section === 'message' && (!integer(ref.messageIndex) || ref.messageIndex >= messageCount)) invalid();
      return {section, ...(section === 'message' ? {messageIndex: ref.messageIndex} : {}), digest: ref.digest};
    });
    return {kind: item.kind, text: item.text, references};
  });
  const state = {version: 1, taskId: input.taskId, mode: input.mode,
    basis: {requestDigest, historyDigest, messageCount, scopeDigest}, items};
  if (new TextEncoder().encode(JSON.stringify(state)).byteLength > 32768) invalid();
  return state;
}

// Canonical JSON snapshots use sorted object keys; absent optional values are null.
function canonical(value, seen = new Set(), depth = 0) {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || depth > 32 || seen.has(value)) invalid();
  seen.add(value);
  const result = Array.isArray(value)
    ? value.map(item => canonical(item, seen, depth + 1))
    : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key], seen, depth + 1)]));
  seen.delete(value);
  return result;
}
const scalar = value => {
  if (value == null) return null;
  if (['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value))) return value;
  invalid();
};
const projectMetadata = (value, fields) => Object.fromEntries(fields.map(key => [key, scalar(value?.[key])]));
function snapshot(task) {
  if (!safeId(task?.id)) invalid();
  const mode = task.delegation?.state === 'reviewing' ? 'review' : task.parentTaskId || task.assignment ? 'child' : 'root';
  const messages = (Array.isArray(task.messages) ? task.messages : []).map((message, index) => ({
    id: message?.id == null ? `index:${index}` : String(message.id), index,
    role: ['user', 'assistant', 'system'].includes(message?.role) ? message.role : 'system',
    content: String(message?.content ?? ''),
  }));
  const attachments = (Array.isArray(task.attachments) ? task.attachments : []).map(attachment => ({
    ...projectMetadata(attachment, ['id', 'name', 'path', 'size', 'lastModified', 'type', 'source', 'url']),
    view: attachment?.view == null ? null : projectMetadata(attachment.view, ['kind', 'sha256', 'start', 'end', 'startPage', 'endPage']),
  }));
  return {taskId: task.id, mode, request: String(task.prompt ?? ''), messages,
    scope: canonical({mode, parentTaskId: scalar(task.parentTaskId), batchId: scalar(task.batchId),
      assignment: task.assignment, review: task.delegation?.review, attachments})};
}
function digestCache() {
  const cache = new Map();
  return text => {
    if (!cache.has(text)) cache.set(text, crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(bytes =>
      Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')));
    return cache.get(text);
  };
}
async function basisFromSnapshot(source, messageCount, digest) {
  const [requestDigest, historyDigest, scopeDigest] = await Promise.all([
    digest(source.request), digest(JSON.stringify(canonical(source.messages.slice(0, messageCount)))), digest(JSON.stringify(source.scope)),
  ]);
  return {requestDigest, historyDigest, messageCount, scopeDigest};
}

/** Basis excludes lease/version and checkpoint summaries; no source text escapes. */
export async function createContextBasis(task, {messageCount} = {}) {
  const source = snapshot(task);
  const count = messageCount === undefined ? source.messages.length : messageCount;
  if (!integer(count) || count > source.messages.length) invalid();
  return {taskId: source.taskId, mode: source.mode, basis: await basisFromSnapshot(source, count, digestCache())};
}

// Continue pending references through read_task_context manifest with offset=nextPendingMessageIndex.
function pendingMetadata(totalMessages, start = 0) {
  const pendingMessageCount = totalMessages - start;
  const pageCount = Math.min(20, pendingMessageCount);
  return {pendingMessageIndexes: Array.from({length: pageCount}, (_, index) => start + index),
    pendingMessageCount, nextPendingMessageIndex: pageCount < pendingMessageCount ? start + pageCount : null};
}

/** source_matched proves source binding only, not semantic completeness or approval. */
export async function verifyResumeState(task, state = task?.checkpoint?.resumeState) {
  let source;
  try { source = snapshot(task); } catch { return {status: 'invalid', state: null, pendingMessageIndexes: [], pendingMessageCount: null, nextPendingMessageIndex: null, reason: 'invalid_task_source'}; }
  const fail = (status, reason) => ({status, state: null, ...pendingMetadata(source.messages.length), reason});
  if (state === undefined) return fail('missing', null);
  let normalized;
  try { normalized = sanitizeResumeState(state); } catch { return fail('invalid', 'invalid_state'); }
  if (normalized.taskId !== source.taskId) return fail('stale', 'task_mismatch');
  if (normalized.mode !== source.mode) return fail('stale', 'mode_mismatch');
  const count = normalized.basis.messageCount;
  if (count > source.messages.length) return fail('stale', 'history_mismatch');
  const digest = digestCache();
  const current = await basisFromSnapshot(source, count, digest);
  for (const key of ['requestDigest', 'historyDigest', 'scopeDigest']) {
    if (normalized.basis[key] !== current[key]) return fail('stale', key === 'requestDigest' ? 'request_mismatch' : key === 'historyDigest' ? 'history_mismatch' : 'scope_mismatch');
  }
  for (const item of normalized.items) for (const ref of item.references) {
    const message = ref.section === 'message' ? source.messages[ref.messageIndex] : null;
    if (item.kind === 'decision' && message && message.role !== 'user') return fail('invalid', 'decision_source_invalid');
    if (ref.digest !== await digest(message ? message.content : source.request)) return fail('stale', 'reference_mismatch');
  }
  return {status: 'source_matched', state: normalized,
    ...pendingMetadata(source.messages.length, count), reason: null};
}

