#!/usr/bin/env bun

import {
  readFileSync,
  readdirSync,
  statSync,
  realpathSync,
  existsSync,
} from "fs";
import { join, dirname } from "path";
import { HOME, PROJECTS_DIR, loadCache, saveCache, walkProjectTranscripts, type CacheFile } from "../../_shared/transcript-walk";

const WINDOW_DAYS = 90;
const NOW = Date.now();
const CUTOFF_MS = NOW - WINDOW_DAYS * 24 * 3600 * 1000;
const PROMPT_CLUSTER_MIN = 3;
const FIRST_WORDS_COUNT = 5;
const DEAD_SKILL_DAYS = 90;
const OVERLAP_MIN_MATCHES = 5;
const META_CLUSTER_MIN_MEMBERS = 3;

const STOPLIST = new Set([
  "the", "and", "for", "use", "uses", "using", "when", "this", "with", "from",
  "into", "via", "you", "your", "that", "are", "have", "has", "had", "but",
  "not", "all", "any", "can", "may", "see", "set", "get", "let", "one", "two",
  "new", "old", "now", "next", "also", "out", "than", "more", "less", "very",
  "should", "could", "would", "must", "will", "want", "need", "wants", "needs",
  "make", "made", "show", "list", "based", "such", "etc",
  "instead", "before", "after", "while", "what", "which", "where", "how", "why",
  "skill", "skills", "claude", "code", "file", "files", "type", "name", "names",
  "above", "below", "each", "both", "only", "either", "between", "across",
  "true", "false", "null", "undefined",
]);

function extractKeywords(text: string): Set<string> {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  for (const t of lower.split(/[^a-z0-9-]+/)) {
    if (t.length < 3) continue;
    if (STOPLIST.has(t)) continue;
    if (/^\d+$/.test(t)) continue;
    out.add(t);
  }
  return out;
}

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

const PROMPT_MAX_CHARS = 1000;

interface SkillRecord {
  name: string;
  path: string;
  scope: "user" | "project";
  mtime: string;
  frontmatter: { name?: string; description?: string };
  body_first_300_chars: string;
  body_first_500_chars: string;
  raw_body: string;
  keywords: string[];
}

function findGitRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 32; i++) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function listSkillDirsForCwd(cwd: string): SkillRecord[] {
  const records: SkillRecord[] = [];
  const seen = new Set<string>();

  const userSkills = join(HOME, ".claude", "skills");
  if (existsSync(userSkills)) {
    for (const entry of readdirSync(userSkills, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const skillMd = join(userSkills, entry.name, "SKILL.md");
      if (!existsSync(skillMd)) continue;
      const rec = loadSkill(entry.name, skillMd, "user");
      if (seen.has(rec.path)) continue;
      seen.add(rec.path);
      records.push(rec);
    }
  }

  const gitRoot = findGitRoot(cwd);
  let dir = cwd;
  for (let i = 0; i < 32; i++) {
    const skillsDir = join(dir, ".claude", "skills");
    if (existsSync(skillsDir)) {
      try {
        for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const skillMd = join(skillsDir, entry.name, "SKILL.md");
          if (!existsSync(skillMd)) continue;
          const rec = loadSkill(entry.name, skillMd, "project");
          if (seen.has(rec.path)) continue;
          seen.add(rec.path);
          records.push(rec);
        }
      } catch {}
    }
    if (gitRoot && dir === gitRoot) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return records;
}

const skillsForCwdCache = new Map<string, SkillRecord[]>();
function getSkillsForCwd(cwd: string): SkillRecord[] {
  if (!cwd) return [];
  const cached = skillsForCwdCache.get(cwd);
  if (cached) return cached;
  const result = listSkillDirsForCwd(cwd);
  skillsForCwdCache.set(cwd, result);
  return result;
}

function loadSkill(name: string, skillMd: string, scope: "user" | "project"): SkillRecord {
  let resolvedPath = skillMd;
  try {
    resolvedPath = realpathSync(skillMd);
  } catch {}
  const raw = readFileSync(resolvedPath, "utf-8");
  const fm = parseFrontmatter(raw);
  const body = stripFrontmatter(raw);
  const mtime = new Date(statSync(resolvedPath).mtimeMs).toISOString();
  const body500 = body.slice(0, 500);
  const keywords = [...extractKeywords(`${fm.description ?? ""}\n${body500}`)];
  return {
    name,
    path: resolvedPath,
    scope,
    mtime,
    frontmatter: fm,
    body_first_300_chars: body.slice(0, 300),
    body_first_500_chars: body500,
    raw_body: body,
    keywords,
  };
}

function parseFrontmatter(raw: string): { name?: string; description?: string } {
  if (!raw.startsWith("---")) return {};
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return {};
  const block = raw.slice(3, end);
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim();
  }
  return out;
}

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---")) return raw;
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return raw;
  return raw.slice(end + 4).replace(/^\n/, "");
}

interface SkillInvocation {
  skill_name: string;
  ts: string;
  cwd: string;
}

interface PromptEntry {
  text: string;
  ts: string;
  cwd: string;
  is_slash: boolean;
}

interface ScanResult {
  invocations: SkillInvocation[];
  prompts: PromptEntry[];
  sessions_scanned: number;
  oldest_session_ms: number | null;
}

// --- Incremental cursor (#40) ---
// Every prior run re-read and re-parsed every in-window .jsonl file from
// scratch (189MB / 507 files and growing). A session's transcript stops
// changing once the session ends, so we cache each file's extracted result
// keyed by (mtimeMs, size) and only re-parse files that are new or changed
// (i.e. the still-active session). The cache is rebuilt each run to contain
// exactly the current in-window file set, so it can't grow past the data it
// mirrors — files that age out of the window are dropped automatically.
// Walk + cache I/O mechanics are shared with corrections.ts via
// _shared/transcript-walk.ts (#9); only per-session extraction and result
// aggregation below are specific to skills.ts.
const CACHE_DIR = join(HOME, ".local", "share", "claude-self-improve");
const CACHE_PATH = join(CACHE_DIR, "skills-scan-cache.json");
const CACHE_VERSION = 1;

interface SessionExtract {
  invocations: SkillInvocation[];
  prompts: PromptEntry[];
  sessionStartMs: number | null;
}

function scan(): ScanResult {
  const result: ScanResult = {
    invocations: [],
    prompts: [],
    sessions_scanned: 0,
    oldest_session_ms: null,
  };

  if (!existsSync(PROJECTS_DIR)) return result;

  const oldCache = loadCache<SessionExtract>(CACHE_PATH, CACHE_VERSION);
  const newCache: CacheFile<SessionExtract> = { version: CACHE_VERSION, files: {} };

  const { sessionsScanned, oldestSessionMs } = walkProjectTranscripts(
    CUTOFF_MS,
    oldCache,
    newCache,
    extractSession,
    (extract) => {
      result.invocations.push(...extract.invocations);
      result.prompts.push(...extract.prompts);
    },
  );
  result.sessions_scanned = sessionsScanned;
  result.oldest_session_ms = oldestSessionMs;

  saveCache(CACHE_PATH, CACHE_DIR, newCache);
  return result;
}

function extractSession(file: string): SessionExtract {
  const extract: SessionExtract = { invocations: [], prompts: [], sessionStartMs: null };
  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch {
    return extract;
  }
  let sessionCwd: string | null = null;
  let sessionStartMs: number | null = null;

  for (const line of raw.split("\n")) {
    if (!line) continue;
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.cwd && !sessionCwd) sessionCwd = entry.cwd;
    const tsStr = entry.timestamp;
    const tsMs = tsStr ? Date.parse(tsStr) : NaN;
    if (!isNaN(tsMs) && sessionStartMs === null) sessionStartMs = tsMs;

    if (entry.isSidechain === true) continue;

    const content = entry.message?.content;
    if (!content || typeof content === "string") {
      if (entry.type === "user" && typeof content === "string") {
        recordPrompt(content, tsStr, sessionCwd, entry.isMeta === true, extract);
      }
      continue;
    }
    if (entry.type === "assistant") {
      for (const block of content) {
        if (block.type !== "tool_use") continue;
        const tu = block as ToolUse;
        if (tu.name === "Skill") {
          const skillName = typeof tu.input?.skill === "string" ? tu.input.skill : undefined;
          if (skillName) {
            extract.invocations.push({
              skill_name: skillName,
              ts: tsStr ?? "",
              cwd: sessionCwd ?? "",
            });
          }
        }
      }
    } else if (entry.type === "user") {
      let skip = false;
      for (const block of content) {
        if (block.type === "tool_result" || (block as any).tool_use_id) {
          skip = true;
          break;
        }
      }
      if (skip) continue;
      for (const block of content) {
        if (block.type !== "text") continue;
        const text = (block as TextBlock).text;
        recordPrompt(text, tsStr, sessionCwd, entry.isMeta === true, extract);
      }
    }
  }
  extract.sessionStartMs = sessionStartMs;
  return extract;
}

function recordPrompt(
  text: string,
  ts: string | undefined,
  cwd: string | null,
  isMeta: boolean,
  extract: SessionExtract,
): void {
  if (!text) return;
  if (isMeta) return;
  const trimmed = text.trim();
  if (!trimmed) return;
  if (trimmed.length > PROMPT_MAX_CHARS) return;
  if (trimmed.startsWith("[Request interrupted")) return;
  if (trimmed.startsWith("<system-reminder>")) return;
  if (trimmed.startsWith("<local-command-caveat>")) return;
  if (trimmed.startsWith("<local-command-stdout>")) return;
  if (trimmed.startsWith("<local-command-stderr>")) return;
  if (trimmed.startsWith("<command-")) return;
  if (trimmed.startsWith("<bash-")) return;
  if (trimmed.startsWith("<user-prompt-submit-hook>")) return;
  if (/^\[image #\d+]/i.test(trimmed)) return;
  const isSlash = /^\/[a-z][a-z0-9_-]*/i.test(trimmed);
  extract.prompts.push({
    text: trimmed,
    ts: ts ?? "",
    cwd: cwd ?? "",
    is_slash: isSlash,
  });
}

function normalizeFirstWords(text: string): string {
  const lower = text.toLowerCase();
  const noSlash = lower.replace(/^\/[a-z][a-z0-9_-]*\s*/, "");
  const words = noSlash.split(/\s+/).filter((w) => w.length > 0);
  return words.slice(0, FIRST_WORDS_COUNT).join(" ");
}

function buildDeadSkills(skills: SkillRecord[], scan: ScanResult, dataSufficient: boolean) {
  const lastUsed = new Map<string, number>();
  for (const inv of scan.invocations) {
    const ts = Date.parse(inv.ts);
    if (isNaN(ts)) continue;
    const prev = lastUsed.get(inv.skill_name) ?? 0;
    if (ts > prev) lastUsed.set(inv.skill_name, ts);
  }
  const result: any[] = [];
  for (const s of skills) {
    const fmName = s.frontmatter.name ?? s.name;
    const last = lastUsed.get(fmName) ?? lastUsed.get(s.name) ?? null;
    const lastIso = last ? new Date(last).toISOString() : null;
    if (!dataSufficient && last === null) continue;
    const ageOk = last === null || NOW - last > DEAD_SKILL_DAYS * 24 * 3600 * 1000;
    if (!ageOk) continue;
    result.push({
      name: s.name,
      path: s.path,
      scope: s.scope,
      last_used: lastIso,
      total_uses_in_window: scan.invocations.filter(
        (i) => i.skill_name === fmName || i.skill_name === s.name,
      ).length,
    });
  }
  return result;
}

interface OverlapHint {
  skill_name: string;
  skill_path: string;
  scope: "user" | "project";
  description: string;
  match_count: number;
}

function computeOverlapHints(clusterSamples: string[], skills: SkillRecord[]): OverlapHint[] {
  const clusterKw = extractKeywords(clusterSamples.join("\n"));
  const hits: OverlapHint[] = [];
  for (const s of skills) {
    let matches = 0;
    for (const w of s.keywords) {
      if (clusterKw.has(w)) matches++;
    }
    if (matches < OVERLAP_MIN_MATCHES) continue;
    hits.push({
      skill_name: s.frontmatter.name ?? s.name,
      skill_path: s.path,
      scope: s.scope,
      description: s.frontmatter.description ?? "",
      match_count: matches,
    });
  }
  hits.sort((a, b) => b.match_count - a.match_count);
  return hits.slice(0, 3);
}

const CODE_REVIEW_TOPIC_WORDS = new Set([
  "review", "code-review", "lc", "leetcode", "algorithm", "algo", "lint",
  "refactor", "debug", "coding", "interview", "tdd", "test", "tests",
]);

function computeCodeReviewOverlap(skills: SkillRecord[]): OverlapHint[] {
  const hits: OverlapHint[] = [];
  for (const s of skills) {
    const matched: string[] = [];
    for (const w of s.keywords) {
      if (CODE_REVIEW_TOPIC_WORDS.has(w)) matched.push(w);
    }
    if (matched.length < 2) continue;
    hits.push({
      skill_name: s.frontmatter.name ?? s.name,
      skill_path: s.path,
      scope: s.scope,
      description: s.frontmatter.description ?? "",
      match_count: matched.length,
    });
  }
  hits.sort((a, b) => b.match_count - a.match_count);
  return hits.slice(0, 3);
}

function detectLanguage(firstSample: string): string {
  const firstLine = firstSample.split(/\r?\n/)[0].trim();
  if (
    /^func\s+/.test(firstLine) ||
    /^package\s+\w/.test(firstLine) ||
    /^import\s+"/.test(firstLine) ||
    /^type\s+\w+\s+(struct|interface|\[\]|\*)/.test(firstLine)
  ) return "go";
  if (
    /^def\s+/.test(firstLine) ||
    /^class\s+\w+/.test(firstLine) ||
    /^from\s+[\w.]+\s+import/.test(firstLine)
  ) return "python";
  if (
    /^function\s+/.test(firstLine) ||
    /^(const|let|var)\s+\w/.test(firstLine) ||
    /^export\s+(default\s+)?/.test(firstLine) ||
    /^import\s+\{/.test(firstLine)
  ) return "js/ts";
  if (
    /^fn\s+/.test(firstLine) ||
    /^pub\s+fn\s+/.test(firstLine) ||
    /^impl\s+/.test(firstLine)
  ) return "rust";
  return "unknown";
}

function buildPromptClusters(prompts: PromptEntry[]) {
  const nonSlash = prompts.filter((p) => !p.is_slash);
  type Key = string;
  const perCwd = new Map<Key, { cwd: string; first_words: string; samples: string[]; count: number }>();
  const overall = new Map<Key, { first_words: string; cwds: Set<string>; samples: string[]; count: number }>();

  for (const p of nonSlash) {
    const fw = normalizeFirstWords(p.text);
    if (!fw || fw.split(/\s+/).filter(Boolean).length < 3) continue;
    if (!p.cwd) continue;

    const cwdKey = `${p.cwd}\x00${fw}`;
    const cwdAgg = perCwd.get(cwdKey) ?? { cwd: p.cwd, first_words: fw, samples: [], count: 0 };
    cwdAgg.count++;
    if (cwdAgg.samples.length < 3) cwdAgg.samples.push(p.text.slice(0, 100));
    perCwd.set(cwdKey, cwdAgg);

    const overallAgg = overall.get(fw) ?? { first_words: fw, cwds: new Set<string>(), samples: [], count: 0 };
    overallAgg.count++;
    overallAgg.cwds.add(p.cwd);
    if (overallAgg.samples.length < 3) overallAgg.samples.push(p.text.slice(0, 100));
    overall.set(fw, overallAgg);
  }

  const clusters: any[] = [];
  const projectFwSeen = new Set<string>();
  for (const v of perCwd.values()) {
    if (v.count < PROMPT_CLUSTER_MIN) continue;
    const skills = getSkillsForCwd(v.cwd);
    const overlap_hints = computeOverlapHints(v.samples, skills);
    const language = detectLanguage(v.samples[0] ?? "");
    clusters.push({
      first_words: v.first_words,
      count: v.count,
      cwds: [v.cwd],
      scope: "project",
      scope_target: join(v.cwd, ".claude", "skills"),
      samples: v.samples,
      language,
      overlap_hints,
      in_meta_cluster: false,
    });
    projectFwSeen.add(v.first_words);
  }
  for (const v of overall.values()) {
    if (v.count < PROMPT_CLUSTER_MIN) continue;
    if (v.cwds.size < 2) continue;
    if (projectFwSeen.has(v.first_words)) continue;
    const firstCwd = [...v.cwds][0];
    const skills = getSkillsForCwd(firstCwd);
    const overlap_hints = computeOverlapHints(v.samples, skills);
    const language = detectLanguage(v.samples[0] ?? "");
    clusters.push({
      first_words: v.first_words,
      count: v.count,
      cwds: [...v.cwds],
      scope: "user",
      scope_target: join(HOME, ".claude", "skills"),
      samples: v.samples,
      language,
      overlap_hints,
      in_meta_cluster: false,
    });
  }
  clusters.sort((a, b) => b.count - a.count);
  return clusters;
}

function buildMetaClusters(clusters: any[]) {
  const groups = new Map<string, { scope_target: string; language: string; scope: string; member_indices: number[]; cwds: Set<string>; total_count: number; sample_first_words: string[]; sample_codes: string[] }>();
  clusters.forEach((c, idx) => {
    if (!c.language || c.language === "unknown") return;
    const key = `${c.scope_target}\x00${c.language}`;
    const g = groups.get(key) ?? {
      scope_target: c.scope_target,
      language: c.language,
      scope: c.scope,
      member_indices: [],
      cwds: new Set<string>(),
      total_count: 0,
      sample_first_words: [],
      sample_codes: [],
    };
    g.member_indices.push(idx);
    for (const cw of c.cwds) g.cwds.add(cw);
    g.total_count += c.count;
    if (g.sample_first_words.length < 5) g.sample_first_words.push(c.first_words);
    if (g.sample_codes.length < 3 && c.samples[0]) g.sample_codes.push(c.samples[0]);
    groups.set(key, g);
  });

  const metas: any[] = [];
  for (const g of groups.values()) {
    if (g.member_indices.length < META_CLUSTER_MIN_MEMBERS) continue;
    for (const idx of g.member_indices) clusters[idx].in_meta_cluster = true;
    const firstCwd = [...g.cwds][0];
    const skillsForMeta = firstCwd ? getSkillsForCwd(firstCwd) : [];
    const code_overlap_hints = computeCodeReviewOverlap(skillsForMeta);
    metas.push({
      meta_kind: "code_paste",
      language: g.language,
      scope: g.scope,
      scope_target: g.scope_target,
      cwds: [...g.cwds],
      total_count: g.total_count,
      cluster_count: g.member_indices.length,
      sample_first_words: g.sample_first_words,
      sample_codes: g.sample_codes,
      member_indices: g.member_indices,
      code_overlap_hints,
    });
  }
  metas.sort((a, b) => b.total_count - a.total_count);
  return metas;
}

function buildSlashFrequency(prompts: PromptEntry[]) {
  const counts = new Map<string, number>();
  for (const p of prompts) {
    if (!p.is_slash) continue;
    const m = p.text.match(/^\/([a-z][a-z0-9_-]*)/i);
    if (!m) continue;
    const cmd = "/" + m[1].toLowerCase();
    counts.set(cmd, (counts.get(cmd) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([command, count]) => ({ command, count }));
}

function buildSkillReviewHints(skills: SkillRecord[], availableAgentNames: Set<string>) {
  const hints: any[] = [];
  for (const s of skills) {
    const issues: string[] = [];
    const agentRefs = [...s.raw_body.matchAll(/~\/?\.claude\/agents\/([a-z0-9_-]+)/gi)];
    for (const m of agentRefs) {
      const ref = m[1];
      if (!availableAgentNames.has(ref)) issues.push(`missing agent reference: ${ref}`);
    }
    const scriptRefs = [...s.raw_body.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/([a-zA-Z0-9_./-]+)/g)];
    const skillDir = s.path.replace(/\/SKILL\.md$/, "");
    for (const m of scriptRefs) {
      const rel = m[1];
      const target = join(skillDir, rel);
      if (!existsSync(target)) issues.push(`missing referenced file: ${rel}`);
    }
    if (issues.length === 0) continue;
    hints.push({
      path: s.path,
      mtime: s.mtime,
      frontmatter: s.frontmatter,
      body_first_300_chars: s.body_first_300_chars,
      issues,
    });
  }
  return hints;
}

function listAvailableAgents(): Set<string> {
  const out = new Set<string>();
  const agentsDir = join(HOME, ".claude", "agents");
  if (!existsSync(agentsDir)) return out;
  for (const e of readdirSync(agentsDir, { withFileTypes: true })) {
    if (!e.isFile()) continue;
    out.add(e.name.replace(/\.md$/, ""));
  }
  return out;
}

const skills = getSkillsForCwd(process.cwd());
const scanResult = scan();
const oldestIso = scanResult.oldest_session_ms ? new Date(scanResult.oldest_session_ms).toISOString() : null;
const dataSufficient =
  scanResult.oldest_session_ms !== null &&
  NOW - scanResult.oldest_session_ms >= DEAD_SKILL_DAYS * 24 * 3600 * 1000;

const promptClusters = buildPromptClusters(scanResult.prompts);
const metaClusters = buildMetaClusters(promptClusters);

const out = {
  generated_at: new Date(NOW).toISOString(),
  meta: {
    data_window_days: WINDOW_DAYS,
    sessions_scanned: scanResult.sessions_scanned,
    oldest_session: oldestIso,
    data_sufficient: dataSufficient,
    skills_found: skills.length,
    total_skill_invocations_in_window: scanResult.invocations.length,
  },
  available_skills: skills.map((s) => ({
    name: s.frontmatter.name ?? s.name,
    path: s.path,
    scope: s.scope,
    description: s.frontmatter.description ?? "",
    body_first_500_chars: s.body_first_500_chars,
  })),
  dead_skills: buildDeadSkills(skills, scanResult, dataSufficient),
  meta_clusters: metaClusters,
  prompt_clusters: promptClusters,
  slash_command_frequency: buildSlashFrequency(scanResult.prompts),
  skill_review_hints: buildSkillReviewHints(skills, listAvailableAgents()),
};

console.log(JSON.stringify(out, null, 2));
