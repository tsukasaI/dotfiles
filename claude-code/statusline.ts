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

const input = await Bun.stdin.json();
const row1: [number, number, string][] = [];
const row2: [number, number, string][] = [];

// 1. Git branch
const dir = input.workspace?.current_dir;
if (dir) {
  process.chdir(dir);
  const proc = Bun.spawnSync(["git", "branch", "--show-current"]);
  const branch = proc.stdout.toString().trim();
  if (branch) {
    const isWorktree = existsSync(".git") && statSync(".git").isFile();
    row1.push([189, 60, `⎇ ${branch}${isWorktree ? " [wt]" : ""}`]);
  }
}

// 2. Directory (home-relative)
if (dir) {
  const home = Bun.env.HOME ?? "";
  const display = dir.startsWith(home) ? `~${dir.slice(home.length)}` : dir;
  row1.push([153, 24, `» ${display}`]);
}

// 3. Model (short name)
const modelName = input.model?.display_name ?? input.model?.id;
if (modelName) {
  const short = modelName.replace(/^Claude /, "");
  row1.push([159, 30, `◇ ${short}`]);
}

// 4. Context usage % (context-aware)
const ctx = input.context_window?.used_percentage;
if (ctx != null) {
  const bgCode = ctx >= 90 ? 52 : ctx >= 70 ? 58 : ctx >= 50 ? 94 : 22;
  const fgCode = ctx >= 90 ? 210 : ctx >= 70 ? 228 : ctx >= 50 ? 223 : 157;
  row2.push([fgCode, bgCode, `◔ ${ctx.toFixed(1)}%`]);
}

// 5. Token counts (used / limit)
const inTok = input.context_window?.total_input_tokens ?? 0;
const outTok = input.context_window?.total_output_tokens ?? 0;
const limit = input.context_window?.context_window_size;
if (limit != null) {
  const fmt = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
  const used = inTok + outTok;
  row2.push([250, 239, `≡ ${fmt(used)}/${fmt(limit)}`]);
}

// 6. Lines changed
const added = input.cost?.total_lines_added ?? 0;
const removed = input.cost?.total_lines_removed ?? 0;
if (added > 0 || removed > 0) {
  row2.push([157, 22, `+${added}`]);
  row2.push([210, 52, `-${removed}`]);
}

// 8. Vim mode (context-aware)
const vimMode = input.vim?.mode;
if (vimMode) {
  const isNormal = vimMode === "NORMAL";
  row2.push([isNormal ? 157 : 228, isNormal ? 22 : 58, `◆ ${vimMode}`]);
}

if (row1.length > 0) console.log(powerline(row1));
if (row2.length > 0) console.log(powerline(row2));
