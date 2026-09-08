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

## Avoid shguard ask/block on these two patterns

shguard can't introspect a bare inline script, and can't rule out an
unresolved `$VAR` expanding to a dangerous value anywhere in argv; both
block outright (`ask_outcome` floors every ask to deny). Prefer the form
shguard can verify statically:

- `awk '{ ... }' file`: write the script to a file at a literal path (a
  relative `./script.awk` or an absolute path, not `$TMPDIR/...` and not
  `-`/process substitution, those are themselves unresolved) and run
  `awk -f ./script.awk file` instead. Note this only satisfies shguard, not
  actual safety: awk's `system()`/`print | "cmd"` can still run arbitrary
  shell and the script's contents aren't inspected either way.
- `gh api path/$var`: any unresolved `$var`/command substitution anywhere in
  a `gh api` invocation blocks, regardless of position (`--method GET` placed
  before the var does not help). Resolve the value to a literal first (e.g.
  capture it with a separate command, then paste the literal into the `gh
  api` call) instead of interpolating a variable at all.
