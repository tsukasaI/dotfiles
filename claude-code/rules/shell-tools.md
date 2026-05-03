# Shell tooling

## Hard rules

- **Never** invoke `grep`, `egrep`, `fgrep`, or `find` via Bash — they ignore `.gitignore` and walk into `node_modules`, wasting tokens. The PreToolUse hook blocks them.
- For content search: use `Grep` (built-in, ripgrep-backed) or `rg` via Bash.
- For filename search: use `Glob` (built-in) or `fd` via Bash.

## Built-in tools first

Built-in tools already skip `node_modules`, `dist`, `target`, etc., and avoid shell-quoting overhead.

| Task | First choice | Bash fallback (when built-in can't) |
|---|---|---|
| Search file contents | `Grep` | `rg` |
| Find files by name | `Glob` | `fd` |
| List a directory (one level) | `LS` | `eza` |
| Read a file | `Read` | — |

## When Bash is unavoidable

- `fd --changed-within 1d` — recently modified files
- `fd --size +10m` — large files
- `rg -l pattern | wc -l`, `rg --count-matches` — counts via pipes
- `eza --tree -L 2 -I 'node_modules|.git'` — recursive tree overview
- `tokei .` — language-wise LOC; prefer over reading many files just to gauge size
