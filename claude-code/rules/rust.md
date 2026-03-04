---
paths:
  - "**/*.rs"
  - "**/Cargo.toml"
  - "**/Cargo.lock"
---

# Rust

- Run `cargo clippy` and `cargo test` before considering changes complete.
- Prefer `thiserror` for library error types, `anyhow` for applications.
- Use `#[must_use]` where appropriate.
