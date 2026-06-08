#!/bin/bash

# Local runner for preview Docker E2E tests
# This script makes it easy to run the Docker-based preview tests locally

set -e

echo "🔨 Building CLI..."
bun run build

echo "🧪 Running Preview Docker E2E Tests..."
echo "Note: This will use ports 8889 and 3307"
echo ""

# Run the tests
bun test tests/e2e/preview-docker.test.ts

echo ""
echo "✅ Preview Docker E2E tests completed!"

# Cleanup any leftover containers
echo "🧹 Cleaning up..."
docker rm -f elementor-cli-preview-test-wp elementor-cli-preview-test-db 2>/dev/null || true
docker volume rm elementor-cli-preview-test_wordpress_data elementor-cli-preview-test_db_data 2>/dev/null || true

echo "Done!"