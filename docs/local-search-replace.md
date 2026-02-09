# Local Search & Replace Feature

## Overview

The `search-replace` command now supports editing locally downloaded pages in addition to the remote WordPress database. This enables a powerful workflow where you can:

1. Download pages with `elementor pull`
2. Edit them locally with `search-replace --local`
3. Review changes with `elementor diff`
4. Upload changes with `elementor push`

## Usage

### Basic Syntax

```bash
# Remote search-replace (default)
elementor search-replace "old-text" "new-text" -p 42

# Local search-replace (new)
elementor search-replace "old-text" "new-text" -p 42 --local
```

### Options

- `-l, --local` - Search and replace in local files instead of remote database
- `-p, --page <id>` - Page ID to update (required unless --all-pages)
- `-a, --all-pages` - Apply to all pages
- `-n, --dry-run` - Preview changes without applying them
- `-s, --site <name>` - Site name from config
- `--json` - Output results as JSON

## Examples

### Single Page Local Edit

```bash
# Preview changes
elementor search-replace "dev.example.com" "prod.example.com" -p 42 --local --dry-run

# Apply changes
elementor search-replace "dev.example.com" "prod.example.com" -p 42 --local
```

### All Local Pages

```bash
# Replace across all downloaded pages
elementor search-replace "http://" "https://" --all-pages --local

# Preview first
elementor search-replace "old-api.com" "new-api.com" --all-pages --local --dry-run
```

## Workflow Examples

### Migration Workflow

```bash
# 1. Download all pages from staging
elementor pull --all --site staging

# 2. Update all URLs locally
elementor search-replace "staging.mysite.com" "www.mysite.com" --all-pages --local

# 3. Review changes
elementor diff --all --site staging

# 4. Push to production
elementor push --all --site production
```

### Content Update Workflow

```bash
# 1. Pull specific page
elementor pull 123

# 2. Update company name
elementor search-replace "OldCorp Inc." "NewCorp LLC" -p 123 --local

# 3. Update phone number
elementor search-replace "(555) 123-4567" "(555) 987-6543" -p 123 --local

# 4. Review all changes
elementor diff 123

# 5. Push when ready
elementor push 123
```

## How It Works

### Local Mode
When using `--local` flag:
- Reads from `.elementor-cli/pages/<site>/<page-id>/`
- Modifies `elements.json` and `settings.json` files
- Deep traversal of all nested Elementor elements
- Searches in all string values within settings

### Remote Mode (default)
Without `--local` flag:
- Connects to WordPress REST API
- Modifies `_elementor_data` and `_elementor_page_settings` meta fields
- Invalidates CSS cache after changes
- Direct database updates

## File Structure

Local pages are stored in:
```
.elementor-cli/
└── pages/
    └── {site-name}/
        └── {page-id}/
            ├── elements.json    # Modified by local search-replace
            ├── settings.json    # Modified by local search-replace
            ├── page.json        # Full page data
            └── meta.json        # Page metadata
```

## Important Notes

1. **Pull First**: Pages must be downloaded with `elementor pull` before local editing
2. **Push to Apply**: Local changes don't affect the website until you run `elementor push`
3. **Deep Search**: Searches all nested elements and settings recursively
4. **Preserve Structure**: Maintains JSON structure and Elementor element hierarchy
5. **Dry Run**: Always use `--dry-run` first to preview changes

## Comparison: Local vs Remote

| Feature | Local (`--local`) | Remote (default) |
|---------|------------------|------------------|
| Speed | Fast (local files) | Slower (API calls) |
| CSS Cache | No invalidation needed | Auto-invalidated |
| Offline | ✅ Works offline | ❌ Requires connection |
| Preview | `elementor diff` | `--dry-run` only |
| Bulk Edit | Edit multiple times before push | Each edit hits database |
| Rollback | Keep file backups | Use WordPress revisions |

## Error Handling

### Common Errors

1. **Page not found locally**
   ```
   Page 42 not found locally. Run 'elementor pull 42' first.
   ```
   Solution: Download the page first with `elementor pull`

2. **No local pages**
   ```
   No pages found locally. Run 'elementor pull --all' first.
   ```
   Solution: Download pages before attempting local edits

## Best Practices

1. **Always Dry Run First**
   ```bash
   elementor search-replace "old" "new" -p 42 --local --dry-run
   ```

2. **Backup Before Bulk Changes**
   ```bash
   cp -r .elementor-cli/pages .elementor-cli/pages.backup
   ```

3. **Review Changes**
   ```bash
   elementor diff 42  # Review before pushing
   ```

4. **Chain Operations**
   ```bash
   # Multiple replacements before pushing
   elementor search-replace "url1" "url2" -p 42 --local
   elementor search-replace "text1" "text2" -p 42 --local
   elementor diff 42
   elementor push 42
   ```

## Technical Details

### Search Algorithm

The local search-replace uses a deep traversal algorithm:

1. **Elements Tree**: Recursively searches through all nested elements
2. **Settings Objects**: Searches all key-value pairs in settings
3. **Arrays**: Handles arrays of strings and objects
4. **Preservation**: Maintains object references and structure

### Performance

- Local operations are significantly faster than remote
- No network latency
- Batch multiple replacements before pushing
- Suitable for large-scale migrations

## See Also

- `elementor pull` - Download pages for local editing
- `elementor push` - Upload local changes to WordPress
- `elementor diff` - Compare local and remote versions
- `elementor audit` - Check for URL mismatches