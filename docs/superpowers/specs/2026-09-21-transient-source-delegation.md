# Transient-source delegation design

Date: 2026-09-21. Status: implementation design, not an implemented feature or release approval.

## Objective and boundaries

Allow a master to assign only the connected source references needed by each child, while preserving the existing subscription-only execution paths and source privacy contract. The platform remains independent of other INNO apps. This extends the current two-provider delegation release; it does not claim that its fixed two-child topology is the final general agent optimizer.

Existing source text is transient. Persist task instructions, attachment metadata/selected-range hashes, ownership/checkpoints, and generated outputs. Do not persist material text, original files, file handles, or transient transport bodies in D1, SQLite, outbox, exports, logs, or task instructions. AI-generated prose may quote evidence; byte-perfect prevention of model repetition is not claimed. Provider session retention is governed by the provider and is distinct from INNO's storage behavior.

Use existing limits: 20 materials and 600,000 UTF-8 bytes per execution; selected UTF-8 view 200,000 bytes; PDF selected view <=100 pages and current parser size limits. No new paid service, API, archive or object bucket.

## Current blockers verified in code

- `public/core/delegation.mjs` rejects parent sourceBound/attachments and child materials.
- `server/runners.mjs` rejects child/review materials and source-backed delegation.
- `worker/dispatch.mjs` automatically claims/fires queued Claude children without sources.
- `worker/bridge.mjs` marks queued attached tasks waiting instead of executing, while direct start excludes queued children/reviews.
- `worker/index.mjs` direct Claude execution omits reviewInputs; automatic orchestration supplies those separately.
- `public/delegation-ui.mjs` disables child/review direct run; `public/app.mjs` assumes the user-selected provider and root resume actions.
- `public/core/source-coverage.mjs` now checks ordinary file material completeness as a prerequisite; this alone does not enable source delegation.

## Assignment and persisted state

Add optional `sourceIds: string[]` to each assignment. Omitted means no sources, preserving older source-free assignments. Reject duplicate/unknown IDs, URLs, malformed selected views, and any child-supplied attachments or material bodies. Resolve references against the parent's attachment metadata at allocation. Copy only validated selected metadata into each child's attachments; retain IDs so a browser's existing connection can satisfy it. Reject ambiguous path/name mappings. Persist sourceIds in assignment and review manifest for audit, not original text.

The parent retains its original references for review. Review execution must re-read all its required connected file references, in addition to receiving child-generated reviewInputs. Do not remove source requirements when children finish, retry, or providers change. Parent source edits remain forbidden while a delegation is active. Existing epoch and owner guards stay authoritative.

## Queued source work and execution

Queued child or queued_for_review tasks with file references are durable work waiting for a source-bearing client. Automatic cloud dispatch and desktop polling must NOT claim or fire these tasks without materials. Leave the queued phase intact so they can be claimed correctly later; expose a derived needs-sources state in UI. This differs from authentication/network failure and must not consume a retry or increment parent epoch.

Extend direct execution to queued children and queued_for_review parents with sources, enforcing assigned provider/master provider and existing parent epoch. Required source names, coverage, hash and byte limits must be verified before an AI side effect. Direct Claude review must obtain the same generated-file reviewInputs as automatic review. Child and review runners accept materials only when they satisfy their declared references; no arbitrary extra source injection.

A frontend coordinator scans pending source work after a successful refresh. It derives provider from assignment or masterProvider, never a stale dropdown. If all references are still connected, it re-extracts/validates them and starts eligible work through existing authenticated direct routes. Start at most one request at a time per browser; desktop keeps its existing one-process limit. Different clients may race; server version/ownership guards choose one winner and prevent a second AI fire.

Do not blindly retry an ambiguous start response. Refresh first; if ownership/status cannot prove it did not start, display existing recovery guidance and retain uncertainty. An unchanged source-waiting task can be offered again only after a definitive failure or a known newer state. Source text stays in the current invocation, never a browser durable outbox.

## Reconnection and UI

Show which child or review needs which sources, the assigned provider/model, and whether this device can execute it. Reuse metadata matching and reconnect controls without permitting child scope edits. A parent-level reconnect satisfies shared attachment IDs; expose a start/resume-sources action distinct from retrying failed children.

When the tab closes or its file access is lost, queued work remains durable but stops until reconnection. A PC-off local source cannot be read by the cloud. Mobile can supply an accessible equivalent file and matching selected-view hash for a Claude child; desktop-only Codex requires its bridge. Do not promise unattended continuation when the only required original is offline.

## Delivery gates

1. Metadata selection cannot copy source text to stored children or outbox.
2. Missing, extra, duplicate, changed or ambiguous sources prevent an AI side effect.
3. No-source scheduled requests never consume a source task or block unrelated source-free tasks behind it.
4. Both direct providers and master review receive only their allowed source scopes and exact coverage.
5. Two browser claims cause one execution; stale epochs cannot deliver results.
6. Tab/bridge loss followed by reconnection reuses completed child outputs without redoing them.
7. Entire source-free regression suite remains valid, with intentional contract tests updated narrowly.
8. Real browser journey, local HTTP/D1 integration tests, and bounded actual subscription smoke after approved deployment/configuration. Evidence must distinguish simulated providers from actual ones.
