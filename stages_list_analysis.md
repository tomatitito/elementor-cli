# Analysis: Missing `stages list` Command

## Issue
The `stages list` command does not exist in the elementor-cli. The user expected a command to list local pages for the staging site.

## Current State
- Local staging pages are stored in `.elementor-cli/pages/{site-name}/` directories
- There is no CLI command to list locally stored pages
- The `pages list` command only lists remote pages from the WordPress site

## Proposed Solution
Add a `stages` command group with the following subcommands:
1. `stages list` - List local pages stored for the staging site
2. `stages delete <page-id>` - Delete a locally stored staging page

## Implementation Plan
1. Create a new command module `src/commands/stages.ts`
2. Implement `stages list` to read from `.elementor-cli/pages/staging/` directory
3. Implement `stages delete` to remove local page directories
4. Register the command in the main CLI entry point

## Alternative Approach
Could also extend existing commands:
- `pages list --local` to list local pages
- `pages delete --local <page-id>` to delete local pages

The alternative approach is more consistent with existing CLI design.
