#!/usr/bin/env bun

import { statSync, readFileSync } from "fs";
import { dirname } from "path";

// ANSI helpers
const RST = "\x1b[0m";
const fgc = (code: number) => `\x1b[38;5;${code}m`;
const bgc = (code: number) => `\x1b[48;5;${code}m`;

// Powerline triangle separator (U+E0B0)
const ARROW = "\uE0B0";

// Build a powerline row from segments: [fgColor, bgColor, text][]
function powerline(segments: [number, number, string][]): string {
  let out = "";
  for (let i = 0; i < segments.length; i++) {
    const [fgCode, bgCode, text] = segments[i];
    // Segment body
    out += `${fgc(fgCode)}${bgc(bgCode)} ${text} `;
    // Triangle: fg = current bg, bg = next bg (or reset)
    if (i < segments.length - 1) {
      out += `${fgc(bgCode)}${bgc(segments[i + 1][1])}${ARROW}`;
    } else {
      out += `${fgc(bgCode)}${RST}${ARROW}${RST}`;
    }
  }
  return out;
}

const fmt = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;

const rlColor = (pct: number): [number, number] =>
  pct >= 90 ? [168, 53] : pct >= 70 ? [176, 54] : pct >= 50 ? [153, 61] : [117, 24];

// Read git HEAD without forking. Walks up from `start` to find `.git`
// (directory or worktree file), then parses HEAD. Returns null if not in a repo
// or HEAD points to a detached commit.
function readGitBranch(start: string): { branch: string; isWorktree: boolean } | null {
  let dir = start;
  while (true) {
    const gitPath = `${dir}/.git`;
    let st;
    try { st = statSync(gitPath); } catch {}
    if (st) {
      let gitDir = gitPath;
      const isWorktree = st.isFile();
      if (isWorktree) {
        const m = readFileSync(gitPath, "utf-8").trim().match(/^gitdir:\s*(.+)$/);
        if (!m) return null;
        gitDir = m[1];
      }
      let head: string;
      try { head = readFileSync(`${gitDir}/HEAD`, "utf-8").trim(); } catch { return null; }
      const m = head.match(/^ref:\s*refs\/heads\/(.+)$/);
      return m ? { branch: m[1], isWorktree } : null;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const input = await Bun.stdin.json();
const row1: [number, number, string][] = [];
const row2: [number, number, string][] = [];
const row3: [number, number, string][] = [];

// --- Row 1: dir | git | model ---

const dir = input.workspace?.current_dir;
if (dir) {
  const home = Bun.env.HOME ?? "";
  const display = dir.startsWith(home) ? `~${dir.slice(home.length)}` : dir;
  row1.push([153, 24, `» ${display}`]);

  const git = readGitBranch(dir);
  if (git) {
    row1.push([189, 60, `⎇ ${git.branch}${git.isWorktree ? " [wt]" : ""}`]);
  }
}

const modelName = input.model?.display_name ?? input.model?.id;
if (modelName) {
  const short = modelName.replace(/^Claude /, "");
  row1.push([159, 30, `◇ ${short}`]);
}

// model-mode badges: reasoning effort, extended thinking, output style.
// Each field is only present when the corresponding mode is active, so a
// missing field simply omits its badge.
const effort = input.effort?.level;
if (effort) {
  row1.push([223, 94, `↯ ${effort}`]);
}
if (input.thinking?.enabled) {
  row1.push([189, 55, "✻ think"]);
}
const style = input.output_style?.name;
if (style && style !== "default") {
  row1.push([159, 22, `✎ ${style}`]);
}

// --- Row 2: context bar | rate limits ---

const ctx = input.context_window?.used_percentage;
if (ctx != null) {
  const [fg, bg] = rlColor(ctx);
  const filled = Math.round(ctx / 10);
  const bar = "█".repeat(filled) + "░".repeat(10 - filled);
  const size = input.context_window?.context_window_size;
  const sizeLabel = size ? ` /${size >= 1_000_000 ? `${size / 1_000_000}M` : `${size / 1000}k`}` : "";
  row2.push([fg, bg, `${bar} ${ctx.toFixed(1)}%${sizeLabel}`]);
}

// resets_at is Unix epoch seconds. 5H resets within the day (HH:mm); 7D spans
// days, so prefix a weekday.
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function resetLabel(epochSec: number, withWeekday: boolean): string {
  const d = new Date(epochSec * 1000);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `↻ ${withWeekday ? `${WEEKDAYS[d.getDay()]} ` : ""}${hm}`;
}

const rl = input.rate_limits;
for (const [key, label] of [["five_hour", "5H"], ["seven_day", "7D"]] as const) {
  const p = rl?.[key]?.used_percentage;
  if (p == null) continue;
  const [fg, bg] = rlColor(p);
  const resetsAt = rl?.[key]?.resets_at;
  const reset = resetsAt ? ` ${resetLabel(resetsAt, key === "seven_day")}` : "";
  row2.push([fg, bg, `${label} ${p.toFixed(0)}%${reset}`]);
}

// --- Row 3: tokens | lines changed ---

const inTok = input.context_window?.total_input_tokens ?? 0;
const outTok = input.context_window?.total_output_tokens ?? 0;
if (inTok > 0 || outTok > 0) {
  row3.push([250, 239, `≡ ${fmt(inTok)}↓ ${fmt(outTok)}↑`]);
}

const costUsd = input.cost?.total_cost_usd;
if (costUsd > 0) {
  row3.push([250, 238, `$${costUsd.toFixed(2)}`]);
}

const added = input.cost?.total_lines_added ?? 0;
const removed = input.cost?.total_lines_removed ?? 0;
if (added > 0 || removed > 0) {
  row3.push([116, 23, `+${added}`]);
  row3.push([175, 53, `-${removed}`]);
}

// --- Output ---

if (row1.length > 0) console.log(powerline(row1));
if (row2.length > 0) console.log(powerline(row2));
if (row3.length > 0) console.log(powerline(row3));
