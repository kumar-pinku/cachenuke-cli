import readline from "node:readline";
import type { ScanReport, ScanTargetResult } from "./core";
import { formatBytes, FILE_COUNT_UNAVAILABLE } from "./core";
import { colors, truncate, pad, statusBadge } from "./ui";

export interface InteractiveResult {
  action: "confirm" | "cancel";
  selectedKeys: string[];
  dryRun: boolean;
}

interface RenderState {
  cursorHidden: boolean;
  isAlternateScreen: boolean;
}

interface TableRow {
  key: string;
  label: string;
  size: string;
  sizeBytes: number;
  files: string;
  paths: string;
  selected: boolean;
  dangerous: boolean;
  target: ScanTargetResult;
}

function formatFileCount(count: number | null): string {
  return count === FILE_COUNT_UNAVAILABLE ? "n/a" : String(count);
}

function getStatusBadge(target: ScanTargetResult, dangerous: boolean): string {
  if (dangerous) {
    return statusBadge("system");
  }

  const MB = 1024 * 1024;
  const sizeInMB = target.totalBytes / MB;

  if (sizeInMB > 500) {
    return statusBadge("warning");
  }

  return statusBadge("safe");
}

function buildTableRows(
  report: ScanReport,
  selectedKeys: Set<string>,
  dangerousTargets: Set<string>
): TableRow[] {
  return report.targets.map((target) => ({
    key: target.key,
    label: target.label,
    size: formatBytes(target.totalBytes),
    sizeBytes: target.totalBytes,
    files: formatFileCount(target.totalFiles),
    paths: String(target.pathCount),
    selected: selectedKeys.has(target.key),
    dangerous: dangerousTargets.has(target.key),
    target,
  }));
}

function renderDetailPanel(target: ScanTargetResult): string[] {
  const lines: string[] = [];

  lines.push("");
  lines.push(colors.cyan("─".repeat(80)));
  lines.push(colors.bold(`${target.label} ${colors.dim(`[${target.key}]`)}`));
  lines.push(colors.dim(target.description));

  const MB = 1024 * 1024;
  const sizeInMB = target.totalBytes / MB;
  const sizeColor = sizeInMB > 500 ? "red" : sizeInMB > 100 ? "yellow" : "green";

  lines.push(
    `Size: ${colors[sizeColor](formatBytes(target.totalBytes))}   ` +
      `Files: ${colors.cyan(formatFileCount(target.totalFiles))}   ` +
      `Paths: ${colors.cyan(String(target.pathCount))}   ` +
      `Missing: ${colors.dim(String(target.missingPaths))}`
  );

  if (target.paths.length > 0) {
    lines.push("");
    lines.push(colors.bold("Paths:"));

    for (const scannedPath of target.paths.slice(0, 3)) {
      lines.push("");
      lines.push(
        `${colors.cyan("→")} ${truncate(scannedPath.path, 76)} ${colors.dim(
          scannedPath.exists ? "(present)" : "(missing)"
        )}`
      );

      if (scannedPath.exists) {
        lines.push(
          `  ${colors.dim("Size:")} ${formatBytes(scannedPath.bytes)} ${colors.dim(
            "|"
          )} ${colors.dim("Files:")} ${formatFileCount(scannedPath.files)}`
        );

        if (scannedPath.topEntries.length > 0) {
          lines.push(`  ${colors.dim("Top entries:")}`);

          for (const entry of scannedPath.topEntries.slice(0, 5)) {
            const entryName = truncate(entry.name, 40);
            const entrySize = formatBytes(entry.bytes);
            const entryFiles = formatFileCount(entry.files);

            lines.push(
              `    ${colors.yellow("•")} ${pad(entryName, 42)} ${colors.dim(
                "|"
              )} ${pad(entrySize, 12, "right")} ${colors.dim("|")} ${pad(
                entryFiles,
                8,
                "right"
              )} files`
            );
          }
        }
      }
    }

    if (target.paths.length > 3) {
      lines.push("");
      lines.push(
        colors.dim(`  ... and ${target.paths.length - 3} more path(s)`)
      );
    }
  }

  if (target.errors.length > 0) {
    lines.push("");
    lines.push(colors.yellow(colors.bold("Errors:")));

    for (const error of target.errors.slice(0, 3)) {
      lines.push(
        `  ${colors.red("✖")} ${truncate(error.path, 50)} ${colors.dim(
          error.message
        )}`
      );
    }

    if (target.errors.length > 3) {
      lines.push(colors.dim(`  ... and ${target.errors.length - 3} more errors`));
    }
  }

  return lines;
}


function renderInteractiveScreen(
  title: string,
  subtitle: string,
  rows: TableRow[],
  cursor: number,
  allowSelection: boolean,
  dryRunEnabled: boolean,
  state: RenderState
): void {
  const width = process.stdout.columns ?? 120;
  const height = process.stdout.rows ?? 30;
  const target = rows[cursor];
  const lines: string[] = [];

  // Calculate viewport for table rows (show only visible rows around cursor)
  const maxVisibleRows = Math.max(5, height - 20); // Reserve space for header/footer
  const halfView = Math.floor(maxVisibleRows / 2);
  let startIdx = Math.max(0, cursor - halfView);
  let endIdx = Math.min(rows.length, startIdx + maxVisibleRows);

  // Adjust if we're at the end
  if (endIdx - startIdx < maxVisibleRows) {
    startIdx = Math.max(0, endIdx - maxVisibleRows);
  }

  // Header with minimal spacing
  lines.push(colors.bold(colors.cyanBright(`${title}`)));
  lines.push(colors.dim(subtitle));

  // Dry-run indicator
  lines.push("");
  if (allowSelection) {
    const dryRunStatus = dryRunEnabled
      ? colors.yellow("[DRY-RUN MODE]")
      : colors.red("[LIVE MODE - WILL DELETE]");
    lines.push(dryRunStatus);
  }

  // Table header
  const checkWidth = 5;
  const labelWidth = Math.max(25, Math.min(35, width - 52));
  const sizeWidth = 12;
  const filesWidth = 10;
  const pathsWidth = 8;
  const statusWidth = 12;

  const headerRow = [
    pad(allowSelection ? "✓" : "#", checkWidth),
    pad("Target", labelWidth),
    pad("Size", sizeWidth, "right"),
    pad("Files", filesWidth, "right"),
    pad("Paths", pathsWidth, "right"),
    pad("Status", statusWidth),
  ].join("  ");

  lines.push("");
  lines.push(colors.bold(colors.cyan(headerRow)));
  lines.push(colors.dim("─".repeat(Math.min(width, headerRow.length + 2))));

  // Show scroll indicator if needed
  if (startIdx > 0) {
    lines.push(colors.dim(`  ↑ ${startIdx} more above...`));
  }

  // Table rows (only visible portion)
  for (let index = startIdx; index < endIdx; index++) {
    const row = rows[index];
    const checkbox = allowSelection ? (row.selected ? "[✓]" : "[ ]") : ` ${index + 1} `;
    const cursorMark = index === cursor ? colors.cyan("›") : " ";
    const statusDisplay = getStatusBadge(row.target, row.dangerous);

    const rowDisplay = [
      pad(checkbox, checkWidth),
      pad(truncate(row.label, labelWidth - 2), labelWidth),
      pad(row.size, sizeWidth, "right"),
      pad(row.files, filesWidth, "right"),
      pad(row.paths, pathsWidth, "right"),
      statusDisplay,
    ].join("  ");

    const coloredRow = index === cursor ? colors.bold(rowDisplay) : rowDisplay;
    lines.push(`${cursorMark} ${coloredRow}`);
  }

  // Show scroll indicator if needed
  if (endIdx < rows.length) {
    lines.push(colors.dim(`  ↓ ${rows.length - endIdx} more below...`));
  }

  // Detail panel (only show if enough space)
  if (target && height > 25) {
    const detailLines = renderDetailPanel(target.target);
    // Limit detail panel to prevent overflow
    const maxDetailLines = Math.min(detailLines.length, height - lines.length - 10);
    lines.push(...detailLines.slice(0, maxDetailLines));
  }

  // Summary
  const totalSize = rows.reduce((sum, row) => sum + row.sizeBytes, 0);
  const selectedSize = rows
    .filter((row) => row.selected)
    .reduce((sum, row) => sum + row.sizeBytes, 0);

  lines.push("");
  lines.push(colors.dim("─".repeat(Math.min(width, 80))));

  if (allowSelection) {
    const selectedCount = rows.filter((row) => row.selected).length;
    lines.push(
      `${colors.bold("Selected:")} ${colors.green(
        `${selectedCount}/${rows.length}`
      )} targets · ${colors.green(formatBytes(selectedSize))} of ${formatBytes(
        totalSize
      )}`
    );
  } else {
    lines.push(
      `${colors.bold("Total:")} ${rows.length} targets · ${formatBytes(
        totalSize
      )}`
    );
  }

  // Controls
  lines.push("");
  lines.push(colors.dim("Controls:"));

  if (allowSelection) {
    lines.push(
      colors.dim(
        "  ↑/↓  Navigate   Space  Toggle   A  All   D  Dry-run   Enter  Confirm   Q/Esc  Cancel"
      )
    );
  } else {
    lines.push(colors.dim("  ↑/↓  Navigate   Enter/Q/Esc  Close"));
  }

  // Render the frame
  writeFrame(lines);
}

function writeFrame(lines: string[]): void {
  if (!process.stdout.isTTY) {
    process.stdout.write(lines.join("\n") + "\n");
    return;
  }

  // Use home and clear in alternate screen - this is stable
  process.stdout.write("\u001b[H\u001b[2J");
  process.stdout.write(lines.join("\n"));
}

function enterAlternateScreen(state: RenderState): void {
  if (state.isAlternateScreen || !process.stdout.isTTY) {
    return;
  }
  // Enter alternate screen with scrolling enabled
  process.stdout.write("\u001b[?1049h");
  state.isAlternateScreen = true;
}

function exitAlternateScreen(state: RenderState): void {
  if (!state.isAlternateScreen || !process.stdout.isTTY) {
    return;
  }
  process.stdout.write("\u001b[?1049l");
  state.isAlternateScreen = false;
}

function hideCursor(state: RenderState): void {
  if (state.cursorHidden || !process.stdout.isTTY) {
    return;
  }
  process.stdout.write("\u001b[?25l");
  state.cursorHidden = true;
}

function showCursor(state: RenderState): void {
  if (!state.cursorHidden || !process.stdout.isTTY) {
    return;
  }
  process.stdout.write("\u001b[?25h");
  state.cursorHidden = false;
}

export async function runInteractiveTable(
  report: ScanReport,
  allowSelection: boolean,
  dangerousTargets: Set<string>
): Promise<InteractiveResult> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive mode requires a TTY terminal.");
  }

  if (report.targets.length === 0) {
    return { action: "cancel", selectedKeys: [], dryRun: true };
  }

  const selectedKeys = new Set(
    allowSelection ? report.targets.map((target) => target.key) : []
  );
  let cursor = 0;
  let dryRun = true;

  const renderState: RenderState = {
    cursorHidden: false,
    isAlternateScreen: false,
  };

  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    if (typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(true);
    }

    // Enter alternate screen and hide cursor
    enterAlternateScreen(renderState);
    hideCursor(renderState);

    const cleanup = (result: InteractiveResult) => {
      // Remove keypress listener
      process.stdin.off("keypress", onKeypress);

      // Restore raw mode
      if (typeof process.stdin.setRawMode === "function") {
        process.stdin.setRawMode(false);
      }

      // Restore terminal state
      showCursor(renderState);
      exitAlternateScreen(renderState);

      // Resume stdin reading (important for returning to prompt)
      if (process.stdin.isPaused()) {
        process.stdin.resume();
      }

      resolve(result);
    };

    const onKeypress = (str: string, key: readline.Key) => {
      // Ignore invalid events
      if (!key || typeof key !== 'object') {
        return;
      }

      // Arrow keys for navigation
      if (key.name === "up" && !key.ctrl && !key.meta && !key.shift) {
        cursor = cursor > 0 ? cursor - 1 : rows.length - 1;
      } else if (key.name === "down" && !key.ctrl && !key.meta && !key.shift) {
        cursor = cursor < rows.length - 1 ? cursor + 1 : 0;
      } else if (allowSelection && key.name === "space" && !key.ctrl && !key.meta) {
        const currentKey = rows[cursor]?.key;
        if (currentKey) {
          if (selectedKeys.has(currentKey)) {
            selectedKeys.delete(currentKey);
          } else {
            selectedKeys.add(currentKey);
          }
        }
      } else if (allowSelection && key.name === "a" && !key.ctrl && !key.meta) {
        if (selectedKeys.size === rows.length) {
          selectedKeys.clear();
        } else {
          rows.forEach((row) => selectedKeys.add(row.key));
        }
      } else if (allowSelection && key.name === "d" && !key.ctrl && !key.meta) {
        dryRun = !dryRun;
      } else if (key.name === "return" && !key.ctrl && !key.meta) {
        cleanup({
          action: "confirm",
          selectedKeys: allowSelection ? [...selectedKeys] : [],
          dryRun,
        });
        return;
      } else if (key.name === "q" || key.name === "escape" || (key.ctrl && key.name === "c")) {
        cleanup({
          action: "cancel",
          selectedKeys: [],
          dryRun: true,
        });
        return;
      } else {
        // Ignore any other input (including mouse events)
        return;
      }

      // Update and re-render (throttled to prevent spam)
      rows = buildTableRows(report, selectedKeys, dangerousTargets);
      renderInteractiveScreen(
        allowSelection
          ? "CacheNuke Interactive Cleanup"
          : "CacheNuke Interactive Scan",
        allowSelection
          ? "Select targets and confirm to clean. Toggle dry-run with 'D'."
          : "Browse detected caches and their sizes.",
        rows,
        cursor,
        allowSelection,
        dryRun,
        renderState
      );
    };

    let rows = buildTableRows(report, selectedKeys, dangerousTargets);
    renderInteractiveScreen(
      allowSelection
        ? "CacheNuke Interactive Cleanup"
        : "CacheNuke Interactive Scan",
      allowSelection
        ? "Select targets and confirm to clean. Toggle dry-run with 'D'."
        : "Browse detected caches and their sizes.",
      rows,
      cursor,
      allowSelection,
      dryRun,
      renderState
    );
    process.stdin.on("keypress", onKeypress);
  });
}
