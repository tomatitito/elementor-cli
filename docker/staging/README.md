# Elementor CLI Staging Environment

This directory contains the Docker setup for the local WordPress staging environment used with the Elementor CLI.

## Quick Start

### Start the staging environment:
```bash
docker-compose up -d
```

### Stop the staging environment:
```bash
docker-compose down
```

### Reset the environment (removes all data):
```bash
docker-compose down -v
```

## Access Details

- **WordPress URL**: http://localhost:8888
- **Admin URL**: http://localhost:8888/wp-admin
- **Username**: admin
- **Password**: admin123

## Application Password

The WordPress application password for API access is automatically generated during setup. To retrieve it:

```bash
docker exec elementor-cli-staging-wp cat /var/www/html/wp-content/test-credentials.txt
```

This password should be used in your `.elementor-cli.yaml` configuration file.

## Database Access

If you need direct database access:
- **Host**: localhost
- **Port**: 3306
- **Database**: wordpress
- **Username**: wordpress
- **Password**: wordpress
- **Root Password**: rootpassword

## Volumes

The environment uses named Docker volumes to persist data:
- `wordpress_data` - WordPress files, uploads, plugins, themes
- `db_data` - MySQL database

Data persists across container restarts unless you explicitly remove volumes with `docker-compose down -v`.