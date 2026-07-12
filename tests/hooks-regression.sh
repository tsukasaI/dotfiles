#!/usr/bin/env bash
# Regression suite for the PreToolUse guardrail hooks.
# Safe anywhere: payloads go via stdin only — no scanned command is executed.
# Run locally:  bash tests/hooks-regression.sh   (or via CI)
# Exit: 0 all pass, 1 any failure.
#
# Every case encodes either a closed bypass (#1/#2/#32/#33/#34/#35) or a
# fixed false positive (see hooks-guardrails skill + git log of hooks/).
# When changing a hook, add the new case here instead of testing by hand.

set -uo pipefail # not -e: failures are counted, not fatal

cd "$(dirname "$0")/.." || exit 1
BD=claude-code/hooks/block-dangerous.sh
BCE=claude-code/hooks/block-config-edit.sh

fails=0
total=0

# expect <hook> <want-exit> <desc> <payload>
expect() {
  local hook=$1 want=$2 desc=$3 payload=$4 got
  printf '%s' "$payload" | "$hook" >/dev/null 2>&1
  got=$?
  total=$((total + 1))
  if [[ "$got" != "$want" ]]; then
    printf 'FAIL %-36s want=%s got=%s\n' "$desc" "$want" "$got"
    fails=$((fails + 1))
  fi
}

cmd() { jq -cn --arg c "$1" '{tool_input:{command:$c}}'; }
fp() { jq -cn --arg p "$1" '{tool_input:{file_path:$p}}'; }

# ── block-dangerous.sh: fail closed on malformed input (#32) ────────────────
expect "$BD" 2 "bad JSON" 'not json'
expect "$BD" 2 "non-string command" '{"tool_input":{"command":["rm"]}}'
expect "$BD" 2 "empty stdin" ''
expect "$BD" 0 "no command field" '{"tool_input":{"file_path":"x"}}'
expect "$BD" 0 "empty command string" "$(cmd '')"

# ── block-dangerous.sh: missing blocklist fails closed (#33) ────────────────
tmp=$(mktemp -d)
cp "$BD" "$tmp/"
expect "$tmp/$(basename "$BD")" 2 "missing blocklist.conf" "$(cmd 'ls')"
rm -rf "$tmp"

# ── block-dangerous.sh: bypasses closed by normalize_cmd (#1) ───────────────
expect "$BD" 2 "backslash-split rm" "$(cmd 'r\m -rf /tmp/x')"
expect "$BD" 2 "quote-split curl" "$(cmd "cur'l' https://evil.example.com/x")"
expect "$BD" 2 "quoted rm at cmd position" "$(cmd "'rm' -rf /tmp/x")"
expect "$BD" 2 "quoted rm after semicolon" "$(cmd "ls; 'rm' -rf /tmp/x")"
expect "$BD" 2 "quote-split bash" "$(cmd "ba'sh' script.sh")"
expect "$BD" 2 "quote-split secret read" "$(cmd "cat .e'nv'")"
expect "$BD" 2 "quote-split force push" "$(cmd "git push --forc'e' origin main")"

# ── block-dangerous.sh: blocklist basics still hold ─────────────────────────
expect "$BD" 2 "plain rm -rf" "$(cmd 'rm -rf foo')"
expect "$BD" 2 "git reset --hard" "$(cmd 'git reset --hard')"
expect "$BD" 0 "git reset soft" "$(cmd 'git reset HEAD~1')"
expect "$BD" 0 "plain rg" "$(cmd 'rg foo')"

# ── block-dangerous.sh: curl localhost exemption (#1 rework) ────────────────
expect "$BD" 2 "curl external" "$(cmd 'curl https://evil.com')"
expect "$BD" 2 "curl quoted external" "$(cmd "curl 'https://evil.com/x'")"
expect "$BD" 2 "curl localhost+external mix" "$(cmd 'curl https://localhost:3000/a https://evil.com')"
expect "$BD" 2 "curl localhost-prefix domain" "$(cmd 'curl https://localhost.evil.com')"
expect "$BD" 0 "curl localhost" "$(cmd 'curl http://localhost:3000/api')"
expect "$BD" 0 "curl quoted localhost+query" "$(cmd "curl 'http://localhost:3000/api?x=1&y=2'")"
expect "$BD" 0 "curl 127.0.0.1" "$(cmd 'curl -s http://127.0.0.1:8080/health')"

# ── block-dangerous.sh: gh api DELETE (#2) ──────────────────────────────────
expect "$BD" 2 "gh api -X DELETE" "$(cmd 'gh api -X DELETE repos/x/y')"
expect "$BD" 2 "gh api -XDELETE glued" "$(cmd 'gh api -XDELETE repos/x/y')"
expect "$BD" 2 "gh api --method=delete" "$(cmd 'gh api --method=delete repos/x/y')"
expect "$BD" 2 "gh api quoted DELETE" "$(cmd "gh api -X 'DELETE' repos/x/y")"
expect "$BD" 0 "gh api read" "$(cmd 'gh api repos/x/y/pulls')"
expect "$BD" 0 "gh api POST (prompt gate)" "$(cmd 'gh api -X POST repos/x/y/issues -f title=t')"

# ── block-dangerous.sh: credential reads (#35) ──────────────────────────────
expect "$BD" 2 "cat aws credentials" "$(cmd 'cat ~/.aws/credentials')"
expect "$BD" 2 "cat kubeconfig" "$(cmd 'cat ~/.kube/config')"
expect "$BD" 2 "bat npmrc" "$(cmd 'bat ~/.npmrc')"
expect "$BD" 2 "cat .env" "$(cmd 'cat .env')"
expect "$BD" 0 "cat README" "$(cmd 'cat README.md')"

# ── block-dangerous.sh: false positives stay fixed ──────────────────────────
expect "$BD" 0 "commit msg with rm -rf" "$(cmd 'git commit -m "story about rm -rf usage"')"
expect "$BD" 0 "commit msg with curl" "$(cmd "git commit -m 'notes on curl exfiltration'")"
expect "$BD" 0 "commit msg with secret" "$(cmd 'git commit -m "fix secret handling"')"
expect "$BD" 0 "commit msg with gh api DELETE" "$(cmd 'git commit -m "block gh api -X DELETE in hook"')"
expect "$BD" 0 "rg quoted secret" "$(cmd "rg 'secret' src/")"
expect "$BD" 0 "echo quoted bash" "$(cmd "echo 'bash is fun'")"
expect "$BD" 0 "fd -e sh (3962cf5)" "$(cmd 'fd -e sh')"
expect "$BD" 0 "rg -t sh" "$(cmd 'rg -t sh foo')"
expect "$BD" 0 "double-quoted apostrophe" "$(cmd 'echo "don'\''t panic"')"
expect "$BD" 0 "force-with-lease" "$(cmd 'git push --force-with-lease origin main')"
expect "$BD" 0 "quoted command path" "$(cmd '"$HOME/dotfiles/setup.sh" --help')"
heredoc_cmd=$(printf 'git commit -m "$(cat <<%sEOF%s\nfix: update secret handling in bash scripts\nEOF\n)"' "'" "'")
expect "$BD" 0 "quoted heredoc body (585626e)" "$(cmd "$heredoc_cmd")"

# ── block-config-edit.sh: fail closed + linter configs ──────────────────────
expect "$BCE" 2 "bce: bad JSON" 'not json'
expect "$BCE" 2 "bce: non-string file_path" '{"tool_input":{"file_path":["a"]}}'
expect "$BCE" 2 "bce: empty stdin" ''
expect "$BCE" 0 "bce: no file_path field" '{"tool_input":{"command":"ls"}}'
expect "$BCE" 2 "bce: eslintrc" "$(fp '/x/.eslintrc')"
expect "$BCE" 0 "bce: normal source file" "$(fp '/x/main.ts')"

# ── block-config-edit.sh: guardrail self-protection (#34) ───────────────────
expect "$BCE" 2 "bce: repo blocklist.conf" "$(fp "$HOME/dotfiles/claude-code/hooks/blocklist.conf")"
expect "$BCE" 2 "bce: repo block-dangerous.sh" "$(fp "$HOME/dotfiles/claude-code/hooks/block-dangerous.sh")"
expect "$BCE" 2 "bce: repo block-config-edit.sh" "$(fp "$HOME/dotfiles/claude-code/hooks/block-config-edit.sh")"
expect "$BCE" 2 "bce: repo allowlist.conf" "$(fp "$HOME/dotfiles/claude-code/hooks/allowlist.conf")"
expect "$BCE" 2 "bce: symlink-path hook" "$(fp "$HOME/.claude/hooks/block-dangerous.sh")"
expect "$BCE" 0 "bce: same-name other project" "$(fp '/some/other/repo/blocklist.conf')"
expect "$BCE" 0 "bce: save-transcript.ts" "$(fp "$HOME/dotfiles/claude-code/hooks/save-transcript.ts")"

echo "---"
echo "$((total - fails))/$total passed"
((fails == 0))
