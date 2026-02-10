# Manual Testing Guide: Complete Workflow

This guide walks you through testing the complete pull → edit → push workflow manually.

## Prerequisites
- Staging site configured in `.elementor-cli.yaml`
- Built project: `npm run build`
- Working credentials for staging

## Quick Test (5 minutes)

```bash
# 1. Check your setup
elementor status --site staging

# 2. Pull a single page (pick any ID from your site)
elementor pull 42 --site staging

# 3. Edit it locally
elementor search-replace "old-text" "new-text" -p 42 --local --site staging

# 4. See what changed
elementor diff 42 --site staging

# 5. Push it back
elementor push 42 --site staging
```

## Comprehensive Test (15 minutes)

### Phase 1: Setup & Discovery
```bash
# Build the project
npm run build

# Check connection
elementor status --site staging

# List available pages
elementor list --site staging

# Note some page IDs for testing
```

### Phase 2: Pull Pages
```bash
# Option A: Pull specific pages (faster)
elementor pull 42 156 298 --site staging

# Option B: Pull all pages (complete test)
elementor pull --all --site staging

# Verify local files exist
ls -la .elementor-cli/sites/staging/pages/
```

### Phase 3: Local Editing

#### Test 1: Single Page Search-Replace
```bash
# Dry-run first (always!)
elementor search-replace "staging.mysite.com" "www.mysite.com" -p 42 --local --dry-run --site staging

# If looks good, apply it
elementor search-replace "staging.mysite.com" "www.mysite.com" -p 42 --local --site staging
```

#### Test 2: Multiple Edits on Same Page
```bash
# You can chain multiple replacements
elementor search-replace "Company Name" "New Company LLC" -p 42 --local --site staging
elementor search-replace "(555) 123-4567" "(555) 987-6543" -p 42 --local --site staging
elementor search-replace "old@email.com" "new@email.com" -p 42 --local --site staging
```

#### Test 3: Bulk Edit All Pages
```bash
# Preview first
elementor search-replace "http://" "https://" --all-pages --local --dry-run --site staging

# Apply if safe
elementor search-replace "http://" "https://" --all-pages --local --site staging
```

### Phase 4: Review Changes
```bash
# Detailed diff for single page
elementor diff 42 --site staging

# Summary for all pages
elementor diff --all --site staging

# JSON output for scripts
elementor diff 42 --json --site staging
```

### Phase 5: Push Changes

#### Safe Push (with dry-run)
```bash
# Preview what will be pushed
elementor push 42 --dry-run --site staging

# Actually push
elementor push 42 --site staging
```

#### Batch Push
```bash
# Push specific pages
elementor push 42 156 298 --site staging

# Push all modified pages
elementor push --all --site staging
```

#### Force Push (skip conflicts)
```bash
# Use with caution!
elementor push 42 --force --site staging
```

### Phase 6: Test Conflict Detection

```bash
# 1. Pull a page
elementor pull 99 --site staging

# 2. Go edit page 99 in WordPress admin (make any small change and save)

# 3. Edit locally too
elementor search-replace "test" "TEST" -p 99 --local --site staging

# 4. Try to push - should warn about conflict
elementor push 99 --site staging

# You'll see:
# ⚠ Page 99 has been modified on remote since last pull
# Options:
# - Pull latest and reapply changes
# - Use --force to overwrite
```

## Testing Scenarios

### Scenario 1: URL Migration
```bash
# Pull all pages
elementor pull --all --site staging

# Update all URLs
elementor search-replace "dev.example.com" "staging.example.com" --all-pages --local --site staging

# Review
elementor diff --all --site staging

# Push all
elementor push --all --site staging
```

### Scenario 2: Content Update Campaign
```bash
# Pull marketing pages
elementor pull 10 11 12 13 --site staging

# Update product name
elementor search-replace "ProductX" "ProductY Pro" --all-pages --local --site staging

# Update pricing
elementor search-replace "$99" "$149" --all-pages --local --site staging

# Update copyright
elementor search-replace "© 2023" "© 2024" --all-pages --local --site staging

# Review all changes
elementor diff --all --site staging

# Push when ready
elementor push --all --site staging
```

### Scenario 3: Emergency Fix
```bash
# Quick fix for single page
elementor pull 404 --site staging
elementor search-replace "broken-link.com" "fixed-link.com" -p 404 --local --site staging
elementor push 404 --site staging
```

## Verification Steps

After pushing, verify your changes:

1. **In WordPress Admin:**
   - Go to Pages → Edit the page
   - Check Elementor editor shows your changes
   - Check revision history was created

2. **On the Frontend:**
   - Visit the page URL
   - Verify visual changes
   - Check browser console for errors

3. **With the CLI:**
   ```bash
   # Pull again and diff should show no changes
   elementor pull 42 --site staging
   elementor diff 42 --site staging
   ```

## Troubleshooting

### Issue: "Page not found locally"
```bash
# Solution: Pull it first
elementor pull 42 --site staging
```

### Issue: "Conflict detected"
```bash
# Option 1: Pull latest and reapply
elementor pull 42 --site staging
# Reapply your edits
elementor search-replace "text" "new" -p 42 --local --site staging
elementor push 42 --site staging

# Option 2: Force push (loses remote changes!)
elementor push 42 --force --site staging
```

### Issue: "No changes detected"
```bash
# Make sure you edited the local files
elementor search-replace "something" "different" -p 42 --local --site staging

# Verify with diff
elementor diff 42 --site staging
```

## Tips

1. **Always dry-run first:** Use `--dry-run` before any destructive operation
2. **Check diff before push:** Review what you're about to upload
3. **Use force sparingly:** `--force` overwrites without asking
4. **Backup before bulk ops:** `cp -r .elementor-cli .elementor-cli.backup`
5. **Work in batches:** Test with one page before doing --all-pages

## Clean Up

After testing:
```bash
# Remove local test files (optional)
rm -rf .elementor-cli/sites/staging/pages/*

# Or keep them for next session
ls -la .elementor-cli/sites/staging/pages/
```

---

Ready to test? Start with the Quick Test, then try the Comprehensive Test!