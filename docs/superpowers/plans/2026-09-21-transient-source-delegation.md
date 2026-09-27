# Transient-source delegation implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Do not interpret this plan as authorization to push main or deploy.

**Goal:** Source-backed children and master review execute using reconnectable transient originals without making another INNO app mandatory.

**Architecture:** Persist reference selection and ownership, transport only freshly verified material text, and let source-bearing clients dispatch queued source work. Scheduled executors skip source-dependent work without consuming its queue phase; server ownership resolves client races.

**Tech Stack:** Existing browser JavaScript modules, Node 24, SQLite, Cloudflare Worker/D1, subscription Codex and Claude Routine.

**Spec:** `docs/superpowers/specs/2026-09-21-transient-source-delegation.md`

## Global constraints

- Work in `E:\Develop\INNO Workspace\.inno\worktrees\source-views` until a later explicit worktree decision.
- 20 materials / 600,000 UTF-8 bytes per execution; preserve current selected-view limits.
- Never serialize transient source text into task, outbox, export, logs, or a new storage system.
- Preserve provider/model assignment, lease/generation/epoch guards, review criteria and retry limits.
- Main publication approval remains pending; no deployment as a side effect of these tasks.

### Task 1: Required source completeness (prerequisite)

Files: `public/core/source-coverage.mjs`, `tests/source-coverage.test.mjs`.

- [x] Reproduce ordinary attachment omission passing verification.
- [x] Require each named local attachment exactly once, reject extra materials and ambiguous paths, and preserve selected-view hash checks.
- [x] Run all Node tests: 353 pass at this point. Existing root calls without attachment metadata remain compatible.
- [x] Add a runner-boundary assertion that omission prevents spawning a provider process. Full Node suite: 354 pass; prerequisite recorded with this plan.

### Task 2: Atomic source-reference assignment

Files: `public/core/delegation.mjs`, `server/model-routing.mjs`, `public/core/claude-routing.mjs`, `server/mcp.mjs`, relevant delegation tests.

Interface: `validateAssignments(parent,input)` returns each assignment with validated `sourceIds` (default []); allocation derives child attachments only from parent metadata. `buildReview` records source scope, not source bytes.

- [x] Add failing selection/unknown-ID/duplicate-ID/URL/extra-material tests and child metadata privacy assertions.
- [x] Implement selection and allocation behind internal sourceDelegationVersion=1; runtime construction remains default-off.
- [x] Preserve sourceIds in gated model-result parsing and gated MCP schema; ordinary schema remains source-free.
- [x] Wire gated Codex/Claude master source-ID policy and sanitized reference context; reject unknown IDs before desktop delivery. Worker advertises server support version only when internally enabled; defaults remain off.
- [x] Verify D1 atomic allocation, rollback and replay; full suite 361 passes. Architecture correction: managed delegation exists in D1, including desktop-connected work. Standalone SqliteTaskStore has no delegation coordinator; its presence as the D1 test harness does not establish a separate SQLite allocation path.

### Task 3: Safe source-bearing execution and review

Files: `worker/dispatch.mjs`, `worker/bridge.mjs`, `worker/index.mjs`, `worker/orchestration.mjs`, `server/runners.mjs`, `server/desktop-bridge.mjs`, `server/desktop-http.mjs`, `worker/review-inputs.mjs`, integration tests.

Interfaces: direct start accepts queued child/review with declared sources; claim uses existing `sourceBound` and provider checks; review claims carry `reviewInputs` plus transient materials. Scheduled dispatch treats required files as not ready.

- [x] Automatic Claude/Codex dispatch preserves source queues and skips them before desktop queue LIMIT; later source-free work can run.
- [x] Internal version=1 enables direct queued child/review starts with existing claim fences. Ordinary queued roots with newly attached files retain a direct reconnect/start path and UI run control.
- [x] Direct Claude verifies source coverage before fire; gated runners accept declared sources. Direct Codex review uses existing hydrated reviewInputs. Architecture correction: Claude uses its persisted review manifest and scoped read_task to fetch generated child files; it does not require the Codex filesystem reviewInputs transport.
- [x] Test provider runner gates, missing sources, stale repeat starts, both review transports and no original in stored state; all 371 tests pass.
- [x] Negotiate direct desktop source version from server and runner support; browser cannot override runner support. Expose the intersection in desktop capabilities.
- [ ] Complete source-specific parent-pause/lost-start/outbox recovery tests and browser coordination before enabling this feature.

### Task 4: Browser source coordinator and reconnection

Files: new `public/source-execution.mjs`, `public/core/source-materials.mjs`, `public/app.mjs`, `public/delegation-ui.mjs`, `public/core/client.mjs`, UI and coordinator tests.

Interface: coordinator receives current tasks, connection session, extraction function, authenticated client and capabilities; sends one eligible source run at a time. It never persists extracted text. Scope/provider derive from stored assignment, not user dropdown.

- [x] Add coordinator-core unit tests for reconnect readiness, missing source, stale task/parent/client while extracting, duplicate refresh, ambiguous start acknowledgment and cleanup. 397 total Node tests pass; browser lifecycle and HTTP recovery evidence remain pending.
- [x] Extract prepareTaskMaterials(task,services) and wire ordinary run() to it. Includes stale-client/task-version checks, 20-file/600k-byte limits, exact selected-view verification and no durable writes. Coordinator must reuse it and additionally fence parent phase/epoch.
- [ ] Add source-required status/actions to parent and child panels, show assigned model/provider and unmet references.
- [ ] Auto-dispatch connected eligible source tasks after fresh state, with no blind retry after uncertain acknowledgment; permit explicit recovery after refresh.
- [ ] Run browser desktop/mobile viewport journeys, then enable the capability gate only when both direct paths and UI are ready.

### Task 5: End-to-end and release evidence

Files: integration tests, `docs/VERIFICATION.md`, `docs/REQUIREMENTS-STATUS.md`, `docs/USER-GUIDE-KO.md`.

- [ ] Test two independent source scopes, mixed providers, review with originals, changed selected hash, tab loss, lease loss and reconnection preserving completed children.
- [ ] Run `node --test --test-isolation=none tests/*.test.mjs` with project-local TEMP/TMP; run affected Python checks only if verifier changes.
- [ ] Conduct bounded actual subscription and browser tests when the new backend is available through an approved environment. Do not rerun AI merely to repeat already proven deterministic assertions.
- [ ] Publish exact limits/evidence; seek release approval only for the completed reviewable scope. Do not mark the full platform complete from this feature's tests.

## Pause checkpoint — 2026-09-21

User requested stopping after the coordinator-core substep to conserve weekly tokens. Module and tests exist but are not wired to the UI. Resume Task 4 UI/reconnect and lifecycle integration on/after Sunday afternoon 2026-09-27, subject to the user’s chosen time. Main publication remains unapproved; no push or deployment.

## Current checkpoint — 2026-09-27 (supersedes pause instructions above)

The user approved PRD and verification commands on 2026-09-23 and explicitly resumed work early; prior main/Cloudflare publication approval remains valid. W1 durable lifecycle and W2 UI are implemented and independently verified. Task 3 source recovery tests now include real HTTP CAS, parent pause, expired lease, lost replies and file outbox restart. Task 4 source status/actions and guarded auto-dispatch are implemented; desktop/mobile local browser checks passed. Gate activation is still pending, so combined implementation/activation checkboxes above are not release-complete.

Task 5 deterministic suite is 427/427 with project-local TEMP/TMP. Bounded live subscription original-source review is in progress, followed by remaining mixed-provider environment evidence and W4 release. The whole product and source collaboration release remain incomplete. Remote main history was rewritten: preserve the verified source tree changes on a latest-origin/main based release branch, not by force push or merging unrelated old history. See docs/PRD.md and the latest docs/PROGRESS.md entries for authoritative remaining work.
