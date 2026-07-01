# Release Checklist

## Resource Gate

Run the release resource verifier before platform builds:

```sh
node scripts/verify-release-resources.mjs --platform=macos
node scripts/verify-release-resources.mjs --platform=windows
```

For local config-only checks when platform binaries are unavailable:

```sh
node scripts/verify-release-resources.mjs --platform=macos --config-only
node scripts/verify-release-resources.mjs --platform=windows --config-only
```

Required bundled resources:

| Platform | Required resources |
| --- | --- |
| macOS | `server.jar`, `uv-macos-arm64`, `jre.zip` |
| Windows | `server.jar`, `uv-windows-x86_64.exe`, `jre.zip` |

## Clean Install Smoke Test

Run this on a clean machine or VM with no system Java installed anywhere on the machine.
It is not enough to clear `PATH` or `JAVA_HOME`: the app can also detect standard
vendor install locations on Windows.

1. Install the freshly built release artifact.
2. Launch the app from the normal desktop entry point, not from a developer shell.
3. Confirm the splash leaves `서버 시작 중...` and the main UI appears.
4. Confirm the status bar shows a local server port.
5. Open the app log directory from Settings.
6. Confirm Rust logs show the bundled JRE path and selected `java`/`java.exe`.
7. Confirm `server.log` is created.
8. Open a small PDF.
9. Run Standard conversion.
10. Confirm Markdown output appears.
11. Quit the app.
12. Relaunch and confirm startup succeeds again without reinstalling.

Failure capture:

- Screenshot the startup/error screen.
- Save the app log directory.
- Record whether `server.jar`, `jre.zip`, and the platform `uv` binary exist in the installed app resources.
- Record the selected Java path from the logs. A passing clean-install smoke test must use the bundled JRE path, not a system Java path.

Passing criteria:

- First launch starts the local server without requiring system Java.
- Startup failure never remains as an infinite splash wait.
- Standard conversion succeeds.
- Relaunch succeeds.
