# Changelog

All notable changes to elementor-cli will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-09-07

### Added

- **Safe deployment workflow** - Added guarded planning, staged upload, publication, rollback, status, integrity verification, database backup, and smoke-check commands.
- **Dependency management** - Added dependency inventory, installation, integrity checks, update planning and application, and vulnerability auditing through reusable WP-CLI transports.
- **Safe user inventory** - Added site-aware user listing with fixed field allowlists, optional email inclusion, and private JSON output.
- **Configurable push revisions** - Added the `createRevisions` site option, `--revision` and `--no-revision` overrides, and production safety confirmation.
- **Elementor version preservation** - Pull and push now round-trip the `_elementor_version` post meta value.
- **Preview E2E coverage** - Added Docker-based preview workflow coverage.

### Changed

- Updated compatibility tracking through Elementor 4.2.4 and WordPress 7.1.
- Expanded command, configuration, API, and deployment documentation.

### Fixed

- Preserved complete local page data after push.
- Corrected default revision configuration, page deletion semantics, database dump paths, dependency checksums, and E2E overwrite behavior.

## [0.4.1] - 2026-02-14

### Fixed

- **Critical: REST API serialization fix** - The `_elementor_page_settings` meta field must be sent as a JavaScript object to the WordPress REST API, not a JSON string. The v0.4.0 release incorrectly used `JSON.stringify()` which caused the REST API to reject requests with the error `'meta._elementor_page_settings is not of type object'`. This broke all page creation and update operations. (#18)

### Changed

- Closed all resolved GitHub issues from v0.4.0 that were left open

## [0.4.0] - 2026-02-14

### Added

- **Configurable container runtime** - Support for both Docker and Podman via `staging.containerRuntime` config option. Podman users no longer need workarounds. (#35)
- **Elementor cache invalidation** - The `search-replace` and `regenerate-css` commands now automatically clear `_elementor_element_cache` to ensure changes are immediately visible on the front-end. Previously, changes were saved but stale cached HTML was displayed. (#34)
- **Plugin asset enqueuing on staging** - Force enqueue CSS/JS assets for plugins like responsive-menu that don't load correctly on staging environments. (#19)
- **Push undo functionality** - Added `--undo` flag to the `push` command to revert the last push operation.

### Fixed

- **Silent error swallowing** - Added debug logging for temp file cleanup errors instead of silently catching and ignoring them. (#30)
- **search-replace local mode** - Fixed LocalStore initialization in search-replace when using local mode.

### Changed

- **Hardcoded paths extracted** - All hardcoded file paths moved to `src/utils/constants.ts` for easier configuration and maintenance. (#33)
- **Dynamic version reading** - The `export` command now reads version from `package.json` instead of using a hardcoded value. (#29)
- **Type improvements** - Replaced `z.any()` with a proper recursive `ElementorElement` schema for better type safety in template validation. (#27)
- **Type exports** - Template types are now properly exported from the `types/index.ts` barrel file. (#28)
- **Test organization** - Moved `wordpress-client.test.ts` to the `tests/unit/` directory following project conventions. (#26)
- **Utility consolidation** - Extracted duplicated `countElements`, `extractUrls`, and `parseHost` functions into shared utility modules. (#22, #23, #24)

### Removed

- **Cleanup** - Removed `.ralph-loop-output/` directory from git tracking and added to `.gitignore`. (#25)

### Compatibility

- Verified compatibility with Elementor 3.35.4 (#20)
