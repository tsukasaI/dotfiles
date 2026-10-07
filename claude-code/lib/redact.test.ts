import { describe, expect, test } from "bun:test";
import { REDACTIONS, redactSecrets, redactTranscript } from "./redact";

// One sample per REDACTIONS rule, keyed by the label the rule emits. The
// coverage test below fails if a rule is added without a sample here.
const a = (n: number) => "a".repeat(n);
// Fixtures are assembled from fragments so the repo's own secret scanner does
// not flag these fake credentials as literals.
const BEGIN = (kind = "") => `-----BEGIN ${kind}${"PRIVATE"} KEY-----`;
const END = (kind = "") => `-----END ${kind}${"PRIVATE"} KEY-----`;
const SAMPLES: Record<string, { token: string; stays?: string }> = {
  "[REDACTED:private-key]": {
    token: `${BEGIN("RSA ")}\nMIIEpAIBAAKCAQEA\nabc\n${END("RSA ")}`,
  },
  "[REDACTED:anthropic-key]": { token: `sk-ant-${a(24)}` },
  "[REDACTED:api-key]": { token: `sk-${a(24)}` },
  "[REDACTED:github-token]": { token: `ghp_${a(36)}` },
  "[REDACTED:slack-token]": { token: `${"xoxb"}-1234567890-abcdef` },
  "[REDACTED:aws-key-id]": { token: `${"AKIA"}ABCDEFGHIJKLMNOP` },
  "[REDACTED:google-key]": { token: `AIza${a(35)}` },
  "[REDACTED:jwt]": { token: `eyJ${a(12)}.eyJ${a(12)}.${a(12)}` },
  "Bearer [REDACTED:token]": { token: `Bearer ${a(30)}` },
  "[REDACTED:stripe-key]": { token: `sk_live_${a(20)}` },
  "[REDACTED:npm-token]": { token: `npm_${a(36)}` },
  "[REDACTED:gitlab-token]": { token: `glpat-${a(24)}` },
  "[REDACTED:aws-secret-key]": {
    token: `aws_secret_access_key=${a(40)}`,
    stays: "aws_secret_access_key=",
  },
  "[REDACTED:url-creds]": {
    token: "https://user:hunter2@example.com/x",
    stays: "https://",
  },
};

// The secret part that must not survive. For most rules that is the whole
// token; for the assignment/URL forms only the value is secret.
function secretOf(label: string): string {
  switch (label) {
    case "[REDACTED:aws-secret-key]":
      return a(40);
    case "[REDACTED:url-creds]":
      return "hunter2";
    case "[REDACTED:private-key]":
      return "MIIEpAIBAAKCAQEA";
    default:
      return SAMPLES[label]!.token;
  }
}

const PREFIXES: Array<[string, string]> = [
  ["start of text", ""],
  ["space", "x "],
  ["newline", "x\n"],
  ["tab", "x\t"],
  ["double quote", 'x"'],
  ["equals", "x="],
  ["carriage return", "x\r"],
  ["colon", "x: "],
];

// Replacements may carry a `$1` capture prefix and a trailing `@`.
const labelsOf = () =>
  REDACTIONS.map(([, repl]) => repl.replace(/^\$1/, "").replace(/@$/, ""));

describe("redaction samples", () => {
  test("every REDACTIONS label has a sample (and vice versa, modulo shared labels)", () => {
    const labels = new Set(labelsOf());
    for (const l of labels) {
      // github_pat_ shares the github-token label with ghp_, so one sample
      // covers the label; the pat rule is exercised in its own test below.
      expect(Object.keys(SAMPLES)).toContain(l);
    }
    for (const l of Object.keys(SAMPLES)) expect(labels.has(l)).toBe(true);
  });
});

describe("redactTranscript: token after each boundary character", () => {
  for (const [label, sample] of Object.entries(SAMPLES)) {
    for (const [name, prefix] of PREFIXES) {
      test(`${label} after ${name}`, () => {
        const text = `${prefix}${sample.token} tail`;
        const line = JSON.stringify({ type: "user", content: text });
        const out = redactTranscript(line);
        expect(out).toContain(label.replace("Bearer [REDACTED:token]", "[REDACTED:token]"));
        expect(out).not.toContain(secretOf(label));
        expect(() => JSON.parse(out)).not.toThrow();
        if (sample.stays) expect(out).toContain(sample.stays);
      });
    }
  }

  test("github_pat_ rule", () => {
    for (const [, prefix] of PREFIXES) {
      const tok = `github_pat_${a(30)}`;
      const out = redactTranscript(JSON.stringify({ c: `${prefix}${tok}` }));
      expect(out).toContain("[REDACTED:github-token]");
      expect(out).not.toContain(tok);
    }
  });

  test("the issue #68 reproduction", () => {
    const out = redactTranscript(JSON.stringify("line\nghp_" + a(36)));
    expect(out).toBe('"line\\n[REDACTED:github-token]"');
  });
});

describe("redactSecrets on JSON-escaped text (malformed-line fallback)", () => {
  for (const [label, sample] of Object.entries(SAMPLES)) {
    for (const esc of ["\\n", "\\t", "\\r"]) {
      test(`${label} after ${esc}`, () => {
        const json = JSON.stringify(`x${esc === "\\n" ? "\n" : esc === "\\t" ? "\t" : "\r"}${sample.token}`);
        expect(json).toContain(esc);
        expect(redactSecrets(json)).not.toContain(secretOf(label));
      });
    }
  }
});

describe("redactTranscript structure", () => {
  test("records without a secret are kept byte-for-byte", () => {
    const line = '{"type":"user",  "n":1.0,"t":"caf\\u00e9"}';
    expect(redactTranscript(`${line}\n`)).toBe(`${line}\n`);
  });

  test("blank lines and trailing newline are preserved", () => {
    const t = `{"a":1}\n\n{"b":"ghp_${a(36)}"}\n`;
    const out = redactTranscript(t);
    expect(out.split("\n").length).toBe(4);
    expect(out.endsWith("\n")).toBe(true);
    expect(out).not.toContain("ghp_");
  });

  test("malformed line falls back to raw redaction", () => {
    const out = redactTranscript(`{not json "\\nghp_${a(36)}`);
    expect(out).toContain("[REDACTED:github-token]");
    expect(out).not.toContain(a(36));
  });

  test("redacts nested values, array items and object keys", () => {
    const tok = `ghp_${a(36)}`;
    const out = redactTranscript(
      JSON.stringify({ m: { c: [{ t: `a\n${tok}` }] }, [`k\n${tok}`]: 1 }),
    );
    expect(out).not.toContain(tok);
    expect(JSON.parse(out).m.c[0].t).toBe("a\n[REDACTED:github-token]");
  });

  test("private key spanning real newlines in one string is one redaction", () => {
    const pem = `${BEGIN()}\nAAAA\n${END()}`;
    const out = redactTranscript(JSON.stringify({ c: `before\n${pem}\nafter` }));
    expect(JSON.parse(out).c).toBe("before\n[REDACTED:private-key]\nafter");
  });

  test("an unterminated BEGIN in one record does not swallow later records", () => {
    const t = [
      JSON.stringify({ c: `${BEGIN()}\nnever closed` }),
      JSON.stringify({ c: "unrelated record" }),
      JSON.stringify({ c: END() }),
    ].join("\n");
    const out = redactTranscript(t);
    expect(out).toContain("unrelated record");
    expect(out).not.toContain("[REDACTED:private-key]");
  });

  test("ordinary text is untouched", () => {
    const s = JSON.stringify({ c: "see task-list and risk-averse, sk-short, ghp_short" });
    expect(redactTranscript(s)).toBe(s);
  });

  test("a word character before the token still blocks the match", () => {
    const s = JSON.stringify({ c: `xghp_${a(36)}` });
    expect(redactTranscript(s)).toBe(s);
  });
});
