# Desktop result workspace binding implementation plan

> Implement task by task with separate implementation and verification agents.

Goal: SRC-02/03/06 prevent a retained result from being posted to a different configured workspace while retaining recoverable output.
Spec: docs/PRD.md approved source recovery/account isolation requirements. This fixes an observed existing flow; no new product requirement or technology.
Architecture: authenticated identity endpoint stores one random stable UUID in existing D1 metadata. Production bridge captures normalized origin/workspace ID before execution and saves it alongside each outbox result; before every delivery it re-reads identity and checks equality. No token values or source originals in binding. HTTP redirects must not forward result bodies to another origin.
Stack: existing JS/Node/Worker/D1 only. Existing isolated source-views worktree.

- [x] Task 1 Worker identity: worker/workspace-identity.mjs, worker/index.mjs, tests/workspace-identity.test.mjs. Auth before lookup; existing identity returned without write; INSERT OR IGNORE then read for concurrent initialization; validate UUID and fail closed on malformed stored value. One row, no growing history or state revision churn. Test parallel calls, separate DBs, authentication, stable value, malformed storage.
- [x] Task 2 production outbox binding: server/desktop-bridge.mjs and focused helper if useful, scripts/desktop-bridge.mjs, targeted tests. Capture identity before claims; post-await stop guards. Verify latest binding before delivery; missing/legacy/mismatch/network failure preserves outbox and never POSTs result or reruns AI. Stable identity permits credential rotation; new origin/DB rejected. Test direct+poll+restart complete/fail, during-execution identity change, same identity, unavailable endpoint, malformed binding. Production must enable enforcement, optional dependency only for existing isolated library clients if needed and documented. No implicit legacy adoption/deletion. Disable request redirects.
- [x] Task 3 independent review/full tests/dry-run, record real limitations and manual legacy recovery steps in docs/DESKTOP-BRIDGE.md and PROGRESS. Reuse existing approved test commands. No actual AI calls. Release only after compatibility/idle/outbox checks; Worker before bridge.

Review focus: endpoint change before restart; DB replacement on same origin; token rotation with same workspace; missing identity in old outbox; stop during identity fetch; receipt replay still separate unresolved issue.

Legacy records lack trustworthy origin. They must remain on disk and block automatic delivery; never guess identity from task UUID alone. A subsequent explicit recovery/adoption workflow is required before claiming legacy recovery complete. No unbounded receipts added by this step. Server accepted-response replay receipts remain the next separate fix.

## Independent review refinements
- Separate identity read and claim are not atomic: include workspaceId in claim response, and new desktop requests carry expected workspace ID. Worker validates the header against the same DB binding before claim/renew/result mutation; old callers without header remain compatible during rollout.
- Delivery preflight blocks ordinary endpoint/account reconfiguration before sending. A DB replacement between preflight and POST cannot guarantee zero network-body transfer: server header guard prevents mutation, not network receipt. Document this limit. Same-origin cloned databases carrying the same identity are indistinguishable.
- Task2 can split into server claim/header contract then local bridge binding. Each substep gets RED/GREEN and separate review. Additional identity waits need stopped checks. Deployment remains Worker-first.

Verification: Node 709/709, independent 43/43, Worker dry-run passed. Development tree only; deployment pending. Legacy explicit adoption and accepted-result receipts remain separate incomplete recovery work.
