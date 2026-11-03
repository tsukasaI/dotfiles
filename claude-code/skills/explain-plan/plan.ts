#!/usr/bin/env bun
import { main, type MainOptions } from "../diagram-explain/render.ts";
// Imported, not read next to import.meta.url: see render.ts.
import planCore from "./plan-core.js" with { type: "text" };

export const CATEGORIES = [
  "input-validation",
  "auth",
  "secrets",
  "process-exec",
  "guard-sandbox",
  "crypto",
  "destructive",
] as const;
const PERSPECTIVES = ["flow", "deepDive", "rejected", "evidence"] as const;
const REQUIRED_PERSPECTIVES = ["flow", "rejected", "evidence"] as const;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

// Runs on the raw object and must tolerate a malformed one: main() calls it even when
// the generic validation already failed.
export function validatePlan(raw: unknown, errors: string[]): void {
  if (!isObj(raw)) return;
  if (raw.mode !== "plan") errors.push('plan: mode must be "plan"');

  const deepIds: string[] = [];
  if (Array.isArray(raw.nodes)) {
    raw.nodes.forEach((n, i) => {
      if (!isObj(n)) return;
      const where = `nodes[${i}]`;
      if ((n.kind === undefined || n.kind === "existing") && n.ref === undefined) {
        errors.push(`${where}: plan mode requires a ref on an existing node`);
      }
      if (isObj(n.deepDive)) {
        if (!CATEGORIES.includes(n.deepDive.category as never)) {
          errors.push(`${where}: deepDive category must be one of ${CATEGORIES.join(", ")}`);
        } else if (typeof n.id === "string") deepIds.push(n.id);
      }
    });
  }

  if (!Array.isArray(raw.steps) || raw.steps.length < 1) errors.push("steps: at least 1 step required");

  if (!Array.isArray(raw.quiz) || raw.quiz.length < 3 || raw.quiz.length > 15) {
    return void errors.push("quiz: 3-15 questions required");
  }
  const seen = new Set<string>();
  const deepCovered = new Set<string>();
  raw.quiz.forEach((q, i) => {
    if (!isObj(q)) return;
    if (q.perspective === undefined) errors.push(`quiz[${i}]: perspective required in plan mode`);
    else if (PERSPECTIVES.includes(q.perspective as never)) seen.add(q.perspective as string);
    if (q.perspective === "deepDive" && typeof q.about === "string") deepCovered.add(q.about);
  });
  for (const p of REQUIRED_PERSPECTIVES) if (!seen.has(p)) errors.push(`quiz: no ${p} question`);
  for (const id of deepIds) if (!deepCovered.has(id)) errors.push(`quiz: no deepDive question about ${id}`);
}

export function planOptions(): MainOptions {
  return {
    extraValidate: validatePlan,
    extraCores: [planCore],
    defaultMode: "plan",
    outDirName: "explain-plan",
  };
}

if (import.meta.main) process.exit(main(process.argv.slice(2), console.log, console.error, planOptions()));
