import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkRefs, embedJson, main, outputPath, renderHtml, validate, type Diagram } from "./render.ts";

const HERE = import.meta.dir;
const LINE_SEPARATORS = String.fromCharCode(0x2028, 0x2029);

let tmp: string;
let repo: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "diagram-explain-test-"));
  repo = join(tmp, "repo");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "a.ts"), "line one\nfunction f() {\n  return 1\n}\n");
  writeFileSync(join(tmp, "secret.txt"), "outside\n");
  symlinkSync(join(tmp, "secret.txt"), join(repo, "link.txt"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const card = () => ({ role: "r", actor: "who", trigger: "when", failure: "fails" });

function base(): Record<string, any> {
  return {
    version: 2,
    slug: "test-diagram",
    title: "t",
    lanes: [{ id: "l", label: "L" }],
    views: [{ id: "v", type: "structure" }],
    nodes: [
      { id: "a", lane: "l", order: 0, kind: "existing", label: "A", card: card(), ref: { file: "src/a.ts", line: 2, excerpt: "function f() {" } },
      { id: "b", lane: "l", order: 1, kind: "proposed", label: "B", card: card() },
    ],
    edges: [{ id: "ab", from: "a", to: "b", data: "x", kind: "proposed" }],
    steps: [{ title: "s", description: "d", changes: { b: "added", ab: "added" } }],
  };
}
const errorsOf = (raw: unknown) => {
  const r = validate(raw);
  return "errors" in r ? r.errors : [];
};
const diagramOf = (raw: unknown) => {
  const r = validate(raw);
  if ("errors" in r) throw new Error(r.errors.join("\n"));
  return r.diagram;
};
const bare = (): Record<string, any> => ({
  version: 2,
  slug: "bare",
  title: "t",
  lanes: [{ id: "l", label: "L" }],
  views: [{ id: "v", type: "structure" }],
  nodes: [{ id: "a", lane: "l", order: 0, label: "A", card: card() }],
});

function full(): Record<string, any> {
  const d = base();
  d.nodes.push({ id: "c", kind: "existing", label: "C", card: { ...card(), failure: { na: "cannot fail" } } });
  d.nodes[2].lane = "l";
  d.nodes[2].order = 2;
  d.edges.push({ id: "bc", from: "b", to: "c", data: "y", kind: "proposed" });
  d.steps[0].changes.bc = "added";
  d.views = [
    { id: "v1", type: "structure", title: "Structure" },
    { id: "v2", type: "calltree", items: [{ node: "a" }, { node: "b", parent: "a" }, { node: "c", parent: "b" }] },
    { id: "v3", type: "sequence", participants: ["a", "b", "c"], messages: ["ab", "bc", "ab"] },
    { id: "v4", type: "dataflow", items: [{ node: "a", value: "1" }, { node: "b", value: "2" }] },
  ];
  d.glossary = [{ term: "t1", definition: "d1" }];
  d.example = { title: "ex", trace: [{ node: "a", text: "x" }] };
  d.openQuestions = [{ question: "q", answer: "a" }];
  d.recall = [{ question: "q", answer: "a" }];
  d.checks = [
    {
      node: "a",
      question: "q",
      choices: [{ text: "x", correct: true, why: "w" }, { text: "y", why: "w" }, { text: "z", why: "w" }],
    },
  ];
  d.explainPrompt = { checklist: ["c1"] };
  return d;
}

describe("validate", () => {
  test("a bare diagram is accepted and normalized", () => {
    const d = diagramOf(bare());
    expect(d).toMatchObject({ mode: "explain", summary: "", edges: [], steps: [], boundaries: [] });
    expect(d.nodes[0].kind).toBe("existing");
  });

  test("accepts no steps and no refs", () => {
    const d = bare();
    d.nodes.push({ id: "b", lane: "l", order: 1, kind: "existing", label: "B", card: card() });
    d.edges = [{ id: "ab", from: "a", to: "b", data: "x" }];
    expect(errorsOf(d)).toEqual([]);
    expect(diagramOf(d).edges[0].kind).toBe("existing");
  });

  test("a proposed element is still an error without steps", () => {
    const d = bare();
    d.nodes.push({ id: "b", lane: "l", order: 1, kind: "proposed", label: "B", card: card() });
    expect(errorsOf(d)).toContain("proposed b is never added in a step");
  });

  test("accepts a diagram with all four view types and every optional section", () => {
    const d = full();
    expect(errorsOf(d)).toEqual([]);
    const out = diagramOf(d);
    expect(out.views.map(v => v.type)).toEqual(["structure", "calltree", "sequence", "dataflow"]);
    expect(out.mode).toBe("explain");
  });

  test("accepts the bundled system design example", () => {
    const raw = JSON.parse(readFileSync(join(HERE, "example.json"), "utf8"));
    expect(errorsOf(raw)).toEqual([]);
    expect(raw.mode).toBeUndefined();
    expect(diagramOf(raw).mode).toBe("explain");
  });

  test("lanes and lane/order are not needed without a structure view", () => {
    const d = full();
    d.views = d.views.slice(1);
    delete d.lanes;
    for (const n of d.nodes) {
      delete n.lane;
      delete n.order;
    }
    expect(errorsOf(d)).toEqual([]);
    expect(diagramOf(d).lanes).toEqual([]);
  });

  test("fills optional arrays on a full diagram", () => {
    const d = diagramOf({ ...base(), edges: undefined, steps: [{ title: "s", description: "d", changes: { b: "added" } }] });
    expect(d.edges).toEqual([]);
    expect(d.boundaries).toEqual([]);
  });

  test.each([
    ["non-object", null],
    ["empty object", {}],
    ["path traversal slug", { ...base(), slug: "../x" }],
    ["uppercase slug", { ...base(), slug: "Plan" }],
    ["whitespace title", { ...base(), title: "   " }],
    ["no lanes", { ...base(), lanes: [] }],
    ["unknown mode", { ...base(), mode: "review" }],
    ["unknown kind", { ...bare(), nodes: [{ id: "a", lane: "l", order: 0, label: "A", card: card(), kind: "maybe" }] }],
    ["version 1", { ...base(), version: 1 }],
    ["no views", { ...base(), views: [] }],
    ["structure view without lanes", { ...base(), lanes: undefined }],
  ])("rejects %s", (_, raw) => {
    expect(errorsOf(raw).length).toBeGreaterThan(0);
  });

  test("a ref is optional on an existing node but validated when present; a proposed one must not have one", () => {
    const d = base();
    delete d.nodes[0].ref;
    expect(errorsOf(d)).toEqual([]);

    d.nodes[0].ref = { file: "/abs", line: 1, excerpt: "x" };
    d.nodes[1].ref = { file: "src/a.ts", line: 1, excerpt: "line one" };
    const errors = errorsOf(d);
    expect(errors.some(e => e.startsWith("nodes[0]: ref.file"))).toBe(true);
    expect(errors.some(e => e.includes("proposed element has no code"))).toBe(true);
  });

  test.each([
    ["absolute path", { file: "/etc/passwd", line: 1, excerpt: "x" }],
    ["zero line", { file: "a", line: 0, excerpt: "x" }],
    ["blank excerpt", { file: "a", line: 1, excerpt: "  \n " }],
    ["oversize excerpt", { file: "a", line: 1, excerpt: Array(41).fill("x").join("\n") }],
  ])("rejects a ref with %s", (_, ref) => {
    const d = base();
    d.nodes[0].ref = ref;
    expect(errorsOf(d).length).toBeGreaterThan(0);
  });

  test("a self-loop edge is rejected", () => {
    const d = base();
    d.edges[0].to = "b";
    d.edges[0].from = "b";
    expect(errorsOf(d)).toContain("edges[0]: from and to must differ");
  });

  test("two nodes in one cell are rejected", () => {
    const d = base();
    d.nodes[1].order = 0;
    expect(errorsOf(d).some(e => e.includes("already sits"))).toBe(true);
  });

  test("step replay: existing added, change before add, never added, edge without endpoint", () => {
    const d = base();
    d.steps = [
      { title: "s1", description: "d", changes: { a: "added", ab: "changed" } },
      { title: "s2", description: "d", changes: { a: "removed" } },
    ];
    const errors = errorsOf(d);
    expect(errors).toContain("steps[0]: existing a cannot be added");
    expect(errors).toContain("steps[0]: ab is changed while absent");
    expect(errors).toContain("proposed b is never added in a step");

    const e = base();
    e.steps.push({ title: "s2", description: "d", changes: { a: "removed" } });
    expect(errorsOf(e)).toContain("steps[1]: edge ab is shown while an endpoint is absent");
  });

  test("an element added twice is rejected", () => {
    const d = base();
    d.steps.push({ title: "s2", description: "d", changes: { b: "added" } });
    expect(errorsOf(d)).toContain("steps[1]: b is added twice");
  });

  test("an unknown id or change value in a step is rejected", () => {
    const d = base();
    d.steps[0].changes = { b: "added", ab: "added", nope: "added", a: "moved" };
    const errors = errorsOf(d);
    expect(errors).toContain("steps[0]: unknown id nope");
    expect(errors.some(e => e.includes("a change must be"))).toBe(true);
  });

  test("more than 30 steps are rejected", () => {
    const d = base();
    d.steps = Array(31).fill({ title: "s", description: "d", changes: { b: "added" } });
    expect(errorsOf(d)).toContain("steps: at most 30 steps");
  });

  test("deepDive and boundaries need mode plan", () => {
    const d = base();
    d.nodes[0].deepDive = { category: "secrets", why: "w" };
    d.boundaries = [{ label: "l", reason: "r" }];
    const errors = errorsOf(d);
    expect(errors).toContain('nodes[0]: deepDive requires mode "plan"');
    expect(errors).toContain('boundaries: requires mode "plan"');

    d.mode = "plan";
    expect(errorsOf(d)).toEqual([]);
    expect(diagramOf(d).mode).toBe("plan");
  });

  test("in plan mode deepDive and boundaries are shape-validated", () => {
    const d = base();
    d.mode = "plan";
    d.nodes[0].deepDive = { category: "secrets" };
    d.boundaries = [{ label: "l" }];
    const errors = errorsOf(d);
    expect(errors.some(e => e.startsWith("nodes[0]: deepDive needs"))).toBe(true);
    expect(errors.some(e => e.startsWith("boundaries[0]"))).toBe(true);
  });
});

describe("recall", () => {
  const item = { question: "なぜ?", answer: "理由だから" };

  test("is optional, normalized to [] and allowed in both modes", () => {
    expect(diagramOf(bare()).recall).toEqual([]);
    const d = { ...bare(), recall: [item] };
    expect(errorsOf(d)).toEqual([]);
    expect(diagramOf(d).recall).toEqual([item]);
    expect(errorsOf({ ...d, mode: "plan" })).toEqual([]);
  });

  test("rejects more than 3 items, bad items and non-arrays", () => {
    const count = "recall: must be an array of 1-3 items";
    expect(errorsOf({ ...bare(), recall: Array(4).fill(item) })).toContain(count);
    expect(errorsOf({ ...bare(), recall: Array(3).fill(item) })).toEqual([]);
    expect(errorsOf({ ...bare(), recall: [] })).toContain(count);
    expect(errorsOf({ ...bare(), recall: "x" })).toContain(count);
    expect(errorsOf({ ...bare(), recall: {} })).toContain(count);
    const msg = "recall[1]: question (<=200) and answer (<=1500) required";
    expect(errorsOf({ ...bare(), recall: [item, { question: " ", answer: "a" }] })).toContain(msg);
    expect(errorsOf({ ...bare(), recall: [item, { question: "q", answer: "a".repeat(1501) }] })).toContain(msg);
    expect(errorsOf({ ...bare(), recall: [item, { question: "q".repeat(201), answer: "a" }] })).toContain(msg);
    expect(errorsOf({ ...bare(), recall: [item, "x"] })).toContain(msg);
  });
});

describe("schema v2 failures", () => {
  const mutate = (fn: (d: Record<string, any>) => void) => {
    const d = full();
    fn(d);
    return errorsOf(d);
  };

  test.each<[string, (d: Record<string, any>) => void, string]>([
    ["missing card field", d => delete d.nodes[0].card.trigger, "nodes[0] (a): card.trigger"],
    ["missing card", d => delete d.nodes[1].card, "nodes[1] (b): card required"],
    ["empty card string", d => (d.nodes[0].card.role = "  "), "nodes[0] (a): card.role"],
    ["oversize card string", d => (d.nodes[0].card.actor = "x".repeat(401)), "nodes[0] (a): card.actor"],
    ["na with empty reason", d => (d.nodes[0].card.failure = { na: " " }), "nodes[0] (a): card.failure na needs"],
    ["na with oversize reason", d => (d.nodes[0].card.failure = { na: "x".repeat(201) }), "card.failure na needs"],
    ["two correct choices", d => (d.checks[0].choices[1].correct = true), "exactly one choice must be correct, found 2"],
    ["no correct choice", d => delete d.checks[0].choices[0].correct, "exactly one choice must be correct, found 0"],
    ["only two choices", d => d.checks[0].choices.pop(), "choices must be an array of 3-4"],
    ["five choices", d => d.checks[0].choices.push(...Array(3).fill({ text: "t", why: "w" })), "choices must be an array of 3-4"],
    ["correct choice without why", d => delete d.checks[0].choices[0].why, "checks[0].choices[0]"],
    ["three checks on one node", d => (d.checks = Array(3).fill(d.checks[0])), "at most 2 checks per node"],
    ["21 checks", d => (d.checks = Array(21).fill(d.checks[0])), "checks: must be an array of at most 20"],
    ["check on unknown node", d => (d.checks[0].node = "zz"), "checks[0]: existing node"],
    ["calltree cycle", d => (d.views[1].items = [{ node: "a" }, { node: "b", parent: "c" }, { node: "c", parent: "b" }]), "parent links form a cycle"],
    ["calltree two roots", d => delete d.views[1].items[1].parent, "exactly one root"],
    ["calltree parent outside the list", d => (d.views[1].items[2].parent = "zz"), "parent must be a node in the same items list"],
    ["calltree node twice", d => d.views[1].items.push({ node: "c", parent: "a" }), "node c appears twice"],
    ["sequence endpoint not a participant", d => (d.views[2].participants = ["a", "b"]), "edge bc has an endpoint that is not a participant"],
    ["sequence unknown edge", d => d.views[2].messages.push("zz"), "unknown edge zz"],
    ["seven participants", d => (d.views[2].participants = Array(7).fill("a")), "participants must be an array of 1-6"],
    ["dataflow with one item", d => d.views[3].items.pop(), "items must be an array of 2-20"],
    ["dataflow blank value", d => (d.views[3].items[0].value = " "), "views[3].items[0]"],
    ["duplicate view id", d => (d.views[1].id = "v1"), "duplicate id v1"],
    ["unknown view type", d => (d.views[1].type = "graph"), "type must be one of"],
    ["five views", d => d.views.push({ id: "v5", type: "structure" }), "views: 1-4 views required"],
    ["structure view without lanes", d => delete d.lanes, "lanes: 1-8 lanes required"],
    ["structure view with a node off its lane", d => delete d.nodes[0].lane, "nodes[0]: unknown lane"],
    ["duplicate glossary term", d => d.glossary.push({ term: "t1", definition: "d" }), "duplicate term t1"],
    ["16 glossary terms", d => (d.glossary = Array.from({ length: 16 }, (_, i) => ({ term: `t${i}`, definition: "d" }))), "glossary: must be an array of at most 15"],
    ["example on unknown node", d => (d.example.trace[0].node = "zz"), "example.trace[0]"],
    ["13 trace entries", d => (d.example.trace = Array(13).fill(d.example.trace[0])), "trace must be an array of 1-12"],
    ["nine open questions", d => (d.openQuestions = Array(9).fill(d.openQuestions[0])), "openQuestions: must be an array of at most 8"],
    ["empty checklist", d => (d.explainPrompt.checklist = []), "explainPrompt: checklist"],
    ["nine checklist items", d => (d.explainPrompt.checklist = Array(9).fill("c")), "explainPrompt: checklist"],
  ])("rejects %s", (_, fn, expected) => {
    expect(mutate(fn).some(e => e.includes(expected))).toBe(true);
  });

  test("a repeated sequence message and two checks on one node are accepted", () => {
    const d = full();
    d.checks = [d.checks[0], d.checks[0]];
    expect(errorsOf(d)).toEqual([]);
  });
});

describe("step predict", () => {
  const withPredict = (predict: unknown) => {
    const d = base();
    d.steps[0].predict = predict;
    return d;
  };
  const msg = "steps[0]: predict needs a question (<=200 chars) and an optional hint (<=300 chars)";

  test("a question with or without a hint is accepted", () => {
    expect(errorsOf(withPredict({ question: "q" }))).toEqual([]);
    expect(errorsOf(withPredict({ question: "q", hint: "h" }))).toEqual([]);
  });

  test("a missing or oversize question, or an oversize hint, is rejected", () => {
    expect(errorsOf(withPredict({ hint: "h" }))).toContain(msg);
    expect(errorsOf(withPredict({ question: "q".repeat(201) }))).toContain(msg);
    expect(errorsOf(withPredict({ question: "q", hint: "h".repeat(301) }))).toContain(msg);
    expect(errorsOf(withPredict("q"))).toContain(msg);
  });
});

describe("checkRefs", () => {
  const withRef = (file: string, line: number, excerpt: string): Diagram => {
    const d = base();
    d.nodes[0].ref = { file, line, excerpt };
    return diagramOf(d);
  };
  const statusOf = (file: string, line: number, excerpt: string) => checkRefs(withRef(file, line, excerpt), repo)[0];

  test("ok when the excerpt sits at the line, ignoring trailing whitespace", () => {
    expect(statusOf("src/a.ts", 2, "function f() {   \n  return 1\n").status).toBe("ok");
  });

  test("moved reports where the excerpt actually is", () => {
    expect(statusOf("src/a.ts", 1, "  return 1")).toMatchObject({ status: "moved", foundAt: 3 });
  });

  test("mismatch when the excerpt is nowhere in the file", () => {
    expect(statusOf("src/a.ts", 2, "function g() {").status).toBe("mismatch");
  });

  test("missing for an absent file or a directory", () => {
    expect(statusOf("src/none.ts", 1, "x").status).toBe("missing");
    expect(statusOf("src", 1, "x").status).toBe("missing");
  });

  test("outside for .. traversal and for a symlink leaving the repo", () => {
    expect(statusOf("../secret.txt", 1, "outside").status).toBe("outside");
    expect(statusOf("link.txt", 1, "outside").status).toBe("outside");
  });

  test("proposed elements and edges without refs are not checked", () => {
    expect(checkRefs(diagramOf(base()), repo).map(c => c.id)).toEqual(["a"]);
  });
});

describe("renderHtml", () => {
  const template = readFileSync(join(HERE, "template.html"), "utf8");

  test("the template carries the recall section and the predict toggle", () => {
    const html = renderHtml(diagramOf(base()), [], template);
    expect(html).toContain('id="recall-sec"');
    expect(html).toContain('id="predict"');
    expect(html).toContain('id="hint"');
    expect(html).toContain('id="predict-hint"');
  });

  test("an excerpt cannot close the data script or inject markup", () => {
    const d = base();
    d.title = "</script><img src=x onerror=alert(1)>";
    d.nodes[0].ref.excerpt = "</SCRIPT><script>alert(1)</script> $& $' " + LINE_SEPARATORS;
    const diagram = diagramOf(d);
    const html = renderHtml(diagram, [], template);
    const payload = html.split('<script type="application/json" id="data">')[1].split("</script>")[0];
    expect(payload).not.toMatch(/[<>]/);
    expect(JSON.parse(payload).diagram).toEqual(diagram);
    expect(html).not.toContain("<img");
  });

  test("the title is HTML-escaped into <title>", () => {
    const html = renderHtml(diagramOf({ ...base(), title: `a & <b> "c" 'd'` }), [], template);
    expect(html).toContain("<title>a &amp; &lt;b&gt; &quot;c&quot; &#39;d&#39;</title>");
  });

  test("text that looks like a marker is never expanded", () => {
    const html = renderHtml(diagramOf({ ...base(), title: "__DATA__ $&" }), [], template);
    expect(html).toContain("<title>__DATA__ $&amp;</title>");
  });

  test("embedJson escapes <, >, & and line separators", () => {
    expect(embedJson("<>&" + LINE_SEPARATORS)).toBe('"\\u003c\\u003e\\u0026\\u2028\\u2029"');
  });

  test("refuses a template with a missing or duplicated marker", () => {
    const d = diagramOf(base());
    for (const marker of ["__DATA__", "__TITLE__"]) {
      expect(() => renderHtml(d, [], `${template}${marker}`)).toThrow();
      expect(() => renderHtml(d, [], template.replace(marker, ""))).toThrow();
    }
  });
});

describe("main", () => {
  const write = (name: string, value: unknown) => {
    const path = join(tmp, name);
    writeFileSync(path, JSON.stringify(value));
    return path;
  };

  test("writes the HTML under TMPDIR and reports mismatches", () => {
    const out = join(tmp, "out");
    const d = base();
    d.nodes[0].ref.excerpt = "function g() {";
    const json = write("d.json", d);
    const logs: string[] = [];
    const prev = process.env.TMPDIR;
    process.env.TMPDIR = out;
    try {
      expect(main([json, "--root", repo], m => logs.push(m), () => {})).toBe(0);
    } finally {
      process.env.TMPDIR = prev;
    }
    expect(logs[0]).toBe(outputPath("test-diagram", { TMPDIR: out }));
    expect(logs[0]).toContain("diagram-explain");
    expect(existsSync(logs[0])).toBe(true);
    expect(logs).toContain("refs: 0/1 ok");
    expect(logs).toContain("MISMATCH a src/a.ts:2");
  });

  test("--out writes to the given path and creates its directory", () => {
    const target = join(tmp, "custom", "deep", "page.html");
    const logs: string[] = [];
    expect(main([write("d2.json", base()), "--root", repo, "--out", target], m => logs.push(m), () => {})).toBe(0);
    expect(logs[0]).toBe(target);
    expect(readFileSync(target, "utf8")).toContain("<title>t</title>");
  });

  test("without refs there is no refs line and --root is not consulted", () => {
    const target = join(tmp, "norefs.html");
    const logs: string[] = [];
    const noRefs = full();
    delete noRefs.nodes[0].ref;
    const code = main([write("ex.json", noRefs), "--root", join(tmp, "no-such-dir"), "--out", target], m => logs.push(m), () => {});
    expect(code).toBe(0);
    expect(logs).toEqual([target]);
  });

  test("options: extra validation, default mode and output dir name", () => {
    const target = join(tmp, "opts.html");
    const d = base();
    d.nodes[0].deepDive = { category: "secrets", why: "w" };
    const json = write("opts.json", d);

    expect(main([json, "--root", repo, "--out", target], () => {}, () => {})).toBe(1);
    expect(existsSync(target)).toBe(false);

    const opts = { defaultMode: "plan" as const };
    expect(main([json, "--root", repo, "--out", target], () => {}, () => {}, opts)).toBe(0);
    expect(readFileSync(target, "utf8")).toContain('"mode":"plan"');

    const failures: string[] = [];
    const veto = { extraValidate: (_: unknown, errors: string[]) => void errors.push("vetoed") };
    expect(main([json, "--root", repo, "--out", join(tmp, "veto.html")], () => {}, m => failures.push(m), { ...opts, ...veto })).toBe(1);
    expect(failures[0]).toContain("- vetoed");
    expect(existsSync(join(tmp, "veto.html"))).toBe(false);

    expect(outputPath("s", { TMPDIR: "/x" }, "explain-plan")).toBe("/x/explain-plan/s/index.html");
  });

  test("writes no HTML for broken JSON or an invalid diagram", () => {
    const out = join(tmp, "out-bad");
    const prev = process.env.TMPDIR;
    process.env.TMPDIR = out;
    try {
      const broken = join(tmp, "broken.json");
      writeFileSync(broken, "{");
      expect(main([broken, "--root", repo], () => {}, () => {})).toBe(1);
      expect(main([write("invalid.json", { ...base(), version: 1 }), "--root", repo], () => {}, () => {})).toBe(1);
    } finally {
      process.env.TMPDIR = prev;
    }
    expect(existsSync(out)).toBe(false);
  });

  test("usage errors exit 2", () => {
    expect(main([], () => {}, () => {})).toBe(2);
    expect(main(["a.json", "--root"], () => {}, () => {})).toBe(2);
    expect(main(["a.json", "--out"], () => {}, () => {})).toBe(2);
    expect(main(["a.json", "b.json"], () => {}, () => {})).toBe(2);
  });
});
