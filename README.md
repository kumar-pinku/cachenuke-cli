# CacheNuke-CLI

🧹 **Universal development cache cleaner with beautiful interactive UI**

Stop wasting time debugging stale caches. Clean npm, pnpm, yarn, workspace builds, and 20+ other development caches with a single command.

## Features

✨ **Beautiful Interactive UI** - Full keyboard navigation with live preview
🎯 **Smart Defaults** - Works out of the box, no configuration needed
🛡️ **Safe by Default** - Preview before deletion with dry-run mode
⚡ **Fast Scanning** - Optimized for large cache directories
🌍 **Cross-Platform** - macOS, Linux, and Windows support
📦 **20+ Cache Types** - Package managers, build tools, IDEs, browsers, and more

## Installation

```bash
npm install -g cachenuke
```

## Quick Start

```bash
# Interactive cleanup (default)
cachenuke

# Interactive scan
cachenuke scan

# Preview without deleting
cachenuke --dry-run

# List all targets
cachenuke targets
```

## What It Cleans

**Package Managers (13 types)**
npm • yarn • pnpm • bun • pip • cargo • gradle • maven • composer • nuget • gem • go • homebrew

**Build Tools & Frameworks**
Next.js • Turbo • Nuxt • Vite • Parcel • SvelteKit • Angular • node_modules/.cache • ESLint

**IDEs & Editors**
VS Code • JetBrains (IntelliJ, WebStorm, PyCharm) • Xcode • CocoaPods

**Browsers**
Chrome • Edge • Brave • Firefox • Chromium

**System**
OS temp • Docker • macOS system caches • Windows system caches

## Commands

```bash
# Default cleanup with smart targets
cachenuke
cachenuke --dry-run
cachenuke --force

# Scan only (no deletion)
cachenuke scan
cachenuke scan --all --exact-files
cachenuke scan workspace vscode

# Clean specific targets
cachenuke clean npm pnpm workspace
cachenuke clean --interactive
cachenuke clean --config ./cachenuke.config.json

# List available targets
cachenuke targets
```

## Interactive Mode

**Default keyboard controls:**
- `↑/↓` - Navigate targets
- `Space` - Toggle selection
- `A` - Select/deselect all
- `D` - Toggle dry-run mode
- `Enter` - Confirm
- `Q/Esc` - Cancel

Disable with `--no-interactive` flag.

## Config File

Create `cachenuke.config.json` or `.cachenukerc.json`:

```json
{
  "defaultTargets": ["workspace", "npm", "pnpm"],
  "excludedTargets": ["browsers", "system"],
  "excludedPaths": ["./dist"],
  "exactFiles": false,
  "interactive": true
}
```

## Options

- `--dry-run` - Preview without deleting
- `--force` - Skip confirmation prompts
- `--interactive` / `--no-interactive` - Toggle interactive mode
- `--all` - Include all targets (not just smart defaults)
- `--exact-files` - Precise file counts (slower)
- `--json` - Machine-readable output
- `--no-color` - Disable colors
- `--config <path>` - Custom config file
- `--cwd <path>` - Run from different directory
- `--top <count>` - Number of top entries to show (default: 5)

## Usage Examples

```bash
# Quick cleanup with interactive selection
cachenuke

# Scan specific caches
cachenuke scan npm pnpm workspace

# Clean workspace builds only
cachenuke clean workspace --dry-run
cachenuke clean workspace --force

# Clean all caches (preview first!)
cachenuke scan --all
cachenuke clean --all --force
```

## Safety Notes

- **Always preview first**: Use `--dry-run` or `scan` before cleaning
- **System caches**: Preview with `cachenuke scan system --dry-run` before cleaning
- **Deletion behavior**: Removes cache contents, not parent folders
- **Browser caches**: Only cache cleared, not history
- **Error handling**: Continues cleaning even if one target fails
