# Connected source views — design

The user approved continued implementation of the original platform scope. This incremental step lets a user select bounded text ranges or PDF pages from connected originals without copying or permanently archiving those originals. It keeps the existing subscription transports and source-bound parallel-delegation prohibition.

## Contract

A durable attachment descriptor may carry optional `view` metadata:

- Text: `{kind:'text-byte-range',start:number,end:number,sha256:string}`. Start/end are exact UTF-8 byte boundaries, end exclusive, at most 200000 bytes.
- PDF: `{kind:'pdf-pages',startPage:number,endPage:number,sha256:string}`. Pages are one-based inclusive, at most100 selected pages, existing30MiB input cap remains.

The hash covers the extracted selected text encoded as UTF-8, not the whole original. It is a change check for that selected view only. Selection metadata contains no source text. Reattachment still requires metadata identity; changed extracted selection hash rejects execution until the user selects it again.

Browser extraction exports `extractSourceView(file, selection, options={})` returning existing extraction fields plus `coverage` and `view` when available. Text selection accepts `{kind:'text-byte-range',start,maxBytes?}` for initial selection or saved start/end. It uses bounded File.slice reads, skips at most3 leading continuation bytes and omits an incomplete trailing code point without replacement. Reject invalid UTF-8 rather than silently corrupt it. PDF selection accepts one-based startPage/endPage; no OCR, image and non-text content is not represented. `coverage` is `{kind,sourceSize,partial,method,start?,end?,startPage?,endPage?,sha256}`; no page is claimed read unless processed.

For no explicit selection, retain existing extraction behavior and strict truncation refusal. Material contract becomes `{name,text,coverage?}`. Coverage is bounded and sanitized, then passed transiently to both executors. It is never stored as original text in task metadata, queues or outbox. Generated answers can quote relevant excerpts.

UI: source preview provides '조회 범위 선택' for text/PDF, clear size/page limits, exact preview and a save action. Unsupported formats stay connectable references with generic guidance; optional research apps are never required. Selected ranges are marked partial in attachment display and executor prompt. Reset selection is available. Run re-extracts and compares selection hash before dispatch. Use no automatic paid tools, OCR, source archival, or cross-provider attachment queues.

## Acceptance

- Non-prefix text range reads are bounded even for a huge File-like source; multi-byte characters preserve boundaries.
- PDF page selection reports selected pages and missing embedded text honestly within existing size cap.
- User sees coverage before sending; durable source descriptor contains only metadata/hash.
- Reconnected changed selection is rejected, including same-size/same-mtime content changes within selection.
- Sentinel original bytes never enter state/export/outbox/new original files.
- Both executor prompts distinguish selected evidence from whole-source claims.
- Existing full extraction, source reconnection and source-bound delegation safeguards regressions pass.

No claim of unlimited formats, sizes, provider-side zero retention, or offline access to disconnected originals is made.
