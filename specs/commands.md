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
elementor-cli pages list [--site <name>] [--status publish|draft|private|all]

# Show page details
elementor-cli pages info <page-id> [--site <name>]

# Create a new page
elementor-cli pages create <title> [--status draft|publish] [--site <name>]

# Create a page with a WordPress page template
elementor-cli pages create <title> --page-template elementor_canvas

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
├── meta.json           # WP post metadata (title, slug, status, template)
└── .pulled_at          # Timestamp of last pull
```

### page.json Structure

```json
{
  "id": 42,
  "title": "Home",
  "slug": "home",
  "status": "publish",
  "template": "elementor_canvas",
  "elementor_data": [...],
  "page_settings": {...},
  "pulled_at": "2024-01-27T12:00:00Z",
  "remote_modified": "2024-01-15T10:30:00Z"
}
```

### WordPress Page Templates

The `template` field stores the WordPress page template. Common values:
- `default` - Theme default template
- `elementor_canvas` - Full-width, no header/footer
- `elementor_header_footer` - Elementor content with theme header/footer

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

Database backup and restore operations for the local staging environment.

```bash
# Create a database dump from staging environment
elementor-cli db dump [--compose-file <path>]

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

Uses Docker to execute WP-CLI commands:
- Dump: `docker compose exec <service> wp db export -`
- Restore: Pipes SQL file to MySQL container

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

---

## `elementor-cli regenerate-css`

Invalidate Elementor CSS cache to force regeneration.

```bash
# Regenerate CSS for a single page
elementor-cli regenerate-css <page-id> [--site <name>]

# Regenerate CSS for multiple pages
elementor-cli regenerate-css 42 156 203
```

### How it works

- Invalidates the `_elementor_css` post meta
- Forces Elementor to rebuild CSS on next page load
- Useful after URL changes or manual data edits

---

## `elementor-cli audit`

Detect URL mismatches, missing assets, and CSS issues in a page.

```bash
# Audit a page
elementor-cli audit <page-id> [--site <name>]

# Also verify assets are accessible
elementor-cli audit <page-id> --check-assets

# Output as JSON
elementor-cli audit <page-id> --json
```

### What it checks

- **URL mismatches:** URLs pointing to wrong domain/port
- **Missing assets:** Images/files that return 404 (with `--check-assets`)
- **CSS status:** Whether Elementor CSS cache is stale

**Output Example:**
```
Audit: Home (ID: 42)

⚠ URL mismatches found:

  widget[image].image.url:
    localhost:8081 (expected: localhost:8080)
    http://localhost:8081/wp-content/uploads/image.jpg

✓ All 5 assets accessible

⚠ CSS may be stale (data updated after CSS generation)
  CSS generated: 2024-01-20T10:00:00Z
  Data modified: 2024-01-22T14:30:00Z

Found 1 issue(s) + stale CSS
```

---

## `elementor-cli search-replace`

Search and replace text in Elementor page data.

```bash
# Replace in a specific page
elementor-cli search-replace <search> <replace> -p <page-id>

# Preview changes without applying (dry run)
elementor-cli search-replace <search> <replace> -p <page-id> --dry-run

# Apply to all Elementor pages
elementor-cli search-replace <search> <replace> --all-pages

# Output as JSON
elementor-cli search-replace <search> <replace> -p <page-id> --json
```

### Use cases

- Fix URL port mismatches after migration
- Update domain names when moving environments
- Replace asset URLs with CDN URLs
- Fix protocol (http to https)

### Notes

- Changes are made directly to the remote WordPress database
- CSS cache is automatically invalidated after changes
- Use `--dry-run` to preview changes before applying

**Example:**
```bash
$ elementor-cli search-replace "staging.example.com" "example.com" --all-pages --dry-run

Dry Run Results
Search:  staging.example.com
Replace: example.com

Page 42: Home
  Elementor data: 3 match(es)
  Page settings: 1 match(es)

Would replace 4 occurrence(s) in 1 page(s)
Run without --dry-run to apply changes.
```

---

## `elementor-cli status`

Show CSS metadata, generation timestamps, and URL analysis for a page.

```bash
# Show status for a page
elementor-cli status <page-id> [--site <name>]

# Output as JSON
elementor-cli status <page-id> --json
```

### What it shows

- CSS cache status (generated, stale, or missing)
- CSS generation timestamp
- Page data modification timestamp
- URL analysis (matching and mismatching URLs)

**Output Example:**
```
Page 42: "Home"

CSS Status:
  Status: file
  Generated: 2024-01-20 10:00:00 (3 days ago)

Data Status:
  Last modified: 2024-01-22 14:30:00 (1 day ago)
  Elements: 25
  ⚠ CSS may be stale (data is newer than CSS)

URL Analysis:
  Site URL: https://example.com
  Found URLs:
    - example.com (15 occurrences) ✓
    - cdn.example.com (3 occurrences) ⚠ mismatch

Recommendations:
  • Run 'elementor-cli regenerate-css 42' to refresh CSS
  • Run 'elementor-cli audit 42' to see URL details
```

---

## `elementor-cli studio`

Start the web-based Studio UI for side-by-side page editing.

```bash
# Start Studio on default port (3000)
elementor-cli studio

# Use custom port
elementor-cli studio --port 8000

# Use specific site config
elementor-cli studio --site production

# Don't open browser automatically
elementor-cli studio --no-open
```

### Features

- Side-by-side view of production and staging
- Quick sync, pull, and push operations
- CSS regeneration controls
- Real-time staging status monitoring

### Prerequisites

- Configure a site: `elementor-cli config add`
- For staging preview: `elementor-cli preview start`

---

## `elementor-cli export`

Export page as Elementor-compatible JSON template.

```bash
# Export page to file (default: <page-slug>.json)
elementor-cli export <page-id> [--site <name>]

# Save to specific file
elementor-cli export <page-id> -o my-template.json

# Copy to clipboard
elementor-cli export <page-id> --clipboard

# Export from local storage instead of remote
elementor-cli export <page-id> --local

# Export raw elements only (no template wrapper)
elementor-cli export <page-id> --raw
```

### Export formats

- **Default:** Elementor template format (importable via Templates > Import)
- **Raw:** Just the elements array (for manual editing or API use)

### Importing the template

1. Go to Templates > Saved Templates in WordPress
2. Click Import Templates
3. Select the exported JSON file

---

## `elementor-cli export-html`

Export page as static HTML.

```bash
# Export page to HTML file
elementor-cli export-html <page-id>

# Specify output file
elementor-cli export-html <page-id> -o homepage.html

# Download and include CSS/JS assets locally
elementor-cli export-html <page-id> --include-assets

# Replace staging URLs with custom base URL
elementor-cli export-html <page-id> --base-url https://example.com
```

### Requirements

- Staging environment must be running
- Page must be synced to staging first

### Use cases

- Create static backups of pages
- Generate HTML for non-WordPress hosting
- Offline previews

---

## `elementor-cli preview watch`

Watch for local changes and auto-sync to staging.

```bash
# Watch and sync all changes
elementor-cli preview watch

# Watch specific site pages
elementor-cli preview watch --site production

# Disable URL rewriting
elementor-cli preview watch --no-rewrite-urls
```

### How it works

1. Watches `.elementor-cli/pages/<site>/` for file changes
2. Automatically syncs modified pages to staging
3. Rewrites URLs from production to staging (unless `--no-rewrite-urls`)
4. Press Ctrl+C to stop watching
