---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---

# Go

- Run `go vet ./...` and `golangci-lint run` before considering changes complete.
- Wrap errors with `fmt.Errorf("context: %w", err)`.
- Use table-driven tests.
