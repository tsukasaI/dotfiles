---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---

# Go

- Run `go vet ./...`, `golangci-lint run`, and `go test ./...` before considering changes complete.
- Wrap errors with `fmt.Errorf("context: %w", err)`.
- Never discard an error without a comment justifying why it's safe, including errors from `defer`red `Close`/`Flush` on writes.
- Use table-driven tests.
