---
id: ec-6u3z
status: open
deps: []
links: []
created: 2026-04-09T18:19:26Z
type: bug
priority: 1
assignee: Jens Kouros
parent: ec-hhi8
tags: [review, bug, push, revisions, elementor]
---
# remote page settings cannot be cleared during push or restore

The client intentionally omits _elementor_page_settings when the settings object is empty. That means pushing a page with empty settings, or restoring a revision with empty/no settings, leaves old remote settings in place instead of clearing them.

Evidence:
- src/services/wordpress-client.ts only sends _elementor_page_settings when Object.keys(pageSettings).length > 0
- src/services/revision-manager.ts restoreRevision() passes possibly empty settings into updatePage()
- src/commands/push.ts uses the same update path

## Acceptance Criteria

Pushing or restoring empty settings produces the intended cleared state on the remote page.
Behavior is consistent across normal push, revision restore, and undo flows.
Regression tests cover existing-settings to empty-settings transitions.
