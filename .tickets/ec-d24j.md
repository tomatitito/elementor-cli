---
id: ec-d24j
status: open
deps: []
links: []
created: 2026-04-09T18:20:12Z
type: bug
priority: 2
assignee: Jens Kouros
parent: ec-hhi8
tags: [review, bug, db, cli]
---
# db dump --output mangles absolute paths

The db dump command always prefixes process.cwd() when writing output. Absolute output paths therefore become invalid paths under the current working directory instead of being respected as absolute destinations.

## Acceptance Criteria

Relative paths remain rooted to the project as intended.
Absolute paths are written exactly as provided.
Tests cover both relative and absolute output destinations.
