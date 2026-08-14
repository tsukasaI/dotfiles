# Shell tooling

`grep`/`egrep`/`fgrep`/`find` are hook-blocked: they ignore `.gitignore` and
walk into `node_modules`, wasting tokens. Use the built-ins — `Grep` for
content, `Glob` for filenames — or `rg`/`fd` when Bash is needed.

## Idioms the built-ins can't do

- `fd --changed-within 1d` — recently modified files
- `fd --size +10m` — large files
- `rg -l pattern | wc -l`, `rg --count-matches` — counts via pipes
- `ls` / `eza` — one-level directory listing (no built-in)
- `eza --tree -L 2 -I 'node_modules|.git'` — recursive tree overview
- `tokei .` — language-wise LOC; prefer over reading many files just to gauge size
