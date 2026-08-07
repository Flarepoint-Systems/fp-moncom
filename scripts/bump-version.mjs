#!/usr/bin/env node
// Single source of truth for the app version: package.json is the only file that
// carries it (electron-builder reads it from there). Run: `npm run bump <version>`.
//
// Also the reusable core behind `npm run release`, which imports bump() and
// assertValidVersion() rather than shelling out.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// electron-builder rejects non-semver, so fail here rather than deep in a build.
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function assertValidVersion(version) {
  if (!version || !SEMVER_RE.test(version)) {
    throw new Error(`invalid semver version: "${version ?? ""}"`);
  }
}

const edits = [
  {
    file: "package.json",
    // First "version" key is the top-level app version, not a dependency range.
    re: /("version":\s*")[^"]*(")/,
  },
];

// Rewrite the app version. Throws if the field is missing. package-lock.json is
// left to `npm install --package-lock-only` (see release.mjs), so bump stays a
// pure, offline file rewrite.
export function bump(version) {
  assertValidVersion(version);
  for (const { file, re } of edits) {
    const path = join(root, file);
    const before = readFileSync(path, "utf8");
    if (!re.test(before)) {
      throw new Error(`could not find version field in ${file}; aborting.`);
    }
    writeFileSync(path, before.replace(re, `$1${version}$2`));
    console.log(`  ${file} -> ${version}`);
  }
}

// CLI: `npm run bump <version>` stays a pure file-rewrite primitive.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.argv[2];
  if (!version) {
    console.error("usage: npm run bump <version>   (e.g. npm run bump 0.3.4)");
    process.exit(1);
  }
  try {
    bump(version);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  console.log(`\nBumped to ${version}. Next: commit, then tag (git tag v${version}).`);
}
