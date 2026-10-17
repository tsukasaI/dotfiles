---
paths:
  - "pi/**"
---

# pi/

Pi coding agent on API-key billing, kept off Claude Code's subscription.

- `pi-factory` (→ `~/.local/bin`) reads the key from Keychain service
  `claude-factory` and exports it to that process only.
- `--build` builds `pi-sandbox:<host pi --version>` from `Dockerfile.pi`
  (the host's nixpkgs Pi is the only version source).
- `--container` runs that tag under apple/container (Homebrew `container`),
  mounting only `$PWD`, and refuses if the tag is missing.
- `settings.json` → `~/.pi/agent/settings.json`.
- The `pi` binary itself comes from nixpkgs (`pi-coding-agent`).
