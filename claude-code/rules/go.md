---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---

# Go

- Run `go vet ./...`, `golangci-lint run`, and `go test ./...` before considering changes complete.
- Wrap errors with `fmt.Errorf("context: %w", err)`.
- Error discarding: see `rules/error-handling.md` for the general rule (a comment justifying why it's safe, or don't discard). Go-specific: this includes errors from `defer`red `Close`/`Flush` on writes.
- Use table-driven tests.
