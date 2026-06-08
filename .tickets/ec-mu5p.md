---
id: ec-mu5p
status: open
deps: []
links: []
created: 2026-04-09T18:19:48Z
type: bug
priority: 1
assignee: Jens Kouros
parent: ec-hhi8
tags: [review, bug, config, cli]
---
# config set can corrupt configuration by writing raw strings

The config set command writes every value as a string and skips schema validation. Boolean and enum fields can therefore be persisted in invalid shapes and later fail Zod parsing or change behavior unexpectedly.

Examples:
- createRevisions becomes "true" instead of true
- enum fields like containerRuntime can be set to arbitrary invalid strings

## Acceptance Criteria

config set validates keys and coerces values to the schema type before writing.
Invalid values are rejected with a clear error.
Tests cover booleans, enums, nested fields, and invalid keys.
