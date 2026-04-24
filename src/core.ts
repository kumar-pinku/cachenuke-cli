import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export type Platform = NodeJS.Platform;

export interface TargetDefinition {
  key: string;
  label: string;
  description: string;
  dangerous?: boolean;
  platform?: "all" | "darwin" | "linux" | "win32";
  smartDefault: boolean;
  resolvePaths(context: RuntimeContext): Promise<string[]>;
}

export interface RuntimeContext {
  cwd: string;
  homeDir: string;
  platform: Platform;
  env: NodeJS.ProcessEnv;
}

export interface ScanOptions {
  exactFiles?: boolean;
  topEntriesLimit?: number;
  excludedPaths?: string[];
  onTargetScanned?: (target: ScanTargetResult) => void;
}

export interface ScanEntry {
  name: string;
  path: string;
  bytes: number;
  files: number | null;
  kind: "directory" | "file";
}

export interface ScanPath {
  path: string;
  exists: boolean;
  bytes: number;
  files: number | null;
  topEntries: ScanEntry[];
  errors: TargetError[];
}

export interface TargetError {
  path: string;
  message: string;
  code?: string;
  suggestion?: string;
}

export interface ScanTargetResult {
  key: string;
  label: string;
  description: string;
  totalBytes: number;
  totalFiles: number | null;
  reclaimable: number;
  missingPaths: number;
  pathCount: number;
  paths: ScanPath[];
  errors: TargetError[];
}

export interface ScanReport {
  scannedAt: string;
  mode: "fast" | "exact";
  targets: ScanTargetResult[];
  totals: {
    bytes: number;
    files: number | null;
    reclaimable: number;
    errors: number;
  };
}

export interface CleanTargetResult {
  key: string;
  label: string;
  deletedBytes: number;
  deletedPaths: number;
  dryRun: boolean;
  errors: TargetError[];
}

export interface CleanReport {
  cleanedAt: string;
  dryRun: boolean;
  targets: CleanTargetResult[];
  totals: {
    deletedBytes: number;
    deletedPaths: number;
    errors: number;
  };
  scan: ScanReport;
}

const DEFAULT_TOP_ENTRIES = 5;
export const FILE_COUNT_UNAVAILABLE = null;

function makeContext(cwd = process.cwd()): RuntimeContext {
  return {
    cwd,
    homeDir: os.homedir(),
    platform: process.platform,
    env: process.env,
  };
}

function unixOnly(
  context: RuntimeContext,
  values: Record<string, Array<string | null>>
): Array<string | null> {
  if (context.platform === "darwin") {
    return values.darwin ?? [];
  }

  if (context.platform === "linux") {
    return values.linux ?? [];
  }

  if (context.platform === "win32") {
    return values.win32 ?? [];
  }

  return [];
}

function withHome(context: RuntimeContext, ...segments: string[]): string {
  return path.join(context.homeDir, ...segments);
}

function withLocalAppData(context: RuntimeContext, ...segments: string[]): string | null {
  const root = context.env.LOCALAPPDATA;
  return root ? path.join(root, ...segments) : null;
}

function withAppData(context: RuntimeContext, ...segments: string[]): string | null {
  const root = context.env.APPDATA;
  return root ? path.join(root, ...segments) : null;
}

function compactPaths(paths: Array<string | null | undefined>): string[] {
  return [...new Set(paths.filter((value): value is string => Boolean(value)))];
}

function normalizePathForMatch(targetPath: string, baseDir: string): string {
  return path.resolve(baseDir, targetPath);
}

function shouldExcludePath(targetPath: string, excludedPaths: string[], baseDir: string): boolean {
  const normalizedTarget = normalizePathForMatch(targetPath, baseDir);

  return excludedPaths.some((pattern) => {
    const normalizedPattern = normalizePathForMatch(pattern, baseDir);
    return (
      normalizedTarget === normalizedPattern ||
      normalizedTarget.startsWith(`${normalizedPattern}${path.sep}`)
    );
  });
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listChildren(targetPath: string): Promise<Dirent[]> {
  return fs.readdir(targetPath, { withFileTypes: true });
}

function captureError(error: unknown, targetPath: string): TargetError {
  const err = error as NodeJS.ErrnoException;
  const base = {
    path: targetPath,
    message: err.message || String(error),
    code: err.code,
  };

  if (err.code === "EACCES" || err.code === "EPERM") {
    return {
      ...base,
      suggestion: "Permission denied. Try running with sudo or check file permissions.",
    };
  }

  if (err.code === "ENOENT") {
    return {
      ...base,
      suggestion: "Path not found. This is normal if the cache hasn't been created yet.",
    };
  }

  if (err.code === "EBUSY") {
    return {
      ...base,
      suggestion: "Resource busy. Close applications using this cache and try again.",
    };
  }

  return base;
}

function parseCommandErrors(stderr: string): TargetError[] {
  return stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.*?):\s(.*)$/);
      return match
        ? { path: match[1], message: match[2] }
        : { path: "command", message: line };
    });
}

async function runCommand(command: string, args: string[]): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function measurePathExact(targetPath: string): Promise<{
  bytes: number;
  files: number;
  errors: TargetError[];
}> {
  let stats;

  try {
    stats = await fs.lstat(targetPath);
  } catch (error) {
    return {
      bytes: 0,
      files: 0,
      errors: [captureError(error, targetPath)],
    };
  }

  if (stats.isSymbolicLink()) {
    return { bytes: 0, files: 0, errors: [] };
  }

  if (!stats.isDirectory()) {
    return { bytes: stats.size, files: 1, errors: [] };
  }

  let totalBytes = 0;
  let totalFiles = 0;
  const errors: TargetError[] = [];

  let children: Dirent[];
  try {
    children = await listChildren(targetPath);
  } catch (error) {
    return {
      bytes: 0,
      files: 0,
      errors: [captureError(error, targetPath)],
    };
  }

  for (const child of children) {
    const childResult = await measurePathExact(path.join(targetPath, child.name));
    totalBytes += childResult.bytes;
    totalFiles += childResult.files;
    errors.push(...childResult.errors);
  }

  return { bytes: totalBytes, files: totalFiles, errors };
}

async function getDiskUsageFast(targetPath: string, platform: Platform): Promise<{
  bytes: number;
  errors: TargetError[];
}> {
  if (platform === "darwin" || platform === "linux") {
    const result = await runCommand("du", ["-sk", targetPath]);
    const firstLine = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);
    const kilobytes = firstLine ? Number.parseInt(firstLine.split(/\s+/)[0] ?? "0", 10) : 0;

    return {
      bytes: Number.isFinite(kilobytes) ? kilobytes * 1024 : 0,
      errors: parseCommandErrors(result.stderr),
    };
  }

  const exact = await measurePathExact(targetPath);
  return { bytes: exact.bytes, errors: exact.errors };
}

async function countFilesFast(targetPath: string, platform: Platform): Promise<{
  files: number | null;
  errors: TargetError[];
}> {
  if (platform === "darwin" || platform === "linux") {
    const result = await runCommand("find", [targetPath, "-type", "f"]);
    const files = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    return {
      files: files.length,
      errors: parseCommandErrors(result.stderr),
    };
  }

  const exact = await measurePathExact(targetPath);
  return { files: exact.files, errors: exact.errors };
}

async function scanSinglePath(
  targetPath: string,
  context: RuntimeContext,
  options: Pick<ScanOptions, 'exactFiles' | 'topEntriesLimit' | 'excludedPaths'> & { exactFiles: boolean; topEntriesLimit: number; excludedPaths: string[] }
): Promise<ScanPath> {
  if (!(await pathExists(targetPath))) {
    return {
      path: targetPath,
      exists: false,
      bytes: 0,
      files: FILE_COUNT_UNAVAILABLE,
      topEntries: [],
      errors: [],
    };
  }

  const stats = await fs.lstat(targetPath);
  const exactInfo = options.exactFiles ? await measurePathExact(targetPath) : null;
  const fastInfo = options.exactFiles
    ? null
    : await getDiskUsageFast(targetPath, context.platform);
  const bytes = exactInfo ? exactInfo.bytes : fastInfo?.bytes ?? 0;
  const files = exactInfo ? exactInfo.files : FILE_COUNT_UNAVAILABLE;
  const pathErrors = exactInfo ? [...exactInfo.errors] : [...(fastInfo?.errors ?? [])];

  const topEntries: ScanEntry[] = [];

  if (stats.isDirectory()) {
    try {
      const children = await listChildren(targetPath);
      for (const child of children) {
        const childPath = path.join(targetPath, child.name);
        const childExact = options.exactFiles ? await measurePathExact(childPath) : null;
        const childFast = options.exactFiles
          ? null
          : await getDiskUsageFast(childPath, context.platform);
        const childBytes = childExact ? childExact.bytes : childFast?.bytes ?? 0;
        const childFiles = childExact ? childExact.files : FILE_COUNT_UNAVAILABLE;

        topEntries.push({
          name: child.name,
          path: childPath,
          bytes: childBytes,
          files: childFiles,
          kind: child.isDirectory() ? "directory" : "file",
        });
      }
    } catch (error) {
      pathErrors.push(captureError(error, targetPath));
    }
  }

  return {
    path: targetPath,
    exists: true,
    bytes,
    files,
    topEntries: topEntries
      .sort((left, right) => right.bytes - left.bytes)
      .slice(0, options.topEntriesLimit),
    errors: pathErrors,
  };
}

async function discoverWorkspaceArtifacts(context: RuntimeContext): Promise<string[]> {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: context.cwd, depth: 0 }];
  const results = new Set<string>();
  const knownDirectoryNames = new Set([
    ".next",
    ".nuxt",
    ".turbo",
    ".parcel-cache",
    ".vite",
    ".svelte-kit",
  ]);
  const knownFileNames = new Set([".eslintcache"]);
  const skipDirectories = new Set([
    ".git",
    "dist",
    "build",
    "coverage",
    ".idea",
    ".vscode",
  ]);
  const maxDepth = 4;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    let entries: Dirent[];
    try {
      entries = await listChildren(current.dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current.dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === "node_modules") {
          const nodeCache = path.join(entryPath, ".cache");
          if (await pathExists(nodeCache)) {
            results.add(nodeCache);
          }
          continue;
        }

        if (knownDirectoryNames.has(entry.name)) {
          results.add(entryPath);
        }

        if (entry.name === ".angular") {
          const angularCache = path.join(entryPath, "cache");
          if (await pathExists(angularCache)) {
            results.add(angularCache);
          }
        }

        if (current.depth < maxDepth && !skipDirectories.has(entry.name)) {
          queue.push({ dir: entryPath, depth: current.depth + 1 });
        }
      } else if (knownFileNames.has(entry.name)) {
        results.add(entryPath);
      }
    }
  }

  return [...results];
}

async function resolveFirefoxCaches(baseDir: string): Promise<string[]> {
  if (!(await pathExists(baseDir))) {
    return [];
  }

  let entries: Dirent[];
  try {
    entries = await listChildren(baseDir);
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(baseDir, entry.name, "cache2"));
}

async function resolveTargetPaths(definition: TargetDefinition, context: RuntimeContext): Promise<string[]> {
  return compactPaths(await definition.resolvePaths(context));
}

export const TARGETS: TargetDefinition[] = [
  {
    key: "npm",
    label: "npm cache",
    description: "Global npm package cache",
    platform: "all",
    smartDefault: true,
    async resolvePaths(context) {
      return compactPaths([
        withHome(context, ".npm"),
        context.platform === "win32"
          ? withLocalAppData(context, "npm-cache")
          : null,
      ]);
    },
  },
  {
    key: "yarn",
    label: "Yarn cache",
    description: "Classic and Berry Yarn caches",
    platform: "all",
    smartDefault: true,
    async resolvePaths(context) {
      return compactPaths([
        ...unixOnly(context, {
          darwin: [
            withHome(context, "Library", "Caches", "Yarn"),
            withHome(context, ".cache", "yarn"),
          ],
          linux: [withHome(context, ".cache", "yarn")],
          win32: [withLocalAppData(context, "Yarn", "Cache") ?? null],
        }),
      ]);
    },
  },
  {
    key: "pnpm",
    label: "pnpm store",
    description: "pnpm content-addressable package store",
    platform: "all",
    smartDefault: true,
    async resolvePaths(context) {
      return compactPaths([
        ...unixOnly(context, {
          darwin: [
            withHome(context, "Library", "pnpm", "store"),
            withHome(context, ".pnpm-store"),
          ],
          linux: [
            withHome(context, ".local", "share", "pnpm", "store"),
            withHome(context, ".pnpm-store"),
          ],
          win32: [withLocalAppData(context, "pnpm", "store") ?? null],
        }),
      ]);
    },
  },
  {
    key: "bun",
    label: "Bun cache",
    description: "Bun package and install cache",
    platform: "all",
    smartDefault: true,
    async resolvePaths(context) {
      return compactPaths([
        ...unixOnly(context, {
          darwin: [withHome(context, ".bun", "install", "cache")],
          linux: [withHome(context, ".bun", "install", "cache")],
          win32: [withLocalAppData(context, "bun", "install", "cache") ?? null],
        }),
      ]);
    },
  },
  {
    key: "workspace",
    label: "Local workspace build caches",
    description: "Project-local caches such as .next, .turbo, and node_modules/.cache",
    platform: "all",
    smartDefault: true,
    resolvePaths(context) {
      return discoverWorkspaceArtifacts(context);
    },
  },
  {
    key: "vscode",
    label: "VS Code caches",
    description: "VS Code cache, workspace storage, and logs",
    platform: "all",
    smartDefault: true,
    async resolvePaths(context) {
      return compactPaths([
        ...unixOnly(context, {
          darwin: [
            withHome(context, "Library", "Application Support", "Code", "Cache"),
            withHome(context, "Library", "Application Support", "Code", "CachedData"),
            withHome(
              context,
              "Library",
              "Application Support",
              "Code",
              "User",
              "workspaceStorage"
            ),
            withHome(context, "Library", "Application Support", "Code", "logs"),
          ],
          linux: [
            withHome(context, ".config", "Code", "Cache"),
            withHome(context, ".config", "Code", "CachedData"),
            withHome(context, ".config", "Code", "User", "workspaceStorage"),
            withHome(context, ".config", "Code", "logs"),
          ],
          win32: [
            withAppData(context, "Code", "Cache") ?? null,
            withAppData(context, "Code", "CachedData") ?? null,
            withAppData(context, "Code", "User", "workspaceStorage") ?? null,
            withAppData(context, "Code", "logs") ?? null,
          ],
        }),
      ]);
    },
  },
  {
    key: "browsers",
    label: "Browser caches",
    description: "Chrome, Edge, Brave, Chromium, and Firefox caches",
    platform: "all",
    smartDefault: true,
    async resolvePaths(context) {
      const firefoxBases = compactPaths(
        unixOnly(context, {
          darwin: [withHome(context, "Library", "Caches", "Firefox", "Profiles")],
          linux: [withHome(context, ".cache", "mozilla", "firefox")],
          win32: [withLocalAppData(context, "Mozilla", "Firefox", "Profiles") ?? null],
        })
      );
      const firefoxCaches = (
        await Promise.all(firefoxBases.map((baseDir) => resolveFirefoxCaches(baseDir)))
      ).flat();

      return compactPaths([
        ...unixOnly(context, {
          darwin: [
            withHome(context, "Library", "Caches", "Google", "Chrome"),
            withHome(context, "Library", "Caches", "BraveSoftware", "Brave-Browser"),
            withHome(context, "Library", "Caches", "Microsoft Edge"),
          ],
          linux: [
            withHome(context, ".cache", "google-chrome"),
            withHome(context, ".cache", "chromium"),
            withHome(context, ".cache", "BraveSoftware", "Brave-Browser"),
            withHome(context, ".cache", "microsoft-edge"),
          ],
          win32: [
            withLocalAppData(context, "Google", "Chrome", "User Data", "Default", "Cache") ??
              null,
            withLocalAppData(context, "BraveSoftware", "Brave-Browser", "User Data", "Default", "Cache") ??
              null,
            withLocalAppData(context, "Microsoft", "Edge", "User Data", "Default", "Cache") ??
              null,
          ],
        }),
        ...firefoxCaches,
      ]);
    },
  },
  {
    key: "temp",
    label: "OS temp directory",
    description: "Current operating system temporary files",
    platform: "all",
    smartDefault: true,
    async resolvePaths() {
      return [os.tmpdir()];
    },
  },
  {
    key: "pip",
    label: "pip cache",
    description: "Python pip download and wheel cache",
    platform: "all",
    smartDefault: true,
    async resolvePaths(context) {
      return compactPaths([
        ...unixOnly(context, {
          darwin: [withHome(context, ".cache", "pip")],
          linux: [withHome(context, ".cache", "pip")],
          win32: [withLocalAppData(context, "pip", "Cache") ?? null],
        }),
      ]);
    },
  },
  {
    key: "gradle",
    label: "Gradle cache",
    description: "Gradle dependency and wrapper caches",
    platform: "all",
    smartDefault: true,
    async resolvePaths(context) {
      return compactPaths([
        ...unixOnly(context, {
          darwin: [withHome(context, ".gradle", "caches")],
          linux: [withHome(context, ".gradle", "caches")],
          win32: [withHome(context, ".gradle", "caches")],
        }),
      ]);
    },
  },
  {
    key: "cargo",
    label: "Cargo cache",
    description: "Rust Cargo registry and git caches",
    platform: "all",
    smartDefault: true,
    async resolvePaths(context) {
      return compactPaths([
        withHome(context, ".cargo", "registry"),
        withHome(context, ".cargo", "git"),
      ]);
    },
  },
  {
    key: "homebrew",
    label: "Homebrew cache",
    description: "Homebrew package manager cache and downloads",
    platform: "all",
    smartDefault: true,
    async resolvePaths(context) {
      if (context.platform !== "darwin" && context.platform !== "linux") {
        return [];
      }
      return compactPaths([
        ...unixOnly(context, {
          darwin: [
            withHome(context, "Library", "Caches", "Homebrew"),
            "/Library/Caches/Homebrew",
          ],
          linux: [withHome(context, ".cache", "Homebrew")],
          win32: [],
        }),
      ]);
    },
  },
  {
    key: "gem",
    label: "Ruby Gems cache",
    description: "RubyGems package cache",
    platform: "all",
    smartDefault: true,
    async resolvePaths(context) {
      return compactPaths([
        withHome(context, ".gem", "cache"),
      ]);
    },
  },
  {
    key: "go",
    label: "Go module cache",
    description: "Go module download cache",
    platform: "all",
    smartDefault: true,
    async resolvePaths(context) {
      return compactPaths([
        withHome(context, "go", "pkg", "mod", "cache"),
        context.env.GOPATH ? path.join(context.env.GOPATH, "pkg", "mod", "cache") : null,
      ]);
    },
  },
  {
    key: "maven",
    label: "Maven cache",
    description: "Maven repository cache",
    platform: "all",
    smartDefault: true,
    async resolvePaths(context) {
      return compactPaths([
        withHome(context, ".m2", "repository"),
      ]);
    },
  },
  {
    key: "composer",
    label: "Composer cache",
    description: "PHP Composer package cache",
    platform: "all",
    smartDefault: true,
    async resolvePaths(context) {
      return compactPaths([
        ...unixOnly(context, {
          darwin: [withHome(context, ".composer", "cache")],
          linux: [withHome(context, ".cache", "composer")],
          win32: [withLocalAppData(context, "Composer") ?? null],
        }),
      ]);
    },
  },
  {
    key: "nuget",
    label: "NuGet cache",
    description: ".NET NuGet package cache",
    platform: "all",
    smartDefault: true,
    async resolvePaths(context) {
      return compactPaths([
        ...unixOnly(context, {
          darwin: [withHome(context, ".nuget", "packages")],
          linux: [withHome(context, ".nuget", "packages")],
          win32: [withLocalAppData(context, "NuGet", "Cache") ?? null],
        }),
      ]);
    },
  },
  {
    key: "docker",
    label: "Docker cache",
    description: "Docker build cache, images, and containers (requires Docker to be stopped)",
    dangerous: true,
    platform: "all",
    smartDefault: false,
    async resolvePaths(context) {
      return compactPaths([
        ...unixOnly(context, {
          darwin: [
            withHome(context, "Library", "Containers", "com.docker.docker", "Data", "vms", "0", "data"),
          ],
          linux: ["/var/lib/docker/overlay2", "/var/lib/docker/tmp"],
          win32: [withLocalAppData(context, "Docker") ?? null],
        }),
      ]);
    },
  },
  {
    key: "jetbrains",
    label: "JetBrains IDE caches",
    description: "IntelliJ IDEA, WebStorm, PyCharm, and other JetBrains IDE caches",
    platform: "all",
    smartDefault: true,
    async resolvePaths(context) {
      return compactPaths([
        ...unixOnly(context, {
          darwin: [
            withHome(context, "Library", "Caches", "JetBrains"),
            withHome(context, "Library", "Logs", "JetBrains"),
          ],
          linux: [
            withHome(context, ".cache", "JetBrains"),
            withHome(context, ".local", "share", "JetBrains"),
          ],
          win32: [
            withLocalAppData(context, "JetBrains") ?? null,
          ],
        }),
      ]);
    },
  },
  {
    key: "xcode",
    label: "Xcode derived data",
    description: "Xcode build cache and derived data",
    platform: "darwin",
    smartDefault: true,
    async resolvePaths(context) {
      return compactPaths([
        withHome(context, "Library", "Developer", "Xcode", "DerivedData"),
        withHome(context, "Library", "Caches", "com.apple.dt.Xcode"),
      ]);
    },
  },
  {
    key: "cocoapods",
    label: "CocoaPods cache",
    description: "iOS dependency manager cache",
    platform: "darwin",
    smartDefault: true,
    async resolvePaths(context) {
      return compactPaths([
        withHome(context, "Library", "Caches", "CocoaPods"),
      ]);
    },
  },
  {
    key: "macos-system",
    label: "macOS system caches",
    description:
      "Broader macOS cache and log locations including user and shared library caches",
    dangerous: true,
    platform: "darwin",
    smartDefault: false,
    async resolvePaths(context) {
      return compactPaths([
        withHome(context, "Library", "Caches"),
        withHome(context, "Library", "Logs"),
        "/Library/Caches",
        "/Library/Logs",
      ]);
    },
  },
  {
    key: "windows-system",
    label: "Windows system caches",
    description:
      "Windows temp and OS-managed cache directories that may require elevated privileges",
    dangerous: true,
    platform: "win32",
    smartDefault: false,
    async resolvePaths(context) {
      const systemRoot = context.env.SystemRoot ?? "C:\\Windows";
      return compactPaths([
        withLocalAppData(context, "Temp"),
        withLocalAppData(context, "Microsoft", "Windows", "INetCache"),
        withLocalAppData(context, "D3DSCache"),
        path.join(systemRoot, "Temp"),
      ]);
    },
  },
];

const TARGET_MAP = new Map(TARGETS.map((target) => [target.key, target]));

export function listTargets(): Array<{
  key: string;
  label: string;
  description: string;
  dangerous: boolean;
  platform: string;
  smartDefault: boolean;
}> {
  return TARGETS.map((target) => ({
    key: target.key,
    label: target.label,
    description: target.description,
    dangerous: Boolean(target.dangerous),
    platform: target.platform ?? "all",
    smartDefault: target.smartDefault,
  }));
}

export function getSmartDefaultTargetKeys(): string[] {
  return TARGETS.filter((target) => target.smartDefault).map((target) => target.key);
}

function resolveSystemAlias(platform: Platform): string | null {
  if (platform === "darwin") {
    return "macos-system";
  }

  if (platform === "win32") {
    return "windows-system";
  }

  return null;
}

function resolveTargetKeys(targets: string[] | undefined, platform: Platform): string[] {
  const requested = targets && targets.length > 0 ? [...new Set(targets)] : getSmartDefaultTargetKeys();
  const expanded = requested.flatMap((target) => {
    if (target !== "system") {
      return [target];
    }

    const resolvedSystemTarget = resolveSystemAlias(platform);
    return resolvedSystemTarget ? [resolvedSystemTarget] : [];
  });
  const uniqueTargets = [...new Set(expanded)];
  const unknown = uniqueTargets.filter((target) => !TARGET_MAP.has(target));

  if (unknown.length > 0) {
    throw new Error(
      `Unknown target(s): ${unknown.join(", ")}. Valid targets: system, ${TARGETS.map((target) => target.key).join(", ")}`
    );
  }

  return uniqueTargets;
}

export async function scanTargets(targets?: string[], options: ScanOptions = {}, cwd = process.cwd()): Promise<ScanReport> {
  const context = makeContext(cwd);
  const resolvedTargetKeys = resolveTargetKeys(targets, context.platform);
  const normalizedOptions = {
    exactFiles: Boolean(options.exactFiles),
    excludedPaths: options.excludedPaths ?? [],
    topEntriesLimit:
      Number.isInteger(options.topEntriesLimit) && options.topEntriesLimit && options.topEntriesLimit > 0
        ? options.topEntriesLimit
        : DEFAULT_TOP_ENTRIES,
    onTargetScanned: options.onTargetScanned,
  };

  const results: ScanTargetResult[] = [];

  for (const key of resolvedTargetKeys) {
    const definition = TARGET_MAP.get(key);
    if (!definition) {
      continue;
    }

    const paths = (await resolveTargetPaths(definition, context)).filter(
      (targetPath) =>
        !shouldExcludePath(targetPath, normalizedOptions.excludedPaths, context.cwd)
    );
    const scannedPaths: ScanPath[] = [];
    let totalBytes = 0;
    let totalFiles = 0;
    let fileCountsAvailable = normalizedOptions.exactFiles;
    let missingPaths = 0;
    const errors: TargetError[] = [];

    for (const targetPath of paths) {
      const scannedPath = await scanSinglePath(targetPath, context, {
        exactFiles: normalizedOptions.exactFiles,
        excludedPaths: normalizedOptions.excludedPaths,
        topEntriesLimit: normalizedOptions.topEntriesLimit,
      });
      scannedPaths.push(scannedPath);
      totalBytes += scannedPath.bytes;

      if (typeof scannedPath.files === "number") {
        totalFiles += scannedPath.files;
      } else {
        fileCountsAvailable = false;
      }

      if (!scannedPath.exists) {
        missingPaths += 1;
      }

      errors.push(...scannedPath.errors);
    }

    const targetResult: ScanTargetResult = {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      totalBytes,
      totalFiles: fileCountsAvailable ? totalFiles : FILE_COUNT_UNAVAILABLE,
      reclaimable: totalBytes,
      missingPaths,
      pathCount: paths.length,
      paths: scannedPaths,
      errors,
    };

    results.push(targetResult);

    // Call progressive callback if provided
    if (normalizedOptions.onTargetScanned) {
      normalizedOptions.onTargetScanned(targetResult);
    }
  }

  const totals = results.reduce(
    (accumulator, target) => {
      accumulator.bytes += target.totalBytes;
      accumulator.reclaimable += target.reclaimable;
      accumulator.errors += target.errors.length;

      if (typeof accumulator.files === "number" && typeof target.totalFiles === "number") {
        accumulator.files += target.totalFiles;
      } else {
        accumulator.files = FILE_COUNT_UNAVAILABLE;
      }

      return accumulator;
    },
    {
      bytes: 0,
      files: normalizedOptions.exactFiles ? 0 : FILE_COUNT_UNAVAILABLE,
      reclaimable: 0,
      errors: 0,
    } as ScanReport["totals"]
  );

  return {
    scannedAt: new Date().toISOString(),
    mode: normalizedOptions.exactFiles ? "exact" : "fast",
    targets: results,
    totals,
  };
}

async function clearPathContents(targetPath: string, dryRun: boolean): Promise<void> {
  if (dryRun) {
    return;
  }

  let stats;
  try {
    stats = await fs.lstat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  if (!stats.isDirectory()) {
    await fs.rm(targetPath, { recursive: true, force: true });
    return;
  }

  const children = await fs.readdir(targetPath);
  for (const childName of children) {
    await fs.rm(path.join(targetPath, childName), {
      recursive: true,
      force: true,
    });
  }
}

export async function cleanTargets(
  targets?: string[],
  options: ScanOptions & { dryRun?: boolean } = {},
  cwd = process.cwd()
): Promise<CleanReport> {
  const scan = await scanTargets(targets, options, cwd);
  const dryRun = Boolean(options.dryRun);
  const results: CleanTargetResult[] = [];

  for (const target of scan.targets) {
    let deletedBytes = 0;
    let deletedPaths = 0;
    const errors: TargetError[] = [];

    for (const scannedPath of target.paths) {
      if (!scannedPath.exists) {
        continue;
      }

      try {
        await clearPathContents(scannedPath.path, dryRun);
        deletedBytes += scannedPath.bytes;
        deletedPaths += 1;
      } catch (error) {
        errors.push(captureError(error, scannedPath.path));
      }
    }

    results.push({
      key: target.key,
      label: target.label,
      deletedBytes,
      deletedPaths,
      dryRun,
      errors,
    });
  }

  return {
    cleanedAt: new Date().toISOString(),
    dryRun,
    targets: results,
    totals: results.reduce(
      (accumulator, target) => {
        accumulator.deletedBytes += target.deletedBytes;
        accumulator.deletedPaths += target.deletedPaths;
        accumulator.errors += target.errors.length;
        return accumulator;
      },
      { deletedBytes: 0, deletedPaths: 0, errors: 0 }
    ),
    scan,
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / 1024 ** exponent;
  const precision = value >= 100 || exponent === 0 ? 0 : value >= 10 ? 1 : 2;

  return `${value.toFixed(precision)} ${units[exponent]}`;
}
