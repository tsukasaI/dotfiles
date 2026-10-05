#!/usr/bin/env bun
// PreToolUse(Edit|Write) hook: mechanically detects AI-slop artifacts.
// stdin -> JSON: {"hook_event_name":"PreToolUse","tool_name":"Edit"|"Write","tool_input":{...}}
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

import { existsSync, readFileSync } from "fs";
import { extname } from "path";

const PROSE_EXTENSIONS = new Set([".md", ".mdx", ".txt"]);
const EM_DASH = "—";

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

async function main(): Promise<void> {
  if (process.env.SLOP_GUARD_DISABLE === "1") return;

  const input = await Bun.stdin.json();

  if (input?.hook_event_name === "PreToolUse") {
    handlePreToolUse(input);
  }
}

main()
  .catch(() => {
    // Fail open: any unexpected error must never block an edit.
  })
  .finally(() => {
    process.exit(0);
  });
