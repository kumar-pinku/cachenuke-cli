import fs from "node:fs/promises";
import path from "node:path";

export interface CacheNukeConfig {
  defaultTargets?: string[];
  excludedTargets?: string[];
  excludedPaths?: string[];
  exactFiles?: boolean;
  interactive?: boolean;
}

const DEFAULT_CONFIG_FILES = ["cachenuke.config.json", ".cachenukerc.json"];

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function validateStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid config field "${fieldName}". Expected an array of strings.`);
  }

  return [...new Set(value)];
}

function validateBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`Invalid config field "${fieldName}". Expected a boolean.`);
  }

  return value;
}

function parseConfig(raw: string, sourcePath: string): CacheNukeConfig {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse config at ${sourcePath}: ${(error as Error).message}`
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid config at ${sourcePath}. Expected a JSON object.`);
  }

  const object = parsed as Record<string, unknown>;

  return {
    defaultTargets: validateStringArray(object.defaultTargets, "defaultTargets"),
    excludedTargets: validateStringArray(object.excludedTargets, "excludedTargets"),
    excludedPaths: validateStringArray(object.excludedPaths, "excludedPaths"),
    exactFiles: validateBoolean(object.exactFiles, "exactFiles"),
    interactive: validateBoolean(object.interactive, "interactive"),
  };
}

export async function loadConfig(
  cwd: string,
  explicitPath?: string
): Promise<{ config: CacheNukeConfig; path: string | null }> {
  const candidatePaths = explicitPath
    ? [path.resolve(cwd, explicitPath)]
    : DEFAULT_CONFIG_FILES.map((fileName) => path.join(cwd, fileName));

  for (const candidatePath of candidatePaths) {
    if (!(await fileExists(candidatePath))) {
      continue;
    }

    const raw = await fs.readFile(candidatePath, "utf8");
    return {
      config: parseConfig(raw, candidatePath),
      path: candidatePath,
    };
  }

  return { config: {}, path: null };
}
