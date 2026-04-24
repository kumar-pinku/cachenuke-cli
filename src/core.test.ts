import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanTargets, scanTargets } from "./core";

async function createWorkspaceFixture(): Promise<string> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "cachenuke-workspace-"));
  await fs.mkdir(path.join(projectDir, ".next", "cache"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "node_modules", ".cache", "demo"), {
    recursive: true,
  });
  await fs.writeFile(path.join(projectDir, ".next", "cache", "a.bin"), "12345", "utf8");
  await fs.writeFile(
    path.join(projectDir, "node_modules", ".cache", "demo", "b.bin"),
    "123456789",
    "utf8"
  );
  return projectDir;
}

test("scanTargets finds local workspace artifacts", async () => {
  const projectDir = await createWorkspaceFixture();
  const report = await scanTargets(["workspace"], { exactFiles: true }, projectDir);

  assert.equal(report.targets.length, 1);
  assert.equal(report.targets[0]?.key, "workspace");
  assert.equal(report.targets[0]?.pathCount, 2);
  assert.ok((report.targets[0]?.totalBytes ?? 0) > 0);
  assert.ok((report.targets[0]?.totalFiles ?? 0) >= 2);
});

test("scanTargets respects excludedPaths", async () => {
  const projectDir = await createWorkspaceFixture();
  const excludedPath = path.join(projectDir, ".next");
  const report = await scanTargets(
    ["workspace"],
    { exactFiles: true, excludedPaths: [excludedPath] },
    projectDir
  );

  assert.equal(report.targets[0]?.pathCount, 1);
  assert.ok(
    report.targets[0]?.paths.every((entry) => !entry.path.startsWith(excludedPath))
  );
});

test("cleanTargets dry-run does not delete workspace artifacts", async () => {
  const projectDir = await createWorkspaceFixture();
  const before = await fs.access(path.join(projectDir, ".next", "cache", "a.bin")).then(
    () => true
  );

  const report = await cleanTargets(["workspace"], { dryRun: true }, projectDir);
  const after = await fs.access(path.join(projectDir, ".next", "cache", "a.bin")).then(
    () => true
  );

  assert.equal(before, true);
  assert.equal(after, true);
  assert.equal(report.dryRun, true);
  assert.ok(report.totals.deletedBytes >= 0);
});
