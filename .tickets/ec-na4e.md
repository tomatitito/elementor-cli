---
id: ec-na4e
status: open
deps: []
links: [ec-3l2b]
created: 2026-04-09T19:25:31Z
type: bug
priority: 1
assignee: Jens Kouros
external-ref: gh-43
tags: [github, bug, push, css]
---
# remote CSS cache invalidation remains ineffective after push

GitHub issue #43 reports that CSS remains stale after push on remote/production sites. Current code still clears _elementor_css and _elementor_element_cache by setting empty strings via REST API and only runs wp elementor flush-css for container-configured sites. Remote/SSH sites do not get an equivalent flush path.

Source: gh-43

## Acceptance Criteria

CSS invalidation works for remote/non-container production sites after push.
Meta invalidation semantics match what Elementor actually requires.
If remote SSH support is the chosen fix path, push/regenerate-css can run the necessary remote flush commands.
Tests or documented verification cover remote invalidation behavior.
