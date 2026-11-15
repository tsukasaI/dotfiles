# srt settings for a repo's pre-push commands, rendered per run because
# $TMPDIR and a worktree's git common dir differ per invocation.
# Inputs: $tmp ($TMPDIR), $common (absolute git common dir), $uid.
{
  # Loopback bind only: workerd/miniflare test runtimes listen on 127.0.0.1.
  network: { allowedDomains: [], deniedDomains: [], allowLocalBinding: true },
  filesystem: {
    denyRead: [
      "~/.ssh", "~/.aws", "~/.gnupg", "~/.kube", "~/.docker/config.json",
      "~/.config/gh", "~/.config/gcloud", "~/.netrc", "~/.npmrc", "~/.pypirc",
      "~/.pgpass", "~/.claude", "~/.claude.json", "~/.pi/agent/auth.json",
      "~/Library/Application Support/turso"
    ],
    # Not the whole pnpm store: wrapped code could then poison packages that
    # other repos and unwrapped runs install. A frozen install that is already
    # up to date only takes these locks (paths from the kernel's deny log).
    allowWrite: [
      ".", $tmp, "~/.cache", $common,
      # srt points TMPDIR inside the sandbox here but does not allow it.
      "/private/tmp/claude-\($uid)",
      "/private/tmp/pnpm-dir-locks-\($uid)",
      "/private/tmp/pnpm-store-operation-locks-\($uid)",
      # Not a * for the version: the glob form was still denied in a test run.
      "~/Library/pnpm/package-manager-store/v11/tmp/engine-locks",
      "~/Library/Preferences/.wrangler/logs"
    ],
    # The files that decide what the next push runs, so wrapped code cannot
    # unwrap or skip it (same set as settings.json's sandbox denyWrite).
    denyWrite: [
      "~/**/lefthook.*", "~/**/lefthook-local.*", "~/**/.lefthook*",
      "~/**/.gitleaks.toml", "~/**/.gitleaksignore",
      "~/**/.git/hooks", "~/**/.git/config",
      ($common + "/hooks"), ($common + "/config")
    ]
  }
}
