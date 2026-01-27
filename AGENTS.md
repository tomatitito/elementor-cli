# Development Guide

How to use Bun for building, testing, and developing `elementor-cli`.

---

## Prerequisites

### Install Bun

```bash
# macOS/Linux
curl -fsSL https://bun.sh/install | bash

# Verify installation
bun --version
```

---

## Development

### Run in Development

```bash
# Run directly (no build needed)
bun run src/index.ts

# Run with arguments
bun run src/index.ts config list
bun run src/index.ts pages list --site production

# Watch mode (auto-restart on changes)
bun --watch run src/index.ts
```

### Install Dependencies

```bash
# Install all dependencies
bun install

# Add a dependency
bun add <package>

# Add a dev dependency
bun add -d <package>

# Remove a dependency
bun remove <package>
```

---

## Building

### Build for Distribution

```bash
# Build single executable (Bun runtime)
bun build src/index.ts --outfile dist/elementor-cli --target bun
```

### Build Options

| Flag | Description |
|------|-------------|
| `--outfile <path>` | Output file path |
| `--outdir <path>` | Output directory (for multiple entry points) |
| `--target bun` | Optimize for Bun runtime |
| `--target node` | Compatible with Node.js |
| `--minify` | Minify output |
| `--sourcemap` | Generate source maps |
| `--external <pkg>` | Don't bundle this package |

---

## Testing

### Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/config-store.test.ts
```

## Type Checking

```bash
# Check types without emitting
tsc --noEmit
```

---

## Linting & Formatting

### Using Biome

```bash
# Install
bun add -d @biomejs/biome

# Initialize config
bunx biome init

# Check code
bunx biome check src/

# Format code
bunx biome format --write src/

# Lint and fix
bunx biome lint --apply src/
```

---

## Troubleshooting

### Common Issues

**"Cannot find module" errors:**
```bash
# Clear Bun cache and reinstall
bun pm cache rm
rm -rf node_modules bun.lockb
bun install
```

**Type errors with Bun APIs:**
```bash
# Ensure bun-types is installed
bun add -d @types/bun
```

**Build fails with external dependencies:**
```bash
# Mark problematic packages as external
bun build src/index.ts --outfile dist/cli --external commander
```
