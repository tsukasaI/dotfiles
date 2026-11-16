import { isPlainObject, localDay } from "../../lib/transcript-parse";

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export interface SessionMetrics {
  startedAt: string;
  cwd: string;
  humanPrompts: number;
  firstPrompt: string;
  handoffs: number;
  selfRuns: number;
  deniedCommands: string[];
  abnormalStops: number;
  askUserQuestions: number;
  exitPlanModes: number;
  autonomous: boolean;
}

export interface SessionRecord {
  sessionId: string;
  metrics: SessionMetrics;
}

export interface Totals {
  sessions: number;
  humanPrompts: number;
  handoffs: number;
  selfRuns: number;
  denials: number;
  denialSessions: number;
  abnormalStops: number;
  askUserQuestions: number;
  exitPlanModes: number;
  autonomousSessions: number;
}

export interface MonthWindow {
  month: string;
  startMs: number;
  endMs: number;
  startIso: string;
  endIso: string;
}

export interface RepoRow {
  repo: string;
  kind: "product" | "harness";
  feat: number | null;
  fix: number | null;
  mergedPrs: number | null;
}

export interface GuardStats {
  total: number;
  withoutIssueRef: number;
}

export interface RateSnapshot {
  tsMs: number;
  sevenDayPct: number;
}

export interface QuotaClustering {
  judged: number;
  highRemaining: number;
  highTimeShare: number | null;
}

export interface ReportInput {
  quota?: QuotaClustering | null;
  window: MonthWindow;
  totals: Totals;
  repos: RepoRow[];
  excludedRepos: string[];
  guard: GuardStats | null;
  urgentIssues: number | null;
  overdueHypotheses: number | null;
  warnings: string[];
  topDenied: { command: string; count: number }[];
  sample: { sessionId: string; project: string; firstPrompt: string }[];
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const NON_HUMAN_PREFIXES = [
  "<task-notification",
  "<system-reminder",
  "<command-",
  "<local-command",
  "<bash-",
];

function isToolResultOnly(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    content.every((b) => isPlainObject(b) && b.type === "tool_result")
  );
}

function contentBlocks(content: unknown): Record<string, unknown>[] {
  return Array.isArray(content) ? content.filter(isPlainObject) : [];
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  return contentBlocks(content)
    .map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : ""))
    .join("\n");
}

export function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function nonEmptyLines(s: string): string[] {
  return s.split("\n").map(normalizeWs).filter((l) => l !== "");
}

export function fencedBlocks(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}

export function bashInputCommand(text: string): string | undefined {
  const t = text.trimStart();
  if (!t.startsWith("<bash-input>")) return undefined;
  const m = /^<bash-input>([\s\S]*?)(?:<\/bash-input>|$)/.exec(t);
  return m?.[1]?.trim() ?? "";
}

export function isHandoff(command: string, precedingAssistantText: string): boolean {
  const want = normalizeWs(command);
  if (want === "") return false;
  const wantLines = nonEmptyLines(command);
  return fencedBlocks(precedingAssistantText).some((b) => {
    if (normalizeWs(b) === want) return true;
    const have = nonEmptyLines(b);
    return wantLines.every((l) => have.includes(l));
  });
}

export function isHookDenial(resultText: string): boolean {
  return resultText.includes("PreToolUse:") && resultText.includes("hook error");
}

interface ToolUse {
  name: string;
  command: string;
}

export function analyzeSession(lines: string[]): SessionMetrics {
  const m: SessionMetrics = {
    startedAt: "",
    cwd: "",
    humanPrompts: 0,
    firstPrompt: "",
    handoffs: 0,
    selfRuns: 0,
    deniedCommands: [],
    abnormalStops: 0,
    askUserQuestions: 0,
    exitPlanModes: 0,
    autonomous: false,
  };
  const toolUses = new Map<string, ToolUse>();
  let assistantText = "";
  let planAccepted = false;

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isPlainObject(parsed)) continue;
    const entry = parsed;

    const ts = typeof entry.timestamp === "string" ? entry.timestamp : "";
    if (!m.startedAt && ts && localDay(ts)) m.startedAt = ts;
    if (!m.cwd && typeof entry.cwd === "string") m.cwd = entry.cwd;

    const message = isPlainObject(entry.message) ? entry.message : undefined;

    if (entry.isApiErrorMessage === true) m.abnormalStops++;

    if (entry.type === "assistant") {
      for (const b of contentBlocks(message?.content)) {
        if (b.type === "text" && typeof b.text === "string") {
          assistantText += `\n${b.text}`;
        } else if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
          if (toolUses.has(b.id)) continue;
          const input = isPlainObject(b.input) ? b.input : {};
          toolUses.set(b.id, {
            name: b.name,
            command: typeof input.command === "string" ? input.command : "",
          });
          if (b.name === "AskUserQuestion") m.askUserQuestions++;
          if (b.name === "ExitPlanMode") m.exitPlanModes++;
        }
      }
      continue;
    }

    if (entry.type !== "user") continue;
    const content = message?.content;

    if (isToolResultOnly(content)) {
      for (const b of contentBlocks(content)) {
        const id = typeof b.tool_use_id === "string" ? b.tool_use_id : "";
        const use = toolUses.get(id);
        const text = textOf(b.content);
        const denied = isHookDenial(text);
        if (denied) m.deniedCommands.push(use?.command || `[${use?.name ?? "unknown"}]`);
        const failed = b.is_error === true || denied;
        if (use?.name === "ExitPlanMode" && !failed) planAccepted = true;
        if (
          use?.name === "Bash" &&
          !failed &&
          planAccepted &&
          /\bgh\s+pr\s+merge\b/.test(use.command)
        ) {
          m.autonomous = true;
        }
      }
      continue;
    }

    if (entry.isMeta === true) continue;
    const text = textOf(content);
    const command = bashInputCommand(text);
    if (command !== undefined) {
      if (isHandoff(command, assistantText)) m.handoffs++;
      else m.selfRuns++;
      continue;
    }
    const head = text.trimStart();
    if (NON_HUMAN_PREFIXES.some((p) => head.startsWith(p))) continue;

    m.humanPrompts++;
    if (!m.firstPrompt) m.firstPrompt = text;
    planAccepted = false;
    assistantText = "";
  }

  return m;
}

export function aggregate(records: SessionRecord[]): Totals {
  const t: Totals = {
    sessions: records.length,
    humanPrompts: 0,
    handoffs: 0,
    selfRuns: 0,
    denials: 0,
    denialSessions: 0,
    abnormalStops: 0,
    askUserQuestions: 0,
    exitPlanModes: 0,
    autonomousSessions: 0,
  };
  for (const { metrics: s } of records) {
    t.humanPrompts += s.humanPrompts;
    t.handoffs += s.handoffs;
    t.selfRuns += s.selfRuns;
    t.denials += s.deniedCommands.length;
    if (s.deniedCommands.length > 0) t.denialSessions++;
    t.abnormalStops += s.abnormalStops;
    t.askUserQuestions += s.askUserQuestions;
    t.exitPlanModes += s.exitPlanModes;
    if (s.autonomous) t.autonomousSessions++;
  }
  return t;
}

export function topDenied(records: SessionRecord[], n: number): { command: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const { metrics } of records) {
    for (const c of metrics.deniedCommands) {
      const key = normalizeWs(c);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([command, count]) => ({ command, count }))
    .sort((a, b) => b.count - a.count || a.command.localeCompare(b.command))
    .slice(0, n);
}

export function sampleSessions<T>(items: T[], n: number, rand: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = copy[i];
    const b = copy[j];
    if (a === undefined || b === undefined) continue;
    copy[i] = b;
    copy[j] = a;
  }
  return copy.slice(0, n);
}

export type SubjectKind = "feat" | "fix" | "other";

export function classifySubject(subject: string): SubjectKind {
  const m = /^(feat|fix)(\([^)]*\))?!?:/.exec(subject.trim());
  if (m?.[1] === "feat") return "feat";
  if (m?.[1] === "fix") return "fix";
  return "other";
}

export function countFeatFix(subjects: string[]): { feat: number; fix: number } {
  let feat = 0;
  let fix = 0;
  for (const s of subjects) {
    const k = classifySubject(s);
    if (k === "feat") feat++;
    else if (k === "fix") fix++;
  }
  return { feat, fix };
}

export function reworkRate(feat: number, fix: number): number | null {
  return feat + fix === 0 ? null : fix / (feat + fix);
}

export function hasIssueRef(message: string): boolean {
  const [first = "", ...rest] = message.split("\n");
  return /#\d+/.test([first.replace(/\s*\(#\d+\)\s*$/, ""), ...rest].join("\n"));
}

export function countGuardCommits(messages: string[]): GuardStats {
  return {
    total: messages.length,
    withoutIssueRef: messages.filter((msg) => !hasIssueRef(msg)).length,
  };
}

export function parseReviewDate(body: string): string | undefined {
  return /^\s*review:\s*(\d{4}-\d{2}-\d{2})\s*$/m.exec(body)?.[1];
}

export function countOverdue(bodies: string[], today: string): number {
  let n = 0;
  for (const b of bodies) {
    const d = parseReviewDate(b);
    if (d !== undefined && d < today) n++;
  }
  return n;
}

export function jstDate(now: Date): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function windowFor(year: number, month: number): MonthWindow {
  const pad = (n: number) => String(n).padStart(2, "0");
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    month: `${year}-${pad(month)}`,
    startMs: Date.UTC(year, month - 1, 1) - JST_OFFSET_MS,
    endMs: Date.UTC(nextYear, nextMonth - 1, 1) - JST_OFFSET_MS,
    startIso: `${year}-${pad(month)}-01T00:00:00+09:00`,
    endIso: `${nextYear}-${pad(nextMonth)}-01T00:00:00+09:00`,
  };
}

export function monthWindow(arg: string | undefined, now: Date): Result<MonthWindow, string> {
  if (arg === undefined) {
    const [y, mo] = jstDate(now).split("-").map(Number);
    if (y === undefined || mo === undefined) return { ok: false, error: "cannot compute current month" };
    return { ok: true, value: mo === 1 ? windowFor(y - 1, 12) : windowFor(y, mo - 1) };
  }
  const m = /^(\d{4})-(\d{2})$/.exec(arg);
  const year = Number(m?.[1]);
  const month = Number(m?.[2]);
  if (!m || month < 1 || month > 12) return { ok: false, error: `invalid --month: ${arg} (want YYYY-MM)` };
  return { ok: true, value: windowFor(year, month) };
}

export function parseRateLimitLines(lines: string[]): RateSnapshot[] {
  const out: RateSnapshot[] = [];
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isPlainObject(parsed)) continue;
    const tsMs = typeof parsed.ts === "string" ? new Date(parsed.ts).getTime() : Number.NaN;
    const pct = parsed.seven_day_pct;
    if (!Number.isFinite(tsMs) || typeof pct !== "number" || !Number.isFinite(pct)) continue;
    out.push({ tsMs, sevenDayPct: pct });
  }
  return out.sort((a, b) => a.tsMs - b.tsMs);
}

export function quotaClustering(
  commitTimesMs: number[],
  snapshots: RateSnapshot[],
  thresholdPct: number,
  window: MonthWindow,
): QuotaClustering {
  const inside = snapshots
    .filter((s) => s.tsMs >= window.startMs && s.tsMs < window.endMs)
    .sort((a, b) => a.tsMs - b.tsMs);

  let judged = 0;
  let highRemaining = 0;
  for (const c of commitTimesMs) {
    let prior: RateSnapshot | undefined;
    for (const s of inside) {
      if (s.tsMs <= c) prior = s;
      else break;
    }
    if (!prior) continue;
    judged++;
    if (prior.sevenDayPct <= thresholdPct) highRemaining++;
  }

  let covered = 0;
  let high = 0;
  inside.forEach((s, i) => {
    const until = inside[i + 1]?.tsMs ?? window.endMs;
    covered += until - s.tsMs;
    if (s.sevenDayPct <= thresholdPct) high += until - s.tsMs;
  });

  return { judged, highRemaining, highTimeShare: covered > 0 ? high / covered : null };
}

export function lastDayOfMonth(w: MonthWindow): string {
  return jstDate(new Date(w.endMs - 1));
}

export function inWindow(ts: string, w: MonthWindow): boolean {
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) && ms >= w.startMs && ms < w.endMs;
}

const na = (n: number | null): string => (n === null ? "N/A" : String(n));
const pct = (r: number | null): string => (r === null ? "N/A" : `${(r * 100).toFixed(1)}%`);

function sumNullable(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
}

export function renderPublic(r: ReportInput): string {
  const t = r.totals;
  const product = r.repos.filter((x) => x.kind === "product");
  const harness = r.repos.filter((x) => x.kind === "harness");
  const feat = sumNullable(product.map((x) => x.feat));
  const fix = sumNullable(product.map((x) => x.fix));
  const merged = sumNullable(product.map((x) => x.mergedPrs));
  const rate = feat === null || fix === null ? null : reworkRate(feat, fix);
  return [
    `## 公開用 (${r.window.month})`,
    "",
    `- セッション数: ${t.sessions}`,
    `- ユーザー発言: ${t.humanPrompts}`,
    `- 手渡し: ${t.handoffs}（自分で実行した ! コマンド: ${t.selfRuns}）`,
    `- hook 拒否: ${t.denials}（${t.denialSessions} セッション）`,
    `- 異常停止: ${t.abnormalStops}`,
    `- 必要な介入（AskUserQuestion ${t.askUserQuestions} / ExitPlanMode ${t.exitPlanModes}）${
      t.askUserQuestions + t.exitPlanModes === 0 ? " 警告: 0 件" : ""
    }`,
    `- 自律稼働セッション: ${t.autonomousSessions}`,
    `- 出荷（プロダクト系）: feat ${na(feat)} / fix ${na(fix)} / マージ PR ${na(merged)}`,
    `- 手戻り率（プロダクト系）: ${pct(rate)}`,
    `- ハーネス系: feat ${na(sumNullable(harness.map((x) => x.feat)))} / fix ${na(
      sumNullable(harness.map((x) => x.fix)),
    )} / マージ PR ${na(sumNullable(harness.map((x) => x.mergedPrs)))}`,
    `- 対象外 (gate なし): ${r.excludedRepos.length} リポジトリ`,
    `- ガードファイルのコミット: ${r.guard === null ? "N/A" : r.guard.total}（Issue 参照なし: ${
      r.guard === null ? "N/A" : r.guard.withoutIssueRef
    }）`,
    `- harness-urgent Issue: ${na(r.urgentIssues)}`,
    `- 見直し日を過ぎた harness-hypothesis: ${na(r.overdueHypotheses)}`,
    r.quota && r.quota.highTimeShare !== null
      ? `- 目的化の見張り: 残量が多い時期のハーネス系コミット ${r.quota.highRemaining}/${r.quota.judged}（基準: 残量が多い時間の割合 ${pct(r.quota.highTimeShare)}）`
      : "- 目的化の見張り: 未計測（rate_limits 未記録）",
    "",
  ].join("\n");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

export function renderLocal(r: ReportInput): string {
  const out: string[] = [`## ローカル用（貼らない） (${r.window.month})`, ""];
  if (r.warnings.length > 0) {
    out.push("### 警告", ...r.warnings.map((w) => `- ${w}`), "");
  }
  out.push("### リポジトリ別");
  for (const x of r.repos) {
    out.push(`- ${x.repo}: feat ${na(x.feat)} / fix ${na(x.fix)} / マージ PR ${na(x.mergedPrs)}`);
  }
  if (r.excludedRepos.length > 0) {
    out.push("", "### 対象外 (gate なし)", ...r.excludedRepos.map((x) => `- ${x}`));
  }
  out.push("", "### 拒否されたコマンド上位");
  if (r.topDenied.length === 0) out.push("- なし");
  for (const d of r.topDenied) out.push(`- ${d.count}x ${d.command}`);
  out.push("", "### 分類用サンプル");
  if (r.sample.length === 0) out.push("- なし");
  for (const s of r.sample) {
    out.push(`- ${s.sessionId} [${s.project}] ${truncate(normalizeWs(s.firstPrompt), 120)}`);
  }
  out.push("");
  return out.join("\n");
}
