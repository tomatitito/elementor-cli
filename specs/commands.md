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

## `elementor-cli users`

Read a minimal user inventory through the explicit site's reusable SSH or Compose
WP-CLI transport. There is no fallback to the default site and no REST fallback.

```bash
elementor-cli users list --site production
elementor-cli users list --site production --role administrator
elementor-cli users list --site recovery --json
elementor-cli users list --site production --include-email
elementor-cli users list --site production --json --output recovery/users.json
```

`--site <name>` is required. `--role <role>` accepts a WordPress role slug made of
lowercase letters, numbers, underscores, and hyphens. `--include-email` is the
only way to request or emit `user_email`. `--output <path>` always writes the same
stable JSON report, with mode `0600`; it can be combined with `--json` to also
print the report.

The WP-CLI invocation is read-only and fixed to `user list`, JSON format,
ascending ID ordering, and these fields:

- default: `ID,user_login,roles,user_registered`
- with `--include-email`: `ID,user_login,roles,user_registered,user_email`

The transport supplies `--skip-plugins --skip-themes`. There is intentionally no
passthrough field, query, format, order, or metadata option. Password hashes,
activation/reset keys, capabilities, session tokens, application-password data,
arbitrary metadata, and credentials are neither requested nor copied. Parsing is
strict: the top level must be an array, every row must have exactly the requested
fields, IDs must be positive safe integers, and control or bidirectional terminal
characters are rejected. Unexpected fields fail the operation rather than being
silently retained or redacted.

Human output is sorted by numeric ID and contains `ID`, `Username`, `Roles`, and
`Registered`, plus `Email` only after explicit opt-in. Roles are normalized and
sorted. JSON uses this schema and key order:

```json
{
  "schemaVersion": 1,
  "site": "production",
  "collectedAt": "2026-08-27T12:00:00.000Z",
  "users": [
    {
      "id": 1,
      "username": "site-admin",
      "roles": ["administrator"],
      "registeredAt": "2021-02-05 10:30:00"
    }
  ]
}
```

A successful empty result exits `0` and produces `users: []` or the explicit
human message `No users found.` Configuration, transport/connection, malformed or
unsafe upstream output, and local output-file failures exit `2`. Operational
errors never include upstream stdout/stderr, command arguments, transport
credentials, or field values.

---

## `elementor-cli deps`

Observe and deterministically reconcile WordPress core, plugins, and themes via
the site's reusable SSH or Compose WP-CLI transport. `--site` is deliberately
required even when a default site exists.

```bash
# Read-only observation; JSON includes core/locale, PHP, regular plugins/themes,
# activation and parent/child state, MU plugins, and drop-ins.
elementor-cli deps inventory --site production \
  --output recovery/production-inventory.json

# Show or apply an exact reconciliation plan.
elementor-cli deps install --site recovery \
  --manifest recovery/packages.json --dry-run
elementor-cli deps install --site recovery \
  --manifest recovery/packages.json

# Verify exact installed-state drift. --strict also reports unlisted packages.
elementor-cli deps verify --site recovery \
  --manifest recovery/packages.json --strict --json

# Read-only release discovery, composed across all categories.
elementor-cli deps check --site recovery --manifest recovery/packages.json
elementor-cli deps core check --site recovery --manifest recovery/packages.json
elementor-cli deps themes check --site recovery --manifest recovery/packages.json
elementor-cli deps plugins check --site recovery --manifest recovery/packages.json

# Phase 1: preview, then atomically update only packages.json.
elementor-cli deps update --all --manifest recovery/packages.json
elementor-cli deps update --all --manifest recovery/packages.json --write
elementor-cli deps themes update --all --manifest recovery/packages.json --write
elementor-cli deps plugins update elementor --version 4.2.3 \
  --manifest recovery/packages.json

# Phase 2: this is the only dependency command that mutates WordPress.
elementor-cli deps install --site recovery --manifest recovery/packages.json
```

### Release checks and manifest updates

`core`, `themes`, and `plugins` each expose `check` and `update`; aggregate
`deps check` and `deps update --all` compose those same category operations.
Checks collect read-only inventory and query trusted release metadata. Human and
schema-versioned JSON output deterministically report every dependency's current
(installed), desired (manifest), available, selected, source, policy, state,
status, and reason. Theme state distinguishes active child, inactive child,
parent, inactive, missing, and unmanaged themes. Core output also identifies the
latest eligible patch, minor, and major while preserving the manifest locale.

`update` is manifest-only. A named category update may use an exact `--version`;
category `--all` and aggregate `--all` resolve every already-managed entry under
its `updatePolicy`. Policies are `exact`, `patch`, `minor`, and `major`, with
`exact` as the default. Selection uses semantic ordering, preserves exact
prerelease identifiers, never opts a stable manifest into a prerelease, and never
silently crosses policy boundaries.

Only entries whose manifest source is `wordpress.org` are queried there. Custom
Git, vendor, and local-artifact entries are not guessed: without trusted update
metadata they are reported `unknown` and left unchanged. Unmanaged packages are
reported by checks but are never added by bulk updates.

Before a write, the complete deterministic proposal is shown. `--write` accepts
it in automation; a named `--version` is also explicit write intent. An
interactive terminal may confirm, defaulting to no. JSON and other non-interactive
calls never prompt and remain previews without explicit intent. All resolutions
must succeed before a same-directory atomic manifest replacement; partial update
is not supported. Locale, activation, source metadata, and unrelated package
entries are preserved. Run `deps install` separately to apply the new desired
versions to WordPress.

### Inventory review warning

Inventory output has `trust: "observation-only"`. It is not a manifest, allowlist,
source attestation, or security audit. It contains no configured credentials and
does not infer that files found on production are safe. Review package identity,
version, activation, and a fresh trusted source before creating `packages.json`.
MU plugins and drop-ins are clearly reported but are not automatically managed.

### `packages.json` version 1

All objects are strict and validated with Zod. Slugs and versions must be exact;
`latest`, ranges, duplicate slugs, unknown schema versions/fields, and non-empty
theme lists without exactly one active theme are rejected.

```json
{
  "schemaVersion": 1,
  "core": {
    "version": "6.9.4",
    "locale": "de_DE",
    "updatePolicy": "minor"
  },
  "plugins": [
    {
      "slug": "elementor",
      "version": "4.2.3",
      "active": true,
      "source": { "type": "wordpress.org" }
    },
    {
      "slug": "vendor-plugin",
      "version": "1.2.0",
      "active": false,
      "source": {
        "type": "vendor-url",
        "url": "https://vendor.example/plugin.zip",
        "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "reviewed": true
      }
    }
  ],
  "themes": []
}
```

Sources are one of:

- `{ "type": "wordpress.org" }`
- `vendor-url`: credential-free HTTPS URL, SHA-256, and `reviewed: true`
- `local-artifact`: project-relative ZIP path, SHA-256, and `reviewed: true`
- `git`: credential-free HTTPS repository, full 40-character reviewed commit,
  credential-free HTTPS artifact URL, SHA-256, and `reviewed: true`

Custom ZIPs are downloaded/read fresh, limited to 200 MiB, hash-checked locally,
streamed through the #66 transport, and hash-checked again on the WordPress host
before installation. Git metadata does not make a moving branch trusted: both the
full reviewed revision and immutable reviewed artifact hash are required. URLs
with credentials, query strings, fragments, or non-HTTPS schemes are rejected.

### Dependency integrity audit

`deps check` is release discovery: it asks whether trusted newer releases satisfy
manifest policy. `deps verify` compares installed versions, activation, locale,
and source metadata with desired manifest state. Neither inspects installed file
contents. Use the separate, strictly read-only integrity audit for that:

```bash
elementor-cli deps audit --site production
elementor-cli deps audit --site recovery --manifest recovery/packages.json
elementor-cli deps audit --site production --json --output audit.json
elementor-cli deps audit --site production --fail-on warning
```

The explicit site must have an SSH or Compose WP-CLI transport; URL/REST access is
not enough. A manifest is optional and contributes reviewed custom artifact/Git
provenance without being treated as proof that extracted files still match the
artifact. The audit normalizes the supported WordPress core/plugin checksum
commands, independently checks the official plugin file list for missing files,
and preserves added, missing, and modified files as separate findings. It also
reports unknown/custom sources and exact reference failures (HTTP 404, network
failure, or unsupported custom/theme checksums). Official theme checksums are not
currently published by the supported WP-CLI tooling, so themes are reported as
unavailable rather than falsely clean.

Every finding has severity, component, reason, evidence, trusted reference where
available, and remediation. Existing suspicious files are only hashed for
evidence; they are never loaded or executed. Uploads are traversed without
following symlinks, with a 100,000-entry safety limit, and executable extensions
or executable mode beneath uploads are critical. Regular plugins and themes
remain skipped while WP-CLI runs. No audit command installs, updates, deletes,
uploads, or changes the site, database, or manifest. It neither looks up
vulnerabilities nor infers them from package age.

Human and schema-versioned JSON contain the same evidence fields in deterministic
severity/component/package/path order. `--output` writes that JSON locally.
`--fail-on` accepts `info`, `warning`, `high`, or `critical` and defaults to
`high`. Exit `0` means no finding reached the threshold, exit `1` means one did,
and exit `2` is reserved for invalid configuration, connection failure, unsafe or
malformed tool output, and incomplete audit execution.

### Reconciliation and exits

Install prints its complete plan before changes, uses exact official versions or
the declared reviewed artifact, fails if that version/artifact is unavailable,
and runs the same check after applying the plan. A matching rerun is a no-op.
Unlisted regular packages are retained by default; `--prune` is the only mode
that removes them. No command copies package files from another site.

Human and `--json` output identify each mismatch with package, field, expected,
and actual values. Output excludes REST/SSH/Compose credentials and custom source
locations. Exit codes are stable: `0` match, `1` drift/install failure (including
a dry-run with a non-empty plan), and `2` invalid config/manifest, connection, or
operational error. This is alignment checking, not deep integrity analysis; use
`deps audit` for installed-file integrity.

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

# Push multiple pages
elementor-cli push 42 156

# Push with conflict check (default)
elementor-cli push <page-id>

# Force push (overwrite remote)
elementor-cli push <page-id> --force

# Push all modified pages
elementor-cli push --all

# Dry run - show what would change
elementor-cli push <page-id> --dry-run

# Create a backup revision before pushing
elementor-cli push <page-id> --revision

# Skip revision creation (overrides site config)
elementor-cli push <page-id> --no-revision

# Undo the last push by restoring the previous revision
elementor-cli push <page-id> --undo

# Preview what undo would restore
elementor-cli push <page-id> --undo --dry-run

# Skip CSS cache invalidation after push
elementor-cli push <page-id> --no-flush
```

### Revision Behavior

Revision creation before push is configurable:

| Priority | Source | Effect |
|----------|--------|--------|
| 1 (highest) | `--revision` flag | Always create backup |
| 2 | `--no-revision` flag | Never create backup |
| 3 (lowest) | Site config `createRevisions` | Per-site default (default: `false`) |

```yaml
# Example config for different environments
sites:
  staging:
    createRevisions: false  # Fast iteration
  production:
    createRevisions: true   # Always backup
```

When pushing to a site whose name contains "prod" without revision creation enabled, the CLI will warn and prompt for confirmation.

### Safety Features

1. Compare remote `modified_date` vs local `remote_modified`
2. If remote is newer, warn and require `--force`
3. Optionally create revision before push (configurable per-site or via flags)

### CSS Cache Invalidation

After a successful push, the CLI automatically:
1. Invalidates CSS via the REST API for each pushed page
2. If the site has a `container` config, also runs `wp elementor flush-css` inside the container

Use `--no-flush` to skip this behavior.

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
This page command is unrelated to `elementor-cli deps audit`, which inspects
WordPress dependency files and uploads through WP-CLI.

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

Search and replace text in Elementor page data. Supports both remote (database) and local (file) modes.

```bash
# Replace in a specific page (remote)
elementor-cli search-replace <search> <replace> -p <page-id>

# Preview changes without applying (dry run)
elementor-cli search-replace <search> <replace> -p <page-id> --dry-run

# Apply to all Elementor pages (remote)
elementor-cli search-replace <search> <replace> --all-pages

# Output as JSON
elementor-cli search-replace <search> <replace> -p <page-id> --json

# Search and replace in local files instead of remote
elementor-cli search-replace <search> <replace> -p <page-id> --local

# Local mode with all pages
elementor-cli search-replace <search> <replace> --all-pages --local --dry-run
```

### Use cases

- Fix URL port mismatches after migration
- Update domain names when moving environments
- Replace asset URLs with CDN URLs
- Fix protocol (http to https)
- Edit downloaded pages locally before pushing

### Modes

| Mode | Flag | Target | CSS invalidation |
|------|------|--------|------------------|
| Remote | (default) | WordPress database via REST API | Automatic |
| Local | `--local` | Files in `.elementor-cli/pages/` | None (push separately) |

### Notes

- By default, changes are made directly to the remote WordPress database
- Use `--local` to edit downloaded pages in `.elementor-cli/pages/`
- CSS cache is automatically invalidated after remote changes
- Use `--dry-run` to preview changes before applying
- After local changes, run `elementor-cli push` to upload

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

---

## `elementor-cli preview element`

Fetch a specific element by ID from local page files.

```bash
# Fetch element by ID
elementor-cli preview element <page-id> <element-id>

# Show element path in the tree
elementor-cli preview element <page-id> <element-id> --path
```

### Example

```bash
$ elementor-cli preview element 42 abc123 --path
Path: container[0] > widget[2](heading)

{
  "id": "abc123",
  "elType": "widget",
  "widgetType": "heading",
  "settings": {
    "title": "Welcome",
    "size": "large"
  }
}
```

### Use cases

- Inspect a specific element's settings without navigating the full JSON
- Debug element configurations during local preview
- Extract element data for reuse or comparison

---

## `elementor-cli templates`

Manage page templates (built-in and custom).

```bash
# List all templates (built-in + custom)
elementor-cli templates list

# Save an existing page as a reusable template
elementor-cli templates save <page-id> <template-name> [--site <name>] [--description "..."]

# Import template from HTML file
elementor-cli templates import-html <html-file> <template-name> [--description "..."]

# Show template details
elementor-cli templates info <template-name>

# Preview template in browser
elementor-cli templates preview <template-name>

# Delete a custom template
elementor-cli templates delete <template-name>

# Export a template to JSON file
elementor-cli templates export <template-name> [--output <file>]
```

### Template Storage

Templates are stored in two locations:

| Location | Purpose |
|----------|---------|
| `~/.elementor-cli/templates/` | Global templates (shared across projects) |
| `.elementor-cli/templates/` | Project-local templates (project-specific) |

Project-local templates take precedence over global templates with the same name.

### Template File Format

```json
{
  "name": "My Custom Template",
  "description": "Custom template description",
  "elements": [...],
  "settings": {...},
  "source": "page",
  "sourceId": 42,
  "created_at": "2024-01-27T12:00:00Z"
}
```

### `templates save`

Save an existing page as a reusable template:

```bash
# Save page 42 as "homepage-layout"
elementor-cli templates save 42 homepage-layout

# Save with description
elementor-cli templates save 42 homepage-layout --description "Full homepage with hero and features"

# Save from specific site
elementor-cli templates save 42 homepage-layout --site production
```

The command:
1. Fetches the page from remote (or uses local if already pulled)
2. Extracts Elementor elements and page settings
3. Stores as template JSON in `.elementor-cli/templates/<template-name>.json`

### `templates import-html`

Create a template from an HTML file:

```bash
# Import HTML as template
elementor-cli templates import-html landing.html my-landing

# Import with description
elementor-cli templates import-html landing.html my-landing --description "Converted from static HTML"
```

HTML elements are converted to Elementor widgets:
- `<h1>`-`<h6>` → `heading` widget
- `<p>`, `<div>` with text → `text-editor` widget
- `<img>` → `image` widget
- `<a>` with button classes → `button` widget
- `<section>`, `<div>` → `container` element

### `templates preview`

Preview a template rendered in the browser:

```bash
# Preview a template
elementor-cli templates preview my-landing

# Preview on custom port
elementor-cli templates preview my-landing --port 3001

# Don't open browser automatically
elementor-cli templates preview my-landing --no-open
```

The command:
1. Starts a local HTTP server
2. Renders the template elements as static HTML with basic Elementor-like styling
3. Opens the preview in the default browser
4. Press Ctrl+C to stop the server

**Note:** This is a simplified preview. For full Elementor rendering with all widgets and styling, sync the template to staging first.

### Using Templates

Create pages with templates:

```bash
# Create page with built-in template
elementor-cli pages create "Home" --template hero-section

# Create page with custom template
elementor-cli pages create "Home" --template my-landing

# List available templates
elementor-cli templates list
```

**Output Example:**
```
Templates:

Built-in:
  blank                 Empty page with no content
  hero-section          Full-width hero with heading, text, and CTA button
  two-column            Two-column layout with image and text
  three-column-features Three-column grid for showcasing features
  contact-form          Contact information section
  landing-page          Full landing page with hero, features, and CTA

Custom (project):
  homepage-layout       Full homepage with hero and features [from page 42]
  my-landing            Converted from static HTML

Custom (global):
  company-footer        Standard company footer section
```

---

## `elementor-cli update`

Check for updates and install the latest version.

```bash
# Install latest version
elementor-cli update

# Check for updates without installing
elementor-cli update --check

# Install a specific version
elementor-cli update --version v0.3.0
```

### How it works

1. Fetches latest release info from GitHub Releases API
2. Compares current version with latest
3. Downloads the appropriate binary for your platform
4. Extracts and installs to `~/.local/bin/elementor-cli`
5. Shows release notes after successful update

### Supported platforms

| OS | Architecture | Binary name |
|----|--------------|-------------|
| macOS | Intel | elementor-cli-darwin-x64 |
| macOS | Apple Silicon | elementor-cli-darwin-arm64 |
| Linux | x86_64 | elementor-cli-linux-x64 |
| Linux | ARM64 | elementor-cli-linux-arm64 |

**Note:** Make sure `~/.local/bin` is in your PATH.
