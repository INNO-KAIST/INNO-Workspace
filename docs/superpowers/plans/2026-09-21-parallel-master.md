# Parallel Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Persist two independent provider assignments, run them concurrently when available, and resume the master once for verified integration without rerunning successful children.

**Architecture:** Cloud D1 owns parent/child batch state and leases. Existing Codex bridge and Claude Routine remain the execution transports; models never serve as polling daemons. Callback reconciliation and bounded recovery inspection schedule the final master only after valid child results arrive.

**Tech Stack:** JavaScript ES modules, Node.js 24, Cloudflare Worker/D1, node:test, existing subscription runtimes.

**Spec:** ../specs/2026-09-21-parallel-master-design.md

Status: approved by user on 2026-09-21; implementation and integration verification in progress.

## Global Constraints

- INNO Workspace is independent. NanoLab, Prism, RefAtlas, Scheduler, Analytics and Ledger are optional; core execution must work with all their integrations disconnected.

- Exactly two children for the first release: one Codex, one Claude; no nested provider dispatch.
- No original source attachments or URL references in this release.
- No paid APIs, paid overage, new hosting provider, or original source archiving.
- Pause/cancel/new instruction fences child writes and new starts; completed child results survive safe resume.
- Requested model is not observed model; Claude Routine root selection remains a documented limitation.

## Task 1: Atomic parent/child state and ownership

Files: new public/core/delegation.mjs and worker/delegations.mjs; update worker/store.mjs, public/core/tasks.mjs; new tests/delegation.test.mjs using the existing D1 SQLite harness.

- [x] Write failing tests for bounded plan validation, duplicate allocation, atomic parent/child creation, current parent generation, and nested dispatch rejection.
- [x] Implement server-generated IDs and a conditional D1 batch; prevent orphan records on a CAS conflict.
- [x] Add parent lifecycle cases for pause, cancel, resume and new user messages; guard child transitions atomically against parent batch/state.
- [x] Test simultaneous child completions, superseded results and manual pause versus automatic lease interruption.
- [x] Review state invariants before transport wiring.

## Task 2: Dispatch and durable reconciliation

Files: worker/index.mjs, worker/bridge.mjs, worker/delegations.mjs, server/mcp.mjs, scripts/inno-mcp.mjs, server/desktop-bridge.mjs; tests/bridge.test.mjs, tests/callback.test.mjs, tests/desktop-bridge.test.mjs.

- [x] Write failing tests for dispatch replay, one provider unavailable, partial failure, first callback lost and once-only master resumption.
- [x] Expose delegate_task only in the cloud environment; add the callback helper whitelist entry.
- [x] Route Codex child claims and Claude child fire through parent-aware ownership checks.
- [x] Reconcile on relevant completion callbacks and an explicitly bounded recovery path, avoiding expensive scans on every UI state poll.
- [x] Keep uncertain external fire outcomes waiting for confirmation; never retry an uncertain paid-token execution blindly.
- [x] Make completed children immutable during sibling retry and ensure parent completion cannot precede the review phase.

## Task 3: Model controls, result manifests and review contract

Files: server/runners.mjs, server/model-routing.mjs, server/handoff-inputs.mjs, public/core/claude-routing.mjs; add focused runner tests.

- [x] Test invalid model/effort refusal and actual Codex CLI model arguments for an assigned role.
- [x] Add bounded self-contained child prompts, with no recursive delegation or handoff.
- [x] Describe Claude requested subagent model and fixed Routine root separately; do not promise per-call root model control.
- [x] Provide generated result manifests and independently checkable acceptance criteria to the final master.
- [x] Test missing/duplicate/oversized artifacts, conflicting results, and review-triggered bounded retry.

## Task 4: Parent view, verification and release

Files: public/app.mjs, public/index.html and relevant styles; docs/VERIFICATION.md, docs/MODEL-ROUTING.md, new operator guide.

- [x] Render children grouped under parent with provider/model/reason/status and partial-completion indicators.
- [x] Test stop-all and retry-only-failed controls; bust the changed frontend entry cache.
- [x] Verify request → allocation → provider execution → master integration with every optional app disconnected.
- [x] Run full Node regression suite and inspect desktop/mobile UI using synthetic data.
- [x] Independent code review; resolve blockers before deployment.
- [ ] Push code, deploy Worker, refresh idle bridge, then run one small real subscription two-provider integration test.
- [ ] Record observed execution counts, generated outputs and limits; do not claim measured savings without a valid comparison.
