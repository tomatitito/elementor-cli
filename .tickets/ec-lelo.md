---
id: ec-lelo
status: open
deps: []
links: [ec-fndw, ec-cvu5]
created: 2026-04-09T18:19:54Z
type: bug
priority: 1
assignee: Jens Kouros
parent: ec-hhi8
tags: [review, bug, preview, config]
---
# preview ignores preview config and falls back to staging defaults

The preview workflow reads config.staging, while some tests and configs use a preview key. Because the schema only preserves staging, preview-specific values can be dropped and commands fall back to defaults like http://localhost:8080.

This causes configured preview ports and paths to be ignored in affected setups.

## Acceptance Criteria

Preview configuration keys are consistent across schema, commands, docs, and tests.
Configured preview URL/port/path values are preserved and used by preview commands.
Regression tests cover non-default preview ports.
