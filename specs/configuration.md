# Configuration

Configuration file format and local file structure for `elementor-cli`.

---

## Config File

**Location:** `.elementor-cli.yaml` (project root)

**Important:** Add to `.gitignore` - this file contains credentials.

### Full Example

```yaml
# Default site for commands when --site is not specified
defaultSite: production

# Remote WordPress sites
sites:
  production:
    url: https://my-friends-site.de
    username: admin
    appPassword: xxxx xxxx xxxx xxxx xxxx xxxx

  staging-remote:
    url: https://staging.my-friends-site.de
    username: admin
    appPassword: yyyy yyyy yyyy yyyy yyyy yyyy

# Local staging environment configuration
staging:
  # Path to docker-compose.yml (relative to project root)
  path: ./docker

  # WordPress service name in docker-compose.yml
  service: wordpress

  # Local staging URL
  url: http://localhost:8080

# Local pages storage directory
pagesDir: .elementor-cli/pages
```

### Site Configuration

Each site requires:

| Field | Required | Description |
|-------|----------|-------------|
| `url` | Yes | WordPress site URL (must be HTTPS) |
| `username` | Yes | WordPress admin username |
| `appPassword` | Yes | Application Password (generate in WordPress admin) |

### Staging Configuration

| Field | Default | Description |
|-------|---------|-------------|
| `path` | `.elementor-cli/staging` | Path to docker-compose.yml |
| `service` | `wordpress` | WordPress service name in compose file |
| `url` | `http://localhost:8080` | Local staging URL |

### Generating Application Passwords

1. Log into WordPress admin
2. Go to **Users → Profile**
3. Scroll to **Application Passwords**
4. Enter a name (e.g., "elementor-cli")
5. Click **Add New Application Password**
6. Copy the generated password (spaces included)

---

## Local File Structure

```
my-project/
├── .elementor-cli.yaml             # Project config (add to .gitignore!)
├── .elementor-cli/
│   ├── pages/
│   │   └── production/             # Per-site storage
│   │       ├── 42/
│   │       │   ├── page.json       # Complete page data
│   │       │   ├── elements.json   # Editable element tree
│   │       │   ├── settings.json   # Page settings
│   │       │   └── meta.json       # Title, slug, status
│   │       └── 156/
│   │           └── ...
│   ├── dumps/                      # Database dumps
│   │   ├── staging-2024-01-27-143052.sql
│   │   └── production-2024-01-26-091530.sql
│   ├── staging/                    # Only if using 'preview init'
│   │   └── docker-compose.yml
│   └── templates/                  # Starter templates
│       ├── blank.json
│       └── landing-page.json
├── docker/                         # Your existing Docker setup (example)
│   └── docker-compose.yml
└── .gitignore                      # Should include .elementor-cli.yaml
```

---

## Page Storage

When you pull a page, it's stored in multiple files for easier editing:

### page.json

Complete page data snapshot:

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

### elements.json

Just the Elementor element tree - this is what you edit:

```json
[
  {
    "id": "abc123",
    "elType": "container",
    "settings": {...},
    "elements": [...]
  }
]
```

### settings.json

Page-level settings:

```json
{
  "background_background": "classic",
  "background_color": "#ffffff",
  "padding": {...}
}
```

### meta.json

WordPress post metadata:

```json
{
  "title": "Home",
  "slug": "home",
  "status": "publish"
}
```

---

## .gitignore Recommendations

Add these to your `.gitignore`:

```gitignore
# Elementor CLI credentials
.elementor-cli.yaml

# Database dumps (optional - may want to keep these)
.elementor-cli/dumps/

# Local staging environment
.elementor-cli/staging/
```

Keep page data in git if you want version control:

```gitignore
# Track page changes in git
!.elementor-cli/pages/
```
