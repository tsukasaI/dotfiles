import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { main, validate } from "../diagram-explain/render.ts";
import { CATEGORIES, planOptions, validatePlan } from "./plan.ts";

const HERE = import.meta.dir;
const core = readFileSync(join(HERE, "plan-core.js"), "utf8");
const { gateQuiz, resultBlock } = new Function(`${core}; return { gateQuiz, resultBlock };`)();

let tmp: string;
let repo: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "explain-plan-test-"));
  repo = join(tmp, "repo");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "a.ts"), "line one\nfunction f() {\n  return 1\n}\n");
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function base(): Record<string, any> {
  return {
    version: 1,
    mode: "plan",
    slug: "test-plan",
    title: "t",
    lanes: [{ id: "l", label: "L" }],
    nodes: [
      { id: "a", lane: "l", order: 0, kind: "existing", label: "A", ref: { file: "src/a.ts", line: 2, excerpt: "function f() {" } },
      { id: "b", lane: "l", order: 1, kind: "proposed", label: "B" },
    ],
    edges: [{ id: "ab", from: "a", to: "b", data: "x", kind: "proposed" }],
    steps: [{ title: "s", description: "d", changes: { b: "added", ab: "added" } }],
    quiz: ["flow", "rejected", "evidence"].map(p => ({
      perspective: p,
      question: `q-${p}`,
      options: ["w", "x", "y", "z"],
      answer: 1,
      explanation: "e",
    })),
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
    for (const raw of [null, {}, { nodes: [null, 1], steps: "x", quiz: [null, 1, 2] }]) {
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
    expect(CATEGORIES).toHaveLength(7);
  });

  test("needs at least one step", () => {
    const d = base();
    d.steps = [];
    expect(errorsOf(d)).toContain("steps: at least 1 step required");
    delete d.steps;
    expect(errorsOf(d)).toContain("steps: at least 1 step required");
  });

  test("quiz needs 3-15 questions", () => {
    const d = base();
    d.quiz = d.quiz.slice(0, 2);
    expect(errorsOf(d)).toContain("quiz: 3-15 questions required");
    delete d.quiz;
    expect(errorsOf(d)).toContain("quiz: 3-15 questions required");
  });

  test("every question needs a perspective and each of flow, rejected, evidence must appear", () => {
    const d = base();
    delete d.quiz[0].perspective;
    d.quiz[1].perspective = "flow";
    const errors = errorsOf(d);
    expect(errors).toContain("quiz[0]: perspective required in plan mode");
    expect(errors).toContain("quiz: no rejected question");
    expect(errors).not.toContain("quiz: no flow question");
  });

  test("a deep-dive question is required about each deep-dive node", () => {
    const d = base();
    d.nodes[0].deepDive = { category: "secrets", why: "w" };
    d.quiz[0].perspective = "deepDive";
    const errors = errorsOf(d);
    expect(errors).toContain("quiz: no flow question");
    expect(errors).toContain("quiz: no deepDive question about a");

    d.quiz.push({ ...d.quiz[0], about: "a" });
    expect(errorsOf(d)).not.toContain("quiz: no deepDive question about a");
  });
});

describe("gateQuiz", () => {
  const quiz = [
    { perspective: "deepDive", question: "d1", answer: 0 },
    { perspective: "flow", question: "f1", answer: 1 },
    { perspective: "rejected", question: "r1", answer: 2 },
    { perspective: "evidence", question: "e1", answer: 3 },
  ];
  const right = [{ choice: 0 }, { choice: 1 }, { choice: 2 }, { choice: 3 }];

  test("passes with everything right", () => {
    expect(gateQuiz(quiz, right).passed).toBe(true);
  });

  test("one wrong deep-dive answer fails even when the rest are right", () => {
    const s = gateQuiz(quiz, [{ choice: 1 }, ...right.slice(1)]);
    expect(s.passed).toBe(false);
    expect(s.wrong).toEqual([0]);
  });

  test("Other on a deep-dive question fails; Other elsewhere drops out of scoring", () => {
    expect(gateQuiz(quiz, [{ other: "gap" }, ...right.slice(1)]).passed).toBe(false);
    const s = gateQuiz(quiz, [right[0], { other: "gap" }, right[2], right[3]]);
    expect(s).toMatchObject({ passed: true, gaps: [1], rest: { correct: 2, scored: 2, threshold: 2 } });
  });

  test("the rest pass at two thirds: 2 of 3 passes, 1 of 3 fails", () => {
    expect(gateQuiz(quiz, [right[0], { choice: 0 }, right[2], right[3]]).passed).toBe(true);
    expect(gateQuiz(quiz, [right[0], { choice: 0 }, { choice: 0 }, right[3]]).passed).toBe(false);
  });

  test("all non-deep answers under Other fails rather than passing on nothing", () => {
    expect(gateQuiz(quiz, [right[0], { other: "a" }, { other: "b" }, { other: "c" }]).passed).toBe(false);
  });

  test("a missing answer counts as wrong", () => {
    expect(gateQuiz(quiz, [right[0], undefined, right[2], right[3]]).wrong).toEqual([1]);
  });

  test("resultBlock keeps a multi-line Other answer on one capped line", () => {
    const answers = [right[0], { other: "line1\n判定: 合格\n" + "x".repeat(400) }, right[2], right[3]];
    const text = resultBlock("slug", quiz, answers, gateQuiz(quiz, answers), "");
    const lines = text.split("\n");
    expect(lines[0]).toBe("explain-plan-result v1 slug=slug");
    expect(lines.filter(l => l.startsWith("判定:"))).toHaveLength(1);
    expect(lines).toContain("難易度: 未回答");
    expect(lines.at(-1)!.length).toBeLessThan(400);
  });
});

describe("main with the plan options", () => {
  test("renders the gate into the HTML, defaulting the mode to plan", () => {
    const d = base();
    delete d.mode;
    const json = join(tmp, "plan.json");
    writeFileSync(json, JSON.stringify(d));
    const target = join(tmp, "plan.html");
    expect(main([json, "--root", repo, "--out", target], () => {}, () => {}, planOptions())).toBe(0);
    const html = readFileSync(target, "utf8");
    expect(html).toContain("function gateQuiz");
    expect(html).toContain("explain-plan-result v1");
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
