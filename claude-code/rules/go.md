---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---

# Go

- Run `go vet ./...`, `golangci-lint run`, and `go test ./...` before considering changes complete.
- Wrap errors with `fmt.Errorf("context: %w", err)`.
- Never discard an error with `_` — wrap and return, or log it, including errors from `defer`red `Close`/`Flush` on writes.
- Use table-driven tests.
