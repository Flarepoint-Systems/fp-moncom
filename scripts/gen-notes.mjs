#!/usr/bin/env node
// Builds the release-notes body from commits between the previous tag and the
// tag being released, bucketed by Conventional Commit type. Prints markdown to
// stdout. Run: `node scripts/gen-notes.mjs [<tag>]` (defaults to
// $GITHUB_REF_NAME, then HEAD).
import { execFileSync } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const to = process.argv[2] || process.env.GITHUB_REF_NAME || "HEAD";

// Nearest tag before `to`; absent on the first release, so notes span all history.
let from = "";
try {
  // Own execFile so the "no tags" failure on a first release stays off stderr.
  from = execFileSync("git", ["describe", "--tags", "--abbrev=0", `${to}^`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  from = "";
}
const range = from ? `${from}..${to}` : to;

// Unit separator between fields keeps subjects with any punctuation intact.
const US = "\x1f";
const raw = git("log", "--no-merges", `--pretty=format:%h${US}%an${US}%s`, range);

const commits = raw
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [hash, author, subject] = line.split(US);
    return { hash, author, subject };
  })
  // The version-bump commit is release plumbing, not a change worth listing.
  // Matches both the old hand-written "chore: bump v" and release.mjs's message.
  .filter((c) => !/^chore(\([^)]*\))?:\s*bump\s+v(ersion)?\b/i.test(c.subject));

// A trailing bare "#123" renders as a PR link in GitHub release bodies.
const prSuffix = (subject) => {
  const m = subject.match(/\(#(\d+)\)/);
  return m ? ` #${m[1]}` : "";
};

const features = [];
const fixes = [];
const other = [];
const typed = /^(feat|fix)(?:\(([^)]*)\))?!?:\s*(.*)$/;

for (const c of commits) {
  const m = c.subject.match(typed);
  if (m) {
    const [, type, scope, rest] = m;
    const head = scope ? `${scope}: ${rest}` : rest;
    const line = `- ${head}${prSuffix(rest)} (${c.author})`;
    (type === "feat" ? features : fixes).push(line);
  } else {
    other.push(`- ${c.hash}: ${c.subject}${prSuffix(c.subject)} (${c.author})`);
  }
}

const body = [
  ["Features", features],
  ["Bug Fixes", fixes],
  ["Commits", other],
]
  .filter(([, items]) => items.length)
  .map(([title, items]) => `### ${title}\n\n${items.join("\n")}`)
  .join("\n\n");

process.stdout.write((body || "_No notable changes._") + "\n");
