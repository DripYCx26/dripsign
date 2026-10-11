// Each gate in check-docs.mjs planted once in a throwaway tree, and a clean tree passing. Trees
// live under the OS temp directory, outside any Git checkout, so the filesystem walk runs here.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { CONTRACT_LINE_CAP, collectDocsIssues } from "./check-docs.mjs";

function withTree(files, work) {
  const root = mkdtempSync(path.join(tmpdir(), "dripsign-tree-"));
  try {
    for (const [relative, body] of Object.entries(files)) {
      const target = path.join(root, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, body);
    }
    return work(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const CONTRACT = [
  "# Contract",
  "",
  "| Load when | Read |",
  "|---|---|",
  "| touching docs | `docs/README.md` |",
  "",
].join("\n");

const CLEAN = {
  "README.md": "# root\n\n| Path | What |\n|---|---|\n| `docs/` | docs |\n",
  "AGENTS.md": CONTRACT,
  ".env.example": "DRIPSIGN_A=1\n# DRIPSIGN_B=\n",
  "docs/README.md": "# docs/\n\n- `deep/` holds notes.\n",
  "docs/a.md": "See [b](deep/b.md).\n",
  "docs/deep/b.md": "# b\n",
  "packages/README.md": "# packages/\n",
  "packages/core/README.md": "# core\n",
  "packages/core/src/config.ts": "env.DRIPSIGN_A; env.DRIPSIGN_B;\n",
  "e2e/smoke.ts": "",
  ".github/ci.yml": "",
};

const issues = (files) => withTree(files, collectDocsIssues);

test("a clean tree passes; hidden dirs, e2e and nested dirs need no README", () => {
  assert.deepEqual(issues(CLEAN), []);
});

test("a missing README at the root, a top-level directory or a package root is flagged", () => {
  const files = { ...CLEAN, "tools/x.mjs": "", "packages/two/src/a.ts": "" };
  delete files["README.md"];
  const found = issues(files);
  assert.ok(found.includes("README.md: missing"));
  assert.ok(found.includes("tools/README.md: missing"));
  assert.ok(found.includes("packages/two/README.md: missing"));
  assert.ok(!found.some((issue) => issue.startsWith("packages/two/src")));
});

test("a listed directory that does not exist and a broken link are flagged", () => {
  const files = { ...CLEAN, "docs/a.md": "See [gone](gone.md).\n" };
  files["docs/README.md"] += "| `gone/` | gone |\n";
  const found = issues(files);
  assert.ok(found.includes("docs/README.md: lists a directory that does not exist: `gone/`"));
  assert.ok(found.includes("docs/a.md: broken link `gone.md`"));
});

test("the contract over its cap or naming a missing path is flagged", () => {
  const long = `${CONTRACT}| x | \`docs/none.md\` |\n${"\n".repeat(CONTRACT_LINE_CAP)}`;
  const found = issues({ ...CLEAN, "AGENTS.md": long });
  assert.ok(found.some((issue) => issue.includes(`exceeds the cap of ${CONTRACT_LINE_CAP}`)));
  assert.ok(found.some((issue) => issue.includes("load table names a path that does not exist")));
});

test("a config key missing from .env.example is flagged", () => {
  const files = { ...CLEAN, "packages/core/src/config.ts": "env.DRIPSIGN_A; env.DRIPSIGN_C;\n" };
  assert.deepEqual(issues(files), [".env.example: missing `DRIPSIGN_C` read in packages/core/src/config.ts"]);
});
