#!/usr/bin/env bun

import { statSync, readFileSync } from "fs";
import { dirname } from "path";
import { abbreviateHome } from "./lib/home-path";

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
      out += `${RST}${fgc(bgCode)}${ARROW}${RST}`;
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

// A finite number, or null for anything else (missing, NaN, wrong type) so
// callers can skip just that segment instead of throwing mid-render.
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

// Runs one row's construction in isolation: a fault building row N (bad
// field type, out-of-range value) must not discard rows that don't depend
// on it. Returns [] on failure so the caller's `.length > 0` check still
// works — fail silent per-row (no statusline row for that one) is the safe
// default for a purely cosmetic tool.
function safeRow(build: () => [number, number, string][]): [number, number, string][] {
  try {
    return build();
  } catch (err) {
    console.error(`[statusline] row failed: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

// Everything below reads/derives from stdin JSON whose shape is not under our
// control (the harness's own schema evolves). This outer catch only guards
// the stdin read/parse itself; per-row faults are handled by safeRow above.
try {
  const input = await Bun.stdin.json();

  // --- Row 1: dir | git | model ---

  const row1 = safeRow(() => {
    const segs: [number, number, string][] = [];
    const dir = input.workspace?.current_dir;
    if (typeof dir === "string" && dir) {
      const display = abbreviateHome(dir, Bun.env.HOME ?? "");
      segs.push([153, 24, `» ${display}`]);

      const git = readGitBranch(dir);
      if (git) {
        segs.push([189, 60, `⎇ ${git.branch}${git.isWorktree ? " [wt]" : ""}`]);
      }
    }

    const modelName = input.model?.display_name ?? input.model?.id;
    if (typeof modelName === "string" && modelName) {
      const short = modelName.replace(/^Claude /, "");
      segs.push([159, 30, `◇ ${short}`]);
    }

    // model-mode badges: reasoning effort, extended thinking, output style.
    // Each field is only present when the corresponding mode is active, so a
    // missing field simply omits its badge.
    const effort = input.effort?.level;
    if (effort) {
      segs.push([223, 94, `↯ ${effort}`]);
    }
    if (input.thinking?.enabled) {
      segs.push([189, 55, "✻ think"]);
    }
    const style = input.output_style?.name;
    if (style && style !== "default") {
      segs.push([159, 22, `✎ ${style}`]);
    }
    return segs;
  });

  // --- Row 2: context bar | rate limits ---

  // resets_at is Unix epoch seconds. 5H resets within the day (HH:mm); 7D spans
  // days, so prefix a weekday.
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function resetLabel(epochSec: number, withWeekday: boolean): string {
    const d = new Date(epochSec * 1000);
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return `↻ ${withWeekday ? `${WEEKDAYS[d.getDay()]} ` : ""}${hm}`;
  }

  const row2 = safeRow(() => {
    const segs: [number, number, string][] = [];
    const ctx = num(input.context_window?.used_percentage);
    if (ctx != null) {
      const [fg, bg] = rlColor(ctx);
      // used_percentage can exceed 100 in the harness's own schema; clamp so
      // repeat() below never gets a negative or absurdly large count.
      const filled = Math.max(0, Math.min(10, Math.round(ctx / 10)));
      const bar = "█".repeat(filled) + "░".repeat(10 - filled);
      const size = num(input.context_window?.context_window_size);
      const sizeLabel = size ? ` /${size >= 1_000_000 ? `${size / 1_000_000}M` : `${size / 1000}k`}` : "";
      segs.push([fg, bg, `${bar} ${ctx.toFixed(1)}%${sizeLabel}`]);
    }

    const rl = input.rate_limits;
    for (const [key, label] of [["five_hour", "5H"], ["seven_day", "7D"]] as const) {
      const p = num(rl?.[key]?.used_percentage);
      if (p == null) continue;
      const [fg, bg] = rlColor(p);
      const resetsAt = num(rl?.[key]?.resets_at);
      const reset = resetsAt ? ` ${resetLabel(resetsAt, key === "seven_day")}` : "";
      segs.push([fg, bg, `${label} ${p.toFixed(0)}%${reset}`]);
    }
    return segs;
  });

  // --- Row 3: tokens | lines changed ---

  const row3 = safeRow(() => {
    const segs: [number, number, string][] = [];
    const inTok = num(input.context_window?.total_input_tokens) ?? 0;
    const outTok = num(input.context_window?.total_output_tokens) ?? 0;
    if (inTok > 0 || outTok > 0) {
      segs.push([250, 239, `≡ ${fmt(inTok)}↓ ${fmt(outTok)}↑`]);
    }

    const costUsd = num(input.cost?.total_cost_usd);
    if (costUsd != null && costUsd > 0) {
      segs.push([250, 238, `$${costUsd.toFixed(2)}`]);
    }

    const added = num(input.cost?.total_lines_added) ?? 0;
    const removed = num(input.cost?.total_lines_removed) ?? 0;
    if (added > 0 || removed > 0) {
      segs.push([116, 23, `+${added}`]);
      segs.push([175, 53, `-${removed}`]);
    }
    return segs;
  });

  // --- Output ---

  if (row1.length > 0) console.log(powerline(row1));
  if (row2.length > 0) console.log(powerline(row2));
  if (row3.length > 0) console.log(powerline(row3));
} catch (err) {
  console.error(`[statusline] failed: ${err instanceof Error ? err.message : err}`);
}
