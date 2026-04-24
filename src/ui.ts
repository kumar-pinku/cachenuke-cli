import ora, { Ora } from "ora";
import chalk from "chalk";
import cliProgress from "cli-progress";
import logSymbols from "log-symbols";
import Table from "cli-table3";

export interface SpinnerOptions {
  text: string;
  enabled?: boolean;
}

export interface ProgressBarOptions {
  total: number;
  format?: string;
  enabled?: boolean;
}

let colorEnabled = true;

export function setColorEnabled(enabled: boolean): void {
  colorEnabled = enabled;
}

export function isColorEnabled(): boolean {
  return colorEnabled;
}

// Enhanced color functions
export const colors = {
  dim: (text: string) => (colorEnabled ? chalk.dim(text) : text),
  bold: (text: string) => (colorEnabled ? chalk.bold(text) : text),
  cyan: (text: string) => (colorEnabled ? chalk.cyan(text) : text),
  magenta: (text: string) => (colorEnabled ? chalk.magenta(text) : text),
  green: (text: string) => (colorEnabled ? chalk.green(text) : text),
  yellow: (text: string) => (colorEnabled ? chalk.yellow(text) : text),
  blue: (text: string) => (colorEnabled ? chalk.blue(text) : text),
  red: (text: string) => (colorEnabled ? chalk.red(text) : text),
  gray: (text: string) => (colorEnabled ? chalk.gray(text) : text),
  white: (text: string) => (colorEnabled ? chalk.white(text) : text),
  greenBright: (text: string) => (colorEnabled ? chalk.greenBright(text) : text),
  redBright: (text: string) => (colorEnabled ? chalk.redBright(text) : text),
  cyanBright: (text: string) => (colorEnabled ? chalk.cyanBright(text) : text),
};

// Symbols
export const symbols = {
  success: colorEnabled ? logSymbols.success : "✓",
  error: colorEnabled ? logSymbols.error : "✖",
  warning: colorEnabled ? logSymbols.warning : "⚠",
  info: colorEnabled ? logSymbols.info : "ℹ",
};

// Enhanced spinner
export function createSpinner(options: SpinnerOptions): Ora | null {
  if (!process.stdout.isTTY || !colorEnabled || options.enabled === false) {
    console.log(`${options.text}...`);
    return null;
  }

  return ora({
    text: options.text,
    spinner: {
      interval: 80,
      frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    },
    color: "cyan",
  }).start();
}

export async function withSpinner<T>(
  text: string,
  task: () => Promise<T>
): Promise<T> {
  const spinner = createSpinner({ text });

  try {
    const result = await task();
    if (spinner) {
      spinner.succeed(colors.bold(text));
    }
    return result;
  } catch (error) {
    if (spinner) {
      spinner.fail(colors.bold(text));
    }
    throw error;
  }
}

// Progress bar
export function createProgressBar(
  options: ProgressBarOptions
): cliProgress.SingleBar | null {
  if (!process.stdout.isTTY || !colorEnabled || options.enabled === false) {
    return null;
  }

  const bar = new cliProgress.SingleBar(
    {
      format:
        options.format ||
        `${colors.cyan("{bar}")} | {percentage}% | {value}/{total} items`,
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic
  );

  bar.start(options.total, 0);
  return bar;
}

// Table creation
export interface TableColumn {
  header: string;
  width?: number;
  alignment?: "left" | "center" | "right";
}

export function createTable(columns: TableColumn[]): Table.Table {
  return new Table({
    head: columns.map((col) => colors.bold(col.header)),
    colWidths: columns.map((col) => col.width || null),
    colAligns: columns.map((col) => col.alignment || "left"),
    style: {
      head: colorEnabled ? ["cyan"] : [],
      border: colorEnabled ? ["gray"] : [],
    },
    chars: {
      top: "─",
      "top-mid": "┬",
      "top-left": "┌",
      "top-right": "┐",
      bottom: "─",
      "bottom-mid": "┴",
      "bottom-left": "└",
      "bottom-right": "┘",
      left: "│",
      "left-mid": "├",
      mid: "─",
      "mid-mid": "┼",
      right: "│",
      "right-mid": "┤",
      middle: "│",
    },
  });
}

// Badges
export function badge(text: string, type: "safe" | "warning" | "system"): string {
  const badges = {
    safe: colorEnabled ? chalk.bgGreen.black(` ${text} `) : `[${text}]`,
    warning: colorEnabled ? chalk.bgYellow.black(` ${text} `) : `[${text}]`,
    system: colorEnabled ? chalk.bgRed.white(` ${text} `) : `[${text}]`,
  };
  return badges[type];
}

// Status indicator
export function statusBadge(
  status: "safe" | "warning" | "system"
): string {
  const badges = {
    safe: badge("SAFE", "safe"),
    warning: badge("WARN", "warning"),
    system: badge("SYSTEM", "system"),
  };
  return badges[status];
}

// File type colors
export function colorFileType(filename: string, text?: string): string {
  const displayText = text || filename;
  const ext = filename.split(".").pop()?.toLowerCase();

  if (filename.includes("log") || ext === "log") {
    return colors.gray(displayText);
  }

  if (
    filename.includes("cache") ||
    ext === "cache" ||
    filename.includes(".next") ||
    filename.includes(".turbo")
  ) {
    return colors.cyan(displayText);
  }

  if (filename.includes("build") || filename.includes("dist")) {
    return colors.magenta(displayText);
  }

  return displayText;
}

// Size color coding
export function colorBySize(bytes: number, text: string): string {
  const MB = 1024 * 1024;
  const GB = MB * 1024;

  if (bytes >= GB) {
    return colors.bold(colors.red(text));
  } else if (bytes >= 100 * MB) {
    return colors.bold(colors.yellow(text));
  } else if (bytes >= 10 * MB) {
    return colors.yellow(text);
  } else if (bytes < 1 * MB) {
    return colors.dim(text);
  }

  return text;
}

// Box drawing
export function drawBox(
  title: string,
  content: string[],
  width = 80
): string {
  const lines = [
    `┌${"─".repeat(width - 2)}┐`,
    `│ ${colors.bold(title).padEnd(width - 4)} │`,
    `├${"─".repeat(width - 2)}┤`,
    ...content.map((line) => `│ ${line.padEnd(width - 4)} │`),
    `└${"─".repeat(width - 2)}┘`,
  ];
  return lines.join("\n");
}

// Summary display
export interface SummaryItem {
  label: string;
  value: string;
  color?: keyof typeof colors;
}

export function displaySummary(items: SummaryItem[]): void {
  console.log("");
  console.log(colors.bold("Summary"));
  console.log(colors.dim("─".repeat(50)));

  for (const item of items) {
    const colorFn = item.color ? colors[item.color] : (text: string) => text;
    console.log(`  ${item.label}: ${colorFn(item.value)}`);
  }

  console.log("");
}

// Warning display
export function displayWarning(message: string, details?: string[]): void {
  console.log("");
  console.log(`${symbols.warning} ${colors.yellow(colors.bold(message))}`);

  if (details && details.length > 0) {
    for (const detail of details) {
      console.log(`  ${colors.yellow("•")} ${detail}`);
    }
  }

  console.log("");
}

// Success display
export function displaySuccess(message: string, details?: string[]): void {
  console.log("");
  console.log(`${symbols.success} ${colors.green(colors.bold(message))}`);

  if (details && details.length > 0) {
    for (const detail of details) {
      console.log(`  ${colors.green("•")} ${detail}`);
    }
  }

  console.log("");
}

// Error display
export function displayError(message: string, details?: string[]): void {
  console.log("");
  console.log(`${symbols.error} ${colors.red(colors.bold(message))}`);

  if (details && details.length > 0) {
    for (const detail of details) {
      console.log(`  ${colors.red("•")} ${detail}`);
    }
  }

  console.log("");
}

// Clear screen
export function clearScreen(): void {
  if (process.stdout.isTTY) {
    process.stdout.write("\u001b[2J\u001b[H");
  }
}

// Truncate text
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 1) + "…";
}

// Pad text
export function pad(text: string, width: number, align: "left" | "right" | "center" = "left"): string {
  const padding = Math.max(0, width - text.length);

  if (align === "right") {
    return " ".repeat(padding) + text;
  } else if (align === "center") {
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    return " ".repeat(leftPad) + text + " ".repeat(rightPad);
  }

  return text + " ".repeat(padding);
}
