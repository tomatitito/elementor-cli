# elementor-cli: Implementation Plan

See [specs/](./specs/readme.md) for the full specification of commands, configuration, and data formats.

---

## Overview

Build a TypeScript CLI tool (using Bun) for managing Elementor pages programmatically.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         elementor-cli                            │
├─────────────────────────────────────────────────────────────────┤
│  Commands Layer (Commander.js)                                   │
│  ├── config    - Manage site connections                        │
│  ├── pages     - List/create/delete pages                       │
│  ├── pull      - Download pages from remote                     │
│  ├── push      - Upload pages to remote                         │
│  ├── preview   - Local staging environment                      │
│  ├── db        - Database dump/restore                          │
│  ├── revisions - View/restore backups                           │
│  └── diff      - Compare local vs remote                        │
├─────────────────────────────────────────────────────────────────┤
│  Core Services                                                   │
│  ├── WordPressClient   - REST API communication                 │
│  ├── ElementorParser   - JSON data transformation               │
│  ├── LocalStore        - File-based page storage                │
│  ├── DockerManager     - Staging environment control            │
│  └── RevisionManager   - Backup/restore operations              │
├─────────────────────────────────────────────────────────────────┤
│  Data Layer                                                      │
│  ├── .elementor-cli.yaml           - Project config (YAML)      │
│  ├── .elementor-cli/pages/         - Downloaded page JSON       │
│  └── .elementor-cli/staging/       - Docker compose files       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Runtime | Bun | Fast, TypeScript-native, good DX |
| CLI Framework | Commander.js | Mature, well-documented, Bun-compatible |
| HTTP Client | Native fetch (Bun) | Built-in, no deps needed |
| Prompts | @inquirer/prompts | Interactive CLI prompts |
| Validation | Zod | Type-safe JSON schema validation |
| Config | yaml | Parse/write YAML config files |
| Docker | docker-compose | Staging environment orchestration |
| Testing | Bun test | Built into Bun |

---

## Help System Requirements

**CRITICAL:** Every command and subcommand MUST implement a comprehensive `--help` flag.

### Help Flag Standards

1. **Main CLI Help**
   - `elementor-cli --help` shows overview of all commands
   - Displays version, description, and available commands
   - Shows global options (if any)

2. **Command-Level Help**
   - Every command must have `--help`: `elementor-cli config --help`
   - Shows command description, usage, and available subcommands/options
   - Includes practical examples

3. **Subcommand-Level Help**
   - Every subcommand must have `--help`: `elementor-cli config init --help`
   - Shows detailed usage, all options with descriptions
   - Includes multiple examples showing common use cases

### Help Content Guidelines

Each `--help` output should include:
- **Usage:** Command syntax with required and optional parameters
- **Description:** What the command does (1-2 sentences)
- **Options:** All flags with short/long forms and descriptions
- **Examples:** At least 2-3 practical examples
- **See Also:** Related commands (where applicable)

### Example Help Output

```bash
$ elementor-cli config init --help

Usage: elementor-cli config init [options]

Initialize a new Elementor CLI configuration for the current project.
This creates a .elementor-cli.yaml file with site connection details.

Options:
  -s, --site <name>      Site identifier (default: "default")
  -u, --url <url>        WordPress site URL
  -p, --password <pass>  Application password
  -i, --interactive      Interactive setup wizard (default: true)
  -h, --help            Display help for command

Examples:
  # Interactive setup (recommended for first time)
  $ elementor-cli config init

  # Non-interactive setup
  $ elementor-cli config init --site production \
    --url https://example.com \
    --password "xxxx xxxx xxxx"

  # Add additional site to existing config
  $ elementor-cli config init --site staging --url https://staging.example.com

See also:
  elementor-cli config add     Add a new site configuration
  elementor-cli config test    Test site connectivity
```

### Implementation in Commander.js

All commands must use Commander.js `.description()` and `.addHelpText()` methods:

```typescript
program
  .command('pull')
  .description('Download Elementor pages from WordPress to local storage')
  .argument('<page-id>', 'Page ID to pull from WordPress')
  .option('-s, --site <name>', 'Site name from config', 'default')
  .option('-f, --force', 'Overwrite local changes without confirmation')
  .addHelpText('after', `
Examples:
  $ elementor-cli pull 42
  $ elementor-cli pull 42 --site production
  $ elementor-cli pull 42 --force
  `)
  .action(pullAction);
```

### Help Checklist

Each command implementation must include:
- [ ] Main command `.description()`
- [ ] All options with descriptions
- [ ] `.addHelpText()` with examples section
- [ ] Argument descriptions for all positional args
- [ ] Related commands in "See also" section (where applicable)

---

## Implementation Phases

### Phase 1: Foundation

**Goal:** Project setup and basic connectivity

1. Initialize project with Bun + TypeScript
2. Set up CLI scaffolding with Commander.js
3. Implement config management
   - `config init` - Interactive setup
   - `config add/remove/list` - Site management
   - `config test` - Connection testing
4. Build WordPress REST API client
   - Authentication with Application Passwords
   - Basic GET/POST/PUT/DELETE operations

**Files:**
```
src/
├── index.ts              # CLI entry point
├── commands/
│   └── config.ts         # Config commands
├── services/
│   └── wordpress-client.ts
├── types/
│   └── index.ts          # TypeScript types
└── utils/
    └── config-store.ts   # YAML config read/write
```

**Deliverable:** Working `elementor-cli config` commands

---

### Phase 2: Core Operations

**Goal:** Pull, push, and diff functionality

1. Implement `pages list/info` commands
2. Build `pull` command
   - Fetch page via REST API
   - Parse Elementor data from meta fields
   - Store locally in structured format
3. Build `push` command
   - Read local changes
   - Conflict detection (compare timestamps)
   - Create revision before overwriting
   - Update via REST API
4. Build `diff` command
   - Compare local vs remote JSON
   - Human-readable output

**Files:**
```
src/
├── commands/
│   ├── pages.ts
│   ├── pull.ts
│   ├── push.ts
│   └── diff.ts
├── services/
│   ├── elementor-parser.ts   # JSON transformation
│   └── local-store.ts        # File operations
```

**Deliverable:** Full pull/push/diff workflow

---

### Phase 3: Staging Environment

**Goal:** Local preview with Docker and database management

1. Implement `preview init`
   - Generate docker-compose.yml template
   - Create in specified or default path
2. Implement `preview start/stop/status`
   - Run docker compose commands
   - Check container status
3. Implement `preview sync`
   - Execute WP-CLI via docker exec
   - Update post meta with Elementor data
   - Flush Elementor CSS cache
4. Implement `preview open`
   - Open browser to staging URL
5. Implement `db dump/restore/list`
   - Create database dumps via WP-CLI
   - Store in `.elementor-cli/dumps/`
   - Restore dumps to staging environment

**Files:**
```
src/
├── commands/
│   ├── preview.ts
│   └── db.ts
├── services/
│   └── docker-manager.ts
└── templates/
    └── docker-compose.yml
```

**Deliverable:** Working local preview environment with database backup/restore

---

### Phase 4: Revisions & Polish

**Goal:** Backup/restore and production readiness

1. Implement `revisions` commands
   - `list` - Fetch revisions via REST API
   - `show` - Display revision details
   - `diff` - Compare revision to current
   - `restore` - Apply revision to page
   - `create` - Manual backup
2. Error handling improvements
   - Friendly error messages
   - Retry logic for network errors
3. Interactive prompts for destructive actions
4. Documentation and README

**Files:**
```
src/
├── commands/
│   └── revisions.ts
├── services/
│   └── revision-manager.ts
```

**Deliverable:** Complete, polished CLI tool

---

## Project Structure

See [specs/structure.md](./specs/structure.md) for detailed project layout.

---

## Dependencies

```json
{
  "name": "elementor-cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "elementor-cli": "./dist/index.js"
  },
  "scripts": {
    "dev": "bun run src/index.ts",
    "build": "bun build src/index.ts --outdir dist --target node",
    "test": "bun test"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "@inquirer/prompts": "^5.0.0",
    "zod": "^3.22.0",
    "chalk": "^5.3.0",
    "ora": "^8.0.0",
    "yaml": "^2.4.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.4.0"
  }
}
```

---

## Verification Plan

### Unit Tests

| Service | Test Cases |
|---------|------------|
| config-store | Read/write YAML, validate schema, handle missing file |
| wordpress-client | Auth headers, response parsing, error handling |
| elementor-parser | JSON transformation, element ID generation |
| local-store | Create/read/update page files, directory structure |
| docker-manager | Compose file detection, command building |

### Integration Tests

1. **Pull/Push cycle**
   - Pull page from test WordPress
   - Modify elements.json
   - Push back
   - Verify changes via REST API

2. **Staging environment**
   - `preview init` creates files
   - `preview start` launches containers
   - `preview sync` updates page
   - `preview stop` cleans up

3. **Revision workflow**
   - Create revision
   - Make changes
   - Restore revision
   - Verify original state

### Manual Testing Checklist

- [ ] `config init` creates valid .elementor-cli.yaml
- [ ] `config test` verifies connection to real WordPress site
- [ ] `pages list` shows Elementor pages
- [ ] `pull <id>` downloads page with correct structure
- [ ] Edit elements.json, `diff` shows changes
- [ ] `push` updates remote page
- [ ] `preview start` launches Docker
- [ ] `preview sync` updates staging
- [ ] `preview open` opens browser
- [ ] `db dump` creates database backup
- [ ] `db list` shows available dumps
- [ ] `db restore` restores database from dump
- [ ] `revisions list` shows history
- [ ] `revisions restore` restores previous version

### Test Environment

```bash
# Option 1: Use staging environment
elementor-cli preview init --path ./test-env
elementor-cli preview start

# Option 2: Standalone Docker
docker run -d --name wp-test -p 8888:80 wordpress:latest
```

---

## Security Considerations

1. **Credentials Storage**
   - Application passwords in `.elementor-cli.yaml`
   - File should be in `.gitignore`
   - Consider future: system keychain integration

2. **Network Security**
   - Enforce HTTPS for remote connections
   - Validate SSL certificates

3. **Data Safety**
   - Conflict detection before push
   - Create revision before overwriting
   - Dry-run mode for push

4. **Input Validation**
   - Validate JSON before push
   - Sanitize element IDs

---

## CI/CD

### GitHub Actions Workflow

**.github/workflows/ci.yml:**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - run: bun install
      - run: bun test
      - run: tsc --noEmit

  build:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - run: bun install
      - run: bun build src/index.ts --outfile dist/elementor-cli --minify

      - uses: actions/upload-artifact@v4
        with:
          name: elementor-cli
          path: dist/elementor-cli
```

### Release Workflow

**.github/workflows/release.yml:**

Builds executable binaries for multiple platforms and creates a published GitHub release when a version tag is pushed (e.g., `v0.0.1`).

**Trigger:** Push tag matching pattern `v[0-9]+.[0-9]+.[0-9]+`

**Build Matrix:**
- Linux x64 (`ubuntu-latest`)
- macOS Intel (`macos-latest`)
- macOS Apple Silicon (`macos-latest-xlarge`)

**Process:**
1. Build standalone executable binaries using `bun build --compile`
2. Create compressed tar.gz archives for each platform
3. Read release notes from `RELEASE_NOTES.md` file
4. Publish release (not draft) with release notes and compiled binaries

**Release Assets:**
- `elementor-cli-linux-x64.tar.gz`
- `elementor-cli-darwin-x64.tar.gz`
- `elementor-cli-darwin-arm64.tar.gz`

**Creating a Release:**

```bash
# Tag the release
git tag v0.0.1
git push origin v0.0.1

# The workflow will automatically:
# - Build binaries for all platforms
# - Create a published release
# - Attach compiled binaries as assets
```

```yaml
name: Release

on:
  push:
    tags:
      - 'v[0-9]+.[0-9]+.[0-9]+'

jobs:
  build:
    name: Build for ${{ matrix.os }}
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            target: linux-x64
            artifact: elementor-cli-linux-x64
          - os: macos-latest
            target: darwin-x64
            artifact: elementor-cli-darwin-x64
          - os: macos-latest-xlarge
            target: darwin-arm64
            artifact: elementor-cli-darwin-arm64
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Build executable
        run: bun build src/index.ts --compile --outfile ${{ matrix.artifact }}

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact }}
          path: ${{ matrix.artifact }}

  release:
    name: Create Release
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: artifacts

      - name: Prepare release assets
        run: |
          mkdir -p release-assets
          find artifacts -type f -exec mv {} release-assets/ \;
          cd release-assets
          chmod +x *
          for file in *; do
            tar czf "${file}.tar.gz" "$file"
          done

      - name: Create Release
        uses: softprops/action-gh-release@v1
        with:
          draft: false
          prerelease: false
          body_path: RELEASE_NOTES.md
          files: |
            release-assets/*.tar.gz
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Preparing a Release:**

Once all implementation phases are complete and the project is ready for release:

1. **Create `RELEASE_NOTES.md`** in the project root with release details:

```markdown
# Elementor CLI v0.0.1

A command-line tool for managing Elementor pages programmatically.

## Features

- ✅ WordPress site configuration management
- ✅ Pull/push Elementor pages between local and remote
- ✅ Local staging environment with Docker
- ✅ Database backup and restore
- ✅ Page revision management
- ✅ Diff tool for comparing local vs remote changes

## What's New in v0.0.1

Initial release with core functionality:
- Config management commands (`init`, `add`, `remove`, `list`, `test`)
- Page operations (`list`, `pull`, `push`)
- Local preview environment with Docker
- Database dump/restore operations
- Revision history and restore capabilities
- Full `--help` documentation for all commands

## Installation

Download the appropriate binary for your platform:
- **Linux (x64):** `elementor-cli-linux-x64.tar.gz`
- **macOS (Intel):** `elementor-cli-darwin-x64.tar.gz`
- **macOS (Apple Silicon):** `elementor-cli-darwin-arm64.tar.gz`

Extract and run:
```bash
tar xzf elementor-cli-*.tar.gz
./elementor-cli-* --help
```

## Quick Start

```bash
# Initialize configuration
elementor-cli config init

# List pages
elementor-cli pages list

# Pull a page
elementor-cli pull <page-id>
```

For full documentation, visit the [GitHub repository](https://github.com/YOUR_USERNAME/elementor-cli).
```

2. **Tag and push the release:**

```bash
git add RELEASE_NOTES.md
git commit -m "Add release notes for v0.0.1"
git tag v0.0.1
git push origin main
git push origin v0.0.1
```

The workflow will automatically build binaries for all platforms and create a published GitHub release using the content from `RELEASE_NOTES.md`.

---

## Future Enhancements

- [ ] Template library for common page structures
- [ ] Bulk operations (pull/push all pages)
- [ ] Watch mode for automatic sync
- [ ] Visual diff output (side-by-side)
- [ ] Plugin for VSCode/other editors
- [ ] Support for Elementor Pro widgets
- [ ] Export to static HTML
