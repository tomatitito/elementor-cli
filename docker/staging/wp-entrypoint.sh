#!/bin/bash
# Custom WordPress entrypoint that runs the seed script after starting Apache

set -e

# Function to run the seed script in the background after WordPress is ready
run_seed() {
  # Wait for WordPress to be fully initialized
  echo "[seed] Waiting for wp-config.php..."
  while [ ! -f /var/www/html/wp-config.php ]; do
    sleep 2
  done
  echo "[seed] Found wp-config.php"

  # Install WP-CLI if not present
  if ! command -v wp &> /dev/null; then
    echo "[seed] Installing WP-CLI..."
    curl -sO https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar
    chmod +x wp-cli.phar
    mv wp-cli.phar /usr/local/bin/wp
    echo "[seed] WP-CLI installed"
  fi

  # Install MySQL client for database checks
  echo "[seed] Installing MySQL client..."
  apt-get update -qq && apt-get install -y -qq default-mysql-client > /dev/null 2>&1
  echo "[seed] MySQL client installed"

  # Wait for database to be ready
  echo "[seed] Waiting for database connection..."
  max_wait=120
  waited=0
  while ! wp db check --path=/var/www/html --allow-root 2>&1; do
    if [ $waited -ge $max_wait ]; then
      echo "[seed] ERROR: Database connection failed after ${max_wait}s"
      exit 1
    fi
    echo "[seed] Database not ready, waiting... (${waited}s)"
    sleep 5
    waited=$((waited + 5))
  done
  echo "[seed] Database connection established"

  # Run the seed script with www-data user for proper permissions
  if [ -f /seed.sh ]; then
    echo "[seed] Running seed script..."
    # Run parts as root for installation, then change ownership
    bash /seed.sh
    chown -R www-data:www-data /var/www/html/wp-content
    echo "[seed] Seed script completed"
  else
    echo "[seed] No seed script found at /seed.sh"
  fi
}

# Start the seed script in the background
run_seed &

# Call the original WordPress entrypoint
exec docker-entrypoint.sh apache2-foreground
