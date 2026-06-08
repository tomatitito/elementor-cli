---
id: ec-nmhl
status: open
deps: []
links: []
created: 2026-04-09T18:20:00Z
type: bug
priority: 2
assignee: Jens Kouros
parent: ec-hhi8
tags: [review, bug, api, diagnostics]
---
# WordPress error handling hides non-JSON HTTP failures

WordPressClient assumes every non-2xx response body is JSON and immediately calls response.json(). If a proxy, auth layer, maintenance page, or PHP fatal returns HTML, plain text, or an empty body, the CLI throws a parsing error and loses the real HTTP status/body context.

## Acceptance Criteria

Non-JSON error responses surface a useful error message that includes at least HTTP status and response text when available.
JSON error bodies still preserve WordPress-specific messages.
Tests cover JSON, text, HTML, and empty-body failures.
