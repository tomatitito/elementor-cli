---
id: ec-5y0u
status: open
deps: []
links: []
created: 2026-04-09T18:20:05Z
type: bug
priority: 2
assignee: Jens Kouros
parent: ec-hhi8
tags: [review, bug, testing, bun]
---
# default test script uses an invalid Bun ignore pattern

package.json defines the default test script as bun test --ignore 'tests/e2e/**'. Bun treats that as a filename filter that matches no test files and exits non-zero, so bun run test is broken.

## Acceptance Criteria

bun run test executes the intended non-E2E suite successfully.
The test script matches Bun CLI semantics.
CI/local docs use the corrected command.
