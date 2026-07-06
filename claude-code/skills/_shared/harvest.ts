#!/usr/bin/env bun
/**
 * harvest.ts — cross-repo knowledge harvester for /article and /weekly-digest.
 *
 * Read-only: runs `git log` across ~/engineer repos, extracts Contextual Commit
 * body lines (learned/decision/rejected/constraint/intent), collects recent
 * vault notes, qiita_drafts status, and optional session stats from logs.db.
 *
 * Usage:
 *   bun harvest.ts --mode=weekly     [--since=YYYY-MM-DD]  # default: last Monday
 *   bun harvest.ts --mode=candidates [--since=YYYY-MM-DD]  # default: 30 days ago
 *
 * Output: one JSON object on stdout. Warnings on stderr.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename, dirname } from "node:path";

// ---------- config ----------

const CONFIG_PATH = join(import.meta.dir, "kb.json");

interface Config {
  vault_root: string;
  notes_dir: string;
  ideas_file: string;
  legacy_notes: string;
  drafts_repo: string;
  engineer_root: string;
  extra_repos?: string[];
  logs_db: string;
  ops_repo: string;
  author_emails: string[];
  max_commits_per_repo: number;
  scan_depth: number;
}

function expand(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

const raw: Config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
const cfg = {
  ...raw,
  vault_root: expand(raw.vault_root),
  notes_dir: expand(raw.notes_dir),
  ideas_file: expand(raw.ideas_file),
  legacy_notes: expand(raw.legacy_notes),
  drafts_repo: expand(raw.drafts_repo),
  engineer_root: expand(raw.engineer_root),
  logs_db: expand(raw.logs_db),
};

// ---------- args ----------

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args.set(m[1], m[2] ?? "true");
}

const mode = args.get("mode");
if (mode !== "weekly" && mode !== "candidates") {
  console.error("usage: harvest.ts --mode=weekly|candidates [--since=YYYY-MM-DD]");
  process.exit(2);
}

function lastMonday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - ((day + 6) % 7));
  return d;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function localYMD(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const sinceArg = args.get("since");
if (sinceArg && !/^\d{4}-\d{2}-\d{2}$/.test(sinceArg)) {
  console.error(`invalid --since: ${sinceArg} (expected YYYY-MM-DD)`);
  process.exit(2);
}
const since = sinceArg ?? localYMD(mode === "weekly" ? lastMonday() : daysAgo(30));

const warnings: string[] = [];
const warn = (msg: string) => {
  warnings.push(msg);
  console.error(`warn: ${msg}`);
};

// ---------- helpers ----------

async function run(
  cmd: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { cwd: opts.cwd, stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = opts.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, opts.timeoutMs)
    : null;
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (timer) clearTimeout(timer);
  return { ok: code === 0 && !timedOut, stdout, stderr: timedOut ? "timeout" : stderr };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------- 1. repo discovery ----------

async function discoverRepos(): Promise<string[]> {
  const res = await run(
    ["fd", "-H", "-I", "-t", "d", "-d", String(cfg.scan_depth), "^\\.git$", cfg.engineer_root],
    { timeoutMs: 30_000 },
  );
  if (!res.ok) {
    warn(`repo discovery failed: ${res.stderr.trim().slice(0, 200)}`);
    return [];
  }
  const skip = new Set([cfg.vault_root, cfg.drafts_repo]);
  const extras = (cfg.extra_repos ?? []).map(expand).filter((p) => existsSync(join(p, ".git")));
  return [...new Set([
    ...res.stdout.split("\n").filter(Boolean).map((p) => dirname(p.replace(/\/$/, ""))),
    ...extras,
  ])]
    .filter((r) => !skip.has(r))
    .sort();
}

// ---------- 2. per-repo commit harvest ----------

const CONTEXT_RE = /^(intent|decision|rejected|constraint|learned)\(([^)]*)\):\s*(.+)$/;
const REC_SEP = "\x1e";
const FIELD_SEP = "\x1f";

interface Commit { hash: string; date: string; subject: string; body: string }
interface RepoResult {
  repo: string;
  count: number;
  subjects: string[];
  contextual: { hash: string; date: string; kind: string; scope: string; text: string }[];
}

async function harvestRepo(repoPath: string): Promise<RepoResult | null> {
  const authorArgs = cfg.author_emails.flatMap((e) => ["--author", e]);
  const res = await run(
    [
      "git", "-C", repoPath, "log",
      `--since=${since}`, ...authorArgs,
      "--no-merges", `--max-count=${cfg.max_commits_per_repo}`, "--date=short",
      `--pretty=format:%h${FIELD_SEP}%ad${FIELD_SEP}%s${FIELD_SEP}%b${REC_SEP}`,
    ],
    { timeoutMs: 10_000 },
  );
  if (!res.ok) {
    if (!/does not have any commits yet/.test(res.stderr)) {
      warn(`git log failed in ${basename(repoPath)}: ${res.stderr.trim().slice(0, 120)}`);
    }
    return null;
  }
  const commits: Commit[] = res.stdout
    .split(REC_SEP)
    .map((rec) => rec.replace(/^\n/, ""))
    .filter((rec) => rec.trim().length > 0)
    .map((rec) => {
      const [hash, date, subject, body = ""] = rec.split(FIELD_SEP);
      return { hash, date, subject, body };
    })
    .filter((c) => c.hash);
  if (commits.length === 0) return null;

  const repo = repoPath.startsWith(cfg.engineer_root + "/")
    ? repoPath.slice(cfg.engineer_root.length + 1)
    : basename(repoPath);
  const contextual = commits.flatMap((c) => {
    const found: { hash: string; date: string; kind: string; scope: string; text: string }[] = [];
    let continuing = false;
    for (const rawLine of c.body.split("\n")) {
      const line = rawLine.trim();
      const m = line.match(CONTEXT_RE);
      if (/^(Claude-Session|Co-authored-by|Signed-off-by):/i.test(line)) {
        continuing = false; // commit trailers are never continuations
      } else if (m) {
        found.push({ hash: c.hash, date: c.date, kind: m[1], scope: m[2], text: m[3] });
        continuing = true;
      } else if (line && continuing) {
        // wrapped continuation of the previous action line
        found[found.length - 1].text += ` ${line}`;
      } else {
        continuing = false; // blank or non-action line ends the continuation
      }
    }
    return found;
  });
  return { repo, count: commits.length, subjects: commits.map((c) => c.subject), contextual };
}

// ---------- 3. vault notes ----------

interface NoteInfo { path: string; title: string; tags: string[]; updated: string }

function recentNotes(): { exists: boolean; notes: NoteInfo[] } {
  if (!existsSync(cfg.notes_dir)) return { exists: false, notes: [] };
  const notes: NoteInfo[] = [];
  // Parse as local midnight so this matches git log's local-time --since (bare
  // "YYYY-MM-DD" would otherwise parse as UTC and skew the boundary by the offset).
  const sinceMs = new Date(`${since}T00:00:00`).getTime();
  for (const f of readdirSync(cfg.notes_dir)) {
    if (!f.endsWith(".md")) continue;
    const full = join(cfg.notes_dir, f);
    try {
      const stat = Bun.file(full);
      if (stat.lastModified < sinceMs) continue;
      const head = readFileSync(full, "utf8").split("\n").slice(0, 20);
      const title = head.find((l) => l.startsWith("# "))?.slice(2) ?? f;
      const tagLine = head.find((l) => l.startsWith("tags:")) ?? "";
      const tags = [...tagLine.matchAll(/[\w-]+/g)].map((m) => m[0]).filter((t) => t !== "tags");
      const updated = head.find((l) => l.startsWith("updated:"))?.slice(8).trim() ?? "";
      notes.push({ path: full, title, tags, updated });
    } catch (e) {
      warn(`could not read note ${f}: ${e}`);
    }
  }
  return { exists: true, notes };
}

// ---------- 4. drafts repo status ----------

interface DraftsInfo {
  exists: boolean;
  wip: string[];
  changed_recent: string[];
  backlog_ideas: string[];
}

async function draftsStatus(): Promise<DraftsInfo> {
  if (!existsSync(cfg.drafts_repo)) {
    warn(`drafts repo missing: ${cfg.drafts_repo}`);
    return { exists: false, wip: [], changed_recent: [], backlog_ideas: [] };
  }
  const wip = readdirSync(cfg.drafts_repo)
    .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")
    .sort();
  const log = await run(
    ["git", "-C", cfg.drafts_repo, "log", `--since=${since}`, "--name-only", "--pretty=format:"],
    { timeoutMs: 10_000 },
  );
  const changed = log.ok
    ? [...new Set(log.stdout.split("\n").filter((l) => l.endsWith(".md")))]
    : [];

  let backlog: string[] = [];
  if (mode === "candidates") {
    try {
      const readme = readFileSync(join(cfg.drafts_repo, "README.md"), "utf8");
      const lines = readme.split("\n");
      const start = lines.findIndex((l) => /^##\s*future\s*$/i.test(l.trim()));
      if (start < 0) {
        warn("qiita_drafts README has no '## future' heading; backlog is empty");
      } else {
        let end = lines.slice(start + 1).findIndex((l) => /^##?\s/.test(l));
        end = end === -1 ? lines.length : start + 1 + end;
        backlog = lines
          .slice(start + 1, end)
          .map((l) => l.trim())
          .filter((l) => /^(\d+\.|-)\s+/.test(l))
          .map((l) => l.replace(/^(\d+\.|-)\s+/, ""));
      }
    } catch {
      warn("could not read qiita_drafts README backlog");
    }
  }
  return { exists: true, wip, changed_recent: changed, backlog_ideas: backlog };
}

// ---------- 5. session stats (optional) ----------

interface SessionStat { project_dir: string; sessions: number; user_messages: number }

function sessionStats(): SessionStat[] | null {
  if (!existsSync(cfg.logs_db)) return null;
  try {
    const { Database } = require("bun:sqlite");
    const db = new Database(cfg.logs_db, { readonly: true });
    const rows = db
      .query(
        `SELECT project_dir, COUNT(*) AS sessions,
                COALESCE(SUM(num_user_messages), 0) AS user_messages
         FROM sessions WHERE started_at >= ?
         GROUP BY project_dir ORDER BY sessions DESC LIMIT 20`,
      )
      .all(since) as SessionStat[];
    db.close();
    return rows;
  } catch (e) {
    warn(`logs.db query failed: ${e}`);
    return null;
  }
}

// ---------- main ----------

const t0 = performance.now();
const repos = await discoverRepos();
const repoResults = (await mapLimit(repos, 8, harvestRepo)).filter(
  (r): r is RepoResult => r !== null,
);
const kb = recentNotes();
const drafts = await draftsStatus();
const sessions = sessionStats();

const out = {
  meta: {
    mode,
    since,
    generated_at: new Date().toISOString(),
    repos_discovered: repos.length,
    repos_with_commits: repoResults.length,
    elapsed_ms: Math.round(performance.now() - t0),
    warnings,
  },
  commits: repoResults.map(({ repo, count, subjects }) => ({ repo, count, subjects })),
  contextual_lines: repoResults.flatMap((r) =>
    r.contextual.map((c) => ({ repo: r.repo, ...c })),
  ),
  kb,
  drafts,
  sessions,
};

console.log(JSON.stringify(out, null, 2));
