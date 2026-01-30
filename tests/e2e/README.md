# E2E Test Environment

This directory contains the Docker setup for end-to-end testing of elementor-cli.

## Quick Start

```bash
# Start the test environment
cd tests/e2e
docker compose up -d

# Wait for setup to complete (watch the cli container logs)
docker compose logs -f cli

# Once setup is complete, the environment is ready for testing
```

## Environment Details

| Service | Container Name | Port | Description |
|---------|---------------|------|-------------|
| WordPress | elementor-cli-test-wp | 8888 | WordPress with Elementor |
| MySQL | elementor-cli-test-db | - | Database server |
| WP-CLI | elementor-cli-test-cli | - | Runs seed script |

## Test Credentials

- **Site URL**: http://localhost:8888
- **Admin URL**: http://localhost:8888/wp-admin
- **Username**: admin
- **Password**: admin123

The application password for API access is generated during setup and saved to:
- Container path: `/var/www/html/wp-content/test-credentials.txt`

## Test Pages

The seed script creates the following test pages:

| Page | Slug | Template | Description |
|------|------|----------|-------------|
| Test Page Simple | test-page-simple | elementor_canvas | Single heading widget |
| Test Page Complex | test-page-complex | elementor_header_footer | Nested containers with multiple widgets |
| Test Page Draft | test-page-draft | default | Draft status page |
| Non-Elementor Page | non-elementor-page | default | Regular WP page, no Elementor |

Page IDs are saved to `/var/www/html/wp-content/test-pages.json`.

## Retrieving Test Credentials

```bash
# Get application password
docker exec elementor-cli-test-wp cat /var/www/html/wp-content/test-credentials.txt

# Get test page IDs
docker exec elementor-cli-test-wp cat /var/www/html/wp-content/test-pages.json
```

## Commands

```bash
# Start environment
docker compose up -d

# View logs
docker compose logs -f

# Stop environment (keeps data)
docker compose stop

# Stop and remove containers + data
docker compose down -v

# Rebuild from scratch
docker compose down -v && docker compose up -d

# Execute WP-CLI commands
docker exec elementor-cli-test-wp wp post list --post_type=page
```

## Using with elementor-cli

Once the environment is running, configure elementor-cli to connect:

```bash
# Get the application password
APP_PASS=$(docker exec elementor-cli-test-wp cat /var/www/html/wp-content/test-credentials.txt | cut -d: -f2)

# Initialize config for test site
elementor-cli config init \
  --site test \
  --url http://localhost:8888 \
  --username admin \
  --password "$APP_PASS"

# Test connection
elementor-cli config test --site test

# List pages
elementor-cli pages list --site test
```

## Troubleshooting

### Seed script didn't run
If pages weren't created, run the seed manually:
```bash
docker compose run --rm cli bash /seed.sh
```

### WordPress not accessible
Check if containers are healthy:
```bash
docker compose ps
```

### Reset everything
```bash
docker compose down -v
docker compose up -d
```
