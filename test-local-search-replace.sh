#!/bin/bash

# Test script for local search-replace functionality

echo "Testing Local Search-Replace Feature"
echo "===================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test configuration
TEST_SITE="staging"
TEST_PAGE_ID="42"
SEARCH_TEXT="old-domain.com"
REPLACE_TEXT="new-domain.com"

echo -e "${YELLOW}Prerequisites:${NC}"
echo "1. Make sure you have a site configured named '$TEST_SITE'"
echo "2. Make sure you have pulled some pages locally with: elementor pull --all"
echo ""
read -p "Press Enter to continue or Ctrl+C to abort..."
echo ""

# Test 1: Dry-run on single local page
echo -e "${GREEN}Test 1: Dry-run search-replace on single local page${NC}"
npm run build
node dist/index.js search-replace "$SEARCH_TEXT" "$REPLACE_TEXT" -p $TEST_PAGE_ID --local --dry-run --site $TEST_SITE
echo ""

# Test 2: Dry-run on all local pages
echo -e "${GREEN}Test 2: Dry-run search-replace on all local pages${NC}"
node dist/index.js search-replace "$SEARCH_TEXT" "$REPLACE_TEXT" --all-pages --local --dry-run --site $TEST_SITE
echo ""

# Test 3: Actual replacement on single page (with confirmation)
echo -e "${GREEN}Test 3: Actual search-replace on single local page${NC}"
read -p "Do you want to perform actual replacement on page $TEST_PAGE_ID? (y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    node dist/index.js search-replace "$SEARCH_TEXT" "$REPLACE_TEXT" -p $TEST_PAGE_ID --local --site $TEST_SITE
    echo ""
    
    # Show diff to verify changes
    echo -e "${YELLOW}You can now check the changes with:${NC}"
    echo "elementor diff $TEST_PAGE_ID --site $TEST_SITE"
fi

echo ""
echo -e "${GREEN}Test completed!${NC}"
echo ""
echo "Next steps:"
echo "1. Verify local changes with: elementor diff <page-id>"
echo "2. Push changes to remote with: elementor push <page-id>"
echo "3. Test remote search-replace without --local flag"