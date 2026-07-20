import fs from "node:fs";
import path from "node:path";

const REQUIRED_UPDATER_PLATFORMS = {
  "darwin-aarch64": "pdf-to-markdown.app.tar.gz",
  "windows-x86_64": "pdf-to-markdown_{version}_x64-setup.exe",
};

function readJson(repoRoot, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function readCargoVersion(repoRoot) {
  const cargoToml = fs.readFileSync(path.join(repoRoot, "src-tauri/Cargo.toml"), "utf8");
  const packageSection = cargoToml.match(/^\[package\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1];
  const version = packageSection?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!version) {
    throw new Error("src-tauri/Cargo.toml is missing [package].version");
  }
  return version;
}

export function verifyReleaseMetadata(repoRoot) {
  const errors = [];
  const expectedVersion = readJson(repoRoot, "release-version.json").version;
  const tauriVersion = readJson(repoRoot, "src-tauri/tauri.conf.json").version;
  const cargoVersion = readCargoVersion(repoRoot);
  const updater = readJson(repoRoot, "latest.json");

  if (typeof expectedVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(expectedVersion)) {
    errors.push("release-version.json must contain a semantic version string");
  }

  for (const [source, actual] of [
    ["src-tauri/tauri.conf.json", tauriVersion],
    ["src-tauri/Cargo.toml", cargoVersion],
    ["latest.json", updater.version],
  ]) {
    if (actual !== expectedVersion) {
      errors.push(`${source} version ${actual ?? "<missing>"} does not match ${expectedVersion}`);
    }
  }

  for (const [platform, filenameTemplate] of Object.entries(REQUIRED_UPDATER_PLATFORMS)) {
    const entry = updater.platforms?.[platform];
    if (!entry) {
      errors.push(`latest.json is missing updater platform ${platform}`);
      continue;
    }
    if (typeof entry.signature !== "string" || entry.signature.length === 0) {
      errors.push(`latest.json platform ${platform} is missing a signature`);
    }
    const filename = filenameTemplate.replace("{version}", expectedVersion);
    const expectedUrl =
      `https://github.com/Chaebin-Park/pdf-to-markdown/releases/download/` +
      `v${expectedVersion}/${filename}`;
    if (entry.url !== expectedUrl) {
      errors.push(`latest.json platform ${platform} URL must be ${expectedUrl}`);
    }
  }

  return { expectedVersion, errors };
}
