# H7 Variable Child Delegation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed "exactly one Codex and one Claude child" managed delegation with 2 to 4 independent children in any provider mix. Claude (routine_fire) children run one at a time. Codex children already run one at a time on the single desktop.

**User decisions (2026-10-06):**
- 2 to 4 children with any provider mix. The master splits only with a stated reason; otherwise it works directly as today.
- Claude children run one at a time.

**Architecture:**
- One shared bound (`DELEGATION_MIN_CHILDREN=2`, `DELEGATION_MAX_CHILDREN=4`) replaces every hard-coded 2.
  - Roles must be distinct.
  - The provider-pair rule is removed.
  - Review, recovery, receipts, observation and retention take the child count from the frozen delegation.
- Claude serialisation is enforced atomically at claim time: a routine_fire child cannot be claimed while a routine_fire sibling of the same batch is running or awaits stop confirmation.
  - Dispatch paths start only the first eligible Claude child.
  - Reconcile after each child ends starts the next.

**Tech Stack:** Node >=24 ES modules, Cloudflare Worker/D1, static JS. No new dependencies.

## Global Constraints
- Existing stored delegations (2 children, one per provider) must keep working unchanged, with no data migration.
- No Claude sibling may fire while another is running or awaiting confirmation, including through cron drain, `/run` and the source coordinator.
- Batch-wide review limits are unchanged and shared by up to 4 children (20 files, 5 MB). Per-child limits are unchanged.
- Subscription only, no paid API. Real-subscription checks run only with user confirmation.

---

### Task 1 (H7-1): Validation and prompts
**Files:** public/core/delegation.mjs, server/model-routing.mjs, server/mcp.mjs, server/runners.mjs, worker/claude-routine.mjs; tests: provider-assignment, delegation, delegation-runner, plugin-assignment, delegation-sources.
- [x] RED:
  - 3 and 4 children are accepted, including same-provider children.
  - 1 and 5 children are rejected.
  - Duplicate roles are rejected.
  - The MCP schema advertises 2..4.
  - The master prompts describe 2 to 4 children in any mix, and say that Claude children run one at a time.
- [x] GREEN; update the tests that pinned the old rule.

### Task 2 (H7-2): Review, recovery, receipts, initial policies
**Files:** server/handoff-inputs.mjs, worker/review-inputs.mjs, worker/store.mjs (initial policies, recoverRemoteExecution), worker/delivery-receipts.mjs; tests.
- [x] RED:
  - A 3-child batch reviews with all three child inputs (desktop and cloud).
  - Recovery requires every child completed.
  - Delegation receipts accept 3 frozen children.
  - The first allocation creates up to one initial policy per new profile (≤4).
- [x] GREEN.

### Task 3 (H7-3): One Claude child at a time
**Files:** worker/store.mjs (claim gate), worker/orchestration.mjs, worker/dispatch.mjs, worker/index.mjs (/run), public/source-execution.mjs, public/source-execution-ui.mjs; tests.
- [x] RED:
  - With two queued Claude children, allocation fires one. Completion fires the next.
  - A definitive fire failure frees the slot and starts the next.
  - An uncertain fire keeps the slot until explicit recovery.
  - Cron drain, `/run` and the source coordinator never start a second one.
  - Codex children are unaffected.
- [x] GREEN.

### Task 4 (H7-4): Observation and retention
**Files:** worker/review-observation.mjs, worker/review-observation-pipeline.mjs (including drain SQL), worker/policy-retention.mjs, public/review-observation-ui.mjs; tests.
- [x] RED:
  - A 3-child completed review records three observations.
  - Retention reads pins from up to 4 children and no longer defers globally.
  - The UI shows the diagnostics of 3 children.
- [x] GREEN.

### Task 5 (H7-5): Documentation, release, real check
- [ ] Update the PRD/HANDOFF H7 status, the user guide (delegation section) and REQUIREMENTS-STATUS.
- [ ] Independent review per task, full tests, dry-run.
- [ ] Ask the user before the release and the real-subscription check. The suggested check is one master with 3 children (Codex, Claude, Claude) to observe Claude serialisation.
