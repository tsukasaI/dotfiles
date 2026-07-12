---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---

# Go

- Run `go vet ./...`, `golangci-lint run`, and `go test ./...` before considering changes complete.
- Wrap errors with `fmt.Errorf("context: %w", err)`.
- Use table-driven tests.
