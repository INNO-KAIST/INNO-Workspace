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
