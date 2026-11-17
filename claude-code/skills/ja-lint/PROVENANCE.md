# ja-lint provenance

`scripts/yomiyasu_lint.py` and `scripts/markdown_visibility.py` (which the
linter imports) are vendored unmodified from
https://github.com/nanaism/yomiyasu (MIT, see `LICENSE`; Unicode-derived
emoji data, see `UNICODE-LICENSE.txt`) at release `v3.0.0`, commit
`7b212ff2f037953b8c233ae315e5c08e7fc36da6`. Standard library only, no
network or subprocess use. Blob pins (`git hash-object <file>`):

- `scripts/yomiyasu_lint.py`: `9670465b81281e1172a8141eabbfcb228363c755`
- `scripts/markdown_visibility.py`: `82f8282b8cc4187deaeedc1daad8eef6df53f0a9`

`scripts/test_yomiyasu_lint.py` pins the fence/frontmatter behavior the
skill relies on (`python3 -I` it). Renewal: when bumping, read the upstream
diff, copy both files unmodified, run the test, and update the release,
commit and blob SHAs above. `ja-lint` runs a store copy, so the new files take
effect after `darwin-rebuild switch`. Claude cannot edit `scripts/`
(`block-config-edit.sh`), so the copy step is the user's.
