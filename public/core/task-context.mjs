/**
 * Pure, provider-independent task text assembly. Callers supply an already
 * scoped task: mode records execution context, it does not fetch parent data.
 * Manifest/metrics are sidecars, not additional model prompt text.
 * This budget covers these three text sections only, not provider instructions,
 * attached materials, tools or other provider-specific prompt overhead.
 */
export async function buildTaskContext(task, {mode = 'root', maxBytes = 96_000} = {}) {
  if (!['root', 'child', 'review'].includes(mode)) throw new TypeError('Unsupported task context mode');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('maxBytes must be a nonnegative safe integer');
  const encoder = new TextEncoder();
  const bytes = text => encoder.encode(text).byteLength;
  // Packet-local cache only: no cross-task, account or persistent reuse.
  const digests = new Map();
  const digest = text => {
    if (!digests.has(text)) digests.set(text, crypto.subtle.digest('SHA-256', encoder.encode(text)).then(buffer =>
      Array.from(new Uint8Array(buffer), value => value.toString(16).padStart(2, '0')).join('')));
    return digests.get(text);
  };
  // Capture all caller-owned values before the first asynchronous digest.
  const taskId = task?.id == null ? null : String(task.id);
  const taskVersion = task?.version == null ? null : (typeof task.version === 'number' ? task.version : String(task.version));
  const request = String(task?.prompt ?? '');
  const checkpointContent = String((typeof task?.checkpoint === 'string' ? task.checkpoint : task?.checkpoint?.content) ?? '');
  const checkpoint = checkpointContent || '- No checkpoint.';
  const messages = (Array.isArray(task?.messages) ? task.messages : []).map(message => ({
    id: message?.id == null ? null : String(message.id),
    role: ['user', 'assistant', 'system'].includes(message?.role) ? message.role : 'system',
    content: String(message?.content ?? ''),
  }));
  const entries = [];
  const rendered = [];
  const originals = [];
  const previousByRole = new Map();
  for (const [index, message] of messages.entries()) {
    const role = message.role;
    const content = String(message?.content ?? '');
    const full = `[Message #${index + 1}] ${role}: ${content}`;
    originals.push(full);
    const entry = {id: message?.id ?? `index:${index}`, index, role, digest: await digest(content), included: true, reference: null};
    if (index === 0 && role === 'user' && content === request) {
      entry.included = false;
      entry.reference = {section: 'request'};
    } else {
      if (!previousByRole.has(role)) previousByRole.set(role, new Map());
      const previous = previousByRole.get(role);
      const priorIndex = previous.get(content);
      const referenceText = `[Message #${index + 1}] ${role}: [Same content as message #${priorIndex + 1}; repeated here in conversation order.]`;
      if (priorIndex !== undefined && bytes(referenceText) < bytes(full)) {
        entry.included = false;
        entry.reference = {section: 'conversation', index: priorIndex};
        rendered.push(referenceText);
      } else {
        rendered.push(full);
        if (priorIndex === undefined) previous.set(content, index);
      }
    }
    entries.push(entry);
  }
  const conversation = rendered.join('\n\n') || '- No additional messages.';
  const inputBytes = bytes(request) + bytes(conversation) + bytes(checkpoint);
  const uncompressedBytes = bytes(request) + bytes(originals.join('\n\n') || '- No additional messages.') + bytes(checkpoint);
  const exceeded = inputBytes > maxBytes;
  return {
    request, conversation, checkpoint, complete: !exceeded,
    manifest: {
      version: 1, taskId, taskVersion, mode,
      prompt: {digest: await digest(request)}, checkpoint: {digest: await digest(checkpointContent)},
      messages: entries,
      // All content remains available in this returned packet, even when blocked.
      // Adapters must not execute until scoped retrieval/splitting resolves budget.
      omissions: [], retrievalRequired: exceeded,
      budget: {scope: 'request+conversation+checkpoint', maxBytes, requiredBytes: inputBytes, exceeded},
    },
    metrics: {inputBytes, uncompressedBytes, savedBytes: uncompressedBytes - inputBytes,
      observedInputTokens: null, observedOutputTokens: null, cachedTokens: null},
  };
}

