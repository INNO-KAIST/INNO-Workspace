# Connection and research adapter review

Review scope: `public/core/attachments.mjs`, `public/core/research.mjs`, their tests, `docs/IMPLEMENTATION.md`, and the integration use sites in `public/app.mjs`. The review compared the adapters with `exportPowerJson` in the local INNO Prism source and a small leading sample of the local RefAtlas catalog. No production code or private research corpus was copied.

## Findings

### [P1] Preserve the complete Prism export provenance

`parsePrismReport` returns only `{engine, analysis, source}` (`public/core/research.mjs:118`). The real `exportPowerJson` payload also contains `file`, `settings`, `calibration`, `densityFactor_mWcm2_per_W`, and `manualSlope`. Those fields record the analysis parameters, beam/power calibration, density conversion, and manual cross-check. A valid import therefore silently loses scientifically material provenance while the UI says the result includes the original source and analysis parameters (`public/app.mjs:106`). This conflicts with the design requirement to retain calibration, units, exclusions, parameters, and engine version with numerical results.

Return a validated representation of the whole supported export (or at least all of the fields above), synthesize `source` without discarding `file`, and apply the finite-number traversal to every retained numeric branch. Add a fixture shaped exactly like the current `exportPowerJson` result and assert deep preservation of settings, calibration, density factor, manual slope, and analysis.

### [P1] Attachment identity can silently bind a task to different bytes

Attachment identity and stale checks use only source, path, size, modification time, and media type (`public/core/attachments.mjs:37-60`). Two files with the same metadata but different same-length content receive the same ID; the later `addFiles` call replaces the in-memory resolver. A probe connecting `AAAA` and then `BBBB` as `same.txt` with identical metadata produced `sameId: true`, and `getFile` returned `BBBB` without a stale error. This undermines stable reattachment and can run an existing task against different source data while displaying it as the original connection. The 32-bit FNV ID also makes deliberate metadata collisions practical, with suffix assignment depending on insertion order.

Use a cryptographic content digest for source identity/integrity, computed transiently in the browser and persisted only as metadata. Verify it before preview or execution. A content digest does not permanently store source bytes. If synchronous `addFiles` must remain, keep connection state pending until the digest is ready and refuse execution until verification completes. Add tests for same metadata/different bytes, digest mismatch after handle refresh, and deterministic identity independent of connection order.

### [P1] RefAtlas can assert evidence it does not actually contain and can lose a real DOI

`normalizePaper` accepts any truthy non-string `abstract`, derives/accepts `evidenceScope: "abstract"`, and then returns `abstract: ""` (`public/core/research.mjs:74-94`). It also accepts `evidenceScope: "full-text"` with no text locator or source requirement. For example, `{id:"opaque", title:"Claim", abstract:123, evidenceScope:"abstract"}` is accepted as abstract evidence with an empty abstract. That is unsupported provenance which can be forwarded to a model as if an abstract had been read.

Separately, DOI candidates extracted from a `doi:` ID or a `doi.org` URL are used only for mismatch checks; they are not assigned to the returned DOI (`public/core/research.mjs:66-72`). `{id:"doi:10.1234/demo", title:"ID-only DOI"}` returns `doi: null`, contrary to DOI-preservation requirements and the integration documentation.

Require abstract evidence to contain a non-empty string. Define the exact condition for `full-text` (for example a validated source locator plus an explicit scope supplied by the trusted adapter), and do not promote arbitrary records to that scope. Resolve one canonical DOI from `record.doi`, DOI-valued ID, and DOI URL, then reject conflicts and return the resolved DOI. For non-DOI IDs, require a recognized source namespace or source locator before presenting the record as traceable evidence. Add negative tests for numeric/object abstracts, unsupported full-text claims, opaque IDs without source, and positive tests for ID-only and URL-only DOI recovery.

### [P1] “Open app” links open repositories; RefAtlas is a 404 when unauthenticated

`INTEGRATIONS` hardcodes repository URLs (`public/core/research.mjs:164-179`), while the interface labels five links “앱 열기” (`public/app.mjs:108-111`). Browser verification showed the Scheduler, NanoLab, Ledger, Prism, and Analytics URLs open GitHub repository pages, not applications. The RefAtlas repository URL returned GitHub’s “Page not found” when unauthenticated, consistent with the design noting that it is private. Local authoritative setup docs already identify application URLs such as `https://inno-kaist.github.io/INNO-Scheduler/Optics_scheduler.html`, `.../Synthesis_scheduler.html`, and `https://wonjeong-dev.github.io/INNO-NanoLab/`.

Give each integration separate `appUrl` and `repositoryUrl` fields. Render “앱 열기” only for a verified deployed application URL; render “저장소 열기” for repository links. For apps whose deployment URL is private, account-specific, or unknown (including RefAtlas Pages), show an explicit unconfigured state rather than a misleading public GitHub link. Replace the current test that checks only `https://` with tests for the destination kind and exact known launch routes, plus a browser smoke test that asserts the expected app shell/title rather than merely a 2xx page.

### [P2] Byte-limited UTF-8 extraction can corrupt the final character

`readText` cuts the Blob at an arbitrary byte boundary and decodes it as a complete UTF-8 buffer (`public/core/attachments.mjs:187-192`). A probe with a multibyte Korean character crossing byte 200,000 returned a trailing replacement character (`U+FFFD`). The result is correctly marked `truncated`, but the text itself is not an exact prefix of the connected source.

Use streaming `TextDecoder` semantics or back off to the last complete UTF-8 sequence before returning text, and test a 2/3/4-byte code point at the cap. Keep `bytesRead` explicit about whether it means bytes fetched or bytes represented in the returned string.

## Verified behavior

- Attachment descriptors are metadata-only copies; file objects/handles remain in `AttachmentSession`, URL references are not fetched, and unsupported binaries return `unavailable`.
- Folder traversal preserves the selected root and repeated handle lookups detect ordinary size/time/name/type changes.
- The RefAtlas compact catalog fields observed in the local sample (`id`, `doi`, `ti`, `yr`, `vn`, `au`, `src`, and tags) map into the current parser without copying the corpus.
- Finite-number validation rejects overflowed Prism analysis values.
- `node --test --test-isolation=none tests/attachments.test.mjs tests/research.test.mjs` passed all 13 tests. The default isolated runner failed in this sandbox with `spawn EPERM`; this was an environment process-spawn restriction, not a test assertion failure.
