# Research integrations

INNO Workspace treats local files and folders as live browser connections. It stores only attachment descriptors in tasks. Source bytes, `File` objects, and file-system handles remain inside the current `AttachmentSession` and disappear when the page is closed or refreshed.

## Connected attachments

Import `AttachmentSession` and `MAX_TEXT_BYTES` from `public/core/attachments.mjs`.

```js
const session = new AttachmentSession();
const [attachment] = session.addFiles(fileInput.files);
const material = await session.readText(attachment.id, { maxBytes: 50_000 });
```

The session exposes:

- `addFiles(files)`: connects an iterable of browser `File` objects. `webkitRelativePath` is preserved for folder-picker files.
- `addDirectory(handle)`: recursively connects the files under a File System Access API directory handle and preserves the selected root folder in each path.
- `addUrl(url)`: registers an `http` or `https` reference. It does not fetch the URL.
- `list()`: returns fresh metadata-only descriptors matching the shared attachment contract.
- `remove(id)` and `clear()`: discard the in-memory connection.
- `getFile(id)`: resolves the current browser file. Directory handles are queried again on every call. It returns `null` for a URL and rejects a file whose size, modification time, name, or media type changed after connection.
- `readText(id, {maxBytes})`: returns `{status, text, bytesRead, size, reason?}`. `status` is `available`, `truncated`, or `unavailable`.

`readText` never reads more than 200,000 bytes, even when a caller asks for more. Known text media types and text-oriented extensions are decoded as UTF-8. Unsupported binary files remain references and return `unavailable`. A restored task contains descriptors only, so the user must reconnect local sources before an executor can receive a new excerpt.

Paths are relative, slash-separated browser paths. Absolute paths, drive paths, empty segments, `.` segments, and `..` traversal are rejected. Callers should persist only the objects returned by `list()` and never serialize the `AttachmentSession` itself.

## Prism analysis JSON

`parsePrismReport(text)` accepts the analysis JSON produced by INNO Prism's power-scan export. It requires `app: "INNO Prism"`, a non-empty engine version, and an analysis object. The return value is:

```js
{
  engine: "PrismFit 2.6.0",
  analysis: { /* original analysis values */ },
  source: { app: "INNO Prism", file: "measurement.h5" },
  settings: { /* analysis settings, when exported */ },
  calibration: { /* calibration inputs and results, when exported */ },
  densityFactor_mWcm2_per_W: 123.4,
  manualSlope: { /* manual range and slope cross-check, when exported */ }
}
```

The four provenance fields after `source` are included only when the Prism export contains them, so older inputs with only `engine`, `analysis`, and file/source information remain compatible. If an export already has a `source` object, that object is preserved. Every numeric value in the analysis, source, settings, calibration, density conversion, and manual-slope data must be finite. The parser rejects malformed JSON, a wrong app type, missing required fields, and values such as an overflowed JSON number. It does not recompute or round analysis results.

## RefAtlas JSON

`parseRefAtlas(text)` accepts all of the existing RefAtlas interchange layouts:

- the compact catalog array (`ti`, `yr`, `vn`, `au`, and `src` fields);
- a monthly `{id: paper}` shard;
- `{papers: [...]}` or `{papers: {id: paper}}` wrappers;
- one paper record.

It returns an array with canonical `id`, `doi`, `title`, `abstract`, `year`, `venue`, `authors`, `source`, `tags`, and `evidenceScope` fields while retaining other source fields. A DOI is resolved from the explicit DOI field, a `doi:` ID, or a `doi.org` URL. DOI URLs are normalized to DOI strings, and URL-only DOI records receive a canonical `doi:` ID. Conflicts among any of those DOI identities are rejected rather than presented as citations.

The evidence scope is preserved when supplied and must be `metadata`, `abstract`, or `full-text`. Abstract evidence must be a non-empty string. Full-text scope requires non-empty text in `fullText` or `full_text`; the parser exposes it canonically as `fullText`. If the source omitted the scope, the parser assigns `full-text` when full-text evidence is present, `abstract` when abstract text is present, and otherwise `metadata`. Each record must have a title and a source identity (`id` or resolved DOI).

`searchPapers(papers, query, limit = 20)` performs a deterministic, case-insensitive search across DOI, title, authors, venue, source, tags, and abstract. All query terms must occur. DOI and title matches rank above metadata and abstract matches; equal scores retain input order. Empty queries return no records, and the function does not mutate the paper array.

## Existing app links

`INTEGRATIONS` is a frozen catalog used by the interface. Each entry contains a primary `url`, a separate `repositoryUrl`, and `linkKind: "app" | "repository"`. The primary URL is labeled as an app only after the deployed page is verified; otherwise it deliberately falls back to the repository.

| App | Primary destination | Kind | Repository | Supported import into Workspace |
|---|---|---|---|---|
| INNO Scheduler | <https://inno-kaist.github.io/INNO-Scheduler/> | App | <https://github.com/INNO-KAIST/INNO-Scheduler> | Link only |
| INNO NanoLab | <https://github.com/INNO-KAIST/INNO-NanoLab> | Repository | Same as primary | Link only |
| INNO Ledger | <https://github.com/INNO-KAIST/INNO-Ledger> | Repository | Same as primary | Link only |
| INNO Prism | <https://github.com/INNO-KAIST/INNO-Prism> | Repository | Same as primary | `analysis-json` |
| INNO Analytics | <https://github.com/INNO-KAIST/INNO-Analytics> | Repository | Same as primary | Link only |
| INNO RefAtlas | <https://github.com/INNO-KAIST/INNO-RefAtlas> | Repository | Same as primary | `catalog-json`, `papers-json` |

The Scheduler deployment returned HTTP 200 with the title `INNO Scheduler` during the 2026-09-13 verification. The NanoLab setup guide's former `wonjeong-dev.github.io` deployment returned 404, and the public GitHub metadata did not declare deployed homepages for NanoLab, Ledger, Prism, or Analytics. RefAtlas is private and has no public deployment URL in this catalog, so those entries remain repository links until an application endpoint is configured and verified.

These adapters parse files that the user explicitly connects. They do not crawl the six applications, copy their corpora, upload source documents, or bypass their authentication.
