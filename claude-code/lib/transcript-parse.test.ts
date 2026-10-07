import { describe, expect, test } from "bun:test";
import {
  localDay,
  parseTranscript,
  sumTokens,
  validateHookInput,
} from "./transcript-parse";

const j = (o: unknown) => JSON.stringify(o);

const user = (ts: unknown, extra: Record<string, unknown> = {}) =>
  j({ type: "user", timestamp: ts, version: "2.0.1", gitBranch: "main", ...extra });
const assistant = (ts: unknown, usage: unknown, model: unknown = "claude-x") =>
  j({ type: "assistant", timestamp: ts, message: { model, usage } });

const T1 = "2026-03-10T12:00:00.000Z";
const T2 = "2026-03-10T12:05:00.000Z";

const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe("parseTranscript: valid entries", () => {
  test("sums tokens and counts messages", () => {
    const meta = parseTranscript([
      user(T1),
      assistant(T1, {
        input_tokens: 10,
        cache_creation_input_tokens: 20,
        cache_read_input_tokens: 30,
        output_tokens: 5,
      }),
      assistant(T2, { input_tokens: 1, output_tokens: 2 }),
    ]);
    expect(meta.inputTokens).toBe(61);
    expect(meta.outputTokens).toBe(7);
    expect(meta.numUser).toBe(1);
    expect(meta.numAssistant).toBe(2);
    expect(meta.model).toBe("claude-x");
    expect(meta.version).toBe("2.0.1");
    expect(meta.gitBranch).toBe("main");
    expect(meta.startedAt).toBe(T1);
    expect(meta.endedAt).toBe(T2);
    expect(total(meta.dayCounts)).toBe(3);
  });
});

describe("parseTranscript: malformed lines", () => {
  test("null, number, string and array lines are skipped, valid ones still count", () => {
    const meta = parseTranscript([
      "null",
      "42",
      '"text"',
      "[1,2]",
      "not json",
      user(T1),
      assistant(T2, { input_tokens: 3, output_tokens: 4 }),
    ]);
    expect(meta.numUser).toBe(1);
    expect(meta.numAssistant).toBe(1);
    expect(meta.inputTokens).toBe(3);
    expect(meta.outputTokens).toBe(4);
  });

  test("non-string timestamp/version/gitBranch/model are ignored", () => {
    const meta = parseTranscript([
      user({ a: 1 }, { version: 5, gitBranch: ["x"] }),
      j({ type: "assistant", timestamp: 123, message: { model: { a: 1 }, usage: {} } }),
    ]);
    expect(meta.numUser).toBe(1);
    expect(meta.numAssistant).toBe(1);
    expect(meta.startedAt).toBe("");
    expect(meta.endedAt).toBe("");
    expect(meta.version).toBe("");
    expect(meta.gitBranch).toBe("");
    expect(meta.model).toBe("");
    expect(meta.dayCounts.size).toBe(0);
  });

  test("a later valid value is still adopted after a wrongly typed one", () => {
    const meta = parseTranscript([user(T1, { version: 5 }), user(T2, { version: "2.0.2" })]);
    expect(meta.version).toBe("2.0.2");
  });

  test("non-object message and usage do not throw", () => {
    const meta = parseTranscript([
      j({ type: "assistant", timestamp: T1, message: "oops" }),
      j({ type: "assistant", timestamp: T1, message: null }),
      j({ type: "assistant", timestamp: T1, message: { usage: [1, 2] } }),
      j({ type: "assistant", timestamp: T1, message: { usage: null } }),
    ]);
    expect(meta.numAssistant).toBe(4);
    expect(meta.inputTokens).toBe(0);
  });

  test("string token counts are not concatenated", () => {
    const meta = parseTranscript([
      assistant(T1, {
        input_tokens: "700",
        cache_creation_input_tokens: 2,
        cache_read_input_tokens: null,
        output_tokens: "9",
      }),
    ]);
    expect(meta.inputTokens).toBe(2);
    expect(meta.outputTokens).toBe(0);
  });

  test("infinite numbers are not summed", () => {
    // JSON has no Infinity literal, but 1e999 parses to Infinity.
    const meta = parseTranscript([
      `{"type":"assistant","timestamp":"${T1}","message":{"usage":{"input_tokens":1e999,"output_tokens":4}}}`,
    ]);
    expect(meta.inputTokens).toBe(0);
    expect(meta.outputTokens).toBe(4);
  });

  test("a bad timestamp does not create a NaN day row", () => {
    const meta = parseTranscript([user("not-a-date"), user(T1)]);
    expect(meta.numUser).toBe(2);
    expect(meta.startedAt).toBe(T1);
    expect(meta.endedAt).toBe(T1);
    expect([...meta.dayCounts.keys()].some((d) => d.includes("NaN"))).toBe(false);
    expect([...meta.dayCounts.keys()]).not.toContain("");
    expect(total(meta.dayCounts)).toBe(1);
  });
});

describe("localDay / sumTokens", () => {
  test("localDay returns empty string for invalid dates", () => {
    expect(localDay("garbage")).toBe("");
    expect(localDay("")).toBe("");
  });
  test("localDay formats a valid date", () => {
    expect(localDay(T1)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  test("sumTokens tolerates non-objects", () => {
    expect(sumTokens(null)).toEqual({ input: 0, output: 0 });
    expect(sumTokens("x")).toEqual({ input: 0, output: 0 });
  });
});

describe("validateHookInput", () => {
  const good = {
    session_id: "s1",
    transcript_path: "/a/b.jsonl",
    cwd: "/x",
    hook_event_name: "SessionEnd",
    reason: "clear",
  };
  test("accepts a well-formed payload", () => {
    const r = validateHookInput(good);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.sessionId).toBe("s1");
      expect(r.value.reason).toBe("clear");
    }
  });
  test("rejects non-objects", () => {
    for (const v of [null, 1, "x", [], undefined]) {
      expect(validateHookInput(v).ok).toBe(false);
    }
  });
  test("rejects missing, non-string or empty session_id / transcript_path / cwd", () => {
    for (const key of ["session_id", "transcript_path", "cwd"]) {
      const missing: Record<string, unknown> = { ...good };
      delete missing[key];
      expect(validateHookInput(missing).ok).toBe(false);
      expect(validateHookInput({ ...good, [key]: 7 }).ok).toBe(false);
      expect(validateHookInput({ ...good, [key]: "" }).ok).toBe(false);
    }
  });
  test("a non-string reason is dropped, not fatal", () => {
    const r = validateHookInput({ ...good, reason: 3 });
    expect(r.ok && r.value.reason).toBeUndefined();
  });
});
