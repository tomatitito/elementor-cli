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
    # Auto-create revision before every push (default: false)
    createRevisions: true
    # Container running WordPress (for CSS cache flush via WP-CLI)
    container:
      runtime: docker    # "docker" or "podman"
      name: my-wordpress-container
    # Optional reusable WP-CLI access over SSH
    wpCli:
      type: ssh
      host: deploy@my-friends-site.de
      path: /var/www/my-friends-site/current

  staging-remote:
    url: https://staging.my-friends-site.de
    username: admin
    appPassword: yyyy yyyy yyyy yyyy yyyy yyyy
    createRevisions: false  # Fast iteration on staging

  recovery:
    url: http://localhost:8082
    # REST credentials are optional for a WP-CLI-only site
    wpCli:
      type: compose
      composeFile: docker/docker-compose.recovery.yml
      envFile: recovery/.env
      projectName: example-recovery
      service: wpcli
      mode: run
      runtime: docker

# Local staging environment configuration
staging:
  # Path to docker-compose.yml (relative to project root)
  path: ./docker

  # WordPress service name in docker-compose.yml
  service: wordpress

  # Local staging URL
  url: http://localhost:8080

  # WP-CLI command (useful if wp is not in PATH or uses a different name)
  wpCommand: wp  # or "php wp-cli.phar" or path to wp-cli

  # Container runtime for staging commands (default: "docker")
  containerRuntime: docker  # "docker" or "podman"

# Local pages storage directory
pagesDir: .elementor-cli/pages
```

### Site Configuration

Each site requires a `url` plus REST credentials, a WP-CLI transport, or both:

| Field | Required | Description |
|-------|----------|-------------|
| `url` | Yes | WordPress site URL (use HTTPS outside local development) |
| `username` | For REST | WordPress admin username; configure with `appPassword` |
| `appPassword` | For REST | Application Password (generate in WordPress admin); configure with `username` |
| `createRevisions` | No | Auto-create revision before push (default: `false`) |
| `container` | No | Container config for WP-CLI CSS flush (see below) |
| `wpCli` | No | Reusable SSH or Compose WP-CLI transport (see below) |

### WP-CLI Transports

The optional `wpCli` block provides reusable WP-CLI access independently of
the staging-specific `DockerManager`. Commands built on this transport receive
stdout, stderr, and the process exit code separately and can stream input (for
example, SQL) over stdin. WP-CLI plugins and themes are skipped by default;
callers that require either can explicitly enable loading it.

#### SSH

```yaml
wpCli:
  type: ssh
  host: deploy@example.com
  path: /var/www/example/current
```

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Must be `ssh` |
| `host` | Yes | SSH host or `user@host`; shell characters and option-like values are rejected |
| `path` | Yes | Absolute WordPress installation path on the remote host |

SSH uses the local OpenSSH configuration and known-hosts database with
`StrictHostKeyChecking=yes`. Add the server's verified key to `known_hosts`
before use; the transport never disables host-key checking. Authentication
material remains managed by SSH and is not placed in command arguments or
configuration by this transport.

#### Docker/Podman Compose

```yaml
wpCli:
  type: compose
  composeFile: docker/docker-compose.recovery.yml
  envFile: recovery/.env
  projectName: example-recovery
  service: wpcli
  mode: run
  runtime: docker
```

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Must be `compose` |
| `composeFile` | Yes | Compose file, resolved from the project root |
| `envFile` | No | Compose environment file, resolved from the project root |
| `projectName` | No | Compose project name (`a-z`, digits, `_`, and `-`) |
| `service` | Yes | Compose service containing `wp` |
| `mode` | Yes | `run` for a one-shot `run --rm`, or `exec` for a running service |
| `runtime` | No | `docker` (default) or `podman` |

Compose and environment files must exist within the project root (including
after resolving symbolic links). Arguments are passed as process argument
arrays, and environment-file contents are never included in errors or logs.

### Container Configuration (per-site)

If a site runs inside a Docker/Podman container, configure `container` to enable WP-CLI-based CSS cache flushing after push:

| Field | Required | Description |
|-------|----------|-------------|
| `runtime` | Yes | Container runtime: `"docker"` or `"podman"` |
| `name` | Yes | Container name or ID |

### Staging Configuration

| Field | Default | Description |
|-------|---------|-------------|
| `path` | `.elementor-cli/staging` | Path to docker-compose.yml |
| `service` | `wordpress` | WordPress service name in compose file (which container has WP-CLI) |
| `url` | `http://localhost:8080` | Local staging URL |
| `wpCommand` | `wp` | WP-CLI command to use (e.g., `php wp-cli.phar` if wp is not in PATH) |
| `containerRuntime` | `docker` | Container runtime for staging commands: `"docker"` or `"podman"` |

### Generating Application Passwords

1. Log into WordPress admin
2. Go to **Users → Profile**
3. Scroll to **Application Passwords**
4. Enter a name (e.g., "elementor-cli")
5. Click **Add New Application Password**
6. Copy the generated password (spaces included)

### Enabling Application Passwords over HTTP (Local Development)

WordPress only allows Application Passwords over HTTPS by default. For local development environments using HTTP, you need to install a must-use plugin.

Create the file `wp-content/mu-plugins/enable-app-passwords-http.php`:

```php
<?php
// Enable Application Passwords over HTTP for local development
add_filter('wp_is_application_passwords_available', '__return_true');
add_filter('application_password_is_api_request', '__return_true');
```

**Warning:** Only use this on local development environments. Never deploy this to production sites.

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
