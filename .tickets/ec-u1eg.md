---
id: ec-u1eg
status: open
deps: []
links: []
created: 2026-04-09T18:19:41Z
type: bug
priority: 1
assignee: Jens Kouros
parent: ec-hhi8
tags: [review, bug, pagination, api]
---
# listPages truncates results at 100 pages

WordPressClient.listPages hard-codes per_page=100 and does not follow pagination headers. Commands that rely on it treat the first page as the full dataset, so larger sites are silently truncated.

Affected areas include pages list, pull --all, search-replace, and Studio page listing.

## Acceptance Criteria

Commands that enumerate pages retrieve the full remote dataset or clearly expose pagination to the caller.
Behavior is tested against multi-page API responses.
User-facing commands no longer silently omit pages after the first 100.
