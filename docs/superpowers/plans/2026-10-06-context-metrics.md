# H2 Context Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cost of each execution's context visible in bytes: what was sent inline, what the model read back through the scoped reader, and how prompt bytes split between task history, attached excerpts and guidance. Show it per execution so the same task can be compared across runs.

**Architecture:**
- The per-execution delivery record (public/core/context-delivery.mjs, version 1) gains optional `retrievalRequests` and `retrievalBytes`.
  - Present only when measured. Old records stay valid.
  - Local Codex counts come from the execution-scoped reader registry (server/context-access.mjs).
  - Cloud Claude counts come from a per-execution Worker metadata counter. It is merged into the record when the execution ends.
- Usage history entries keep a bounded copy of the delivery record, so the task panel can list executions side by side.

**Tech Stack:** Node >=24 ES modules, Cloudflare Worker/D1, static HTML/JS. No new dependencies.

## Global Constraints
- Byte counts only; tokens stay null unless a provider reports them. No savings claims across different tasks.
- Measurement never fails, delays or replaces a result. Invalid or missing measurements are dropped or shown as unmeasured.
- Existing subscriptions only; no paid API. No original source persistence. No new runtime or language.
- Records written by the new code must stay readable by the deployed Worker after a Worker-first deploy. Deploy order: Worker and Pages first, then the desktop connector.

---

### Task 1 (H2-1): Local retrieval accounting and prompt breakdown
**Files:** public/core/context-delivery.mjs, server/context-access.mjs, server/runners.mjs; tests/context-delivery.test.mjs, tests/context-access.test.mjs (or local-context-access), tests/context-selection-adapters.test.mjs.
- [x] RED:
  - The validator accepts records with and without the retrieval pair and rejects a half pair or bad counts.
  - The notice shows re-read requests and bytes, and splits the prompt into task history, excerpts and guidance.
  - `lease.usage()` reports request attempts and returned bytes.
  - A selected Codex run reports retrieval equal to the registry counts. A run without a reader reports 0/0.
- [x] GREEN, then focused and full tests.

### Task 2 (H2-2): Cloud retrieval accounting
**Files:** worker/index.mjs (MCP read path), worker/store.mjs (completion/failure merge), a small worker/context-reads.mjs; tests.
- [x] A successful `read_task_context` under an execution capability increments `context_read:<taskId>:<executionId>:<generation>` atomically.
- [x] The counter starts at 0/0 when the execution is fired.
- [x] Only a completion through that execution's MCP call merges the counts into `checkpoint.contextDelivery`, then deletes the counter. These are separate steps, so the count is best-effort. Other endings leave the record unmeasured.
- [x] The scheduled handler sweeps counters older than 24 hours, 32 per run. Counters stay bounded.

### Task 3 (H2-3): Per-execution history and same-task comparison
**Files:** public/core/execution-usage.mjs, public/app.mjs; tests.
- [x] Usage history entries carry the validated delivery record of that execution (bounded by the existing 100 entries).
- [x] The task panel lists recent executions of this task: readiness, task history bytes, re-read bytes, prompt bytes, reported input/cached tokens. No cross-task comparison.

### Task 4 (H2-4): Bounds and documentation
- [ ] Record what accumulates and its bound: usage history 100 per task, delivery record fixed size, counters swept.
- [ ] Referenced originals are task messages, which are never deleted (active-reference protection).
- [ ] Keep the known gap open: the task body has no total size bound (H9).
- [ ] Update CONTEXT-EFFICIENCY-IMPLEMENTATION, USER-GUIDE-KO, REQUIREMENTS-STATUS (CTX-02/05/06), HANDOFF H2, PROGRESS.
- [ ] Real same-task comparison (full versus selected, initial plus re-read bytes) is measured in H3 with real subscriptions.
