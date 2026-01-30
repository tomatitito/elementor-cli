#!/bin/bash
# E2E Test Seed Script for WordPress + Elementor
# This script sets up WordPress with Elementor and test data for e2e testing

set -e

# Function to retry a command with exponential backoff
retry_command() {
  local max_attempts=$1
  local delay=$2
  local command="${@:3}"
  local attempt=1

  while [ $attempt -le $max_attempts ]; do
    echo "Attempt $attempt/$max_attempts: $command"
    if eval "$command"; then
      return 0
    fi
    echo "Command failed, waiting ${delay}s before retry..."
    sleep $delay
    delay=$((delay * 2))
    attempt=$((attempt + 1))
  done

  echo "Command failed after $max_attempts attempts"
  return 1
}

echo "=== Starting E2E Test Environment Setup ==="

# Enable Application Passwords over HTTP (required for local testing)
echo "Enabling Application Passwords over HTTP..."
mkdir -p /var/www/html/wp-content/mu-plugins
cat > /var/www/html/wp-content/mu-plugins/enable-app-passwords-http.php << 'EOFPHP'
<?php
// Enable Application Passwords over HTTP for local development
add_filter('wp_is_application_passwords_available', '__return_true');
add_filter('application_password_is_api_request', '__return_true');
EOFPHP
echo "Application Passwords HTTP support enabled"

# Wait for wp-config.php to be created by WordPress container
echo "Waiting for wp-config.php..."
max_wait=60
waited=0
while [ ! -f /var/www/html/wp-config.php ]; do
  if [ $waited -ge $max_wait ]; then
    echo "ERROR: wp-config.php not found after ${max_wait}s"
    echo "Contents of /var/www/html:"
    ls -la /var/www/html/ || echo "Cannot list directory"
    exit 1
  fi
  sleep 2
  waited=$((waited + 2))
done
echo "Found wp-config.php"

# Wait for database connection
echo "Waiting for WordPress database connection..."
max_wait=120
waited=0
while ! wp db check --path=/var/www/html --allow-root 2>&1; do
  if [ $waited -ge $max_wait ]; then
    echo "ERROR: Database connection failed after ${max_wait}s"
    exit 1
  fi
  echo "Database not ready, waiting... (${waited}s)"
  sleep 5
  waited=$((waited + 5))
done
echo "Database connection established"

# Check if test data already exists (WordPress may be installed but test data not created)
if [ -f /var/www/html/wp-content/test-pages.json ]; then
  echo "Test data already exists, skipping setup"
  cat /var/www/html/wp-content/test-pages.json
  exit 0
fi

# Check if WordPress is already installed
if ! wp core is-installed --path=/var/www/html --allow-root 2>/dev/null; then
  echo "Installing WordPress..."
  wp core install \
    --path=/var/www/html \
    --url="http://localhost:8888" \
    --title="Elementor CLI Test Site" \
    --admin_user="admin" \
    --admin_password="admin123" \
    --admin_email="admin@example.com" \
    --skip-email \
    --allow-root
else
  echo "WordPress already installed, proceeding to create test data..."
fi

echo "Configuring WordPress settings..."
wp option update permalink_structure '/%postname%/' --path=/var/www/html --allow-root
wp option update blogdescription "E2E Test Environment" --path=/var/www/html --allow-root

echo "Installing Elementor plugin..."
if ! retry_command 3 5 "wp plugin install elementor --activate --path=/var/www/html --allow-root"; then
  echo "ERROR: Failed to install Elementor plugin after retries"
  echo "Creating marker file to indicate failure..."
  echo '{"error": "Failed to install Elementor plugin"}' > /var/www/html/wp-content/test-pages.json
  exit 1
fi

echo "Creating application password for CLI access..."
# Create application password and save it
APP_PASSWORD=$(wp user application-password create admin "elementor-cli-test" --porcelain --path=/var/www/html --allow-root 2>/dev/null || echo "")

if [ -n "$APP_PASSWORD" ]; then
  echo "Application password created: $APP_PASSWORD"
  # Save credentials to a file for test access
  echo "admin:$APP_PASSWORD" > /var/www/html/wp-content/test-credentials.txt
  chmod 600 /var/www/html/wp-content/test-credentials.txt
else
  echo "Warning: Could not create application password (may already exist)"
fi

echo "Creating test pages with Elementor content..."

# Test Page 1: Simple heading page
PAGE1_ID=$(wp post create \
  --post_type=page \
  --post_title="Test Page Simple" \
  --post_status=publish \
  --post_name="test-page-simple" \
  --porcelain \
  --path=/var/www/html \
  --allow-root)

echo "Created page $PAGE1_ID: Test Page Simple"

# Set Elementor data for page 1
ELEMENTOR_DATA_1='[{"id":"abc12345","elType":"container","settings":{},"elements":[{"id":"def67890","elType":"widget","widgetType":"heading","settings":{"title":"Welcome to Test Page","size":"large"},"elements":[]}]}]'

wp post meta update "$PAGE1_ID" _elementor_data "$ELEMENTOR_DATA_1" --path=/var/www/html --allow-root
wp post meta update "$PAGE1_ID" _elementor_edit_mode "builder" --path=/var/www/html --allow-root
wp post meta update "$PAGE1_ID" _elementor_version "3.18.0" --path=/var/www/html --allow-root
wp post meta update "$PAGE1_ID" _wp_page_template "elementor_canvas" --path=/var/www/html --allow-root

# Test Page 2: Complex nested structure
PAGE2_ID=$(wp post create \
  --post_type=page \
  --post_title="Test Page Complex" \
  --post_status=publish \
  --post_name="test-page-complex" \
  --porcelain \
  --path=/var/www/html \
  --allow-root)

echo "Created page $PAGE2_ID: Test Page Complex"

# Nested Elementor structure with multiple sections and widgets
ELEMENTOR_DATA_2='[{"id":"sec11111","elType":"container","settings":{"content_width":"full"},"elements":[{"id":"col11111","elType":"container","settings":{},"elements":[{"id":"wid11111","elType":"widget","widgetType":"heading","settings":{"title":"Section 1 Heading","size":"xl"},"elements":[]},{"id":"wid11112","elType":"widget","widgetType":"text-editor","settings":{"editor":"<p>This is test content in section 1.</p>"},"elements":[]}]}]},{"id":"sec22222","elType":"container","settings":{},"elements":[{"id":"col22221","elType":"container","settings":{},"elements":[{"id":"wid22221","elType":"widget","widgetType":"image","settings":{"image":{"url":"https://example.com/image1.jpg","id":""}},"elements":[]}]},{"id":"col22222","elType":"container","settings":{},"elements":[{"id":"wid22222","elType":"widget","widgetType":"heading","settings":{"title":"Column 2 Heading"},"elements":[]}]}]}]'

wp post meta update "$PAGE2_ID" _elementor_data "$ELEMENTOR_DATA_2" --path=/var/www/html --allow-root
wp post meta update "$PAGE2_ID" _elementor_edit_mode "builder" --path=/var/www/html --allow-root
wp post meta update "$PAGE2_ID" _elementor_version "3.18.0" --path=/var/www/html --allow-root
wp post meta update "$PAGE2_ID" _wp_page_template "elementor_header_footer" --path=/var/www/html --allow-root

# Test Page 3: Draft page for testing status changes
PAGE3_ID=$(wp post create \
  --post_type=page \
  --post_title="Test Page Draft" \
  --post_status=draft \
  --post_name="test-page-draft" \
  --porcelain \
  --path=/var/www/html \
  --allow-root)

echo "Created page $PAGE3_ID: Test Page Draft"

ELEMENTOR_DATA_3='[{"id":"dra11111","elType":"container","settings":{},"elements":[{"id":"dra22222","elType":"widget","widgetType":"heading","settings":{"title":"Draft Page Content"},"elements":[]}]}]'

wp post meta update "$PAGE3_ID" _elementor_data "$ELEMENTOR_DATA_3" --path=/var/www/html --allow-root
wp post meta update "$PAGE3_ID" _elementor_edit_mode "builder" --path=/var/www/html --allow-root

# Create a test page with no Elementor content (regular WordPress page)
PAGE4_ID=$(wp post create \
  --post_type=page \
  --post_title="Non-Elementor Page" \
  --post_status=publish \
  --post_name="non-elementor-page" \
  --post_content="This is a regular WordPress page without Elementor." \
  --porcelain \
  --path=/var/www/html \
  --allow-root)

echo "Created page $PAGE4_ID: Non-Elementor Page"

# Save test page IDs for test access
cat > /var/www/html/wp-content/test-pages.json << EOF
{
  "simple": $PAGE1_ID,
  "complex": $PAGE2_ID,
  "draft": $PAGE3_ID,
  "nonElementor": $PAGE4_ID
}
EOF

echo ""
echo "=== E2E Test Environment Setup Complete ==="
echo ""
echo "Test Site URL: http://localhost:8888"
echo "Admin URL: http://localhost:8888/wp-admin"
echo "Admin User: admin"
echo "Admin Password: admin123"
echo ""
echo "Test Pages Created:"
echo "  - Page $PAGE1_ID: Test Page Simple (elementor_canvas)"
echo "  - Page $PAGE2_ID: Test Page Complex (elementor_header_footer)"
echo "  - Page $PAGE3_ID: Test Page Draft (draft status)"
echo "  - Page $PAGE4_ID: Non-Elementor Page (no Elementor)"
echo ""
echo "Credentials saved to: /var/www/html/wp-content/test-credentials.txt"
echo "Page IDs saved to: /var/www/html/wp-content/test-pages.json"
