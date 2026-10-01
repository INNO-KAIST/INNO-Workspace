import {createContextBasis,verifyResumeState} from './context-resume.mjs';
const INPUT_FIELDS = new Set(['taskId', 'expectedVersion', 'section', 'messageIndex', 'offset', 'maxBytes', 'expectedDigest', 'messageCount']);
const fail = (statusCode, message) => { throw Object.assign(new Error(message), {statusCode}); };
const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
const messageRole = role => ['user', 'assistant', 'system'].includes(role) ? role : 'system';
const messageId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id) ? id : null;

/**
 * Read only the selected original text from an already authorized task snapshot.
 * Callers must authenticate and authorize the task before passing it here.
 * Text offsets count UTF-8 bytes; manifest offsets count messages (20 per page).
 * No parent, attachment, artifact, storage, network or arbitrary-field access.
 */
export async function readTaskContext(task, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    || Reflect.ownKeys(input).some(key => !INPUT_FIELDS.has(key))) fail(400, 'Invalid context read fields');
  const {taskId, expectedVersion, section, messageIndex, offset = 0, maxBytes = 16_000, expectedDigest} = input;
  if (typeof taskId !== 'string' || !taskId) fail(400, 'Invalid taskId');
  // Check scope and version before touching any source content or message count.
  if (taskId !== task?.id) fail(409, 'Task context scope mismatch');
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) fail(400, 'Invalid expectedVersion');
  const currentVersion = task?.version;
  if (expectedVersion !== currentVersion) {
    if (Number.isSafeInteger(currentVersion) && currentVersion > 0) {
      throw Object.assign(new Error('Task context version mismatch'), {statusCode: 409, code: 'CONTEXT_VERSION_CONFLICT', currentVersion});
    }
    fail(409, 'Task context version mismatch');
  }
  const taskVersion = expectedVersion;
  if (!['request', 'checkpoint', 'message', 'manifest', 'basis', 'resume'].includes(section)) fail(400, 'Invalid context section');
  if (!Number.isSafeInteger(offset) || offset < 0) fail(400, 'Invalid context offset');
  const has = field => Object.hasOwn(input, field);
  if (section === 'basis' || section === 'resume') {
    if (['offset','maxBytes','expectedDigest','messageIndex'].some(has)
      || (section === 'resume' && has('messageCount'))) fail(400, 'Invalid structured context read fields');
    if (section === 'basis') {
      if (has('messageCount') && (!Number.isSafeInteger(input.messageCount) || input.messageCount < 0)) fail(400, 'Invalid messageCount');
      const basis = await createContextBasis(task, has('messageCount') ? {messageCount:input.messageCount} : {});
      return {...basis, taskVersion, section};
    }
    return {taskId, taskVersion, section, ...await verifyResumeState(task)};
  }
  if (has('messageCount')) fail(400, 'messageCount requires basis section');
  if (section !== 'message' && has('messageIndex')) fail(400, 'messageIndex requires message section');
  if (section === 'manifest') {
    if (has('maxBytes') || has('expectedDigest')) fail(400, 'Manifest does not accept maxBytes or expectedDigest');
  } else {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 4 || maxBytes > 16_000) fail(400, 'Invalid maxBytes');
    if ((has('expectedDigest') || offset > 0) && (typeof expectedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(expectedDigest))) fail(400, 'Invalid or missing expectedDigest');
  }
  const encoder = new TextEncoder();
  if (section === 'manifest') {
    const messages = Array.isArray(task.messages) ? task.messages : [];
    const totalMessages = messages.length;
    if (offset > totalMessages) fail(400, 'Context offset out of range');
    // Snapshot this bounded page before the first asynchronous digest.
    const rows = messages.slice(offset, offset + 20).map((message, index) => ({
      messageIndex: offset + index, id: messageId(message?.id), role: messageRole(message?.role),
      bytes: encoder.encode(String(message?.content ?? '')),
    }));
    const references = await Promise.all(rows.map(async row => ({
      messageIndex: row.messageIndex, id: row.id, role: row.role,
      digest: await sha256(row.bytes), byteLength: row.bytes.byteLength,
    })));
    const nextOffset = offset + rows.length;
    return {taskId, taskVersion, section, offset, nextOffset, totalMessages, done: nextOffset === totalMessages, messages: references};
  }
  let content;
  if (section === 'request') content = String(task.prompt ?? '');
  else if (section === 'checkpoint') content = String((typeof task.checkpoint === 'string' ? task.checkpoint : task.checkpoint?.content) ?? '');
  else {
    const messages = Array.isArray(task.messages) ? task.messages : [];
    if (!Number.isSafeInteger(messageIndex) || messageIndex < 0 || messageIndex >= messages.length) fail(400, 'Invalid messageIndex');
    content = String(messages[messageIndex]?.content ?? '');
  }
  // Text and metadata are now detached from mutable task/input references.
  const bytes = encoder.encode(content);
  const totalBytes = bytes.byteLength;
  const continuation = index => index < totalBytes && (bytes[index] & 0xc0) === 0x80;
  if (offset > totalBytes || continuation(offset)) fail(400, 'Context offset must be an in-range UTF-8 boundary');
  let nextOffset = Math.min(offset + maxBytes, totalBytes);
  while (continuation(nextOffset)) nextOffset--;
  const contentDigest = await sha256(bytes);
  if (expectedDigest !== undefined && expectedDigest !== contentDigest) fail(409, 'Task context digest mismatch');
  // ignoreBOM preserves a literal U+FEFF at the start of any selected page.
  const text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes.subarray(offset, nextOffset));
  return {taskId, taskVersion, section, ...(section === 'message' ? {messageIndex} : {}),
    contentDigest, text, offset, nextOffset, totalBytes, done: nextOffset === totalBytes};
}

