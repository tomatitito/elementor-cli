---
id: ec-3l2b
status: open
deps: []
links: [ec-na4e]
created: 2026-04-09T19:48:13Z
type: bug
priority: 1
assignee: Jens Kouros
tags: [investigation, production, push, elementor]
---
# production push stores correct Elementor data but frontend still renders stale structure

Based on production-push-analysis.md: after pushing production page 2849, _elementor_data appears correct in the database and via the REST API, but the frontend still renders the old page structure/content. This is broader than CSS alone and may involve duplicate _elementor_data rows, revision/autosave precedence, hosting cache layers, or Elementor internal render caches.

Source note was captured in production-push-analysis.md and then removed from the worktree.

## Acceptance Criteria

The root cause is identified with a reproducible verification path.
If this is a code bug, the fix is tracked or implemented with regression coverage where feasible.
If this is environmental/hosting behavior, the ticket documents the required operational remediation.
