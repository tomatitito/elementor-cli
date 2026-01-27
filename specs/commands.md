# Commands

Full specification of all `elementor-cli` commands.

---

## `elementor-cli config`

Manage site connections and settings.

```bash
# Initialize config file interactively
elementor-cli config init

# Add a new site connection
elementor-cli config add <name>
  --url <wordpress-url>
  --username <admin-username>
  --app-password <application-password>

# List configured sites
elementor-cli config list

# Remove a site
elementor-cli config remove <name>

# Set default site
elementor-cli config use <name>

# Set a config value
elementor-cli config set <key> <value>

# Test connection
elementor-cli config test [name]
```

---

## `elementor-cli pages`

List and manage pages.

```bash
# List all Elementor pages on remote site
elementor-cli pages list [--site <name>] [--status draft|publish|all]

# Show page details
elementor-cli pages info <page-id> [--site <name>]

# Create a new page
elementor-cli pages create <title> [--template <template-name>] [--site <name>]

# Delete a page
elementor-cli pages delete <page-id> [--site <name>] [--force]
```

**Output Example:**
```
ID      Title                Status    Modified
─────────────────────────────────────────────────
42      Home                 publish   2024-01-15
156     About Us             publish   2024-01-10
203     Contact (draft)      draft     2024-01-20
```

---

## `elementor-cli pull`

Download pages from remote site.

```bash
# Pull a specific page
elementor-cli pull <page-id> [--site <name>]

# Pull multiple pages
elementor-cli pull 42 156 203

# Pull all pages
elementor-cli pull --all [--site <name>]

# Pull and overwrite local changes
elementor-cli pull <page-id> --force
```

### Local Storage

Pages are stored in `.elementor-cli/pages/<site>/<page-id>/`:

```
.elementor-cli/pages/production/42/
├── page.json           # Full page data
├── elements.json       # Just _elementor_data (for editing)
├── settings.json       # Page settings
├── meta.json           # WP post metadata (title, slug, status)
└── .pulled_at          # Timestamp of last pull
```

### page.json Structure

```json
{
  "id": 42,
  "title": "Home",
  "slug": "home",
  "status": "publish",
  "elementor_data": [...],
  "page_settings": {...},
  "pulled_at": "2024-01-27T12:00:00Z",
  "remote_modified": "2024-01-15T10:30:00Z"
}
```

---

## `elementor-cli push`

Upload local changes to remote site.

```bash
# Push a specific page
elementor-cli push <page-id> [--site <name>]

# Push with conflict check (default)
elementor-cli push <page-id>

# Force push (overwrite remote)
elementor-cli push <page-id> --force

# Push all modified pages
elementor-cli push --all

# Dry run - show what would change
elementor-cli push <page-id> --dry-run
```

### Safety Features

1. Compare remote `modified_date` vs local `remote_modified`
2. If remote is newer, warn and require `--force`
3. Create revision before push (for rollback)

---

## `elementor-cli preview`

Local staging environment for previewing changes. Supports existing Docker setups.

```bash
# Initialize a new staging environment (scaffolds docker-compose.yml)
elementor-cli preview init [--path <directory>]

# Start staging environment (docker compose up -d)
elementor-cli preview start [--compose-file <path>]

# Stop staging environment (docker compose down)
elementor-cli preview stop [--compose-file <path>]

# Show staging status (container status, URL)
elementor-cli preview status

# Sync local page changes to staging WordPress
elementor-cli preview sync <page-id> [--compose-file <path>]

# Sync all locally modified pages
elementor-cli preview sync --all

# Open staging in browser
elementor-cli preview open [page-id]
```

### Flag Precedence

`--compose-file` flag > `staging.path` in config > auto-detect

### Using Existing Docker Setup

Configure the path in `.elementor-cli.yaml`:

```yaml
staging:
  path: ./docker              # Your existing docker-compose location
  service: wordpress          # Name of WordPress service in compose file
  url: http://localhost:8080  # URL to access staging
```

The CLI will:
1. Run `docker compose` commands in the configured path
2. Execute WP-CLI via `docker compose exec <service> wp ...`

### `preview init`

Creates a new Docker Compose setup if you don't have one:

```bash
# Create in default location (.elementor-cli/staging/)
elementor-cli preview init

# Create in custom location
elementor-cli preview init --path ./my-docker
```

**Generated docker-compose.yml:**

```yaml
services:
  wordpress:
    image: wordpress:latest
    ports:
      - "8080:80"
    environment:
      WORDPRESS_DB_HOST: db
      WORDPRESS_DB_USER: wordpress
      WORDPRESS_DB_PASSWORD: wordpress
      WORDPRESS_DB_NAME: wordpress
    volumes:
      - wordpress_data:/var/www/html
    depends_on:
      - db

  db:
    image: mysql:8.0
    environment:
      MYSQL_DATABASE: wordpress
      MYSQL_USER: wordpress
      MYSQL_PASSWORD: wordpress
      MYSQL_ROOT_PASSWORD: rootpassword
    volumes:
      - db_data:/var/lib/mysql

volumes:
  wordpress_data:
  db_data:
```

### Sync Mechanism

The `preview sync` command:
1. Reads local page data from `<pagesDir>/<site>/<page-id>/`
2. Runs `docker compose exec <service> wp ...` to:
   - Create/update post: `wp post update <id> --post_title=...`
   - Update Elementor data: `wp post meta update <id> _elementor_data '<json>'`
   - Update page settings: `wp post meta update <id> _elementor_page_settings '<json>'`
3. Clears cache: `wp elementor flush-css`

---

## `elementor-cli db`

Database backup and restore operations.

```bash
# Create a database dump from staging environment
elementor-cli db dump [--output <file>] [--compose-file <path>]

# Create a database dump from remote site (requires SSH access)
elementor-cli db dump --site <name> --ssh <user@host> [--output <file>]

# Restore a database dump to staging
elementor-cli db restore <file> [--compose-file <path>]

# List available dumps
elementor-cli db list
```

### Storage

- **Default location:** `.elementor-cli/dumps/`
- **Filename format:** `<site>-<timestamp>.sql` (e.g., `staging-2024-01-27-143052.sql`)

### Example

```bash
# Backup staging before making changes
elementor-cli db dump
# Output: Created dump: .elementor-cli/dumps/staging-2024-01-27-143052.sql

# Restore if something goes wrong
elementor-cli db restore .elementor-cli/dumps/staging-2024-01-27-143052.sql
```

### Mechanism

- For staging: Uses `docker compose exec <service> wp db export -`
- For remote (with SSH): Uses `ssh <host> "wp db export -"`

---

## `elementor-cli revisions`

View and restore page backups/revisions.

```bash
# List revisions for a page
elementor-cli revisions list <page-id> [--site <name>]

# Show revision details
elementor-cli revisions show <page-id> <revision-id>

# Compare revision to current
elementor-cli revisions diff <page-id> <revision-id>

# Restore a revision
elementor-cli revisions restore <page-id> <revision-id> [--site <name>]

# Create a manual backup (revision)
elementor-cli revisions create <page-id> [--message "backup note"]
```

**Output Example:**
```
Revision  Date                 Author    Note
──────────────────────────────────────────────────
rev_15    2024-01-20 14:30    admin     Autosave
rev_14    2024-01-18 09:15    admin     Updated hero section
rev_13    2024-01-15 16:45    editor    Initial layout
```

---

## `elementor-cli diff`

Compare local changes with remote.

```bash
# Show diff for a page
elementor-cli diff <page-id> [--site <name>]

# JSON diff output
elementor-cli diff <page-id> --format json

# Summary only
elementor-cli diff <page-id> --summary
```

**Output Example:**
```diff
Page: Home (ID: 42)

Settings:
  - background_color: "#ffffff" → "#f5f5f5"

Elements:
  + Added: widget[heading] in section[abc123]
  ~ Modified: widget[button] settings.text: "Learn More" → "Get Started"
  - Removed: widget[image] from section[def456]
```
