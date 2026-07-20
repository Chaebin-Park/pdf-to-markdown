# Release Metadata Verification — v0.8.7

## Scope

- Treat `release-version.json` as the repository's single expected release version.
- Verify Tauri, Cargo, and updater versions match that value.
- Require signed updater entries for `darwin-aarch64` and `windows-x86_64`.
- Require both updater URLs to point at the expected `v0.8.7` GitHub release artifacts.
- Keep verification dependency-free and offline-capable with Node built-ins.

## Acceptance Criteria

- A valid v0.8.7 fixture passes.
- A stale application version and a missing Windows updater entry fail.
- An unexpected macOS updater URL fails.
- macOS and Windows config-only release verification pass against repository files.
- Frontend production build and `git diff --check` pass.

## Commands and Evidence

Run from the repository root:

```sh
node --test tests/release-metadata.test.mjs
node scripts/verify-release-resources.mjs --platform=macos --config-only
node scripts/verify-release-resources.mjs --platform=windows --config-only
npm --prefix frontend run build
git diff --check
```

Result recorded on 2026-07-20: all commands passed. The Node test suite executed
three cases, including two deliberately invalid fixtures, without network access.

## Remaining Risk

Config-only checks do not validate the presence or binary contents of packaged JRE,
server JAR, or platform `uv` resources. Full platform release jobs retain those checks.
