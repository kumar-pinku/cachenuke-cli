import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "./config";

test("loadConfig reads explicit config and validates fields", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cachenuke-config-"));
  const configPath = path.join(tempDir, "custom-config.json");

  await fs.writeFile(
    configPath,
    JSON.stringify({
      defaultTargets: ["workspace", "npm"],
      excludedTargets: ["temp"],
      excludedPaths: ["./dist"],
      exactFiles: true,
      interactive: false,
    }),
    "utf8"
  );

  const { config, path: resolvedPath } = await loadConfig(tempDir, "./custom-config.json");

  assert.equal(resolvedPath, configPath);
  assert.deepEqual(config.defaultTargets, ["workspace", "npm"]);
  assert.deepEqual(config.excludedTargets, ["temp"]);
  assert.deepEqual(config.excludedPaths, ["./dist"]);
  assert.equal(config.exactFiles, true);
  assert.equal(config.interactive, false);
});

test("loadConfig returns empty config when no file exists", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cachenuke-empty-"));
  const result = await loadConfig(tempDir);

  assert.equal(result.path, null);
  assert.deepEqual(result.config, {});
});
