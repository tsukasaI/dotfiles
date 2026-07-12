---
paths:
  - "**/*.rs"
  - "**/Cargo.toml"
  - "**/Cargo.lock"
---

# Rust

- Run `cargo fmt`, `cargo clippy`, and `cargo test` before considering changes complete.
- Prefer `thiserror` for library error types, `anyhow` for applications.
- Use `#[must_use]` where appropriate.
- Don't silently drop errors from fallible iterators with `.ok()` / `.filter_map(Result::ok)` / `if let Ok(x)` — handle each `Err` or collect failures alongside successes (see rules/error-handling.md).
- Counters aggregating external data (byte totals across inputs) use `u64` with `saturating_add`, not bare `usize` `+` — wrapping arithmetic in a counting path is a silent wrong answer on 32-bit targets and a panic in debug builds.
