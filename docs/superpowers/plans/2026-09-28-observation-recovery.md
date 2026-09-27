# Failed review observation recovery implementation plan

> Scope: approved CR003 MOD06/07 and durable recovery; existing isolated source-views worktree. No CR004 evaluation change, AI run, paid API, new stack, or model promotion.

Goal: a user can requeue failed collection of saved completed-review evidence without rerunning work. The existing scheduled pipeline performs bounded collection after the durable request.

## Contract
- POST /api/tasks/:id/review-observations: {operation:'retry_failed', expectedVersion, reviewExecutionId, reviewGeneration, batchId, epoch}.
- Strict keys/types; completed root/current completed delegation/exact two frozen children and marker identity. Require current task version; stale or concurrent request conflicts. Only failed rows reset to pending/attempts0/nextAt null, with bounded recovery counter and timestamp for diagnosis; preserve sibling terminal rows and all execution/result fields.
- No failed rows => 409 without mutation. No process/AI dispatch in POST. Existing cron processes pending rows with original verifier and retry bounds. Uncertain response requires refresh, never automatic mutation replay.
- Cloud capability reviewObservationRecovery; desktop proxy forwards only exact route/method with existing auth. UI requires supported connected server and current trustworthy snapshot; user explicitly clicks '관측 기록 다시 수집'. Explain saved-results only and next scheduled run; in-flight disabled, captured client/epoch/task fence.

## Tasks
- [x] Backend implementer: RED tests for auth/input/current identity/CAS/concurrency/result preservation/failed-only/replay/no AI, then pipeline method, Worker endpoint/capability, desktop proxy. Files worker/review-observation-pipeline.mjs, worker/index.mjs, server/desktop-http.mjs, targeted tests.
- [x] UI implementer after backend contract review: client method, recovery button/controller in existing observation UI and app; bounded state, no cross-client result application, no retry mutation after uncertain response. RED targeted UI/client tests then implement.
- [x] Independent review and integration: relevant tests, full Node suite, Wrangler dry-run, actual synthetic desktop/mobile click->pending->recorded/duplicate path and task switch. Record actual limits; no production DB or AI calls.
- [x] Update progress/docs and commit verified changes; deployment only as integrated release.

## Review refinements
- No failed rows: backend may return 409 without mutation. No implicit fresh AI execution.
- recoveryCount is a monotonically increasing safe integer (legacy 0), not a small lifetime manual retry allowance. Automatic attempts remain 3. Capture this count in process/mark to reject stale asynchronous completion after a manual reset (ABA).
- UI uses idle/submitting/uncertain state. Capture client/task/selection epoch and expected version/identity. After POST, refresh only the captured still-current client. If refresh fails, offer explicit read-only status check; do not automatically repost. A successful confirmation read after POST unlocks even an unchanged failed snapshot, but retry requires a new user click. Expected-version CAS prevents duplicate mutation if the old POST commits late. Only a failed confirmation read requires the explicit read-only status-check button. Task/account changes suppress stale notices and result application.




