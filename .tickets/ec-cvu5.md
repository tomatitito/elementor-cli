---
id: ec-cvu5
status: open
deps: [ec-fndw]
links: [ec-lelo, ec-fndw]
created: 2026-04-09T18:19:31Z
type: bug
priority: 1
assignee: Jens Kouros
parent: ec-hhi8
tags: [review, bug, studio, elementor, serialization]
---
# studio sync stores _elementor_page_settings with the wrong serialization

The preview command passes { format: "json" } when writing _elementor_page_settings through DockerManager, but the Studio API omits that option. As a result, Studio can store raw JSON strings where Elementor expects the PHP-side decoded structure.

Evidence:
- src/commands/preview.ts uses updatePostMeta(..., { format: "json" })
- src/studio/api.ts writes page settings without that option
- src/services/docker-manager.ts only decodes JSON when format=json is supplied

## Acceptance Criteria

Studio sync writes page settings using the same serialization contract as preview sync.
A staging sync initiated from Studio results in Elementor-readable page settings.
Regression tests cover the Studio API path.
