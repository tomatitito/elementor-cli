---
id: ec-t1o9
status: open
deps: []
links: []
created: 2026-06-17T07:25:57Z
type: task
priority: 1
assignee: Jens Kouros
tags: [architecture, coupling, refactor]
---
# Extract shared push and staging sync workflows

Balanced Coupling review found duplicated high-volatility workflow knowledge across CLI commands and Studio API. The risky areas are:\n\n- CLI push in src/commands/push.ts has conflict checks, revision handling, post-push local metadata updates, CSS invalidation, and production safety prompts.\n- Studio API push in src/studio/api.ts directly calls WordPressClient.updatePage, bypassing much of that safety behavior.\n- Staging sync behavior is duplicated in src/commands/preview.ts for sync and watch, and again in src/studio/api.ts.\n- src/commands/preview.ts has grown into a large orchestration file mixing Docker lifecycle, WordPress setup, mu-plugin generation, page sync, watch mode, URL rewriting, and element lookup.\n\nThis is unbalanced functional coupling: multiple modules know the same workflow rules, but they are far enough apart that behavior can diverge as features evolve.

## Design

Introduce explicit application/use-case services to turn duplicated functional coupling into contract coupling:\n\n1. Add src/application/push-page.ts\n   - Encapsulate the common push workflow.\n   - Support conflict detection, revision policy, CSS invalidation, and local store update.\n   - Expose options for CLI prompts/force/dry-run and Studio API policy.\n\n2. Add src/application/sync-page-to-staging.ts\n   - Encapsulate local page load, optional URL rewriting, staging create/update, Elementor meta update, and CSS flush.\n   - Reuse from preview sync, preview watch, and Studio API /api/sync/:id.\n\n3. Thin src/commands/preview.ts\n   - Keep Commander wiring in the command file.\n   - Move setup/sync/watch implementation behind application services where practical.\n\n4. Consider later splitting DockerManager if it keeps changing:\n   - ContainerRuntime / ComposeProject / WpCli / StagingWordPressAdmin / ElementorStagingOps.

## Acceptance Criteria

- CLI push and Studio API push use the same shared push use case or an explicitly shared lower-level service.\n- Studio API push no longer bypasses conflict/revision/cache/local-metadata policy unintentionally.\n- preview sync, preview watch, and Studio API sync reuse one staging-sync implementation.\n- Existing unit and e2e tests pass.\n- Add or update tests covering the shared push and staging sync behavior.\n- preview.ts has materially less workflow duplication; command handlers mostly delegate to use-case services.

