# QA-v09-003 Code Validation Bundles

Date: 2026-07-20

## Objective

Turn the code-verifiable parts of the large-PDF Hybrid/OCR/Formula follow-up into small, independently testable work bundles. Each bundle is implemented, documented, and committed separately.

## Completed bundles

| Bundle | Acceptance criteria | Evidence | Commit |
|---|---|---|---|
| Frontend result polling | A `202/RUNNING` result reaches `DONE`; server `ERROR` details survive; timeout is deterministic; cancellation stops polling; frontend build passes | `npm test` — 4 passed; `npm run build` passed; `docs/qa/frontend-result-polling.md` | `a852181` |
| Rust JVM bootstrap contract | Required PDFBox module/native-access flags are fixed; JVM options precede `-jar`; Unicode/space paths remain one argument; no real JVM is spawned by tests | `cargo test` — 3 passed; `cargo check` passed; `docs/qa/qa-v09-003-rust-jvm-bootstrap.md` | `954c30d` |
| Release metadata and resources | Tauri, Cargo, lockfile, updater metadata, platform entries, and artifact URLs agree on `0.8.7`; stale/missing metadata fails; macOS/Windows config checks pass | Node tests — 3 passed; both config-only checks passed; `docs/qa/release-metadata-verification.md` | `a204a06` |

The stable release metadata baseline was aligned in commit `425aa1c`. The subsequent
release candidate sets the build version to `0.9.0-rc.2` while intentionally keeping
the automatic-update stable channel on `0.8.7`.

## Integrated verification

Run from the repository root unless a directory is shown:

```text
frontend: npm test                       PASS (4/4)
frontend: npm run build                  PASS
src-tauri: cargo test                    PASS (3/3)
src-tauri: cargo check                   PASS
server: ./gradlew :app:shadowJar         PASS
node --test tests/release-metadata.test.mjs
                                          PASS (3/3)
node scripts/verify-release-resources.mjs --platform=macos --config-only
                                          PASS
node scripts/verify-release-resources.mjs --platform=windows --config-only
                                          PASS
git diff --check                         PASS
```

## Remaining non-code verification

QA-v09-003 is not closed by these tests. It still requires representative large PDFs and real macOS/Windows runs for Hybrid, OCR, and Formula modes. Those runs must capture memory/timeout/path behavior, logs, failure recovery, and successful reuse of the app/server after a failed conversion.

## Known validation limits

- Frontend TypeScript tests currently require Node 22 type stripping and emit an experimental warning.
- Config-only release checks do not inspect real JRE/JAR/uv bundle contents; release jobs retain the full resource check.
- Rust unit tests do not start a real JVM or exercise Windows path normalization on macOS.
- The frontend build retains pre-existing dynamic-import and large-chunk warnings.
