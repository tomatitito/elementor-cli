# elementor-cli Specification

A CLI tool for managing Elementor pages programmatically. Download, edit, preview, and push pages without using the Elementor visual editor.

---

## Features

- **Pull/Push** - Download pages as JSON, edit locally, push changes back
- **Local Preview** - Docker-based staging environment for testing changes
- **Revisions** - View history and restore previous versions
- **Database Backup** - Dump and restore WordPress database
- **Diff** - Compare local changes with remote

---

## Documentation

| Document | Description |
|----------|-------------|
| [Commands](./commands.md) | All CLI commands with options and examples |
| [Configuration](./configuration.md) | Config file format and local file structure |
| [Elementor JSON](./elementor-json.md) | How to edit Elementor page data |
| [WordPress API](./api.md) | REST API endpoints and authentication |
| [Project Structure](./structure.md) | Source code organization and file layout |

---

## Quick Start

```bash
# 1. Initialize project config
elementor-cli config init

# 2. Add your WordPress site (interactive prompts or flags)
elementor-cli config add production \
  --url https://example.com \
  --username admin \
  --app-password "xxxx xxxx xxxx xxxx xxxx xxxx"

# 3. Test connection
elementor-cli config test

# 4. List pages
elementor-cli pages list

# 5. Pull a page to edit
elementor-cli pull 42

# 6. Edit the JSON
code .elementor-cli/pages/production/42/elements.json

# 7. Preview locally
elementor-cli preview start
elementor-cli preview sync 42
elementor-cli preview open 42

# 8. Push to production
elementor-cli push 42
```

---

## Command Overview

| Command | Description |
|---------|-------------|
| `config` | Manage site connections and settings |
| `pages` | List, create, delete pages |
| `pull` | Download pages from remote |
| `push` | Upload local changes to remote |
| `preview` | Local Docker staging environment |
| `db` | Database dump and restore |
| `revisions` | View and restore page history |
| `diff` | Compare local vs remote changes |
| `regenerate-css` | Invalidate Elementor CSS cache |
| `audit` | Detect URL mismatches, missing assets, CSS issues |
| `search-replace` | Search and replace text in Elementor data |
| `status` | Show CSS metadata and URL analysis |
| `studio` | Web UI for side-by-side page editing |
| `export` | Export page as Elementor JSON template |
| `export-html` | Export page as static HTML |
| `templates` | Manage page templates (save, import, preview) |
