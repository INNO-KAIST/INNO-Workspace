# Source views implementation plan

Use superpowers:subagent-driven-development. Worktree: E:\Develop\INNO Workspace\.inno\worktrees\source-views. Base0b1f641, branchcodex/source-views. Parallel-master release remains separately blocked on explicit main approval; do not push/deploy this branch without completing its checks and approved release scope.

1. Extraction (parallel_runner): public/core/source-views.mjs NEW; public/core/extract.mjs minimal PDF page options; tests/source-views.test.mjs NEW. Implement bounded reads/hash/coverage/revalidation and tests first. Export extractSourceView and verifySourceView (re-extract saved view; reject hash mismatch). No UI/task mutations.
2. Root contract: public/core/tasks.mjs attachment view and sanitizeMaterials coverage whitelist; public/core/client.mjs attachment export view; server/runners.mjs +worker/index.mjs source coverage prompt. Tests for no source persistence, invalid ranges and source-bound consistency.
3. UI (parallel_ui): public/app.mjs,index.html,styles.css and optional public/source-views-ui.mjs +focused tests. Preview selection and save/reset through attachment action. Run selected views with verifySourceView; noselection oldextract strictlimits. Do not editcoreclient/tasks/extract.
4. Root integration: fullregressions, desktop/mobile browser tests with synthetic largefile, independent review, docs/acceptance. Keep originalinput bytes inbrowser/executionmemory only.

Initial baseline inherited:286tests pass. Existing subscription models remain unchanged for ordinary task; no platform integrations required. Limit independent subagents to2 for this bounded step, compact inputs and tests, no recursive delegation.

Acceptance: extraction + root contract + UI implemented; independent review findings corrected. Full suite312/312. Browser synthetic791KB non-prefix selection/save/input invalidation and390x844 confirmed. Production release and live subscription test pending, not completed. SOURCE-VIEWS.md documents limits.
