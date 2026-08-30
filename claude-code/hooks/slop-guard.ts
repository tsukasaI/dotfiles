#!/usr/bin/env bun
// PreToolUse(Edit|Write) + Stop hook: mechanically detects AI-slop artifacts.
// stdin -> JSON (shape depends on hook_event_name):
//   PreToolUse: {"hook_event_name":"PreToolUse","tool_name":"Edit"|"Write","tool_input":{...}}
//   Stop:       {"hook_event_name":"Stop","stop_hook_active":bool,"transcript_path":str}
// Always exits 0 — this is a style guard, not a security guardrail, so every
// failure mode (bad JSON, missing fields, unreadable files) fails OPEN.
// Kill switch: SLOP_GUARD_DISABLE=1 skips all checks unconditionally.
//
// PreToolUse: counts em-dash / cliché-phrase occurrences in old vs. new text
// and only flags a NET INCREASE — old_string/on-disk content is the baseline,
// so pre-existing text (e.g. context lines Edit copies into new_string for
// uniqueness) is never flagged, only what this specific call newly writes.
// Violations are reported via permissionDecision:"deny" (no updatedInput —
// there's no single correct mechanical replacement for a banned phrase, and
// updatedInput is known to be ignored when multiple PreToolUse hooks share a
// matcher: https://github.com/anthropics/claude-code/issues/15897).
//
// Stop: flags script-mixing only (unexpected Hangul/Cyrillic runs inside an
// otherwise Japanese-context reply) — a post-hoc "please rewrite" nudge is
// the only lever available since no hook can intercept chat text pre-display.

import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from "fs";
import { extname } from "path";

const PROSE_EXTENSIONS = new Set([".md", ".mdx", ".txt"]);
const EM_DASH = "—";
const JAPANESE_KANA_RE = /[぀-ゟ゠-ヿ]/g;
const FOREIGN_SCRIPT_RUN_RE = /[\p{Script=Hangul}\p{Script=Cyrillic}]{2,}/gu;
const JAPANESE_KANA_THRESHOLD = 10;
const TRANSCRIPT_TAIL_BYTES = 64 * 1024;

interface PhraseRule {
  category: string;
  phrase: string;
  reason: string;
  alt: string;
}

function loadPhraseRules(): PhraseRule[] {
  const confPath = new URL("slop-phrases.conf", import.meta.url).pathname;
  const text = readFileSync(confPath, "utf-8");
  const rules: PhraseRule[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 3 || parts[1] === "") continue;
    rules.push({ category: parts[0], phrase: parts[1], reason: parts[2], alt: parts[3] ?? "" });
  }
  return rules;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

function countPhrase(text: string, phrase: string): number {
  const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`, "gi");
  return countMatches(text, re);
}

function countEmDash(text: string): number {
  return countMatches(text, new RegExp(EM_DASH, "g"));
}

function denyIfViolations(oldText: string, newText: string): string[] {
  const violations: string[] = [];

  if (countEmDash(newText) > countEmDash(oldText)) {
    violations.push("em dash (—) newly introduced — this repo bans em dashes in prose; rewrite the sentence without one");
  }

  for (const rule of loadPhraseRules()) {
    if (countPhrase(newText, rule.phrase) > countPhrase(oldText, rule.phrase)) {
      const altSuffix = rule.alt ? ` (try: ${rule.alt})` : "";
      violations.push(`AI-cliché phrase "${rule.phrase}" [${rule.category}]: ${rule.reason}${altSuffix}`);
    }
  }

  return violations;
}

function handlePreToolUse(input: any): void {
  const filePath: unknown = input?.tool_input?.file_path;
  if (typeof filePath !== "string" || filePath === "") return;
  if (filePath.includes("/claude-code/hooks/")) return; // avoid self-reference false positives
  if (!PROSE_EXTENSIONS.has(extname(filePath).toLowerCase())) return;

  let oldText = "";
  let newText = "";

  if (input.tool_name === "Edit") {
    if (typeof input.tool_input?.old_string !== "string") return;
    if (typeof input.tool_input?.new_string !== "string") return;
    oldText = input.tool_input.old_string;
    newText = input.tool_input.new_string;
  } else if (input.tool_name === "Write") {
    if (typeof input.tool_input?.content !== "string") return;
    newText = input.tool_input.content;
    if (existsSync(filePath)) {
      oldText = readFileSync(filePath, "utf-8");
    }
  } else {
    return;
  }

  const violations = denyIfViolations(oldText, newText);
  if (violations.length === 0) return;

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: violations.join("; "),
      },
    }),
  );
}

function readTranscriptTail(transcriptPath: string): string {
  const size = statSync(transcriptPath).size;
  const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES);
  const length = size - start;
  const buffer = Buffer.alloc(length);
  const fd = openSync(transcriptPath, "r");
  try {
    readSync(fd, buffer, 0, length, start);
  } finally {
    closeSync(fd);
  }
  const text = buffer.toString("utf-8");
  const lines = text.split("\n");
  if (start > 0) lines.shift(); // first line may be truncated mid-record
  return lines.join("\n");
}

function extractLastAssistantText(transcriptTail: string): string {
  let lastText = "";
  for (const line of transcriptTail.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (obj?.type !== "assistant") continue;
    const content = obj?.message?.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((block: any) => block?.type === "text" && typeof block.text === "string")
      .map((block: any) => block.text)
      .join("\n");
    if (text !== "") lastText = text;
  }
  return lastText;
}

function handleStop(input: any): void {
  if (input?.stop_hook_active === true) return;

  const transcriptPath: unknown = input?.transcript_path;
  if (typeof transcriptPath !== "string" || transcriptPath === "") return;
  if (!existsSync(transcriptPath)) return;

  const tail = readTranscriptTail(transcriptPath);
  const lastText = extractLastAssistantText(tail);
  if (lastText === "") return;

  const kanaCount = countMatches(lastText, JAPANESE_KANA_RE);
  if (kanaCount < JAPANESE_KANA_THRESHOLD) return;

  const foreignRuns = lastText.match(FOREIGN_SCRIPT_RUN_RE);
  if (!foreignRuns || foreignRuns.length === 0) return;

  const sample = [...new Set(foreignRuns)].slice(0, 5).join(", ");
  console.log(
    JSON.stringify({
      decision: "block",
      reason: `Script-mixing detected in your last reply: unexpected non-Japanese script run(s) [${sample}] appeared inside otherwise Japanese text. Rewrite the affected span in Japanese (or the intended script).`,
    }),
  );
}

async function main(): Promise<void> {
  if (process.env.SLOP_GUARD_DISABLE === "1") return;

  const input = await Bun.stdin.json();

  if (input?.hook_event_name === "PreToolUse") {
    handlePreToolUse(input);
  } else if (input?.hook_event_name === "Stop") {
    handleStop(input);
  }
}

main()
  .catch(() => {
    // Fail open: any unexpected error must never block an edit or a stop.
  })
  .finally(() => {
    process.exit(0);
  });
