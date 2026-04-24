#!/usr/bin/env node

import readline from "node:readline";
import path from "node:path";
import { Command } from "commander";
import { loadConfig, type CacheNukeConfig } from "./config";
import {
  FILE_COUNT_UNAVAILABLE,
  TARGETS,
  cleanTargets,
  formatBytes,
  getSmartDefaultTargetKeys,
  listTargets,
  scanTargets,
  type CleanReport,
  type ScanPath,
  type ScanReport,
  type ScanTargetResult,
} from "./core";
import { runInteractiveTable, type InteractiveResult } from "./interactive";
import {
  colors,
  symbols,
  setColorEnabled,
  withSpinner as uiWithSpinner,
  displaySummary,
  displayWarning,
  displaySuccess,
  displayError,
  createTable,
  statusBadge,
  colorBySize,
} from "./ui";
import { ProgressiveDisplay } from "./progressive";

type SharedOptions = {
  all?: boolean;
  config?: string;
  cwd?: string;
  dryRun?: boolean;
  exactFiles?: boolean;
  force?: boolean;
  interactive?: boolean;
  json?: boolean;
  noColor?: boolean;
  top?: number;
};

type ExecutionContext = {
  config: CacheNukeConfig;
  cwd: string;
};

function normalizeOptions(input: SharedOptions | Command): SharedOptions {
  if (input && typeof (input as Command).opts === "function") {
    return (input as Command).opts<SharedOptions>();
  }

  return input as SharedOptions;
}

function formatFileCount(count: number | null): string {
  return count === FILE_COUNT_UNAVAILABLE ? "n/a" : String(count);
}


function printTargets(): void {
  console.log("");
  console.log(colors.bold(colors.cyanBright("CacheNuke Targets")));
  console.log("");

  console.log(
    `${colors.cyan("•")} ${colors.bold("system")}: Auto-detected system caches (${colors.blue(
      process.platform
    )})`
  );
  console.log(`  ${colors.dim("Resolves to the current OS system cache target automatically.")}`);
  console.log("");

  for (const target of listTargets()) {
    const suffix = target.smartDefault
      ? colors.green("smart default")
      : colors.yellow("optional");
    const badges = [suffix, colors.blue(target.platform)];

    if (target.dangerous) {
      badges.push(colors.red("system-level"));
    }

    console.log(
      `${colors.cyan("•")} ${colors.bold(target.key)}: ${target.label} ${colors.dim(
        `(${badges.join(", ")})`
      )}`
    );
    console.log(`  ${colors.dim(target.description)}`);
    console.log("");
  }
}

function printScanReport(report: ScanReport): void {
  console.log("");
  console.log(
    `${symbols.success} ${colors.bold("Scan completed")} ${colors.dim(
      `at ${new Date(report.scannedAt).toLocaleTimeString()}`
    )} ${colors.dim(`(${report.mode} mode)`)}`
  );
  console.log("");

  for (const target of report.targets) {
    console.log(
      `${colors.bold(colors.cyan(target.label))} ${colors.dim(`[${target.key}]`)}`
    );

    const sizeColored = colorBySize(target.totalBytes, formatBytes(target.totalBytes));
    console.log(`  ${colors.dim("Size:")} ${sizeColored}`);
    console.log(`  ${colors.dim("Files:")} ${formatFileCount(target.totalFiles)}`);
    console.log(`  ${colors.dim("Reclaimable:")} ${formatBytes(target.reclaimable)}`);
    console.log(`  ${colors.dim("Paths:")} ${target.pathCount}`);

    if (target.missingPaths > 0) {
      console.log(`  ${colors.dim("Missing:")} ${target.missingPaths}`);
    }

    for (const scannedPath of target.paths.slice(0, 2)) {
      console.log("");
      console.log(
        `  ${colors.yellow("→")} ${scannedPath.path} ${colors.dim(
          `(${scannedPath.exists ? "present" : "missing"})`
        )}`
      );

      if (!scannedPath.exists) {
        continue;
      }

      console.log(
        `     ${formatBytes(scannedPath.bytes)} across ${formatFileCount(
          scannedPath.files
        )} files`
      );

      if (scannedPath.topEntries.length > 0) {
        console.log(`     ${colors.dim("Largest:")}`);
        for (const entry of scannedPath.topEntries.slice(0, 3)) {
          console.log(
            `       ${colors.yellow("•")} ${entry.name}: ${formatBytes(entry.bytes)} ${colors.dim(
              `(${formatFileCount(entry.files)} files)`
            )}`
          );
        }
      }
    }

    if (target.paths.length > 2) {
      console.log("");
      console.log(colors.dim(`  ... and ${target.paths.length - 2} more path(s)`));
    }

    if (target.errors.length > 0) {
      console.log("");
      console.log(`  ${colors.yellow("Errors:")} ${target.errors.length}`);
      for (const error of target.errors.slice(0, 2)) {
        console.log(`    ${colors.red("✖")} ${error.path}`);
        console.log(`      ${colors.dim(error.message)}`);
        if (error.suggestion) {
          console.log(`      ${colors.cyan("→")} ${error.suggestion}`);
        }
      }
    }

    console.log("");
  }

  displaySummary([
    { label: "Total size", value: formatBytes(report.totals.bytes), color: "green" },
    { label: "Total files", value: formatFileCount(report.totals.files), color: "cyan" },
    {
      label: "Reclaimable",
      value: formatBytes(report.totals.reclaimable),
      color: "greenBright",
    },
    ...(report.totals.errors > 0
      ? [{ label: "Scan errors", value: String(report.totals.errors), color: "red" as const }]
      : []),
  ]);
}

function printCleanReport(report: CleanReport): void {
  const action = report.dryRun ? "Would delete" : "Deleted";
  const symbol = report.dryRun ? symbols.info : symbols.success;
  const title = report.dryRun ? "Dry run completed" : "Cleanup completed";

  console.log("");
  console.log(
    `${symbol} ${colors.bold(title)} ${colors.dim(
      `at ${new Date(report.cleanedAt).toLocaleTimeString()}`
    )}`
  );
  console.log("");

  for (const target of report.targets) {
    if (target.deletedBytes === 0) continue;

    console.log(
      `${colors.bold(colors.cyan(target.label))} ${colors.dim(`[${target.key}]`)}`
    );

    const sizeColored = report.dryRun
      ? colors.yellow(formatBytes(target.deletedBytes))
      : colors.green(formatBytes(target.deletedBytes));

    console.log(`  ${colors.dim(action + ":")} ${sizeColored}`);
    console.log(`  ${colors.dim("Paths:")} ${target.deletedPaths}`);

    if (target.errors.length > 0) {
      console.log(`  ${colors.red("Errors:")} ${target.errors.length}`);
      for (const error of target.errors.slice(0, 2)) {
        console.log(`    ${colors.red("✖")} ${error.path}`);
        console.log(`      ${colors.dim(error.message)}`);
        if (error.suggestion) {
          console.log(`      ${colors.cyan("→")} ${error.suggestion}`);
        }
      }
    }

    console.log("");
  }

  const summaryColor = report.dryRun ? "yellow" : "greenBright";

  displaySummary([
    {
      label: action,
      value: formatBytes(report.totals.deletedBytes),
      color: summaryColor,
    },
    { label: "Paths touched", value: String(report.totals.deletedPaths), color: "cyan" },
    ...(report.totals.errors > 0
      ? [{ label: "Errors", value: String(report.totals.errors), color: "red" as const }]
      : []),
  ]);

  if (!report.dryRun && report.totals.deletedBytes > 0) {
    displaySuccess(`Freed ${formatBytes(report.totals.deletedBytes)}!`);
  }
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(question, resolve);
  });

  rl.close();
  return answer;
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  const answer = await prompt(question);
  return ["y", "yes"].includes(answer.trim().toLowerCase());
}

async function withSpinner<T>(label: string, task: () => Promise<T>): Promise<T> {
  return uiWithSpinner(label, task);
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got "${value}".`);
  }

  return parsed;
}

function applyTargetPolicy(
  targets: string[],
  options: SharedOptions,
  config: CacheNukeConfig
): string[] {
  const baseTargets = options.all
    ? listTargets().map((target) => target.key)
    : targets.length > 0
      ? targets
      : config.defaultTargets && config.defaultTargets.length > 0
        ? config.defaultTargets
        : getSmartDefaultTargetKeys();

  const excludedTargets = new Set(config.excludedTargets ?? []);
  return [...new Set(baseTargets)].filter((target) => !excludedTargets.has(target));
}

function selectTargets(targets: string[], options: SharedOptions, context: ExecutionContext): string[] {
  return applyTargetPolicy(targets, options, context.config);
}

async function resolveExecutionContext(options: SharedOptions): Promise<ExecutionContext> {
  const cwd = options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
  const { config } = await loadConfig(cwd, options.config);

  if (options.noColor || process.env.NO_COLOR) {
    setColorEnabled(false);
  }

  return { config, cwd };
}


async function handleScan(targets: string[], options: SharedOptions): Promise<void> {
  const context = await resolveExecutionContext(options);
  const effectiveOptions: SharedOptions = {
    ...options,
    exactFiles: options.exactFiles ?? context.config.exactFiles,
    interactive: options.interactive ?? context.config.interactive ?? (process.stdout.isTTY && process.stdin.isTTY),
  };
  const selectedTargets = selectTargets(targets, effectiveOptions, context);

  // Use spinner for quick, clean scanning
  const report = await withSpinner(
    "Scanning caches",
    () => scanTargets(selectedTargets, {
      exactFiles: effectiveOptions.exactFiles,
      excludedPaths: context.config.excludedPaths,
      topEntriesLimit: effectiveOptions.top,
    }, context.cwd)
  );

  if (effectiveOptions.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (effectiveOptions.interactive) {
    const dangerousTargets = new Set(
      TARGETS.filter((target) => target.dangerous).map((target) => target.key)
    );
    const result = await runInteractiveTable(report, false, dangerousTargets);
    if (result.action === "cancel") {
      console.log(colors.dim("Cancelled."));
      process.exit(0);
    }
    return;
  }

  printScanReport(report);
}

async function resolveInteractiveSelection(
  selectedTargets: string[],
  options: SharedOptions,
  context: ExecutionContext,
  dangerousTargets: Set<string>
): Promise<InteractiveResult | null> {
  // Skip progressive display, go straight to scanning with spinner
  const preview = await withSpinner(
    "Scanning caches",
    () => scanTargets(selectedTargets, {
      exactFiles: options.exactFiles,
      excludedPaths: context.config.excludedPaths,
      topEntriesLimit: options.top,
    }, context.cwd)
  );

  const result = await runInteractiveTable(preview, true, dangerousTargets);
  if (result.action !== "confirm" || result.selectedKeys.length === 0) {
    console.log(colors.dim("Cancelled."));
    process.exit(0);
  }

  return result;
}

async function handleClean(targets: string[], options: SharedOptions): Promise<void> {
  const context = await resolveExecutionContext(options);
  const effectiveOptions: SharedOptions = {
    ...options,
    exactFiles: options.exactFiles ?? context.config.exactFiles,
    interactive: options.interactive ?? context.config.interactive ?? (process.stdout.isTTY && process.stdin.isTTY),
  };
  let selectedTargets = selectTargets(targets, effectiveOptions, context);
  let finalDryRun = effectiveOptions.dryRun;

  const dangerousTargets = new Set(
    TARGETS.filter((target) => target.dangerous).map((target) => target.key)
  );
  const requestedDangerousTargets = selectedTargets.filter((target) =>
    dangerousTargets.has(target)
  );

  if (effectiveOptions.interactive) {
    const interactiveResult = await resolveInteractiveSelection(
      selectedTargets,
      effectiveOptions,
      context,
      dangerousTargets
    );
    if (!interactiveResult) {
      // User cancelled, exit cleanly
      console.log(colors.dim("Cancelled."));
      process.exit(0);
    }
    selectedTargets = interactiveResult.selectedKeys;
    finalDryRun = interactiveResult.dryRun;
  }

  if (requestedDangerousTargets.length > 0 && !finalDryRun && !effectiveOptions.force) {
    displayWarning(
      "System-level cache targets detected",
      [
        `The following targets include broader OS-level caches: ${requestedDangerousTargets.join(", ")}`,
        "Use --dry-run first to preview what will be deleted.",
      ]
    );
  }

  if (!finalDryRun && !effectiveOptions.force && !effectiveOptions.interactive) {
    const preview = await withSpinner(
      "Scanning caches",
      () => scanTargets(selectedTargets, {
        exactFiles: effectiveOptions.exactFiles,
        excludedPaths: context.config.excludedPaths,
        topEntriesLimit: effectiveOptions.top,
      }, context.cwd)
    );

    if (effectiveOptions.json) {
      console.log(JSON.stringify(preview, null, 2));
    }

    const confirmed = await confirm(
      `${colors.bold("Delete")} ${colors.green(
        formatBytes(preview.totals.reclaimable)
      )} across ${colors.cyan(selectedTargets.join(", "))}? [y/N] `
    );

    if (!confirmed) {
      console.log("");
      console.log(colors.dim("Cancelled."));
      return;
    }
  }

  const report = await withSpinner(
    finalDryRun ? "Preparing dry-run report" : "Cleaning caches",
    () =>
      cleanTargets(selectedTargets, {
        dryRun: finalDryRun,
        exactFiles: effectiveOptions.exactFiles,
        excludedPaths: context.config.excludedPaths,
        topEntriesLimit: effectiveOptions.top,
      }, context.cwd)
  );

  if (effectiveOptions.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printCleanReport(report);
}

const program = new Command();
const knownSubcommands = new Set(["scan", "clean", "targets", "help"]);

program
  .name("cachenuke")
  .description(
    colors.bold("CacheNuke CLI") +
      " - " +
      colors.dim("Universal development cache cleaner")
  )
  .version("1.0.0", "-v, --version", "Display version number")
  .addHelpText(
    "after",
    `
${colors.bold("Examples:")}
  ${colors.dim("$")} cachenuke ${colors.dim("# Interactive cleanup (default in terminal)")}
  ${colors.dim("$")} cachenuke scan ${colors.dim("# Interactive scan (default in terminal)")}
  ${colors.dim("$")} cachenuke --no-interactive ${colors.dim("# Disable interactive mode")}
  ${colors.dim("$")} cachenuke clean npm pnpm --dry-run ${colors.dim("# Preview cleanup")}
  ${colors.dim("$")} cachenuke targets ${colors.dim("# List all available targets")}

${colors.bold("Note:")}
  ${colors.dim("Interactive mode is enabled by default when running in a terminal (TTY).")}
  ${colors.dim("Use --no-interactive to disable it, or set interactive: false in config.")}

${colors.bold("Learn more:")}
  ${colors.cyan("https://github.com/kumar-pinku/cachenuke-cli")}
`
  );

program
  .command("scan")
  .description("Scan caches without deleting them")
  .argument("[targets...]", "Targets to scan using smart defaults if omitted")
  .option("-a, --all", "Include every supported target")
  .option("--config <path>", "Load config from a specific JSON file")
  .option("--cwd <path>", "Run target discovery relative to a specific working directory")
  .option("--exact-files", "Count files exactly. Slower on large caches.")
  .option("-i, --interactive", "Browse scan results in an interactive table (default in TTY)")
  .option("--no-interactive", "Disable interactive mode")
  .option("--json", "Print machine-readable JSON")
  .option("--no-color", "Disable ANSI colors and spinner rendering")
  .option(
    "--top <count>",
    "How many largest entries to show per path",
    parsePositiveInt,
    5
  )
  .action(async (targets: string[], options: SharedOptions | Command) => {
    await handleScan(targets, normalizeOptions(options));
  });

program
  .command("clean")
  .description("Explicit cleanup command")
  .argument("[targets...]", "Targets to clean using smart defaults if omitted")
  .option("-a, --all", "Include every supported target")
  .option("--config <path>", "Load config from a specific JSON file")
  .option("--cwd <path>", "Run target discovery relative to a specific working directory")
  .option("--dry-run", "Preview what would be deleted")
  .option("--exact-files", "Count files exactly. Slower on large caches.")
  .option("--force", "Skip confirmation prompt")
  .option("-i, --interactive", "Browse caches in an interactive table before cleanup (default in TTY)")
  .option("--no-interactive", "Disable interactive mode")
  .option("--json", "Print machine-readable JSON")
  .option("--no-color", "Disable ANSI colors and spinner rendering")
  .option(
    "--top <count>",
    "How many largest entries to show per path",
    parsePositiveInt,
    5
  )
  .action(async (targets: string[], options: SharedOptions | Command) => {
    await handleClean(targets, normalizeOptions(options));
  });

program
  .command("targets")
  .description("List supported cleanup targets")
  .action(() => {
    printTargets();
  });

function buildArgv(argv: string[]): string[] {
  const firstUserArg = argv[2];

  if (
    !firstUserArg ||
    firstUserArg.startsWith("-") ||
    !knownSubcommands.has(firstUserArg)
  ) {
    return [argv[0], argv[1], "clean", ...argv.slice(2)];
  }

  return argv;
}

// Handle Ctrl+C gracefully
process.on("SIGINT", () => {
  console.log("");
  console.log(colors.yellow("⚠ Scan cancelled by user"));
  process.exit(130); // Standard exit code for SIGINT
});

process.on("SIGTERM", () => {
  console.log("");
  console.log(colors.yellow("⚠ Process terminated"));
  process.exit(143); // Standard exit code for SIGTERM
});

program.parseAsync(buildArgv(process.argv)).catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
