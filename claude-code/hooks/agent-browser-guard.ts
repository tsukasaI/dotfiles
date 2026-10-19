#!/usr/bin/env bun
// PreToolUse(mcp__agent-browser__.*) hook: allowlists agent-browser MCP tools
// and constrains their arguments.
// stdin -> JSON: {"hook_event_name":"PreToolUse","tool_name":"mcp__agent-browser__agent_browser_*","tool_input":{...}}
// Fail CLOSED: bad JSON, unexpected shapes, and any exception all deny. Exit 2
// only if the deny verdict itself cannot be printed.

import { realpathSync } from "fs";
import { dirname, resolve } from "path";

const TOOL_PREFIX = "mcp__agent-browser__agent_browser_";
const ALLOWED_ROOT = "/private/tmp/claude-501";

const ALLOWED_TOOLS = new Set([
  "open", "snapshot", "click", "fill", "type", "press", "check", "uncheck", "select", "scroll",
  "wait_ms", "wait_for_selector", "wait_for_text", "wait_for_load",
  "get_text", "get_url", "get_title", "read", "back", "forward", "reload", "close",
  "tab_new", "tab_list", "tab_switch", "tab_close",
  "screenshot", "console", "errors", "network_requests", "network_request", "eval",
  "highlight", "diff_snapshot", "diff_screenshot", "diff_url", "vitals", "a11y",
  "tools_profiles",
]);

const FORBIDDEN_KEYS = new Set([
  "extraArgs", "caCert", "clearCaCert", "restore", "restoreSave", "restoreCheckFn",
  "restoreCheckText", "restoreCheckUrl", "namespace", "screenshotDir", "headed", "webgpu", "webmcp",
]);
const PATH_KEYS = new Set(["path", "output", "baseline"]);
const URL_KEYS = new Set(["url", "url1", "url2"]);
// namespace is in FORBIDDEN_KEYS and never reaches this check.
const NAME_KEYS = new Set(["session"]);
const SAFE_NAME = /^[\w-]+$/;
// Not a closed key allowlist per tool: agent-browser is pre-1.0 and churns its
// schema, so instead any unvetted key that looks like a filesystem or launch
// control fails closed until it is reviewed and added to PATH_KEYS.
// "dir" only as a suffix: scroll's "direction" is not a directory.
const SUSPICIOUS_KEY = /path|dir$|directory|file|output|cert|args|profile|socket|executable/i;

const PREFIX = "agent-browser-guard: ";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Trailing slash on purpose: not a bare startsWith(ALLOWED_ROOT), which would
// accept the sibling /private/tmp/claude-501-evil.
function isUnderRoot(p: string): boolean {
  return p.startsWith(`${ALLOWED_ROOT}/`);
}

function checkPath(key: string, value: unknown): string | null {
  if (typeof value !== "string" || value === "") return `${PREFIX}${key} must be a non-empty string`;
  if (value.includes("\0")) return `${PREFIX}${key} contains NUL`;
  if (value.split(/[\\/]/).includes("..")) return `${PREFIX}${key} contains a ".." segment`;
  // Relative paths are denied, not resolved: the browser daemon's cwd is not
  // this hook's cwd, so path.resolve here would vouch for the wrong directory.
  if (!value.startsWith("/")) return `${PREFIX}${key} must be an absolute path`;

  // macOS /tmp is a symlink to /private/tmp; compare in the canonical spelling.
  const normalized = value.startsWith("/tmp/") ? `/private${value}` : value;
  const resolved = resolve(normalized);
  if (!isUnderRoot(resolved)) return `${PREFIX}${key} must be under ${ALLOWED_ROOT}/`;

  let probe = resolved;
  for (;;) {
    try {
      const real = realpathSync(probe);
      if (real !== ALLOWED_ROOT && !isUnderRoot(real)) {
        return `${PREFIX}${key} escapes ${ALLOWED_ROOT}/ via symlink`;
      }
      return null;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") return `${PREFIX}${key} cannot be verified`;
      const parent = dirname(probe);
      if (parent === probe) return `${PREFIX}${key} cannot be verified`;
      probe = parent;
    }
  }
}

function checkUrl(key: string, value: unknown): string | null {
  if (typeof value !== "string") return `${PREFIX}${key} must be a string`;
  if (value === "about:blank") return null;
  let protocol: string;
  try {
    protocol = new URL(value).protocol;
  } catch {
    return `${PREFIX}${key} is not a valid URL`;
  }
  if (protocol !== "http:" && protocol !== "https:") return `${PREFIX}${key} must be http(s) or about:blank`;
  return null;
}

function checkName(key: string, value: unknown): string | null {
  if (typeof value !== "string" || !SAFE_NAME.test(value)) return `${PREFIX}${key} must match [A-Za-z0-9_-]+`;
  return null;
}

function hasFileScheme(v: unknown, depth = 0): boolean {
  if (depth > 8) return true;
  if (typeof v === "string") return /^file:/i.test(v.trim());
  if (Array.isArray(v)) return v.some((x) => hasFileScheme(x, depth + 1));
  if (isPlainObject(v)) return Object.values(v).some((x) => hasFileScheme(x, depth + 1));
  return false;
}

export function decide(payload: unknown): string | null {
  if (!isPlainObject(payload)) return `${PREFIX}payload must be an object`;
  const toolName = payload.tool_name;
  if (typeof toolName !== "string" || !toolName.startsWith(TOOL_PREFIX)) {
    return `${PREFIX}not an agent-browser tool`;
  }
  const suffix = toolName.slice(TOOL_PREFIX.length);
  if (!ALLOWED_TOOLS.has(suffix)) return `${PREFIX}tool "${suffix}" is not allowlisted`;

  const input = payload.tool_input;
  if (!isPlainObject(input)) return `${PREFIX}tool_input must be an object`;

  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN_KEYS.has(key)) return `${PREFIX}argument "${key}" is forbidden`;
    let verdict: string | null = null;
    if (PATH_KEYS.has(key)) verdict = checkPath(key, value);
    else if (URL_KEYS.has(key)) verdict = checkUrl(key, value);
    else if (NAME_KEYS.has(key)) verdict = checkName(key, value);
    else if (SUSPICIOUS_KEY.test(key)) verdict = `${PREFIX}argument "${key}" is not vetted`;
    else if (hasFileScheme(value)) verdict = `${PREFIX}${key} contains a file: URL`;
    if (verdict) return verdict;
  }
  return null;
}

function denyJson(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}

async function main(): Promise<void> {
  let reason: string | null;
  try {
    reason = decide(JSON.parse(await Bun.stdin.text()));
  } catch {
    reason = `${PREFIX}unreadable input`;
  }
  if (reason !== null) console.log(denyJson(reason));
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch(() => process.exit(2));
}
