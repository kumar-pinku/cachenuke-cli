import readline from "node:readline";
import type { ScanTargetResult } from "./core";
import { formatBytes } from "./core";
import { colors, symbols } from "./ui";

export interface ProgressiveDisplayOptions {
  enabled: boolean;
  targetCount: number;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const RENDER_INTERVAL_MS = 90;
const RECENT_TARGET_LIMIT = 6;

function clampProgress(current: number, total: number): number {
  if (total <= 0) {
    return 1;
  }

  return Math.min(1, Math.max(0, current / total));
}

function truncateText(text: string, maxLength: number): string {
  if (maxLength <= 0 || text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function colorTargetSize(bytes: number, text: string): string {
  const mb = 1024 * 1024;

  if (bytes >= 1024 * mb) {
    return colors.bold(colors.red(text));
  }

  if (bytes >= 250 * mb) {
    return colors.bold(colors.yellow(text));
  }

  if (bytes >= 25 * mb) {
    return colors.green(text);
  }

  return colors.dim(text);
}

function getTargetIcon(bytes: number): string {
  if (bytes === 0) {
    return colors.dim("○");
  }

  if (bytes >= 1024 * 1024 * 1024) {
    return colors.red("●");
  }

  if (bytes >= 250 * 1024 * 1024) {
    return colors.yellow("●");
  }

  return colors.green("●");
}

export class ProgressiveDisplay {
  private enabled: boolean;
  private targetCount: number;
  private completedCount = 0;
  private totalBytes = 0;
  private startTime: number;
  private frameIndex = 0;
  private renderTimer: NodeJS.Timeout | null = null;
  private completedTargets: ScanTargetResult[] = [];
  private finished = false;
  private cursorHidden = false;
  private renderedLineCount = 0;

  constructor(options: ProgressiveDisplayOptions) {
    this.enabled =
      options.enabled &&
      Boolean(process.stdout.isTTY) &&
      process.env.TERM !== "dumb";
    this.targetCount = options.targetCount;
    this.startTime = Date.now();
  }

  start(): void {
    if (!this.enabled || this.finished) {
      return;
    }

    this.hideCursor();
    this.render();
    this.renderTimer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
      this.render();
    }, RENDER_INTERVAL_MS);
  }

  addTarget(target: ScanTargetResult): void {
    if (!this.enabled || this.finished) {
      return;
    }

    this.completedCount += 1;
    this.totalBytes += target.totalBytes;
    this.completedTargets.push(target);
    this.render();
  }

  complete(totalTargets: number, totalBytes: number, totalTime: number): void {
    if (!this.enabled || this.finished) {
      return;
    }

    this.finished = true;
    this.completedCount = totalTargets;
    this.totalBytes = totalBytes;

    if (this.renderTimer) {
      clearInterval(this.renderTimer);
      this.renderTimer = null;
    }

    this.render(true, totalTime);
    this.showCursor();
  }

  clear(): void {
    if (!this.enabled) {
      return;
    }

    if (this.renderTimer) {
      clearInterval(this.renderTimer);
      this.renderTimer = null;
    }

    // Clear the progressive display
    if (this.renderedLineCount > 0) {
      readline.moveCursor(process.stdout, 0, -this.renderedLineCount);
      readline.cursorTo(process.stdout, 0);
      readline.clearScreenDown(process.stdout);
      this.renderedLineCount = 0;
    }

    this.showCursor();
    this.finished = true;
  }

  private render(isComplete = false, totalTime?: number): void {
    if (!this.enabled) {
      return;
    }

    const width = process.stdout.columns ?? 100;
    const elapsedSeconds = totalTime ?? (Date.now() - this.startTime) / 1000;
    const progress = clampProgress(this.completedCount, this.targetCount);
    const progressPercent = Math.round(progress * 100);
    const spinner = isComplete ? symbols.success : SPINNER_FRAMES[this.frameIndex] ?? "•";
    const title = isComplete ? "Scan complete" : "Scanning caches";
    const subtitle = isComplete
      ? `${formatBytes(this.totalBytes)} discovered across ${this.completedCount} target${
          this.completedCount === 1 ? "" : "s"
        }`
      : `${this.completedCount}/${this.targetCount} targets scanned`;
    const progressBarWidth = Math.max(16, Math.min(32, width - 44));
    const filled = Math.round(progressBarWidth * progress);
    const empty = Math.max(0, progressBarWidth - filled);
    const progressBar =
      colors.cyan("█".repeat(filled)) + colors.dim("░".repeat(empty));
    const throughput = elapsedSeconds > 0 ? this.totalBytes / elapsedSeconds : 0;
    const recentTargets = this.completedTargets.slice(-RECENT_TARGET_LIMIT).reverse();
    const recentLabelWidth = Math.max(18, Math.min(36, width - 44));
    const topTarget = this.completedTargets.reduce<ScanTargetResult | null>(
      (largest, current) =>
        !largest || current.totalBytes > largest.totalBytes ? current : largest,
      null
    );

    const lines: string[] = [];
    lines.push("");
    lines.push(
      `  ${colors.bold(colors.cyanBright("CacheNuke Scan"))} ${colors.dim("live progress")}`
    );
    lines.push(
      `  ${colors.cyan(String(spinner))} ${colors.bold(title)} ${colors.dim("·")} ${colors.dim(
        subtitle
      )}`
    );
    lines.push("");
    lines.push(
      `  ${progressBar} ${colors.bold(String(progressPercent).padStart(3, " "))}% ${colors.dim(
        `· ${elapsedSeconds.toFixed(1)}s`
      )}`
    );
    lines.push("");
    lines.push(
      `  ${colors.dim("Targets")} ${colors.bold(String(this.completedCount).padStart(2, " "))}/${String(
        this.targetCount
      ).padEnd(2, " ")}   ` +
        `${colors.dim("Space")} ${colors.bold(colorTargetSize(this.totalBytes, formatBytes(this.totalBytes)))}   ` +
        `${colors.dim("Rate")} ${colors.bold(formatBytes(throughput))}${colors.dim("/s")}`
    );

    if (topTarget) {
      lines.push(
        `  ${colors.dim("Largest")} ${getTargetIcon(topTarget.totalBytes)} ${truncateText(
          topTarget.label,
          Math.max(20, width - 42)
        )} ${colors.dim("·")} ${colorTargetSize(
          topTarget.totalBytes,
          formatBytes(topTarget.totalBytes)
        )}`
      );
    } else {
      lines.push(
        `  ${colors.dim("Largest")} ${colors.dim("waiting for first completed target")}`
      );
    }

    lines.push("");
    lines.push(`  ${colors.bold("Recently Scanned")}`);

    if (recentTargets.length === 0) {
      lines.push(`  ${colors.dim("No targets completed yet.")}`);
    } else {
      for (const target of recentTargets) {
        lines.push(
          `  ${getTargetIcon(target.totalBytes)} ${truncateText(
            target.label,
            recentLabelWidth
          )} ${colors.dim("·")} ${colorTargetSize(
            target.totalBytes,
            formatBytes(target.totalBytes)
          )} ${colors.dim(`(${target.pathCount} path${target.pathCount === 1 ? "" : "s"})`)}`
        );
      }
    }

    if (!isComplete) {
      const remaining = Math.max(0, this.targetCount - this.completedCount);
      lines.push("");
      lines.push(
        `  ${colors.dim(
          `Scanning continues automatically. ${remaining} target${remaining === 1 ? "" : "s"} remaining.`
        )}`
      );
    } else {
      lines.push("");
      lines.push(
        `  ${symbols.success} ${colors.bold("Finalized")} ${colors.dim(
          `in ${elapsedSeconds.toFixed(1)}s`
        )}`
      );
    }

    lines.push("");
    this.writeFrame(lines);
  }

  private hideCursor(): void {
    if (this.cursorHidden || !process.stdout.isTTY) {
      return;
    }

    process.stdout.write("\u001B[?25l");
    this.cursorHidden = true;
  }

  private showCursor(): void {
    if (!this.cursorHidden || !process.stdout.isTTY) {
      return;
    }

    process.stdout.write("\u001B[?25h");
    this.cursorHidden = false;
  }

  private writeFrame(lines: string[]): void {
    if (this.renderedLineCount > 0) {
      readline.moveCursor(process.stdout, 0, -this.renderedLineCount);
      readline.cursorTo(process.stdout, 0);
    }

    readline.clearScreenDown(process.stdout);
    process.stdout.write(lines.join("\n"));
    this.renderedLineCount = lines.length;
  }
}
