#!/usr/bin/env bun

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, extname, relative } from "path";

const HOME = Bun.env.HOME!;
const PROJECTS_DIR = join(HOME, ".claude", "projects");
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
  name: string;
  input?: Record<string, unknown>;
}
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
  kind: "interrupt" | "correction";
  ts: string;
  cwd: string;
  tool_name: string;
  excerpt: string;
  file_path: string | null;
  user_response: string;
  assistant_action: string;
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
    if (fp.startsWith(cwd + "/")) rel = relative(cwd, fp);
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

function shouldSkipUserText(trimmed: string): boolean {
  if (!trimmed) return true;
  if (trimmed.startsWith("<system-reminder>")) return true;
  if (trimmed.startsWith("<local-command-caveat>")) return true;
  if (trimmed.startsWith("<local-command-stdout>")) return true;
  if (trimmed.startsWith("<local-command-stderr>")) return true;
  if (trimmed.startsWith("<command-")) return true;
  if (trimmed.startsWith("<bash-")) return true;
  if (trimmed.startsWith("<user-prompt-submit-hook>")) return true;
  if (/^\[image #\d+]/i.test(trimmed)) return true;
  return false;
}

interface ScanResult {
  pairs: Pair[];
  sessions_scanned: number;
  oldest_session_ms: number | null;
}

function scan(): ScanResult {
  const result: ScanResult = { pairs: [], sessions_scanned: 0, oldest_session_ms: null };
  if (!existsSync(PROJECTS_DIR)) return result;
  for (const projEntry of readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!projEntry.isDirectory()) continue;
    walkDir(join(PROJECTS_DIR, projEntry.name), result);
  }
  return result;
}

function walkDir(dir: string, result: ScanResult): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walkDir(full, result);
      continue;
    }
    if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.mtimeMs < CUTOFF_MS) continue;
    processSession(full, result);
  }
}

function processSession(file: string, result: ScanResult): void {
  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch {
    return;
  }
  result.sessions_scanned++;

  const entries: TranscriptEntry[] = [];
  const byUuid = new Map<string, TranscriptEntry>();
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      const obj: TranscriptEntry = JSON.parse(line);
      entries.push(obj);
      if (obj.uuid) byUuid.set(obj.uuid, obj);
    } catch {}
  }

  let sessionCwd = "";
  let sessionStartMs: number | null = null;
  for (const e of entries) {
    if (e.cwd && !sessionCwd) sessionCwd = e.cwd;
    const ts = e.timestamp ? Date.parse(e.timestamp) : NaN;
    if (!isNaN(ts) && sessionStartMs === null) sessionStartMs = ts;
  }
  if (sessionStartMs !== null) {
    if (result.oldest_session_ms === null || sessionStartMs < result.oldest_session_ms) {
      result.oldest_session_ms = sessionStartMs;
    }
  }

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
      if (shouldSkipUserText(trimmed)) continue;

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

      result.pairs.push({
        kind,
        ts: e.timestamp ?? "",
        cwd: e.cwd ?? sessionCwd,
        tool_name: action.tool_name,
        excerpt: action.excerpt,
        file_path: action.file_path,
        user_response: trimmed.slice(0, 200),
        assistant_action: describeAssistantAction(action),
      });
    }
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
  const cwd = parent.cwd ?? sessionCwd;
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
  kind: "interrupt" | "correction";
  tool_name: string;
  excerpt: string;
  cwds: Set<string>;
  exts: Set<string>;
  count: number;
  samples: { ts: string; assistant_action: string; user_response: string }[];
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
      samples: [],
    };
    agg.count++;
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
      scope === "project" && cwds[0]
        ? join(cwds[0], ".claude", "CLAUDE.md")
        : join(HOME, ".claude", "CLAUDE.md");
    const path_hint = v.exts.size === 1 ? [...v.exts][0] : null;
    out.push({
      kind: v.kind,
      tool_name: v.tool_name,
      excerpt: v.excerpt,
      count: v.count,
      cwds,
      scope_hint: scope,
      scope_target,
      path_hint,
      samples: v.samples,
    });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

const scanResult = scan();
const oldestIso = scanResult.oldest_session_ms ? new Date(scanResult.oldest_session_ms).toISOString() : null;

const out = {
  generated_at: new Date(NOW).toISOString(),
  meta: {
    data_window_days: WINDOW_DAYS,
    sessions_scanned: scanResult.sessions_scanned,
    oldest_session: oldestIso,
    total_pairs_collected: scanResult.pairs.length,
  },
  correction_pairs: buildClusters(scanResult.pairs),
};

console.log(JSON.stringify(out, null, 2));
