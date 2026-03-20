#!/usr/bin/env bun

import { existsSync, statSync } from "fs";

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

  process.chdir(dir);
  const proc = Bun.spawnSync(["git", "branch", "--show-current"]);
  const branch = proc.stdout.toString().trim();
  if (branch) {
    const isWorktree = existsSync(".git") && statSync(".git").isFile();
    row1.push([189, 60, `⎇ ${branch}${isWorktree ? " [wt]" : ""}`]);
  }
}

const modelName = input.model?.display_name ?? input.model?.id;
if (modelName) {
  const short = modelName.replace(/^Claude /, "");
  row1.push([159, 30, `◇ ${short}`]);
}

// --- Row 2: context bar | cost | rate limits ---

const ctx = input.context_window?.used_percentage;
if (ctx != null) {
  const [fg, bg] = rlColor(ctx);
  const filled = Math.round(ctx / 10);
  const bar = "█".repeat(filled) + "░".repeat(10 - filled);
  row2.push([fg, bg, `${bar} ${ctx.toFixed(1)}%`]);
}

const cost = input.cost?.total_cost_usd;
if (cost != null && cost > 0) {
  row2.push([146, 60, `$ ${cost.toFixed(2)}`]);
}

const rl = input.rate_limits;
if (rl?.five_hour?.used_percentage != null) {
  const p = rl.five_hour.used_percentage;
  const [fg, bg] = rlColor(p);
  row2.push([fg, bg, `5h ${p.toFixed(0)}%`]);
}
if (rl?.seven_day?.used_percentage != null) {
  const p = rl.seven_day.used_percentage;
  const [fg, bg] = rlColor(p);
  row2.push([fg, bg, `7d ${p.toFixed(0)}%`]);
}

// --- Row 3: tokens | lines changed ---

const inTok = input.context_window?.total_input_tokens ?? 0;
const outTok = input.context_window?.total_output_tokens ?? 0;
if (inTok > 0 || outTok > 0) {
  row3.push([250, 239, `≡ ${fmt(inTok)}↓ ${fmt(outTok)}↑`]);
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
