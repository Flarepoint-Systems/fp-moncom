#!/usr/bin/env node
// One-command release: guard, verify, bump, commit, tag, push. The tag push
// triggers the Release workflow (.github/workflows/release.yml), which builds the
// Windows installer + portable and drafts a GitHub release with generated notes.
// Run: `npm run release <version>`.
import { execFileSync } from "node:child_process";
import { bump, assertValidVersion } from "./bump-version.mjs";

const BRANCH = "main"; // releases are cut from main only
const REMOTE = "origin";

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const gitInherit = (...args) => execFileSync("git", args, { stdio: "inherit" });

function tagExistsLocal(tag) {
  try {
    execFileSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const version = process.argv[2];
if (!version) fail("usage: npm run release <version>   (e.g. npm run release 0.3.4)");
try {
  assertValidVersion(version);
} catch (e) {
  fail(e.message);
}
const tag = `v${version}`;

// ── Guards (fail before touching anything) ──────────────────────────────────
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== BRANCH) fail(`on branch "${branch}"; releases must be cut from "${BRANCH}".`);

if (git("status", "--porcelain")) {
  fail("working tree has uncommitted changes; commit or stash them so the bump commit is clean.");
}

if (tagExistsLocal(tag)) fail(`tag ${tag} already exists locally.`);
try {
  if (git("ls-remote", "--tags", REMOTE, tag)) fail(`tag ${tag} already exists on ${REMOTE}.`);
} catch (e) {
  fail(`could not reach ${REMOTE} to check for ${tag}: ${e.message}`);
}

// ── Verify, then bump → commit → tag → push ─────────────────────────────────
// Build output lands in gitignored dist/, so the clean-tree guard above holds.
console.log("→ typechecking (npm run check)…");
try {
  execFileSync("npm", ["run", "check"], { stdio: "inherit" });
} catch {
  fail("typecheck failed; not releasing.");
}

console.log("→ building (npm run build)…");
try {
  execFileSync("npm", ["run", "build"], { stdio: "inherit" });
} catch {
  fail("build failed; not releasing.");
}

console.log(`→ bumping to ${version}`);
try {
  bump(version);
} catch (e) {
  fail(e.message);
}

// package.json's bump leaves package-lock.json's own version fields stale; resync
// them so the lock lands in the same commit and `npm ci` stays happy in CI.
console.log("→ syncing package-lock.json…");
try {
  execFileSync("npm", ["install", "--package-lock-only"], { stdio: "inherit" });
} catch {
  fail("npm install --package-lock-only failed; not releasing.");
}

try {
  gitInherit("commit", "-am", `chore: bump version to ${tag}`);
  gitInherit("tag", tag);
} catch (e) {
  fail(`git commit/tag failed: ${e.message}`);
}

try {
  gitInherit("push", REMOTE, BRANCH, tag);
} catch (e) {
  fail(`push failed: ${e.message}\n  commit and ${tag} exist locally; retry with: git push ${REMOTE} ${BRANCH} ${tag}`);
}

console.log(`\n✓ released ${tag}. The Release workflow is now building.`);
