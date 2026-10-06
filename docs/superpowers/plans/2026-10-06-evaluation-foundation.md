# H6 Evaluation Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a bounded Codex execution provably end, record that proof durably, and settle its budget reservation atomically. The default budget stays 0, so no comparison run happens; this is the foundation only (user decision 2026-10-06).

**User decisions (2026-10-06):**
- Foundation only, budget 0.
- Codex only. Claude stays excluded because its forced time stop is unverified.
- Use built-in Windows tools; no new native helper.

**Architecture:**
- Process tree:
  - At spawn, the Codex runner records the root PID.
  - On terminate (deadline, timeout or abort) it snapshots the descendant tree from `Get-CimInstance Win32_Process` (PID, parent PID, creation time) and kills it with `taskkill /T /F`. It then re-enumerates until no recorded (PID, creation time) pair survives, or a proof timeout passes.
  - The close wait is capped, so a stuck root reports "unconfirmed" instead of hanging.
  - The outcome is `verified`, `survivors` or `unavailable`.
- Proof record: the bounded run's local observation (elapsed time, deadline exceeded, tree outcome) is persisted with the completion or failure.
- Settlement: the reservation settles in the same write only when the tree outcome is `verified`. Any other outcome keeps it `reserved`, so the job stays blocked as designed.
- Out of scope this round: the comparison job creator (bounded runs cannot pin models yet), the budget UI beyond a read-only status, and Claude.

## Global Constraints
- Ordinary (unbounded) runs keep their current behaviour, except that abort and timeout now also end descendants. That is a safety improvement, and it must never block a result.
- The tree proof never claims more than it observed: access denied or a PowerShell failure gives `unavailable`, never `verified`.
- No new runtime or language. PowerShell and CIM are built into Windows. Non-Windows hosts report `unavailable`.
- Budget 0 means zero extra AI executions.

---

### Task 1 (H6-1): Process tree termination and proof
**Files:** new server/process-tree.mjs; server/runners.mjs (collectProcess terminate/close); server/execution-deadline.mjs (observation); tests: process-tree (real node parent plus grandchild on Windows), evaluation-deadline.
- [x] RED:
  - A real node process that spawns a grandchild: the grandchild is gone after terminate, and the outcome is `verified`.
  - A survivor (simulated enumerator) gives `survivors`.
  - An enumerator failure gives `unavailable`.
  - (Changed) No close-wait cap: a run without a verified proof keeps ownership until close, as before. A real Windows check showed that a killed root releases the pipes.
  - (Changed, review round 2) The real grandchild is spawned `detached`. Node's own job object otherwise ends it with its parent and hides a broken tree kill.
  - (Changed, review round 2) The root is confirmed only from a snapshot that finished while the runner held its process handle. A row under an exited tracked PID is adopted only if created before that parent was last seen alive; otherwise it is ambiguous, never ended, and the proof is not verified.
- [x] GREEN.

### Task 2 (H6-2): Durable proof and atomic settlement
**Files:** server/desktop-bridge.mjs (outbox record), worker/bridge.mjs (claim error hazard, pass-through), worker/store.mjs and server/store.mjs (finish/fail settle with the ledger in one write), worker/evaluation-budgets.mjs (verifyCompletion from the stored proof); tests.
- [x] RED:
  - (Changed) The proof is stored atomically with the completion. Settlement is a separate idempotent step from that stored proof, run after completion and retried by the scheduled sweep.
    - A combined budget-and-receipt write would need statement reordering; the pre-existing incompatibility is kept.
  - Any other outcome stays `reserved`.
  - A forged client duration is ignored.
  - A replay is idempotent.
  - A bounded task in the desktop queue cannot crash the claim loop.
- [x] GREEN.

### Task 3 (H6-3): Read-only budget status and documentation
- [ ] (Deferred) A read-only ledger status. With budget 0 and no job creator, production can hold no ledger to show; build it with the comparison job creator.
- [ ] Docs, PROGRESS, independent review, release with user confirmation.
