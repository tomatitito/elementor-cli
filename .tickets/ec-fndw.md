---
id: ec-fndw
status: open
deps: []
links: [ec-lelo, ec-cvu5]
created: 2026-04-09T18:19:16Z
type: bug
priority: 0
assignee: Jens Kouros
parent: ec-hhi8
tags: [review, bug, preview, studio, staging]
---
# preview and studio sync update the wrong staging post on first sync

When staging does not already contain the target page, the code creates a new page but keeps writing Elementor meta to the original local page ID instead of the returned staging ID. First-time syncs can fail or mutate the wrong post.

Evidence:
- src/commands/preview.ts ignores newId after createPage()
- src/studio/api.ts creates a page and continues updating pageId

## Acceptance Criteria

Both preview sync and Studio sync use the created staging post ID for all subsequent meta writes.
First sync of a previously missing page succeeds end-to-end.
Tests cover create-vs-update paths in both entrypoints.
