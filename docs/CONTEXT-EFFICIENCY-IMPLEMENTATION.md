# CR-005 implementation — approved proposal, 2026-10-01

## Stage 1 — CTX-01/02/03 shared durable context assembly
- Shared async buildTaskContext(task,{mode,maxBytes=96000}) returns request/conversation/checkpoint, complete, versioned manifest and byte metrics. Web/Node compatible ES module; no dependency or persistence changes.
- Preserve complete original request, checkpoint and chronological messages. Remove only the leading user message identical to the original request; later repeated requests may revise intervening decisions and retain their position. Repeated same-role content may use an earlier explicit reference only when shorter; never cross role boundaries.
- Manifest scopes task ID/version/role, ordered source IDs/index fallbacks and content hashes; no global cache. New state changes hashes. Original attachment bodies remain transient and outside the durable packet.
- Measure actual UTF-8 bytes for request/conversation/checkpoint. Observed provider/cache token counts remain null. This stage does not enforce a whole-provider-prompt budget or claim observed subscription savings.
- Do not slice long bodies or silently drop old messages. If packet exceeds budget, complete=false and a safe CONTEXT_RETRIEVAL_REQUIRED execution error prevents provider spawn/fire. Scoped retrieval and persisted state in Stage2 will resolve this boundary; this is not the completed long-conversation experience.
- Adapt local Codex and Claude runners plus Worker Claude routine text to await the same packet while preserving model, source, lease, callback and assignment instructions.
- Tests: old decision beyond20, long-message/checkpoint tail, Unicode UTF8, initial duplicate removal, repeated instructions preserving chronology, role/task isolation, source hashes after edits, deterministic repeated build and oversized packet blocking before provider execution. Existing fake processes/fetch only.

## Work split and verification
| WBS | Owner | Inputs/outputs | Status |
|---|---|---|---|
|CTX1-A|packet implementer|public/core/task-context.mjs, tests/task-context.test.mjs|verified|
|CTX1-B|adapter implementer|server/runners.mjs, worker/index.mjs, focused prompt/routine tests|verified|
|CTX1-C|independent reviewer + main|contract review, focused tests, full approved Node suite, Wrangler dry-run|verified|

Remaining approved stages: explicit resumable state and scoped original-history retrieval; provenance-checked summary/state updates without standalone AI calls by default; observed usage/cache/UI and supported subscription integration verification. Journal/legacy recovery and CR004 remain separate unfinished requirements.

## Stage 2A — bounded source-history retrieval, CTX-03/04
- Pure readTaskContext(task,args) reads only request, checkpoint, a selected message, or a20-reference manifest page. Mandatory exact taskId and expectedVersion; text continuation also requires expectedDigest. Snapshot source fields before hashing.
- Text pages use validated UTF-8 byte boundaries and at most16000 content bytes, with full-source SHA256, totalBytes, offset/nextOffset/done. Do not split Unicode, return attachment bodies/artifacts, or expose a whole task. Manifest pages use index offset and at most20 safe source references; no full content.
- Expose read_task_context through existing MCP; use handlers.readTask so existing account/execution assignment scoping still applies. Worker authorizes it as a read, with the same readable task set and stale-owner checks as read_task. No scope expansion or arbitrary storage paths.
- Verify real MCP calls, unauthorized parent/sibling reads, superseded ownership, task-version/digest mismatch, UTF8 continuation and long historical tails. This is a retrieval building block; oversized automatic prompt preparation stays blocked until explicit resume-state selection is implemented and verified. No premature claim that Stage2 is complete.
- No new DB schema, dependency, API key, AI call, source archive, recurring poll or persistent cache.

Stage2A verified: shared bounded reader + authenticated MCP integration, safe version-discovery conflicts. Independent13/13, full1039:1038pass/0fail/1existing Windows symlink skip; Wrangler dry-run passed. No deployment or AI calls. Next Stage2B must connect provenance-checked current resume state and actual provider access: managed Codex currently lacks remote MCP; Claude callback guidance must be tested. Initial oversized history without a valid resume state still needs safe bootstrap/splitting; do not silently treat read-tool availability as sufficient context.
