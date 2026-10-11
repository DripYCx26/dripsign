#!/usr/bin/env node
// Documentation gate: a README.md at the root, in every top-level directory (hidden directories,
// node_modules and e2e excepted) and in every apps/* and packages/* root; every directory a README
// lists exists; every relative Markdown link resolves; AGENTS.md stays within its line cap and
// every path its load table names exists; every DRIPSIGN_* key config.ts reads is in .env.example.
// Inside a Git checkout the tree is what Git would commit; outside Git it walks the filesystem.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKIP = new Set([".git", "node_modules", "worktrees"]);
const LINK = /\]\(([^)]+)\)/gu;

function walkFilesystem(root, dir = "") {
  const dirs = [];
  const files = [];
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.isSymbolicLink()) continue;
    const relative = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      dirs.push(relative);
      const nested = walkFilesystem(root, relative);
      dirs.push(...nested.dirs);
      files.push(...nested.files);
    } else {
      files.push(relative);
    }
  }
  return { dirs, files };
}

function gitTree(root) {
  let listing;
  try {
    listing = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
  const files = listing.split("\0").filter((entry) => entry && existsSync(path.join(root, entry)));
  const dirs = new Set();
  for (const file of files) {
    const parts = file.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) dirs.add(parts.slice(0, depth).join("/"));
  }
  return { dirs: [...dirs].sort(), files };
}

export function walk(root) {
  return gitTree(root) ?? walkFilesystem(root);
}

const PACKAGE_ROOT = /^(?:apps|packages)\/[^/]+$/u;
const README_EXEMPT = new Set(["e2e"]);

export function requiredReadmeDirs(dirs) {
  return [
    "",
    ...dirs.filter((dir) =>
      dir.includes("/")
        ? PACKAGE_ROOT.test(dir)
        : !dir.startsWith(".") && !README_EXEMPT.has(dir) && dir !== "node_modules",
    ),
  ];
}

// A directory a README lists: a backticked path ending in `/` that opens a table row or list item.
const LISTED_DIR = /^(?:\|\s*|[-*]\s+)`([^`]+\/)`/u;

function listedDirs(markdown) {
  return markdown
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => LISTED_DIR.exec(line)?.[1])
    .filter(Boolean);
}

export function collectReadmeIssues(root, tree = walk(root)) {
  const { dirs, files } = tree;
  const issues = [];
  for (const dir of requiredReadmeDirs(dirs)) {
    const readme = dir ? `${dir}/README.md` : "README.md";
    if (!files.includes(readme)) issues.push(`${readme}: missing`);
  }
  for (const readme of files.filter((file) => path.posix.basename(file) === "README.md")) {
    const markdown = readFileSync(path.join(root, readme), "utf8");
    for (const listed of listedDirs(markdown)) {
      const target = path.posix.join(path.posix.dirname(readme), listed);
      if (!dirs.includes(target.replace(/\/+$/u, "")))
        issues.push(`${readme}: lists a directory that does not exist: \`${listed}\``);
    }
  }
  return issues;
}

export function collectLinkIssues(root, tree = walk(root)) {
  const issues = [];
  for (const file of tree.files.filter((name) => name.endsWith(".md"))) {
    const markdown = readFileSync(path.join(root, file), "utf8");
    for (const match of markdown.matchAll(LINK)) {
      const target = match[1].split("#")[0].trim();
      if (!target || /^(?:https?:|mailto:)/u.test(target)) continue;
      if (!existsSync(path.join(root, path.dirname(file), target))) {
        issues.push(`${file}: broken link \`${match[1]}\``);
      }
    }
  }
  return issues;
}

const CONTRACT = "AGENTS.md";
export const CONTRACT_LINE_CAP = 100;
const REPO_PATH = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]*)*$/u;

export function collectContractIssues(root) {
  const target = path.join(root, CONTRACT);
  if (!existsSync(target)) return [`${CONTRACT}: missing`];
  const text = readFileSync(target, "utf8").replaceAll("\r\n", "\n");
  const issues = [];
  const lineCount = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  if (lineCount > CONTRACT_LINE_CAP)
    issues.push(`${CONTRACT}: ${lineCount} lines exceeds the cap of ${CONTRACT_LINE_CAP}`);
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^\|\s*Load when\s*\|/u.test(line));
  if (start === -1)
    return [...issues, `${CONTRACT}: no load table (a row starting with \`| Load when |\`)`];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    for (const match of line.matchAll(/`([^`]+)`/gu)) {
      const ref = match[1];
      if (!REPO_PATH.test(ref) || !(ref.includes("/") || /\.(?:md|html|json|toml|yaml)$/u.test(ref)))
        continue;
      if (!existsSync(path.join(root, ref)))
        issues.push(`${CONTRACT}: load table names a path that does not exist: \`${ref}\``);
    }
  }
  return issues;
}

const CONFIG = "packages/core/src/config.ts";
const ENV_EXAMPLE = ".env.example";

// Every DRIPSIGN_* key config.ts reads must be documented in .env.example. Skipped while
// config.ts does not exist yet.
export function collectEnvIssues(root) {
  const config = path.join(root, CONFIG);
  if (!existsSync(config)) return [];
  const example = path.join(root, ENV_EXAMPLE);
  if (!existsSync(example)) return [`${ENV_EXAMPLE}: missing`];
  const keys = (text, pattern) => new Set(Array.from(text.matchAll(pattern), (match) => match[1]));
  const documented = keys(readFileSync(example, "utf8"), /^#?\s*(DRIPSIGN_[A-Z0-9_]+)=/gmu);
  const read = keys(readFileSync(config, "utf8"), /\b(DRIPSIGN_[A-Z0-9_]+)\b/gu);
  return [...read]
    .filter((key) => !documented.has(key))
    .map((key) => `${ENV_EXAMPLE}: missing \`${key}\` read in ${CONFIG}`);
}

export function collectDocsIssues(root) {
  const tree = walk(root);
  return [
    ...collectReadmeIssues(root, tree),
    ...collectLinkIssues(root, tree),
    ...collectContractIssues(root),
    ...collectEnvIssues(root),
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const issues = collectDocsIssues(root);
  for (const issue of issues) console.error(issue);
  if (issues.length) {
    console.error(`docs check found ${issues.length} issue(s)`);
    process.exitCode = 1;
  } else {
    console.log("docs check ok");
  }
}
