# CLAUDE.md - Development Guide

CacheNuke CLI development reference for contributors and maintainers.

## Architecture

```
src/
├── cli.ts           # Entry point, command routing
├── core.ts          # Target definitions, scan/clean logic
├── config.ts        # Config loading & validation
├── interactive.ts   # Interactive UI (keyboard nav, alternate screen)
├── progressive.ts   # Progressive scan display
└── ui.ts            # UI primitives (colors, spinners)
```

## Key Modules

**core.ts** - Business logic for scanning and cleaning cache targets
**cli.ts** - Command routing, option parsing, output formatting
**config.ts** - JSON config file discovery and validation
**interactive.ts** - Full-screen terminal UI with viewport scrolling
**progressive.ts** - Real-time scan progress with animated spinners
**ui.ts** - Color functions, symbols, and formatters

## Development Setup

```bash
git clone https://github.com/kumar-pinku/cachenuke-cli.git
cd cachenuke-cli
npm install
npm run build
npm link
npm test
```

## Adding a New Cache Target

Edit `src/core.ts` and add to `TARGETS` array:

```typescript
{
  key: "mytarget",
  label: "My Cache",
  description: "Description of the cache",
  platform: "all", // or "darwin" | "linux" | "win32"
  smartDefault: false,
  dangerous: false,
  async resolvePaths(context) {
    return compactPaths([
      ...unixOnly(context, {
        darwin: [withHome(context, "Library", "Caches", "MyApp")],
        linux: [withHome(context, ".cache", "myapp")],
        win32: [withLocalAppData(context, "MyApp") ?? null],
      }),
    ]);
  },
}
```

## Testing

```bash
# Unit tests
npm test

# Manual testing
npm run build
node dist/cli.js scan --dry-run
node dist/cli.js clean workspace --dry-run
cachenuke --help
```

## Code Style

- **TypeScript strict mode** enabled
- **Naming**: `camelCase` functions, `PascalCase` interfaces, `UPPER_SNAKE_CASE` constants
- **Error handling**: Catch specific errors, provide actionable messages
- **Imports**: Group by node, external, local

## Common Patterns

**OS-specific paths:**
```typescript
...unixOnly(context, {
  darwin: [withHome(context, "path")],
  linux: [withHome(context, "path")],
  win32: [withAppData(context, "path") ?? null],
})
```

**Progressive scanning:**
```typescript
const display = new ProgressiveDisplay({ enabled: true, targetCount: 5 });
display.start();
const report = await scanTargets(targets, {
  onTargetScanned: (target) => display.addTarget(target),
});
display.complete(report.targets.length, report.totals.bytes, elapsed);
```

## Interactive Mode Implementation

Uses **alternate screen buffer** for stable UI with viewport-based scrolling:
- Shows only visible rows that fit on screen
- Scroll indicators ("↑ 5 more above...", "↓ 3 more below...")
- Cursor stays centered as you navigate
- No multiple frames or flicker

## Performance Optimizations

- **Fast mode** (default): `du -sk` on Unix for instant size calculation
- **Exact mode** (`--exact-files`): Recursive traversal for file counts
- **Workspace discovery**: BFS with max depth 4, skips `.git`, `dist`, `build`

## Release Checklist

```bash
# Pre-release
npm test
npm run build
npm version patch|minor|major

# Publish
npm publish
git tag v1.x.x
git push --tags
```

## Contribution Guidelines

1. Fork repository
2. Create feature branch
3. Add/update tests
4. Ensure `npm test` passes
5. Update documentation
6. Submit PR

## License

ISC - Pinku Kumar <kumarpinku494@gmail.com>
