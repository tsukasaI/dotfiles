# Cloud sessions

Verification log: `docs/cloud-sessions.md`.

- `claude-code/cloud/setup.sh` fetches `CLAUDE.md`, `rules/`, `skills/` and
  `agents/` from raw.githubusercontent.com at a pinned commit, verifies each
  file against `cloud/manifest.sha256`, appends `cloud/CLAUDE.cloud.md` (the
  cloud-only deltas) to `~/.claude/CLAUDE.md`, turns git signing off, and
  installs sqlite3, gitleaks, atlas, cargo-deny and cargo-audit at the versions
  pinned in the script.
- Two environments, split by network and secret boundary rather than by repo:
  `personal-dev` (Custom: the default list plus `atlasbinaries.com`, this
  script) and `macromenu-ingest` (Custom: the default list plus
  `www.matsuyafoods.co.jp`, macromenu's own setup script). Repo-specific setup
  belongs in that repo's SessionStart hook.
- The git identity is not in the script: the platform rewrites
  `user.name`/`user.email` in `~/.gitconfig` after it runs. Set
  `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and
  `GIT_COMMITTER_EMAIL` in the environment's variables instead.
- `cloud/setup.sh` also installs the `tsukasaI/coding-guidelines` files listed in
  `cloud/coding-guidelines.sha256`, at the commit in
  `cloud/coding-guidelines.ref`, into `~/.claude/rules/coding-guidelines/`
  (the same list `setup.sh` links on the Mac). Re-pin with
  `bash tests/coding-guidelines-pin.sh --write <coding-guidelines main commit>`,
  then regenerate the manifest.
- `cloud/exclude.txt` lists the Mac-only skills left out, with reasons.
- Renew the pin: `bash claude-code/cloud/pin.sh <main commit>` and paste the
  output into the environment's setup-script box. Until then cloud sessions
  keep the old pinned config.
