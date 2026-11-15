{ coreutils, git, gnused, jq, sandbox-runtime, writeShellApplication }:
writeShellApplication {
  name = "prepush-sandbox";
  runtimeInputs = [ coreutils git gnused jq ];
  # git push runs lefthook's pre-push outside Claude Code's Bash sandbox, so a
  # repo's own code (tests, verify scripts) would run unconfined. lefthook
  # wraps those commands with this; cloud/setup.sh installs a pass-through
  # under the same name, where the container is the boundary.
  text = ''
    if [ "$#" -eq 0 ]; then
      echo "prepush-sandbox: usage: prepush-sandbox <command> [args...]" >&2
      exit 2
    fi
    common=$(git rev-parse --path-format=absolute --git-common-dir)
    dir=$(mktemp -d)
    trap 'rm -rf "$dir"' EXIT
    # Not $TMPDIR as given: it can be /var/... or /tmp/..., and the kernel
    # checks the resolved /private/... path.
    tmp=$(realpath "''${TMPDIR:-/tmp}")
    jq -n --arg tmp "$tmp" --arg common "$common" --arg uid "$(id -u)" \
      -f ${./prepush-sandbox/srt-settings.jq} >"$dir/srt.json"
    # Not srt's own argv: it dropped operands in a test (sh -c '...' _ 'a b'
    # printed nothing), so each word is single-quoted into one -c string.
    cmd=""
    for word in "$@"; do
      cmd="$cmd '$(printf '%s' "$word" | sed "s/'/'\\\\'''/g")'"
    done
    # Network is denied, so a pnpm/npm fetch (pnpm audit in a verify script)
    # only waits out its timeout: 71s of a 108s verify in a measured run, and
    # retries=0 alone did not shorten it. Both prefixes: pnpm 11 reads pnpm_config_*.
    export npm_config_fetch_retries=0 npm_config_fetch_timeout=5000
    export pnpm_config_fetch_retries=0 pnpm_config_fetch_timeout=5000
    debug=()
    [ "''${PREPUSH_SANDBOX_DEBUG:-}" = 1 ] && debug=(--debug)
    status=0
    ${sandbox-runtime}/bin/srt "''${debug[@]}" --settings "$dir/srt.json" -c "$cmd" || status=$?
    exit "$status"
  '';
}
