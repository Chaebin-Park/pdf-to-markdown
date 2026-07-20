# Hybrid Runtime Profiles

## Runtime contract

- Java core and Python Hybrid package are aligned on OpenDataLoader PDF `2.4.3`.
- Installation uses `opendataloader-pdf[hybrid]==2.4.3` and records the verified
  installed version in `.hybrid_installed`.
- An existing service on port 5002 is rejected unless it was started and tracked
  by this app. Upstream `/health` reports health only, not version or profile.

## Profiles

| Profile | Server arguments | Conversion modes |
| --- | --- | --- |
| `hybrid` | default Docling pipeline | Hybrid, Hybrid Full |
| `ocr` | `--force-ocr --ocr-lang ko,en` | OCR |
| `formula` | `--enrich-formula` | Formula |

Switching profiles stops the app-owned server and starts the requested profile.
Both stdout and stderr are copied into the application log with a `docling` prefix.

## Diagnostics

Settings reports the expected and installed package versions, running profile,
port, and last runtime error. A version mismatch requires reinstalling Hybrid mode.

## Verification

```sh
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
npm --prefix frontend run build
git diff --check
```

Unit tests assert the pinned dependency and exact arguments for all three profiles.
