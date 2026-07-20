#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { verifyReleaseMetadata } from "./lib/release-metadata.mjs";

const args = new Set(process.argv.slice(2));
const platformArg = process.argv.find((arg) => arg.startsWith("--platform="));
const platform = platformArg?.split("=")[1];
const configOnly = args.has("--config-only");

const repoRoot = process.cwd();

const expectations = {
  macos: {
    config: "src-tauri/tauri.release-macos.conf.json",
    resources: {
      "../server/app/build/libs/server.jar": "server.jar",
      "resources/uv-macos-arm64": "uv-macos-arm64",
      "resources/jre.zip": "jre.zip",
    },
    files: [
      "server/app/build/libs/server.jar",
      "src-tauri/resources/uv-macos-arm64",
      "src-tauri/resources/jre.zip",
    ],
    jreJavaEntry: "jre/bin/java",
    uv: {
      file: "src-tauri/resources/uv-macos-arm64",
      validate: validateExecutableBit,
    },
  },
  windows: {
    config: "src-tauri/tauri.windows.conf.json",
    resources: {
      "../server/app/build/libs/server.jar": "server.jar",
      "resources/uv-windows-x86_64.exe": "uv-windows-x86_64.exe",
      "resources/jre.zip": "jre.zip",
    },
    files: [
      "server/app/build/libs/server.jar",
      "src-tauri/resources/uv-windows-x86_64.exe",
      "src-tauri/resources/jre.zip",
    ],
    jreJavaEntry: "jre/bin/java.exe",
    uv: {
      file: "src-tauri/resources/uv-windows-x86_64.exe",
      validate: validateWindowsExecutable,
    },
  },
};

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

function readJson(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function readZipEntries(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const buffer = fs.readFileSync(absolutePath);
  const eocdSignature = 0x06054b50;
  const centralDirectorySignature = 0x02014b50;
  const searchStart = Math.max(0, buffer.length - 0xffff - 22);

  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error("missing ZIP end-of-central-directory record");
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== centralDirectorySignature) {
      throw new Error("invalid ZIP central-directory record");
    }

    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;

    if (nameEnd > buffer.length) {
      throw new Error("invalid ZIP entry name length");
    }

    entries.push(buffer.toString("utf8", nameStart, nameEnd).replaceAll("\\", "/"));
    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

function requireZipEntry(zipPath, expectedEntry) {
  let entries;
  try {
    entries = readZipEntries(zipPath);
  } catch (error) {
    fail(`${zipPath} is not a readable ZIP archive: ${error.message}`);
    return;
  }

  if (!entries.includes(expectedEntry)) {
    fail(`${zipPath} missing ZIP entry: ${expectedEntry}`);
  }
}

function requireZipHasAny(zipPath, predicate, description) {
  let entries;
  try {
    entries = readZipEntries(zipPath);
  } catch (error) {
    fail(`${zipPath} is not a readable ZIP archive: ${error.message}`);
    return;
  }

  if (!entries.some(predicate)) {
    fail(`${zipPath} missing ZIP content: ${description}`);
  }
}

function validateExecutableBit(relativePath, stat) {
  if ((stat.mode & 0o111) === 0) {
    fail(`${relativePath} must be executable`);
  }
}

function validateWindowsExecutable(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const header = Buffer.alloc(2);
  const fd = fs.openSync(absolutePath, "r");
  try {
    fs.readSync(fd, header, 0, header.length, 0);
  } finally {
    fs.closeSync(fd);
  }

  if (header.toString("ascii") !== "MZ") {
    fail(`${relativePath} must be a Windows PE executable`);
  }
}

if (!platform || !expectations[platform]) {
  fail("Usage: node scripts/verify-release-resources.mjs --platform=macos|windows [--config-only]");
  process.exit();
}

let metadataResult;
try {
  metadataResult = verifyReleaseMetadata(repoRoot);
  for (const error of metadataResult.errors) {
    fail(error);
  }
} catch (error) {
  fail(`release metadata verification failed: ${error.message}`);
}

const expected = expectations[platform];
const config = readJson(expected.config);
const resources = config.bundle?.resources;

if (!resources || typeof resources !== "object" || Array.isArray(resources)) {
  fail(`${expected.config} must define bundle.resources as an object`);
} else {
  for (const [source, target] of Object.entries(expected.resources)) {
    if (resources[source] !== target) {
      fail(`${expected.config} missing resource mapping ${source} -> ${target}`);
    }
  }
}

if (!configOnly) {
  let allFilesPresent = true;

  for (const file of expected.files) {
    const absolutePath = path.join(repoRoot, file);
    if (!fs.existsSync(absolutePath)) {
      fail(`required release resource missing: ${file}`);
      allFilesPresent = false;
      continue;
    }
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile() || stat.size === 0) {
      fail(`required release resource is empty or not a file: ${file}`);
      allFilesPresent = false;
    }
  }

  if (allFilesPresent) {
    requireZipHasAny(
      "server/app/build/libs/server.jar",
      (entry) => entry === "META-INF/MANIFEST.MF" || entry.endsWith(".class"),
      "JAR manifest or class files"
    );
    requireZipEntry("src-tauri/resources/jre.zip", expected.jreJavaEntry);

    const uvPath = expected.uv.file;
    const uvStat = fs.statSync(path.join(repoRoot, uvPath));
    expected.uv.validate(uvPath, uvStat);
  }
}

if (process.exitCode) {
  process.exit();
}

console.log(
  `release verification passed (v${metadataResult.expectedVersion}, ${platform}${configOnly ? ", config-only" : ""})`
);
