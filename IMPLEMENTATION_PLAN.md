# Plan: Add `preview setup` Command ✅ COMPLETED

Add a new subcommand to automate staging environment setup for elementor-cli.

> **Status**: Implemented on 2026-02-02. The command also:
> - Ensures WP-CLI is installed in the container
> - Checks if WordPress is installed and installs it if needed
> - Sets up pretty permalinks for REST API
> - Creates an additional mu-plugin to expose Elementor meta fields in REST API

## Command

```bash
elementor-cli preview setup
```

## What It Does

1. Creates a mu-plugin (`enable-app-passwords-http.php`) to enable Application Passwords over HTTP
2. Creates a WordPress admin user (or uses existing)
3. Generates an application password for REST API access
4. Updates `.elementor-cli.yaml` with the staging site configuration

## Files to Modify

### 1. `src/services/docker-manager.ts`

Add four new methods:

```typescript
async userExists(username: string): Promise<boolean>
// Uses: wp user get <username> --format=json

async createUser(username: string, email: string): Promise<number>
// Uses: wp user create <username> <email> --role=administrator --porcelain

async createAppPassword(username: string, appName: string): Promise<string>
// Uses: wp user application-password create <username> <appName> --porcelain

async execBash(command: string): Promise<string>
// Uses: docker compose exec <service> bash -c '<command>'
// For creating the mu-plugin file
```

### 2. `src/commands/preview.ts`

Add `setup` subcommand (following existing patterns like `init`, `start`, `sync`):

```typescript
previewCommand
  .command("setup")
  .description("Set up staging for API access (creates mu-plugin, user, app password)")
  .option("-u, --username <username>", "WordPress username", "admin")
  .option("-e, --email <email>", "Email for new user")
  .option("-c, --compose-file <path>", "Path to docker-compose.yml")
  .option("--skip-mu-plugin", "Skip creating the mu-plugin")
  .option("-y, --yes", "Skip confirmation prompts")
```

## Implementation Flow

1. **Check staging is running** (same pattern as `sync` command)
2. **Create mu-plugin** (unless `--skip-mu-plugin`):
   - Check if file exists: `docker compose exec wordpress test -f /var/www/html/wp-content/mu-plugins/enable-app-passwords-http.php`
   - Create directory and file via bash heredoc
3. **Handle user**:
   - Check if user exists via `wp user get`
   - If not, prompt for email and create via `wp user create`
4. **Create app password**:
   - `wp user application-password create <user> elementor-cli --porcelain`
   - Output is just the password (e.g., `xxxx xxxx xxxx xxxx xxxx xxxx`)
5. **Update config**:
   - Show preview of configuration
   - Confirm with user (unless `-y`)
   - Call `addSite()` from config-store

## Example Session

```
$ elementor-cli preview setup

Checking staging environment...
✓ Staging is running at http://localhost:8080

Creating mu-plugin for Application Passwords...
✓ Created enable-app-passwords-http.php

? WordPress admin username: admin
User 'admin' already exists, using existing user.

Creating application password...
✓ Application password created

Staging Configuration
  Site name: staging
  URL: http://localhost:8080
  Username: admin
  App Password: xxxx xxxx xxxx xxxx xxxx xxxx

? Save this configuration? Yes
✓ Site 'staging' added to .elementor-cli.yaml

Next steps:
  Run 'elementor-cli pages list --site staging' to verify
```

## Verification

1. Start staging: `elementor-cli preview start`
2. Run setup: `elementor-cli preview setup`
3. Test connection: `elementor-cli pages list --site staging`
