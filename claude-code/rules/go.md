---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---

# Go

- Run `go vet ./...`, `golangci-lint run`, and `go test ./...` before considering changes complete.
- Conventions (error wrapping, discarded errors, tests, layout) live in coding-guidelines `languages/go.md`, which loads alongside this rule from `~/.claude/rules/coding-guidelines/`.
