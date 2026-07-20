# Release Metadata Verification — v0.9.0-rc.2

## Scope

- Treat `release-version.json` as the build version and channel source of truth.
- Verify Tauri and Cargo versions match `0.9.0-rc.2`.
- Keep the stable updater metadata on `0.8.7` while the RC is a prerelease.
- Require signed updater entries for `darwin-aarch64` and `windows-x86_64`.
- Require both updater URLs to point at the expected `v0.8.7` GitHub release artifacts.
- Keep verification dependency-free and offline-capable with Node built-ins.

## Acceptance Criteria

- A valid v0.9.0-rc.2 fixture with stable updater v0.8.7 passes.
- A prerelease version declared on the stable channel fails.
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
four cases, including three deliberately invalid fixtures, without network access.

## Remaining Risk

Config-only checks do not validate the presence or binary contents of packaged JRE,
server JAR, or platform `uv` resources. Full platform release jobs retain those checks.
