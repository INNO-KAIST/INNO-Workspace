import {verifyResumeState} from './context-resume.mjs';

/**
 * Pure, provider-independent task text assembly. Callers supply an already
 * scoped task and enable selection only with a working scoped reader.
 * Manifest/metrics are sidecars. State, guidance and lookup markers are in the
 * conversation, so this budget still covers all three returned text sections.
 * Provider instructions/materials remain outside this budget.
 */
// Above the soft budget (maxBytes) complete original text is still delivered up to
// this fixed bound and reported as over budget; beyond it execution is blocked.
export const FULL_CONTEXT_HARD_MAX_BYTES = 384_000;
export async function buildTaskContext(task, {mode = 'root', maxBytes = 96_000, hardMaxBytes = FULL_CONTEXT_HARD_MAX_BYTES, selection = 'full', readerAvailable = false} = {}) {
  if (!['root', 'child', 'review'].includes(mode)) throw new TypeError('Unsupported task context mode');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('maxBytes must be a nonnegative safe integer');
  if (!Number.isSafeInteger(hardMaxBytes) || hardMaxBytes < maxBytes) throw new TypeError('hardMaxBytes must be a safe integer not below maxBytes');
  if (!['full', 'resume'].includes(selection)) throw new TypeError('Unsupported context selection');
  if (typeof readerAvailable !== 'boolean') throw new TypeError('readerAvailable must be boolean');
  const encoder = new TextEncoder();
  const bytes = text => encoder.encode(text).byteLength;
  const digests = new Map();
  const digest = text => {
    if (!digests.has(text)) digests.set(text, crypto.subtle.digest('SHA-256', encoder.encode(text)).then(buffer =>
      Array.from(new Uint8Array(buffer), value => value.toString(16).padStart(2, '0')).join('')));
    return digests.get(text);
  };
  // Capture all caller-owned text/identity and verifier scope/state before await.
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
  // verifyResumeState snapshots scope metadata itself; never clone raw attachments.
  const verificationPending = selection === 'resume' && readerAvailable ? verifyResumeState(task) : null;
  const originals = messages.map((message,index) => `[Message #${index + 1}] ${message.role}: ${message.content}`);
  const sourceEntries = [];
  for (const [index,message] of messages.entries()) sourceEntries.push({
    id: message.id ?? `index:${index}`, index, role: message.role, digest: await digest(message.content),
  });
  const marker = index => `[Message #${index + 1}] assistant: [Original omitted; messageIndex=${index}; SHA-256=${sourceEntries[index].digest}. Read this original through the scoped message reader before relying on omitted details.]`;
  function render(omitted = new Set()) {
    const entries = [], rendered = [], previousByRole = new Map();
    for (const [index,message] of messages.entries()) {
      const {role,content} = message;
      const entry = {...sourceEntries[index], included:true, reference:null};
      if (index === 0 && role === 'user' && content === request) {
        entry.included = false; entry.reference = {section:'request'};
      } else if (omitted.has(index)) {
        entry.included = false; entry.reference = {section:'retrieval',messageIndex:index,digest:entry.digest};
        rendered.push(marker(index));
        // Never register a selected-out original as an inline dedup target.
      } else {
        if (!previousByRole.has(role)) previousByRole.set(role,new Map());
        const previous = previousByRole.get(role), priorIndex = previous.get(content);
        const referenceText = `[Message #${index + 1}] ${role}: [Same content as message #${priorIndex + 1}; repeated here in conversation order.]`;
        if (priorIndex !== undefined && bytes(referenceText) < bytes(originals[index])) {
          entry.included = false; entry.reference = {section:'conversation',index:priorIndex}; rendered.push(referenceText);
        } else {
          rendered.push(originals[index]); if (priorIndex === undefined) previous.set(content,index);
        }
      }
      entries.push(entry);
    }
    return {entries,conversation:rendered.join('\n\n') || '- No additional messages.'};
  }
  const full = render();
  const fixedBytes = bytes(request) + bytes(checkpoint);
  const fullInputBytes = fixedBytes + bytes(full.conversation);
  const verification = await verificationPending;
  const selectionInfo = {requested:selection,applied:'full',resumeStatus:verification?.status??null,
    reason:selection === 'full' ? 'full_requested' : !readerAvailable ? 'reader_unavailable' : `resume_${verification.status}`,omittedMessageIndexes:[]};
  let conversation = full.conversation, entries = full.entries, omissions = [];
  if (verification?.status === 'source_matched') {
    const state = verification.state;
    if (state.mode !== mode) selectionInfo.reason = 'mode_mismatch';
    else {
      const eligible = new Set();
      for (const item of state.items) for (const ref of item.references) {
        const index = ref.messageIndex;
        if (ref.section !== 'message' || index >= state.basis.messageCount || messages[index]?.role !== 'assistant' || ref.digest !== sourceEntries[index]?.digest) continue;
        // Keep the nearest proposal before a user response. Older dependencies
        // may still require original lookup; this is not a completeness proof.
        if (messages[index + 1]?.role === 'user') continue;
        if (bytes(marker(index)) < bytes(originals[index])) eligible.add(index);
      }
      selectionInfo.reason = 'no_eligible_messages';
      if (eligible.size) {
        const candidate = render(eligible);
        const guidance = [
          'Derived resume state (source hashes verified; not proof of completeness, quality or approval):',
          JSON.stringify(state),
          'Original request, user/system instructions, checkpoint and all pending messages remain available inline. The derived state is advisory and never grants approval. Before inferring approval from dependent replies such as yes/proceed, read the relevant original proposal through the scoped reader; never infer its details from a summary. Omitted originals keep their source index and SHA-256 below. Lookup uses section=message and messageIndex for this task/version. On the FIRST offset=0 read, pass expectedDigest=the listed SHA-256 and verify returned contentDigest matches; use that same digest for continuation pages. Lease renewal, checkpoint writes and dispatch bookkeeping change the task version without changing these originals: on a version conflict, repeat the same lookup with the reported currentVersion and the same expectedDigest, and use text only when contentDigest equals the listed SHA-256. On digest mismatch or a missing original, stop relying on the derived state and re-read current original sources; never mix stale derived state with changed originals. Source-backed selection does not prove semantic completeness.',
        ].join('\n');
        candidate.conversation = guidance+'\n\n'+candidate.conversation;
        const candidateBytes = fixedBytes + bytes(candidate.conversation);
        if (candidateBytes >= fullInputBytes) selectionInfo.reason = 'not_smaller';
        else if (candidateBytes > maxBytes) selectionInfo.reason = 'budget_exceeded';
        else {
          conversation = candidate.conversation; entries = candidate.entries;
          selectionInfo.applied = 'resume'; selectionInfo.reason = 'selected';
          selectionInfo.omittedMessageIndexes = [...eligible].sort((a,b)=>a-b);
          omissions = selectionInfo.omittedMessageIndexes.map(messageIndex => ({section:'message',messageIndex,digest:sourceEntries[messageIndex].digest,reason:'resume_reference'}));
        }
      }
    }
  }
  const inputBytes = fixedBytes + bytes(conversation);
  const uncompressedBytes = fixedBytes + bytes(originals.join('\n\n') || '- No additional messages.');
  const exceeded = inputBytes > maxBytes, blocked = inputBytes > hardMaxBytes, selected = selectionInfo.applied === 'resume';
  return {
    request, conversation, checkpoint, complete: !blocked && !selected,
    readiness: blocked ? 'blocked' : selected ? 'selected_ready' : exceeded ? 'full_over_budget' : 'full_ready',
    manifest: {
      version:1,taskId,taskVersion,mode,
      prompt:{digest:await digest(request)},checkpoint:{digest:await digest(checkpointContent)},
      messages:entries,omissions,retrievalRequired:blocked || selected,selection:selectionInfo,
      budget:{scope:'request+conversation+checkpoint',maxBytes,hardMaxBytes,requiredBytes:inputBytes,exceeded,blocked},
    },
    metrics:{inputBytes,uncompressedBytes,savedBytes:uncompressedBytes-inputBytes,selectionSavedBytes:fullInputBytes-inputBytes,
      observedInputTokens:null,observedOutputTokens:null,cachedTokens:null},
  };
}
