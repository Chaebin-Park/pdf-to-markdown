# Conversion quality improvements

## Scope

This delivery implements the code-verifiable parts of bundles A through G. Physical-device and representative-document validation remains in `QA-HQ-001`.

## Completed bundles

| Bundle | Result | Verification |
|---|---|---|
| A — job isolation | Per-job input/output directories, cancellation endpoint, stale artifact rejection, safe cleanup | Concurrent input and lifecycle tests |
| B — OCR profile | Pinned Hybrid 2.4.3, force OCR, `ko,en` languages | Rust command/profile tests |
| C — Formula profile | Dedicated server profile with formula enrichment | Rust command/profile tests |
| D — reading order | Auto, Struct Tree, and XY-Cut strategies; invalid values rejected | Kotlin config mapping tests |
| E — content preservation | Header/footer, line breaks, and four safety filters exposed with truthful defaults | Frontend serialization and Kotlin config tests |
| F — completeness gate | Missing, empty, stale, malformed, and element-free page detection; UI warning | Kotlin validator tests and frontend build |
| G — runtime stability | Version marker validation, owned-process profile switching, health check, logs and diagnostics | Rust tests/check and QA notes |

## Fresh verification

- Frontend: `npm test` — 5/5 passed
- Frontend: `npm run build` — passed; existing chunk-size/dynamic-import warnings remain
- Server: `./gradlew test shadowJar` — passed
- Rust: `cargo test` — 9/9 passed
- Rust: `cargo check` — passed
- `git diff --check` — passed

## Deferred QA-HQ-001

Run on macOS and Windows with representative PDFs:

- valid and malformed Tagged PDFs
- two/three-column papers
- Korean and mixed-language scanned PDFs
- formula-heavy papers
- documents with headers, footers, footnotes, and tiny text
- 100+ page documents
- cancellation followed by immediate retry

Record paragraph omissions, reading-order errors, empty pages, OCR errors, formula extraction success, runtime, and memory. Stable promotion remains gated on this evidence.
