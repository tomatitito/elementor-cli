#!/bin/bash

# Complete Workflow Test: Pull → Edit Locally → Diff → Push
# This script tests the full local editing workflow with staging environment

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
SITE="staging"
TEST_SEARCH="staging.yourdomain.com"  # Change this to match your staging domain
TEST_REPLACE="production.yourdomain.com"  # Change this to your target domain

echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}    Complete Elementor CLI Workflow Test - Staging Environment${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# Function to pause and wait for user
pause() {
    echo ""
    echo -e "${YELLOW}Press Enter to continue or Ctrl+C to abort...${NC}"
    read -r
    echo ""
}

# Function to run command with highlighting
run_command() {
    echo -e "${BLUE}Running:${NC} $1"
    eval "$1"
    echo ""
}

# =============================================================================
# STEP 0: Build and Check Setup
# =============================================================================
echo -e "${GREEN}▶ Step 0: Building and Checking Setup${NC}"
echo "----------------------------------------"
run_command "npm run build"

echo -e "${BLUE}Checking current configuration:${NC}"
run_command "node dist/elementor-cli.js status --site $SITE"
pause

# =============================================================================
# STEP 1: List Remote Pages
# =============================================================================
echo -e "${GREEN}▶ Step 1: List Available Pages on Staging${NC}"
echo "--------------------------------------------"
echo "Let's see what pages are available on your staging site:"
echo ""
run_command "node dist/elementor-cli.js list --site $SITE"

echo -e "${YELLOW}Note the page IDs above. We'll use them for testing.${NC}"
echo -e "${YELLOW}If you want to test with specific pages, note their IDs now.${NC}"
pause

# =============================================================================
# STEP 2: Pull Pages from Staging
# =============================================================================
echo -e "${GREEN}▶ Step 2: Pull Pages from Staging${NC}"
echo "-----------------------------------"
echo "We'll pull some pages to work with locally."
echo ""
echo "Options:"
echo "1) Pull ALL pages (comprehensive test)"
echo "2) Pull specific page(s) (faster test)"
echo ""
read -p "Choose option (1 or 2): " pull_option

if [ "$pull_option" = "1" ]; then
    echo -e "${BLUE}Pulling all pages from staging...${NC}"
    run_command "node dist/elementor-cli.js pull --all --site $SITE"
else
    read -p "Enter page ID(s) to pull (space-separated): " page_ids
    echo -e "${BLUE}Pulling specific pages from staging...${NC}"
    run_command "node dist/elementor-cli.js pull $page_ids --site $SITE"
fi

# Show what was downloaded
echo -e "${BLUE}Local pages now available:${NC}"
run_command "ls -la .elementor-cli/sites/$SITE/pages/"
pause

# =============================================================================
# STEP 3: Test Local Search-Replace
# =============================================================================
echo -e "${GREEN}▶ Step 3: Edit Pages Locally with Search-Replace${NC}"
echo "--------------------------------------------------"
echo "Now we'll test the local search-replace feature."
echo ""
echo -e "${YELLOW}We'll do a dry-run first to preview changes.${NC}"
echo ""

# Get a page ID for testing
if [ "$pull_option" = "1" ]; then
    echo "Which page ID should we test search-replace on?"
    ls .elementor-cli/sites/$SITE/pages/
    read -p "Enter page ID: " test_page_id
else
    test_page_id=$(echo $page_ids | cut -d' ' -f1)
    echo -e "${BLUE}Using page ID: $test_page_id for search-replace test${NC}"
fi

# Dry run first
echo -e "${CYAN}3a. Dry-run (preview) on single page${NC}"
echo "Search: $TEST_SEARCH"
echo "Replace: $TEST_REPLACE"
run_command "node dist/elementor-cli.js search-replace \"$TEST_SEARCH\" \"$TEST_REPLACE\" -p $test_page_id --local --dry-run --site $SITE"

echo -e "${YELLOW}Review the dry-run results above.${NC}"
read -p "Do you want to apply this search-replace? (y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${CYAN}3b. Applying search-replace locally${NC}"
    run_command "node dist/elementor-cli.js search-replace \"$TEST_SEARCH\" \"$TEST_REPLACE\" -p $test_page_id --local --site $SITE"
    
    # Optional: Test on all pages
    echo ""
    read -p "Do you also want to test search-replace on ALL local pages? (y/n): " -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${CYAN}3c. Dry-run on all local pages${NC}"
        run_command "node dist/elementor-cli.js search-replace \"$TEST_SEARCH\" \"$TEST_REPLACE\" --all-pages --local --dry-run --site $SITE"
        
        read -p "Apply to all pages? (y/n): " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            run_command "node dist/elementor-cli.js search-replace \"$TEST_SEARCH\" \"$TEST_REPLACE\" --all-pages --local --site $SITE"
        fi
    fi
else
    echo "Skipping search-replace application."
fi

pause

# =============================================================================
# STEP 4: Review Changes with Diff
# =============================================================================
echo -e "${GREEN}▶ Step 4: Review Changes with Diff${NC}"
echo "------------------------------------"
echo "Let's see what changed in our local files compared to remote."
echo ""

echo -e "${CYAN}4a. Diff for single page${NC}"
run_command "node dist/elementor-cli.js diff $test_page_id --site $SITE"

echo ""
read -p "Do you want to see diff for ALL pages? (y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${CYAN}4b. Diff for all pages (summary)${NC}"
    run_command "node dist/elementor-cli.js diff --all --site $SITE"
fi

pause

# =============================================================================
# STEP 5: Test Push (Dry Run First)
# =============================================================================
echo -e "${GREEN}▶ Step 5: Push Changes Back to Staging${NC}"
echo "----------------------------------------"
echo -e "${YELLOW}IMPORTANT: We'll do a dry-run first to see what would be pushed.${NC}"
echo ""

echo -e "${CYAN}5a. Dry-run push for single page${NC}"
run_command "node dist/elementor-cli.js push $test_page_id --dry-run --site $SITE"

echo ""
echo -e "${YELLOW}Review the dry-run results above.${NC}"
echo -e "${RED}WARNING: The next step will actually modify your staging site!${NC}"
read -p "Do you want to ACTUALLY push this page to staging? (y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${CYAN}5b. Actual push to staging${NC}"
    run_command "node dist/elementor-cli.js push $test_page_id --site $SITE"
    
    echo -e "${GREEN}✅ Page pushed successfully!${NC}"
    echo ""
    
    # Test push all
    read -p "Do you want to test pushing ALL modified pages? (y/n): " -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${CYAN}5c. Dry-run push all pages${NC}"
        run_command "node dist/elementor-cli.js push --all --dry-run --site $SITE"
        
        echo -e "${RED}WARNING: This will push ALL local changes to staging!${NC}"
        read -p "Proceed with pushing all? (y/n): " -n 1 -r
        echo ""
        
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            run_command "node dist/elementor-cli.js push --all --site $SITE"
        fi
    fi
else
    echo "Push cancelled. Your local changes remain but weren't uploaded."
fi

pause

# =============================================================================
# STEP 6: Test Conflict Detection
# =============================================================================
echo -e "${GREEN}▶ Step 6: Test Conflict Detection (Optional)${NC}"
echo "----------------------------------------------"
echo "This tests what happens when the remote page changes after you pulled it."
echo ""
read -p "Do you want to test conflict detection? (y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Steps:"
    echo "1. We'll pull a fresh page"
    echo "2. You manually edit it on WordPress"
    echo "3. We'll try to push and see the conflict warning"
    echo ""
    
    read -p "Enter a page ID for conflict test: " conflict_page_id
    
    echo -e "${CYAN}6a. Pull fresh page${NC}"
    run_command "node dist/elementor-cli.js pull $conflict_page_id --site $SITE"
    
    echo ""
    echo -e "${YELLOW}NOW: Go to your WordPress admin and make a small edit to page $conflict_page_id${NC}"
    echo -e "${YELLOW}(Change anything - add a word, change a color, etc.)${NC}"
    echo -e "${YELLOW}Save the page in WordPress before continuing.${NC}"
    pause
    
    echo -e "${CYAN}6b. Make a local edit${NC}"
    run_command "node dist/elementor-cli.js search-replace \"test\" \"TEST\" -p $conflict_page_id --local --site $SITE"
    
    echo -e "${CYAN}6c. Try to push (should detect conflict)${NC}"
    run_command "node dist/elementor-cli.js push $conflict_page_id --site $SITE"
    
    echo ""
    echo -e "${GREEN}Did you see the conflict warning? That's the safety mechanism!${NC}"
    echo "You can use --force to override, or pull the latest and reapply your changes."
fi

# =============================================================================
# STEP 7: Cleanup Options
# =============================================================================
echo ""
echo -e "${GREEN}▶ Step 7: Test Complete!${NC}"
echo "------------------------"
echo ""
echo -e "${CYAN}Summary of what we tested:${NC}"
echo "✅ Pull pages from staging"
echo "✅ Edit locally with search-replace"
echo "✅ Review changes with diff"
echo "✅ Push changes back to staging"
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "✅ Conflict detection"
fi

echo ""
echo -e "${YELLOW}Cleanup Options:${NC}"
echo "1. Keep local files (for further testing)"
echo "2. Remove test files"
echo ""
read -p "Choose option (1 or 2): " cleanup_option

if [ "$cleanup_option" = "2" ]; then
    echo -e "${RED}This will remove all local page files for $SITE!${NC}"
    read -p "Are you sure? (y/n): " -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        run_command "rm -rf .elementor-cli/sites/$SITE/pages/*"
        echo "Local files removed."
    fi
fi

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}                    Workflow Test Complete!${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Next steps:"
echo "- Check your staging site to verify the changes"
echo "- Try more complex edits with multiple search-replace operations"
echo "- Test the audit command to find URL mismatches"
echo "- Explore templates and other features"
echo ""
echo -e "${GREEN}Happy editing! 🎉${NC}"