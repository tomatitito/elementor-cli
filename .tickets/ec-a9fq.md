---
id: ec-a9fq
status: open
deps: [ec-6u3z]
links: []
created: 2026-04-09T18:19:10Z
type: bug
priority: 0
assignee: Jens Kouros
parent: ec-hhi8
tags: [review, bug, push, revisions]
---
# push --undo restores the wrong revision

The undo path in the push command selects the newest revision with Elementor data instead of the pre-push backup revision. In normal flows that is likely the current post-push revision, so undo can become a no-op rather than a rollback.

Evidence:
- src/commands/push.ts selects revisions.find((rev) => rev.hasElementorData)
- src/services/revision-manager.ts createBackup() creates a new revision before push, but undo does not identify that specific backup

## Acceptance Criteria

Undo restores the revision that existed immediately before the last push.
Dry-run output identifies the exact revision that would be restored.
Regression tests cover both backup-created and no-backup scenarios.
