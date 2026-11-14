# Shell tooling

shguard allows a Bash command only when it parsed the whole command and every
simple command matches a catalog row; everything else is refused. Use the
built-ins first (`Grep` for content, `Glob` for filenames). `find`, `sed`, and
`awk` are refused outright (they can never get a catalog row), as are `curl`,
non-GET `gh api`, and most other commands; `grep` ignores `.gitignore`, so
prefer `rg`. `fd` works on a directory named relative to the working directory;
its `-x` form and absolute paths under `/Users` are refused.

## Idioms the built-ins can't do

- `rg -l pattern | wc -l`, `rg --count-matches` — counts via pipes (use
  relative paths)
- `ls` — one-level directory listing (no built-in)
- `tokei .` — language-wise LOC; prefer over reading many files just to gauge size
- `rg -n "\x{30e6}\x{30fc}\x{30b6}\x{30fc}" path`: a pattern with non-ASCII text (Japanese) is refused as a raw byte, but the same text written as `\x{...}` Unicode escapes passes; the path itself must still be ASCII

## Unsupported shell syntax is refused

The parser accepts only simple commands, pipelines, `&&`, `||`, `;`, quoting,
`"${NAME}"`, a leading `~`, and the redirects `2>&1`, `>&2`, `>/dev/null`,
`2>/dev/null`. `$(...)`, unquoted `$X`, globs, `> file`, `<`, heredocs,
subshells, braces, assignments, and `&` are refused (`ask_outcome = "deny"`).
`$TMPDIR` and `$HOME` are the exception: the `dotfiles-mod` plugin rewrites
them to literal paths before shguard sees the command (not inside single
quotes; any heredoc/here-string, `$(...)`, backquote, or `HOME=`/`TMPDIR=`
assignment anywhere in the command disables the rewrite for the whole
command). A word starting with `~` in option position is also refused, so
`cat ~/x` fails.
