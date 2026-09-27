# Generated deliverable verification

Run `python scripts/verify-deliverable.py generated.docx` with a working Python3 interpreter. For PDF previews use `python scripts/verify-deliverable.py generated.pdf --render-dir output/qa`. The tool prints JSON with bounded artifact-compatible `checks` and paths of generated preview images. Exit1 means a failed check; exit0 can still contain `not_run`, so always inspect statuses.

Office checks use only Python standard libraries: ZIP CRC, bounded expanded size, required package parts, XML parsing and rejection of DTD/entity declarations. This is not an Office schema/relationship validator or renderer. Office page/slide rendering is explicitly not_run. PDF parsing and rendering use optional free pypdfium2; absence is reported as not_run. No dependencies are automatically installed and no content is uploaded.

PDF rendering is limited to100pages,10million pixels per page and100million total pixels. File input limit10MB; Office expanded total100MB and20MB per entry. Render output uses a new directory each invocation to avoid overwrites. Keep previews in the task run directory and clean through existing run-storage controls. Partial previews from a failed run may remain for diagnosis; a failure does not claim all pages rendered.

Codex receives the local repository helper path and Claude receives the repository-relative path. Execution requires Python in that runtime; the desktop app's bundled interpreter is not assumed present on every desktop or cloud runtime. The agent must inspect every preview separately before adding a passed visual-inspection check. Model-reported checks remain labeled AI reports.

Validated2026-09-21:4Python tests (including actual1page PDF generation/rendering on this host),332Node tests. The synthetic PDF's rendered text and12.5 value were inspected without clipping. No live subscription task or real manuscript/deck validation is implied.
