#!/usr/bin/env bun
import { main, type MainOptions } from "../diagram-explain/render.ts";

export const CATEGORIES = [
  "input-validation",
  "auth",
  "secrets",
  "process-exec",
  "guard-sandbox",
  "crypto",
  "destructive",
] as const;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

// Runs on the raw object and must tolerate a malformed one: main() calls it even when
// the generic validation already failed.
export function validatePlan(raw: unknown, errors: string[]): void {
  if (!isObj(raw)) return;
  if (raw.mode !== "plan") errors.push('plan: mode must be "plan"');

  if (Array.isArray(raw.nodes)) {
    raw.nodes.forEach((n, i) => {
      if (!isObj(n)) return;
      const where = `nodes[${i}]`;
      if ((n.kind === undefined || n.kind === "existing") && n.ref === undefined) {
        errors.push(`${where}: plan mode requires a ref on an existing node`);
      }
      if (isObj(n.deepDive) && !CATEGORIES.includes(n.deepDive.category as never)) {
        errors.push(`${where}: deepDive category must be one of ${CATEGORIES.join(", ")}`);
      }
    });
  }

  if (!Array.isArray(raw.steps) || raw.steps.length < 1) errors.push("steps: at least 1 step required");
}

export function planOptions(): MainOptions {
  return {
    extraValidate: validatePlan,
    defaultMode: "plan",
    outDirName: "explain-plan",
  };
}

if (import.meta.main) process.exit(main(process.argv.slice(2), console.log, console.error, planOptions()));
