#!/usr/bin/env bun

import { join, extname, relative } from "path";
import { logsDbPath, expandHome as expandHomeShared, isNonPromptText, scanSessions } from "./transcripts";

const HOME = Bun.env.HOME;
if (!HOME) {
  console.error("[corrections.ts] HOME is not set; cannot locate claude-logs. Set HOME or CLAUDE_LOGS_DB.");
  process.exit(2);
}
const LOGS_DB_PATH = logsDbPath(HOME);

const WINDOW_DAYS = 30;
const NOW = Date.now();
const CUTOFF_MS = NOW - WINDOW_DAYS * 24 * 3600 * 1000;
const PAIR_MIN_COUNT = 2;

const CORRECTION_PHRASES_EN = [
  "actually,",
  " actually ",
  "instead,",
  " instead ",
  "don't ",
  "stop ",
  "wait,",
  " wait ",
  "no,",
  " wrong",
  "not what i",
  "that's wrong",
  "that's not",
  "you should not",
  "you shouldn't",
];

const CORRECTION_PHRASES_JA = [
  "違う",
  "やめて",
  "そうじゃない",
  "逆です",
  "逆だ",
  "ダメ",
  "もう一度",
  "間違ってる",
  "間違っている",
  "直して",
  "やり直し",
  "そうではなく",
];

const PROMPT_MAX_CHARS_FOR_CORRECTION = 400;

interface ToolUse {
  type: "tool_use";
  id?: string;
  name: string;
  input?: Record<string, unknown>;
}

interface ToolResult {
  type: "tool_result";
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

const FAILURE_CHAIN_MIN = 3;
interface TextBlock {
  type: "text";
  text: string;
}
type ContentBlock = ToolUse | TextBlock | { type: string; [k: string]: unknown };

interface TranscriptEntry {
  uuid?: string;
  parentUuid?: string | null;
  type?: string;
  cwd?: string;
  timestamp?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  message?: {
    role?: string;
    content?: ContentBlock[] | string;
  };
}

interface AssistantAction {
  ts: string;
  tool_name: string;
  excerpt: string;
  file_path: string | null;
}

interface Pair {
  kind: "interrupt" | "correction" | "failure_loop";
  ts: string;
  cwd: string;
  tool_name: string;
  excerpt: string;
  file_path: string | null;
  user_response: string;
  assistant_action: string;
  chain_length?: number;
}

interface ToolUseEvent {
  id: string;
  ts: string;
  tool_name: string;
  excerpt: string;
  file_path: string | null;
  cwd: string;
}

interface ToolResultEvent {
  is_error: boolean;
  content: string;
}

function excerptForTool(name: string, input: Record<string, unknown> | undefined, cwd: string): { excerpt: string; file_path: string | null } {
  if (!input) return { excerpt: name, file_path: null };
  if (name === "Bash") {
    const cmd = typeof input.command === "string" ? input.command : "";
    const firstLine = cmd.split("\n")[0].trim();
    const tokens = firstLine.split(/\s+/).slice(0, 2).join(" ");
    return { excerpt: tokens.slice(0, 60), file_path: null };
  }
  if (name === "Edit" || name === "Write" || name === "Read") {
    const fp = typeof input.file_path === "string" ? input.file_path : "";
    let rel = fp;
    if (cwd && fp.startsWith(cwd + "/")) rel = relative(cwd, fp);
    return { excerpt: rel.slice(0, 80), file_path: fp || null };
  }
  if (name === "Skill") {
    const sk = typeof input.skill === "string" ? input.skill : "";
    return { excerpt: sk.slice(0, 60), file_path: null };
  }
  if (name === "Agent") {
    const sub = typeof input.subagent_type === "string" ? input.subagent_type : "";
    return { excerpt: sub.slice(0, 60), file_path: null };
  }
  const firstKey = Object.keys(input)[0];
  const v = firstKey ? input[firstKey] : "";
  return { excerpt: typeof v === "string" ? v.slice(0, 60) : "", file_path: null };
}

function describeAssistantAction(a: AssistantAction): string {
  if (a.tool_name === "text") return `text: ${a.excerpt}`;
  return `${a.tool_name}: ${a.excerpt}`;
}

function isCorrectionPhrase(text: string): boolean {
  const lower = text.toLowerCase();
  for (const p of CORRECTION_PHRASES_EN) {
    if (lower.includes(p)) return true;
  }
  for (const p of CORRECTION_PHRASES_JA) {
    if (text.includes(p)) return true;
  }
  return false;
}

interface ScanResult {
  pairs: Pair[];
  sessions_scanned: number;
  oldest_session_ms: number | null;
  errors: string[];
  db_unavailable: boolean;
}

interface SessionExtract {
  pairs: Pair[];
  sessionStartMs: number | null;
}

function expandHome(p: string | null | undefined): string {
  return expandHomeShared(p, HOME);
}

// entry.cwd comes verbatim from parsed transcript JSON, so its declared
// `string` type isn't enforced at runtime; coerce here so every downstream
// consumer (path.join, path.relative, etc.) can trust the result.
function entryCwd(cwd: unknown, fallback: string): string {
  return typeof cwd === "string" && cwd ? cwd : fallback;
}

function scan(): ScanResult {
  const s = scanSessions(LOGS_DB_PATH, CUTOFF_MS, (jsonl, projectDir) => {
    const extract = extractSession(jsonl, projectDir);
    return { extract, sessionStartMs: extract.sessionStartMs };
  });
  const result: ScanResult = {
    pairs: [],
    sessions_scanned: s.sessions_scanned,
    oldest_session_ms: s.oldest_session_ms,
    errors: s.errors,
    db_unavailable: s.db_unavailable,
  };
  for (const extract of s.extracts) {
    result.pairs.push(...extract.pairs);
  }
  return result;
}

function extractSession(transcriptJsonl: string, projectDir: string | null): SessionExtract {
  const extract: SessionExtract = { pairs: [], sessionStartMs: null };

  const entries: TranscriptEntry[] = [];
  const byUuid = new Map<string, TranscriptEntry>();
  for (const line of transcriptJsonl.split("\n")) {
    if (!line) continue;
    try {
      const obj: TranscriptEntry = JSON.parse(line);
      entries.push(obj);
      if (obj.uuid) byUuid.set(obj.uuid, obj);
    } catch {}
  }

  let sessionCwd = expandHome(projectDir);
  let sessionStartMs: number | null = null;
  for (const e of entries) {
    if (!sessionCwd) sessionCwd = entryCwd(e.cwd, sessionCwd);
    const ts = e.timestamp ? Date.parse(e.timestamp) : NaN;
    if (!isNaN(ts) && sessionStartMs === null) sessionStartMs = ts;
  }
  extract.sessionStartMs = sessionStartMs;

  // Build tool_use timeline and tool_result map for failure_loop detection.
  const toolUseTimeline: ToolUseEvent[] = [];
  const toolResults = new Map<string, ToolResultEvent>();
  for (const e of entries) {
    if (e.isSidechain === true) continue;
    const content = e.message?.content;
    if (!content || typeof content === "string") continue;
    const cwd = entryCwd(e.cwd, sessionCwd);
    const ts = e.timestamp ?? "";
    if (e.type === "assistant") {
      for (const b of content) {
        if (b.type !== "tool_use") continue;
        const tu = b as ToolUse;
        if (!tu.id) continue;
        const { excerpt, file_path } = excerptForTool(tu.name, tu.input, cwd);
        toolUseTimeline.push({ id: tu.id, ts, tool_name: tu.name, excerpt, file_path, cwd });
      }
    } else if (e.type === "user") {
      for (const b of content) {
        if (b.type !== "tool_result") continue;
        const tr = b as ToolResult;
        if (!tr.tool_use_id) continue;
        const contentStr = typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content ?? "");
        toolResults.set(tr.tool_use_id, {
          is_error: tr.is_error === true,
          content: contentStr,
        });
      }
    }
  }
  detectFailureLoops(toolUseTimeline, toolResults, extract.pairs);

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.isSidechain === true) continue;
    if (e.isMeta === true) continue;
    if (e.type !== "user") continue;
    const content = e.message?.content;
    if (!content) continue;
    let texts: string[] = [];
    let hasToolResult = false;
    if (typeof content === "string") {
      texts.push(content);
    } else {
      for (const b of content) {
        if (b.type === "tool_result" || (b as any).tool_use_id) {
          hasToolResult = true;
          break;
        }
        if (b.type === "text") texts.push((b as TextBlock).text);
      }
    }
    if (hasToolResult) continue;

    for (const t of texts) {
      const trimmed = t.trim();
      if (isNonPromptText(trimmed)) continue;

      let kind: "interrupt" | "correction" | null = null;
      if (trimmed.startsWith("[Request interrupted")) {
        kind = "interrupt";
      } else if (trimmed.length <= PROMPT_MAX_CHARS_FOR_CORRECTION && isCorrectionPhrase(trimmed)) {
        kind = "correction";
      }
      if (!kind) continue;

      const action = resolveAssistantAction(e, byUuid, entries, i, sessionCwd);
      if (!action) continue;
      if (kind === "interrupt" && action.tool_name === "text") continue;

      extract.pairs.push({
        kind,
        ts: e.timestamp ?? "",
        cwd: entryCwd(e.cwd, sessionCwd),
        tool_name: action.tool_name,
        excerpt: action.excerpt,
        file_path: action.file_path,
        user_response: trimmed.slice(0, 200),
        assistant_action: describeAssistantAction(action),
      });
    }
  }
  return extract;
}

function detectFailureLoops(
  timeline: ToolUseEvent[],
  results: Map<string, ToolResultEvent>,
  pairs: Pair[],
): void {
  let i = 0;
  while (i < timeline.length) {
    const head = timeline[i];
    const headRes = results.get(head.id);
    if (!headRes || !headRes.is_error) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < timeline.length) {
      const next = timeline[j + 1];
      if (next.tool_name !== head.tool_name || next.excerpt !== head.excerpt) break;
      const nextRes = results.get(next.id);
      if (!nextRes || !nextRes.is_error) break;
      j++;
    }
    const chainLen = j - i + 1;
    if (chainLen >= FAILURE_CHAIN_MIN) {
      const last = timeline[j];
      const lastRes = results.get(last.id);
      pairs.push({
        kind: "failure_loop",
        ts: last.ts,
        cwd: head.cwd,
        tool_name: head.tool_name,
        excerpt: head.excerpt,
        file_path: head.file_path,
        chain_length: chainLen,
        user_response: (lastRes?.content ?? "").trim().slice(0, 200),
        assistant_action: `${head.tool_name}: ${head.excerpt}`,
      });
    }
    i = j + 1;
  }
}

function resolveAssistantAction(
  userEntry: TranscriptEntry,
  byUuid: Map<string, TranscriptEntry>,
  entries: TranscriptEntry[],
  userIdx: number,
  sessionCwd: string,
): AssistantAction | null {
  let parent: TranscriptEntry | undefined;
  if (userEntry.parentUuid) parent = byUuid.get(userEntry.parentUuid);
  if (!parent || parent.type !== "assistant") {
    for (let j = userIdx - 1; j >= 0 && j >= userIdx - 5; j--) {
      if (entries[j].type === "assistant") {
        parent = entries[j];
        break;
      }
    }
  }
  if (!parent || parent.type !== "assistant") return null;
  const cwd = entryCwd(parent.cwd, sessionCwd);
  const content = parent.message?.content;
  if (!content || typeof content === "string") {
    return null;
  }
  let tu: ToolUse | null = null;
  let text = "";
  for (const b of content) {
    if (b.type === "tool_use" && !tu) tu = b as ToolUse;
    else if (b.type === "text" && !text) text = (b as TextBlock).text;
  }
  if (tu) {
    const { excerpt, file_path } = excerptForTool(tu.name, tu.input, cwd);
    return { ts: parent.timestamp ?? "", tool_name: tu.name, excerpt, file_path };
  }
  if (text) {
    return { ts: parent.timestamp ?? "", tool_name: "text", excerpt: text.slice(0, 60), file_path: null };
  }
  return null;
}

interface ClusterAgg {
  kind: "interrupt" | "correction" | "failure_loop";
  tool_name: string;
  excerpt: string;
  cwds: Set<string>;
  exts: Set<string>;
  count: number;
  total_chain_length: number;
  max_chain_length: number;
  samples: { ts: string; assistant_action: string; user_response: string; chain_length?: number }[];
}

function buildClusters(pairs: Pair[]) {
  const map = new Map<string, ClusterAgg>();
  for (const p of pairs) {
    const key = `${p.kind}\x00${p.tool_name}\x00${p.excerpt}`;
    const agg = map.get(key) ?? {
      kind: p.kind,
      tool_name: p.tool_name,
      excerpt: p.excerpt,
      cwds: new Set<string>(),
      exts: new Set<string>(),
      count: 0,
      total_chain_length: 0,
      max_chain_length: 0,
      samples: [],
    };
    agg.count++;
    if (p.chain_length) {
      agg.total_chain_length += p.chain_length;
      if (p.chain_length > agg.max_chain_length) agg.max_chain_length = p.chain_length;
    }
    if (p.cwd) agg.cwds.add(p.cwd);
    if (p.file_path) {
      const ext = extname(p.file_path);
      if (ext) agg.exts.add(ext);
    }
    if (agg.samples.length < 3) {
      agg.samples.push({
        ts: p.ts,
        assistant_action: p.assistant_action,
        user_response: p.user_response,
        chain_length: p.chain_length,
      });
    }
    map.set(key, agg);
  }
  const out: any[] = [];
  for (const v of map.values()) {
    if (v.count < PAIR_MIN_COUNT) continue;
    const cwds = [...v.cwds];
    const scope: "project" | "user" = cwds.length <= 1 ? "project" : "user";
    const scope_target =
      scope === "project" && typeof cwds[0] === "string" && cwds[0]
        ? join(cwds[0], ".claude", "CLAUDE.md")
        : join(HOME, ".claude", "CLAUDE.md");
    const path_hint = v.exts.size === 1 ? [...v.exts][0] : null;
    const entry: any = {
      kind: v.kind,
      tool_name: v.tool_name,
      excerpt: v.excerpt,
      count: v.count,
      cwds,
      scope_hint: scope,
      scope_target,
      path_hint,
      samples: v.samples,
    };
    if (v.kind === "failure_loop") {
      entry.total_chain_length = v.total_chain_length;
      entry.max_chain_length = v.max_chain_length;
    }
    out.push(entry);
  }
  // sort: failure_loop > interrupt > correction, then by count desc within kind
  const kindRank = (k: string) => (k === "failure_loop" ? 0 : k === "interrupt" ? 1 : 2);
  out.sort((a, b) => {
    const k = kindRank(a.kind) - kindRank(b.kind);
    if (k !== 0) return k;
    return b.count - a.count;
  });
  return out;
}

const scanResult = scan();

// Aggregation trusts fields copied verbatim out of transcript JSON (e.g.
// cwd); a future field slip should be diagnosable, not a bare Bun stack
// dump with no output at all.
try {
  const oldestIso = scanResult.oldest_session_ms ? new Date(scanResult.oldest_session_ms).toISOString() : null;
  const pairsByKind = scanResult.pairs.reduce((acc, p) => {
    acc[p.kind] = (acc[p.kind] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const out = {
    generated_at: new Date(NOW).toISOString(),
    meta: {
      source: "claude-logs",
      data_window_days: WINDOW_DAYS,
      sessions_scanned: scanResult.sessions_scanned,
      oldest_session: oldestIso,
      total_pairs_collected: scanResult.pairs.length,
      pairs_by_kind: pairsByKind,
      errors: scanResult.errors,
    },
    correction_pairs: buildClusters(scanResult.pairs),
  };

  for (const err of scanResult.errors) console.error(`[corrections.ts] ${err}`);
  console.log(JSON.stringify(out, null, 2));
  if (scanResult.db_unavailable) process.exit(2);
} catch (e) {
  console.error(`[corrections.ts] aggregation failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
