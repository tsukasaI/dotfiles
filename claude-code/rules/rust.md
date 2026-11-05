---
paths:
  - "**/*.rs"
  - "**/Cargo.toml"
  - "**/Cargo.lock"
---

# Rust

- Run `cargo fmt`, `cargo clippy --all-targets -- -D warnings`, and `cargo test` before considering changes complete.
- Conventions (error types, fallible iterators, counters, lints) live in coding-guidelines `languages/rust.md`, which loads alongside this rule from `~/.claude/rules/coding-guidelines/`.
