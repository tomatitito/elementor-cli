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
