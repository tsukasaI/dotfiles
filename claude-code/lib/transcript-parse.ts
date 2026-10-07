// Defensive transcript parsing and hook-input validation (#69). Extracted
// from hooks/save-transcript.ts so it is importable without running that
// hook's top-level main.
//
// save-transcript is the only writer of logs.db, so one malformed line or a
// wrongly typed field must degrade to "skip that value", never to losing the
// whole session. Everything read from the transcript is therefore treated as
// untrusted `unknown` and type-checked at the point of use.

export interface SessionMeta {
  model: string;
  version: string;
  gitBranch: string;
  startedAt: string;
  endedAt: string;
  inputTokens: number;
  outputTokens: number;
  numUser: number;
  numAssistant: number;
  dayCounts: Map<string, number>;
}

export interface ValidHookInput {
  sessionId: string;
  transcriptPath: string;
  cwd: string;
  hookEventName: string;
  reason?: string;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asCount(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// ts is an ISO 8601 UTC timestamp; bucket by local calendar day so late-night/
// early-morning sessions attribute to the day the user experienced, not the
// UTC day. Returns "" for an unparseable timestamp; callers must skip it.
export function localDay(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Only finite numbers are summed; a string such as "700" would otherwise
// concatenate ("700" + 2 -> "7002") instead of add.
export function sumTokens(usage: unknown): { input: number; output: number } {
  if (!isPlainObject(usage)) return { input: 0, output: 0 };
  return {
    input:
      asCount(usage.input_tokens) +
      asCount(usage.cache_creation_input_tokens) +
      asCount(usage.cache_read_input_tokens),
    output: asCount(usage.output_tokens),
  };
}

export function parseTranscript(lines: string[]): SessionMeta {
  const meta: SessionMeta = {
    model: "",
    version: "",
    gitBranch: "",
    startedAt: "",
    endedAt: "",
    inputTokens: 0,
    outputTokens: 0,
    numUser: 0,
    numAssistant: 0,
    dayCounts: new Map(),
  };

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    // null, numbers, strings and arrays are valid JSON but not records.
    if (!isPlainObject(parsed)) continue;
    const entry = parsed;

    // An unparseable timestamp is dropped entirely, so it can neither become
    // started_at/ended_at nor a day bucket.
    const rawTs = asString(entry.timestamp);
    const day = rawTs ? localDay(rawTs) : "";
    const ts = day ? rawTs : "";
    if (!meta.startedAt && ts) meta.startedAt = ts;
    if (ts) meta.endedAt = ts;

    const isMessage = entry.type === "user" || entry.type === "assistant";
    if (day && isMessage) {
      meta.dayCounts.set(day, (meta.dayCounts.get(day) ?? 0) + 1);
    }

    const message = isPlainObject(entry.message) ? entry.message : undefined;

    switch (entry.type) {
      case "user":
        meta.numUser++;
        meta.version ||= asString(entry.version);
        meta.gitBranch ||= asString(entry.gitBranch);
        break;

      case "assistant":
        meta.numAssistant++;
        meta.model ||= asString(message?.model);
        if (message?.usage !== undefined) {
          const tokens = sumTokens(message.usage);
          meta.inputTokens += tokens.input;
          meta.outputTokens += tokens.output;
        }
        break;
    }
  }

  return meta;
}

// Validate the SessionEnd payload. Returns the problem as a string so the
// caller can log it to stderr and exit 0 (a hook must never fail the session).
export function validateHookInput(
  input: unknown,
): { ok: true; value: ValidHookInput } | { ok: false; error: string } {
  if (!isPlainObject(input)) return { ok: false, error: "hook input is not an object" };
  for (const key of ["session_id", "transcript_path", "cwd"] as const) {
    if (typeof input[key] !== "string" || input[key] === "") {
      return { ok: false, error: `hook input field ${key} is missing or not a string` };
    }
  }
  return {
    ok: true,
    value: {
      sessionId: input.session_id as string,
      transcriptPath: input.transcript_path as string,
      cwd: input.cwd as string,
      hookEventName: asString(input.hook_event_name),
      reason: typeof input.reason === "string" ? input.reason : undefined,
    },
  };
}
