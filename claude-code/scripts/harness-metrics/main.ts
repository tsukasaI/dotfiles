#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, join } from "path";
import { isPlainObject } from "../../lib/transcript-parse";
import {
  aggregate,
  analyzeSession,
  countFeatFix,
  countGuardCommits,
  countOverdue,
  inWindow,
  jstDate,
  lastDayOfMonth,
  monthWindow,
  renderLocal,
  renderPublic,
  sampleSessions,
  topDenied,
  type GuardStats,
  type MonthWindow,
  type RepoRow,
  type Result,
  type SessionRecord,
} from "./metrics";

const home = Bun.env.HOME ?? "";
const warnings: string[] = [];

function warn(msg: string): void {
  warnings.push(msg);
  console.error(`warning: ${msg}`);
}

function toLines(text: string): string[] {
  return text.split("\n").filter((l) => l.trim());
}

function loadDbTranscripts(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const path = join(home, ".local", "share", "claude-logs", "logs.db");
  try {
    const db = new Database(path, { readonly: true });
    const rows = db.query("SELECT session_id, transcript_jsonl FROM transcript_raw").all();
    db.close();
    for (const row of rows) {
      if (!isPlainObject(row)) continue;
      if (typeof row.session_id === "string" && typeof row.transcript_jsonl === "string") {
        out.set(row.session_id, toLines(row.transcript_jsonl));
      }
    }
  } catch (e: unknown) {
    warn(`logs.db unreadable: ${e instanceof Error ? e.message : String(e)}`);
  }
  return out;
}

function loadJsonlTranscripts(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const root = join(home, ".claude", "projects");
  try {
    for (const dir of readdirSync(root)) {
      const full = join(root, dir);
      if (!statSync(full).isDirectory()) continue;
      for (const f of readdirSync(full)) {
        if (!f.endsWith(".jsonl")) continue;
        try {
          out.set(basename(f, ".jsonl"), toLines(readFileSync(join(full, f), "utf-8")));
        } catch (e: unknown) {
          warn(`transcript unreadable: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  } catch (e: unknown) {
    warn(`~/.claude/projects unreadable: ${e instanceof Error ? e.message : String(e)}`);
  }
  return out;
}

async function run(cmd: string[], cwd: string): Promise<Result<string, string>> {
  try {
    const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return code === 0
      ? { ok: true, value: stdout }
      : { ok: false, error: `${cmd.slice(0, 2).join(" ")} exited ${code}: ${stderr.trim().slice(0, 200)}` };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? home + p.slice(1) : p;
}

function hasGate(repo: string): boolean {
  try {
    const names = readdirSync(repo);
    return (
      names.some((n) => n.startsWith("lefthook") || n.startsWith(".lefthook")) ||
      existsSync(join(repo, ".github", "workflows"))
    );
  } catch {
    return false;
  }
}

function isOthersOss(repo: string): boolean {
  return repo.startsWith(join(home, "oss") + "/") || repo.startsWith(join(home, "engineer", "oss") + "/");
}

async function repoToplevel(cwd: string): Promise<string | undefined> {
  const r = await run(["git", "rev-parse", "--show-toplevel"], cwd);
  return r.ok ? r.value.trim() : undefined;
}

function stringField(v: unknown, key: string): string {
  if (!isPlainObject(v)) return "";
  const x = v[key];
  return typeof x === "string" ? x : "";
}

async function repoRow(repo: string, w: MonthWindow): Promise<RepoRow> {
  const name = basename(repo);
  const kind = name === "dotfiles" || name === "shguard" ? "harness" : "product";
  const empty: RepoRow = { repo: name, kind, feat: null, fix: null, mergedPrs: null };
  if (name === "dotfiles" || name === "ops") {
    const r = await run(
      ["git", "log", `--since=${w.startIso}`, `--until=${w.endIso}`, "--format=%s"],
      repo,
    );
    if (!r.ok) {
      warn(`${name}: ${r.error}`);
      return empty;
    }
    return { ...empty, ...countFeatFix(r.value.split("\n")) };
  }
  const r = await run(
    [
      "gh", "pr", "list", "--state", "merged",
      "--search", `merged:${w.startIso.slice(0, 10)}..${lastDayOfMonth(w)}`,
      "--json", "title", "--limit", "200",
    ],
    repo,
  );
  if (!r.ok) {
    warn(`${name}: ${r.error}`);
    return empty;
  }
  try {
    const parsed: unknown = JSON.parse(r.value);
    const titles = Array.isArray(parsed) ? parsed.map((p: unknown) => stringField(p, "title")) : [];
    return { ...empty, ...countFeatFix(titles), mergedPrs: titles.length };
  } catch {
    warn(`${name}: gh output not JSON`);
    return empty;
  }
}

async function guardStats(w: MonthWindow): Promise<GuardStats | null> {
  const messages: string[] = [];
  const sources: { dir: string; paths: string[] }[] = [
    {
      dir: join(home, "dotfiles"),
      paths: ["--", "claude-code/shguard/", "claude-code/settings.json", "claude-code/hooks/"],
    },
    { dir: join(home, "engineer", "shguard"), paths: [] },
  ];
  let failed = false;
  for (const s of sources) {
    const r = await run(
      ["git", "log", `--since=${w.startIso}`, `--until=${w.endIso}`, "--format=%B%x00", ...s.paths],
      s.dir,
    );
    if (!r.ok) {
      warn(`guard commits: ${r.error}`);
      failed = true;
      continue;
    }
    messages.push(...r.value.split("\0").filter((m) => m.trim()));
  }
  return failed ? null : countGuardCommits(messages);
}

async function ghCount(args: string[], field: "length" | "bodies", dir: string): Promise<number | string[] | null> {
  const r = await run(["gh", "issue", "list", ...args, "--limit", "200"], dir);
  if (!r.ok) {
    warn(`gh issue list: ${r.error}`);
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(r.value);
    if (!Array.isArray(parsed)) return null;
    if (field === "length") return parsed.length;
    return parsed.map((p: unknown) => stringField(p, "body"));
  } catch {
    warn("gh issue list: output not JSON");
    return null;
  }
}

async function main(): Promise<void> {
  const flagIdx = process.argv.indexOf("--month");
  const w = monthWindow(flagIdx === -1 ? undefined : process.argv[flagIdx + 1], new Date());
  if (!w.ok) {
    console.error(w.error);
    process.exit(2);
  }
  const window = w.value;

  const merged = loadDbTranscripts();
  for (const [id, lines] of loadJsonlTranscripts()) {
    const existing = merged.get(id);
    if (!existing || lines.length > existing.length) merged.set(id, lines);
  }

  const records: SessionRecord[] = [];
  const cwds = new Map<string, string>();
  for (const [sessionId, lines] of merged) {
    const metrics = analyzeSession(lines);
    if (!inWindow(metrics.startedAt, window)) continue;
    records.push({ sessionId, metrics });
    if (metrics.cwd) cwds.set(sessionId, expandHome(metrics.cwd));
  }

  const repoDirs = new Set<string>();
  for (const cwd of new Set(cwds.values())) {
    const top = await repoToplevel(cwd);
    if (top) repoDirs.add(top);
  }

  const repos: RepoRow[] = [];
  const excludedRepos: string[] = [];
  for (const dir of [...repoDirs].sort()) {
    if (isOthersOss(dir)) continue;
    if (!hasGate(dir)) {
      excludedRepos.push(basename(dir));
      continue;
    }
    repos.push(await repoRow(dir, window));
  }

  const dotfiles = join(home, "dotfiles");
  const urgent = await ghCount(
    ["--label", "harness-urgent", "--state", "all", "--search", `created:${window.startIso.slice(0, 10)}..${lastDayOfMonth(window)}`, "--json", "number"],
    "length",
    dotfiles,
  );
  const hypotheses = await ghCount(
    ["--label", "harness-hypothesis", "--state", "open", "--json", "body"],
    "bodies",
    dotfiles,
  );

  const sample = sampleSessions(records, 5, Math.random).map((r) => ({
    sessionId: r.sessionId,
    project: basename(r.metrics.cwd) || "unknown",
    firstPrompt: r.metrics.firstPrompt,
  }));

  const input = {
    window,
    totals: aggregate(records),
    repos,
    excludedRepos,
    guard: await guardStats(window),
    urgentIssues: typeof urgent === "number" ? urgent : null,
    overdueHypotheses: Array.isArray(hypotheses) ? countOverdue(hypotheses, jstDate(new Date())) : null,
    warnings,
    topDenied: topDenied(records, 10),
    sample,
  };
  console.log(renderPublic(input));
  console.log(renderLocal(input));
}

await main();
