# elementor-cli

A command-line tool for managing Elementor pages programmatically. Edit pages as JSON, version control with git, and deploy changes without using the visual editor.

## Features

- **Pull/Push** - Download pages as JSON, edit locally, push changes back
- **Version Control** - Track page changes with git (JSON diffs instead of visual)
- **Local Preview** - Docker-based staging environment to test before deployment
- **Database Management** - Backup and restore WordPress databases
- **Diff Comparison** - Compare local changes with remote pages
- **Multi-site Support** - Manage multiple WordPress installations

## Requirements

- [Bun](https://bun.sh) runtime
- WordPress 5.6+ with Application Passwords enabled
- Docker & Docker Compose (for local preview feature)

## Installation

```bash
# Clone repository
git clone https://github.com/your-org/elementor-cli.git
cd elementor-cli

# Install dependencies
bun install

# Build executable
bun build src/index.ts --outfile dist/elementor-cli --target bun
chmod +x dist/elementor-cli
```

## Quick Start

```bash
# Initialize configuration
elementor-cli config init

# Add WordPress site
elementor-cli config add production \
  --url https://example.com \
  --username admin \
  --app-password "xxxx xxxx xxxx xxxx"

# Test connection
elementor-cli config test

# List pages
elementor-cli pages list

# Pull a page
elementor-cli pull 42

# Edit locally
code .elementor-cli/pages/production/42/elements.json

# Push changes
elementor-cli push 42
```

## Commands

| Command | Description |
|---------|-------------|
| `config init\|add\|list\|remove\|test` | Manage site connections |
| `pages list\|info\|create\|delete` | List and manage pages |
| `pull [page-ids]` | Download pages from remote |
| `push [page-ids]` | Upload changes to remote |
| `diff <page-id>` | Compare local vs remote |
| `preview init\|start\|stop\|sync\|open` | Local staging environment |
| `db dump\|restore\|list` | Database backup/restore |
| `revisions list\|show\|restore\|create` | Manage page history |
| `deps inventory\|check\|update\|verify\|install` | Review, select, and reconcile WordPress packages |
| `users list --site <name>` | Safely list users through WP-CLI |

Use `--help` with any command for detailed options:

```bash
elementor-cli --help
elementor-cli config --help
elementor-cli pull --help
```

## Configuration

Configuration is stored in `.elementor-cli.yaml`:

```yaml
defaultSite: production

sites:
  production:
    url: https://my-site.com
    username: admin
    appPassword: "xxxx xxxx xxxx xxxx"
    wpCli:
      type: ssh
      host: deploy@example.com
      path: /var/www/example/current

  recovery:
    url: http://localhost:8082
    wpCli:
      type: compose
      composeFile: docker/docker-compose.recovery.yml
      envFile: recovery/.env
      projectName: example-recovery
      service: wpcli
      mode: run
      runtime: docker

staging:
  path: .elementor-cli/staging
  service: wordpress
  url: http://localhost:8080

pagesDir: .elementor-cli/pages
```

Sites may configure REST credentials, `wpCli`, or both. SSH transports run `wp`
at the configured absolute WordPress path and enforce SSH host-key verification.
Compose paths are resolved from the project root and must remain within it.
Compose supports Docker or Podman, custom Compose/environment files, an optional
project name, and either one-shot `run --rm` or existing-service `exec` mode.
See [the configuration reference](specs/configuration.md#wp-cli-transports) for
the complete field and security details.

## Safe User Listing

User inventory always requires an explicit site and uses that site's configured
SSH or Compose WP-CLI transport:

```bash
elementor-cli users list --site production
elementor-cli users list --site production --role administrator
elementor-cli users list --site recovery --json
elementor-cli users list --site production --include-email
elementor-cli users list --site production --json --output users.json
```

Default human and JSON output contain only numeric ID, login, sorted roles, and
the WordPress registration timestamp. Email is personal data and is added only by
`--include-email`. The command has no field-selection option: its WP-CLI request
uses a fixed allowlist, skips regular plugins and themes, and rejects malformed or
unexpected response fields. It never requests or emits password hashes,
activation/reset keys, sessions, application passwords, arbitrary user metadata,
or configured connection credentials.

Results are sorted by numeric ID. JSON is schema version 1 and has stable keys:
`schemaVersion`, `site`, `collectedAt`, and `users`. `--output` writes this JSON
with private file permissions; it does not imply `--include-email`. A successful
empty list exits `0` and contains `users: []` (or `No users found.` in human
output). Configuration, connection, unsafe-response, and file errors exit `2`
with secret-free diagnostics.

## Dependency Manifests

Dependency commands use the configured WP-CLI transport and always require an
explicit site. Inventory is read-only and can be captured for review:

```bash
elementor-cli deps inventory --site production \
  --output recovery/production-inventory.json
```

> **Inventory is only an observation.** It is not an allowlist, does not identify
> trustworthy sources, and must not be renamed to `packages.json` without review.
> Review every package, version, activation choice, and source before committing a
> manifest.

A version 1 `packages.json` pins WordPress core, locale, regular plugins, themes,
activation state, and an explicit source:

```json
{
  "schemaVersion": 1,
  "core": { "version": "6.9.4", "locale": "de_DE", "updatePolicy": "minor" },
  "plugins": [
    {
      "slug": "elementor",
      "version": "4.2.3",
      "active": true,
      "source": { "type": "wordpress.org" }
    }
  ],
  "themes": [
    {
      "slug": "hello-elementor",
      "version": "3.4.9",
      "active": true,
      "source": { "type": "wordpress.org" }
    }
  ]
}
```

Use a two-phase update workflow: first review trusted release metadata and update
only `packages.json`, then explicitly install that desired state into WordPress:

```bash
# Read-only checks (aggregate or category-specific)
elementor-cli deps check --site recovery --manifest recovery/packages.json
elementor-cli deps core check --site recovery --manifest recovery/packages.json
elementor-cli deps themes check --site recovery --manifest recovery/packages.json
elementor-cli deps plugins check --site recovery --manifest recovery/packages.json

# Read-only installed-file integrity (manifest provenance is optional)
elementor-cli deps audit --site recovery --manifest recovery/packages.json
elementor-cli deps audit --site recovery --json --output recovery/audit.json
elementor-cli deps audit --site recovery --fail-on warning

# Preview policy-selected changes; no manifest or WordPress mutation
elementor-cli deps update --all --manifest recovery/packages.json

# Explicitly write all managed policy-eligible versions to the manifest only
elementor-cli deps update --all --manifest recovery/packages.json --write
elementor-cli deps themes update --all --manifest recovery/packages.json --write
elementor-cli deps plugins update elementor --version 4.2.3 \
  --manifest recovery/packages.json
elementor-cli deps core update --minor --manifest recovery/packages.json --write

# Only install mutates WordPress
elementor-cli deps install --site recovery --manifest recovery/packages.json --dry-run
elementor-cli deps install --site recovery --manifest recovery/packages.json
elementor-cli deps verify --site recovery --manifest recovery/packages.json --strict --json
```

`check` commands require a site and report installed, desired, available, policy,
source, and state. Category and aggregate `update` commands never contact or
mutate WordPress unless optional `--site` context is requested; even then it is
inventory-only. Bulk updates include only manifest-managed dependencies. Custom
and vendor packages without trusted update metadata remain unchanged with status
`unknown`; only entries explicitly sourced from WordPress.org use its APIs.
Automatic writes require `--write` or interactive confirmation; `--version` is
itself explicit write intent. Non-interactive calls without that intent are safe
previews and never prompt.

`deps check` discovers releases and evaluates manifest update policy; it does not
inspect files. `deps audit` instead compares installed core/plugin files with
published checksums, reports added/missing/modified files separately, identifies
unknown/custom or unsupported checksum sources, and flags executable files under
uploads as critical. Its optional manifest supplies reviewed custom source
provenance, not a claim that extracted files match an artifact ZIP. Theme
checksums are explicitly reported unavailable because the supported official
WP-CLI tooling does not publish them. Audit is read-only, skips regular plugins
and themes, does not execute discovered files, and performs no vulnerability or
"outdated means vulnerable" inference. `--fail-on` controls exits: `0` below
threshold, `1` at/above threshold, and `2` for configuration, connection, or
incomplete execution errors.

The top-level `elementor-cli audit <page-id>` is different again: it audits one
Elementor page's URLs, assets, and generated CSS, not dependency integrity.

Each core, plugin, or theme entry may set `updatePolicy` to `exact`, `patch`,
`minor`, or `major` (`exact` is the safe default). Policy selection does not move
a stable version onto a prerelease or silently cross a configured boundary.
Prerelease strings and the core locale are preserved exactly.

Install downloads the manifest's declared exact version, prints its plan first, and checks
the result. It never copies packages from production and leaves unlisted packages
in place unless `--prune` is explicitly supplied. Reviewed custom ZIP sources can
use an HTTPS vendor URL, a project-relative local artifact, or a Git repository +
full commit and HTTPS artifact URL; every custom source requires `reviewed: true`
and a lowercase SHA-256 hash. See [the command specification](specs/commands.md#elementor-cli-deps)
for schemas, security constraints, JSON output, and exit codes.

### Generating Application Passwords

1. Log into WordPress admin
2. Go to Users → Your Profile
3. Scroll to "Application Passwords"
4. Enter a name (e.g., "elementor-cli")
5. Click "Add New Application Password"
6. Copy the generated password (include spaces)

## Local Storage Structure

```
.elementor-cli/
├── pages/
│   └── production/
│       └── 42/
│           ├── page.json       # Full page snapshot
│           ├── elements.json   # Editable element tree
│           ├── settings.json   # Page settings
│           └── meta.json       # Title, slug, status
├── dumps/                      # Database backups
└── staging/                    # Docker setup
```

## Local Preview

Test changes locally before pushing:

```bash
# Initialize Docker environment
elementor-cli preview init

# Start staging
elementor-cli preview start

# Sync local page to staging
elementor-cli preview sync 42

# Open in browser
elementor-cli preview open 42

# Stop when done
elementor-cli preview stop
```

## .gitignore Recommendations

```gitignore
# Credentials (NEVER commit)
.elementor-cli.yaml

# Optional: Database dumps
.elementor-cli/dumps/

# Optional: Docker staging
.elementor-cli/staging/
```

## Development

```bash
# Run in development
bun run src/index.ts

# Watch mode
bun --watch run src/index.ts

# Run non-E2E tests
bun run test

# Type check
tsc --noEmit

# Format code
bun run biome format --write .
```

## Documentation

Detailed documentation is available in the `/specs` directory:

- [commands.md](specs/commands.md) - Command reference with examples
- [configuration.md](specs/configuration.md) - Config format and storage
- [api.md](specs/api.md) - WordPress REST API details
- [elementor-json.md](specs/elementor-json.md) - Guide to editing Elementor JSON

## License

MIT
