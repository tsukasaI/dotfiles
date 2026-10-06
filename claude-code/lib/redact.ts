// Credential redaction for saved transcripts (#4, #68). Extracted from
// hooks/save-transcript.ts so it is importable without running that hook's
// top-level main.
//
// The transcript is stored locally and may later be pushed verbatim to
// Turso (push-to-turso.sh), so mask well-known credential formats before
// they ever reach the DB. Regex-based on purpose: running gitleaks at
// SessionEnd would add process-spawn latency to every session close.
// Patterns are prefix-identifiable formats only — generic entropy
// heuristics would mangle ordinary code discussion in the transcript.

// Token-start boundary. Plain `\b` fails after a JSON escape: in `\nghp_...`
// the `n` and `g` are both word characters, so no boundary exists. This
// accepts either "previous char is not a word char" or "previous two chars are
// a JSON whitespace escape". Redacting parsed strings (redactTranscript)
// removes the need for the second branch there; it stays so that a line that
// fails to parse, and any direct redactSecrets() call on JSON text, are
// covered too. On parsed text it can only over-redact a literal backslash-n.
const B = String.raw`(?:(?<![A-Za-z0-9_])|(?<=\\[nrtbf]))`;

export const REDACTIONS: Array<[RegExp, string]> = [
  [
    // Spans real newlines (parsed strings) as well as escaped ones (raw JSON
    // text). redactTranscript applies it per string and per malformed line,
    // never across records, so a lazily expanding match cannot splice
    // unrelated records together. The `{0,16384}` cap bounds worst-case work
    // per start position; it is comfortably larger than an RSA-8192 PEM body
    // (~13KB escaped) but a fail-open bound in principle — re-measure if key
    // sizes grow.
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]{0,16384}?-----END [A-Z ]*PRIVATE KEY-----/g,
    "[REDACTED:private-key]",
  ],
  [new RegExp(`${B}sk-ant-[A-Za-z0-9_-]{20,}`, "g"), "[REDACTED:anthropic-key]"],
  [new RegExp(`${B}sk-[A-Za-z0-9_-]{20,}`, "g"), "[REDACTED:api-key]"],
  [new RegExp(`${B}gh[pousr]_[A-Za-z0-9]{20,}`, "g"), "[REDACTED:github-token]"],
  [new RegExp(`${B}github_pat_[A-Za-z0-9_]{20,}`, "g"), "[REDACTED:github-token]"],
  [new RegExp(`${B}xox[baprs]-[A-Za-z0-9-]{10,}`, "g"), "[REDACTED:slack-token]"],
  [new RegExp(`${B}(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\\b`, "g"), "[REDACTED:aws-key-id]"],
  [new RegExp(`${B}AIza[0-9A-Za-z_-]{35}`, "g"), "[REDACTED:google-key]"],
  [
    new RegExp(
      `${B}eyJ[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\b`,
      "g",
    ),
    "[REDACTED:jwt]",
  ],
  [new RegExp(`${B}Bearer\\s+[A-Za-z0-9._~+/=-]{20,}`, "g"), "Bearer [REDACTED:token]"],
  [new RegExp(`${B}[rs]k_(?:live|test)_[A-Za-z0-9]{16,}`, "g"), "[REDACTED:stripe-key]"],
  [new RegExp(`${B}npm_[A-Za-z0-9]{36}\\b`, "g"), "[REDACTED:npm-token]"],
  [new RegExp(`${B}glpat-[A-Za-z0-9_-]{20,}`, "g"), "[REDACTED:gitlab-token]"],
  [
    // The secret key has no prefix of its own, so only the assignment form is
    // recognizable. Quote/backslash runs are allowed around the separator
    // because JSON text is escaped (`\"aws_secret_access_key\": \"...`).
    new RegExp(
      `${B}(aws_secret_access_key["'\\\\\\s]*[=:]["'\\\\\\s]*)[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+])`,
      "gi",
    ),
    "$1[REDACTED:aws-secret-key]",
  ],
  [
    // user:password@ in a URL. `"` and `\` are excluded so a match can't span
    // a JSON string boundary; a `/` before the `@` (path, port-then-path)
    // means it isn't userinfo.
    new RegExp(`${B}([a-z][a-z0-9+.-]*:\\/\\/)[^\\s/:@"\\\\]+:[^\\s/@"\\\\]+@`, "gi"),
    "$1[REDACTED:url-creds]@",
  ],
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, label] of REDACTIONS) out = out.replace(re, label);
  return out;
}

// Redact string values (and keys) of a parsed JSON value. Returns the input
// object itself when nothing changed so callers can keep the original line.
function redactValue(v: unknown, hit: { changed: boolean }): unknown {
  if (typeof v === "string") {
    const r = redactSecrets(v);
    if (r !== v) hit.changed = true;
    return r;
  }
  if (Array.isArray(v)) return v.map((x) => redactValue(x, hit));
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const rk = redactSecrets(k);
      if (rk !== k) hit.changed = true;
      out[rk] = redactValue(x, hit);
    }
    return out;
  }
  return v;
}

// Redact a JSONL transcript. Each record is parsed and its strings are
// redacted before re-serialising, so a token that starts a line, tab or
// string sees the text exactly as the user wrote it instead of behind a
// `\n` / `\t` escape. Records with no hit are kept byte-for-byte; records
// that fail to parse fall back to redacting the raw line.
export function redactTranscript(jsonl: string): string {
  return jsonl
    .split("\n")
    .map((line) => {
      if (!line.trim()) return line;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return redactSecrets(line);
      }
      const hit = { changed: false };
      const redacted = redactValue(parsed, hit);
      return hit.changed ? JSON.stringify(redacted) : line;
    })
    .join("\n");
}
