import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { main, validate } from "../diagram-explain/render.ts";
import { planOptions, validatePlan } from "./plan.ts";

const HERE = import.meta.dir;

let tmp: string;
let repo: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "explain-plan-test-"));
  repo = join(tmp, "repo");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "a.ts"), "line one\nfunction f() {\n  return 1\n}\n");
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const card = { role: "r", actor: "who", trigger: "when", failure: "fails" };

function base(): Record<string, any> {
  return {
    version: 2,
    mode: "plan",
    slug: "test-plan",
    title: "t",
    lanes: [{ id: "l", label: "L" }],
    views: [
      { id: "v1", type: "structure" },
      { id: "v2", type: "sequence", participants: ["a", "b"], messages: ["ab"] },
    ],
    nodes: [
      { id: "a", lane: "l", order: 0, kind: "existing", label: "A", card, ref: { file: "src/a.ts", line: 2, excerpt: "function f() {" } },
      { id: "b", lane: "l", order: 1, kind: "proposed", label: "B", card },
    ],
    edges: [{ id: "ab", from: "a", to: "b", data: "x", kind: "proposed" }],
    steps: [{ title: "s", description: "d", changes: { b: "added", ab: "added" } }],
  };
}
const errorsOf = (raw: unknown) => {
  const r = validate(raw);
  const errors = "errors" in r ? [...r.errors] : [];
  validatePlan(raw, errors);
  return errors;
};

describe("validatePlan", () => {
  test("accepts a minimal plan", () => {
    expect(errorsOf(base())).toEqual([]);
  });

  test("accepts the bundled example", () => {
    expect(errorsOf(JSON.parse(readFileSync(join(HERE, "example.json"), "utf8")))).toEqual([]);
  });

  test("tolerates a malformed document", () => {
    for (const raw of [null, {}, { nodes: [null, 1], steps: "x" }]) {
      expect(() => validatePlan(raw, [])).not.toThrow();
    }
  });

  test("mode must be plan", () => {
    const d = base();
    delete d.mode;
    expect(errorsOf(d)).toContain('plan: mode must be "plan"');
    d.mode = "explain";
    expect(errorsOf(d)).toContain('plan: mode must be "plan"');
  });

  test("an existing node needs a ref, including one with kind omitted", () => {
    const d = base();
    delete d.nodes[0].ref;
    expect(errorsOf(d)).toContain("nodes[0]: plan mode requires a ref on an existing node");
    delete d.nodes[0].kind;
    expect(errorsOf(d)).toContain("nodes[0]: plan mode requires a ref on an existing node");
  });

  test("a deepDive category outside the fixed list is rejected", () => {
    const d = base();
    d.nodes[0].deepDive = { category: "performance", why: "w" };
    expect(errorsOf(d).some(e => e.startsWith("nodes[0]: deepDive category must be one of"))).toBe(true);
  });

  test("needs at least one step", () => {
    const d = base();
    d.steps = [];
    expect(errorsOf(d)).toContain("steps: at least 1 step required");
    delete d.steps;
    expect(errorsOf(d)).toContain("steps: at least 1 step required");
  });
});

describe("main with the plan options", () => {
  test("renders a plan, defaulting the mode to plan", () => {
    const d = base();
    delete d.mode;
    const json = join(tmp, "plan.json");
    writeFileSync(json, JSON.stringify(d));
    const target = join(tmp, "plan.html");
    expect(main([json, "--root", repo, "--out", target], () => {}, () => {}, planOptions())).toBe(0);
    const html = readFileSync(target, "utf8");
    expect(html).toContain('"mode":"plan"');
  });

  test("a plan without a ref on an existing node writes nothing", () => {
    const d = base();
    delete d.nodes[0].ref;
    const json = join(tmp, "noref.json");
    writeFileSync(json, JSON.stringify(d));
    const target = join(tmp, "noref.html");
    const failures: string[] = [];
    expect(main([json, "--root", repo, "--out", target], () => {}, m => failures.push(m), planOptions())).toBe(1);
    expect(failures[0]).toContain("plan mode requires a ref");
    expect(existsSync(target)).toBe(false);
  });
});
