import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyReleaseMetadata } from "../scripts/lib/release-metadata.mjs";

function makeFixture(mutator = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-metadata-"));
  fs.mkdirSync(path.join(root, "src-tauri"));
  const fixture = {
    expected: {
      version: "0.9.0-rc.1",
      channel: "prerelease",
      stableUpdaterVersion: "0.8.7",
    },
    tauri: { version: "0.9.0-rc.1" },
    cargo: '[package]\nname = "app"\nversion = "0.9.0-rc.1"\n\n[dependencies]\n',
    updater: {
      version: "0.8.7",
      platforms: {
        "darwin-aarch64": {
          signature: "mac-signature",
          url: "https://github.com/Chaebin-Park/pdf-to-markdown/releases/download/v0.8.7/pdf-to-markdown.app.tar.gz",
        },
        "windows-x86_64": {
          signature: "windows-signature",
          url: "https://github.com/Chaebin-Park/pdf-to-markdown/releases/download/v0.8.7/pdf-to-markdown_0.8.7_x64-setup.exe",
        },
      },
    },
  };
  mutator(fixture);
  fs.writeFileSync(path.join(root, "release-version.json"), JSON.stringify(fixture.expected));
  fs.writeFileSync(path.join(root, "src-tauri/tauri.conf.json"), JSON.stringify(fixture.tauri));
  fs.writeFileSync(path.join(root, "src-tauri/Cargo.toml"), fixture.cargo);
  fs.writeFileSync(path.join(root, "latest.json"), JSON.stringify(fixture.updater));
  return root;
}

test("accepts v0.9.0-rc.1 while keeping v0.8.7 on the stable updater channel", (t) => {
  const root = makeFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(verifyReleaseMetadata(root), {
    expectedVersion: "0.9.0-rc.1",
    stableUpdaterVersion: "0.8.7",
    channel: "prerelease",
    errors: [],
  });
});

test("rejects a stale version and missing Windows updater entry", (t) => {
  const root = makeFixture((fixture) => {
    fixture.tauri.version = "0.8.6";
    delete fixture.updater.platforms["windows-x86_64"];
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { errors } = verifyReleaseMetadata(root);
  assert.ok(errors.some((error) => error.includes("tauri.conf.json version 0.8.6")));
  assert.ok(errors.some((error) => error.includes("missing updater platform windows-x86_64")));
});

test("rejects an updater URL outside the stable v0.8.7 release", (t) => {
  const root = makeFixture((fixture) => {
    fixture.updater.platforms["darwin-aarch64"].url =
      "https://example.invalid/v0.8.7/pdf-to-markdown.app.tar.gz";
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { errors } = verifyReleaseMetadata(root);
  assert.ok(errors.some((error) => error.includes("darwin-aarch64 URL must be")));
});

test("rejects a prerelease version declared on the stable channel", (t) => {
  const root = makeFixture((fixture) => {
    fixture.expected.channel = "stable";
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { errors } = verifyReleaseMetadata(root);
  assert.ok(errors.some((error) => error.includes("stable channel cannot use")));
});
