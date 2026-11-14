import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { layoutViews, wrapText, type NodeBox, type ViewLayout } from "./layout.ts";
import { renderHtml, validate, type Diagram } from "./render.ts";

const HERE = import.meta.dir;
const EXAMPLES = ["example.json", "example-trace.json", "example-c4.json"];

const load = (name: string): Diagram => {
  const r = validate(JSON.parse(readFileSync(join(HERE, name), "utf8")));
  if ("errors" in r) throw new Error(`${name}: ${r.errors.join("; ")}`);
  return r.diagram;
};

const overlaps = (a: NodeBox, b: NodeBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const sizes = ["desktop", "phone"] as const;

function laidOut(d: Diagram) {
  return layoutViews(d);
}

describe("layoutViews", () => {
  test.each(EXAMPLES)("%s: every drawn node and edge has coordinates and no two nodes overlap", async name => {
    const d = load(name);
    const layouts = await laidOut(d);
    const laid = d.views.filter(v => v.type === "structure" || v.type === "c4");
    expect(Object.keys(layouts)).toEqual(laid.map(v => v.id));
    for (const view of laid) {
      const members = new Set(view.type === "c4" ? view.items.map(it => it.node) : d.nodes.map(n => n.id));
      for (const size of sizes) {
        const L: ViewLayout = layouts[view.id][size];
        expect(Object.keys(L.nodes).sort()).toEqual([...members].sort());
        const wantEdges = d.edges.filter(e => members.has(e.from) && members.has(e.to)).map(e => e.id);
        expect(Object.keys(L.edges).sort()).toEqual(wantEdges.sort());
        for (const route of Object.values(L.edges)) {
          expect(route.points.length).toBeGreaterThanOrEqual(2);
          for (const p of route.points) {
            expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeGreaterThanOrEqual(0);
          }
        }
        const boxes = Object.values(L.nodes);
        for (const b of boxes) {
          expect(b.x).toBeGreaterThanOrEqual(0);
          expect(b.y).toBeGreaterThanOrEqual(0);
          expect(b.x + b.w).toBeLessThanOrEqual(L.width);
          expect(b.y + b.h).toBeLessThanOrEqual(L.height);
        }
        boxes.forEach((a, i) => boxes.slice(i + 1).forEach(b => expect(overlaps(a, b)).toBe(false)));
      }
    }
  });

  test("a structure view gets a header per lane that holds nodes", async () => {
    const d = load("example.json");
    const layouts = await laidOut(d);
    const view = d.views.find(v => v.type === "structure");
    if (!view) throw new Error("no structure view");
    for (const size of sizes) {
      expect(layouts[view.id][size].headers.map(h => h.text)).toEqual(d.lanes.map(l => l.label));
    }
  });

  test("the c4 boundary contains every member and no other node", async () => {
    const d = load("example-c4.json");
    const layouts = await laidOut(d);
    const view = d.views.find(v => v.type === "c4" && v.boundary);
    if (!view || view.type !== "c4" || !view.boundary) throw new Error("no c4 view with a boundary");
    const members = new Set(view.boundary.nodes);
    for (const size of sizes) {
      const L = layouts[view.id][size];
      const r = L.boundary;
      if (!r) throw new Error("no boundary rect");
      const rect = { ...r, lines: [], kind: [], sub: [] };
      for (const [id, b] of Object.entries(L.nodes)) {
        if (members.has(id)) {
          expect(b.x).toBeGreaterThanOrEqual(r.x);
          expect(b.y).toBeGreaterThanOrEqual(r.y);
          expect(b.x + b.w).toBeLessThanOrEqual(r.x + r.w);
          expect(b.y + b.h).toBeLessThanOrEqual(r.y + r.h);
        } else expect(overlaps(b, rect)).toBe(false);
      }
    }
  });

  test("phones lay out narrower than desktops for a multi-lane structure", async () => {
    const d = load("example.json");
    const layouts = await laidOut(d);
    const view = d.views.find(v => v.type === "structure");
    if (!view) throw new Error("no structure view");
    expect(layouts[view.id].phone.width).toBeLessThan(layouts[view.id].desktop.width);
  });

  test("the same input gives the same layout", async () => {
    const d = load("example-c4.json");
    expect(await laidOut(d)).toEqual(await laidOut(d));
  });

  test("views other than structure and c4 are left alone", async () => {
    const d = load("example-trace.json");
    d.views = [{ id: "seq", type: "dataflow", items: [{ node: "handler", value: "a" }, { node: "service", value: "b" }] }];
    expect(await laidOut(d)).toEqual({});
  });

  test("a box is sized from its wrapped text", async () => {
    const d = load("example-c4.json");
    const L = (await laidOut(d))[d.views[1].id].desktop;
    const db = L.nodes.db;
    expect(db.kind).toEqual(["[Container: PostgreSQL]"]);
    expect(db.h).toBeGreaterThanOrEqual((db.lines.length + db.kind.length + db.sub.length) * 14);
    const phone = (await laidOut(d))[d.views[1].id].phone;
    expect(phone.nodes.api.w).toBeLessThanOrEqual(150);
  });

  test("an edge label carries the c4 tech as its own line", async () => {
    const d = load("example-c4.json");
    const L = (await laidOut(d))[d.views[1].id].desktop;
    expect(L.edges["c2-pay"].label?.lines.at(-1)).toBe("[HTTPS/JSON]");
  });

  test.each(EXAMPLES)("%s renders with its layouts embedded", async name => {
    const d = load(name);
    const html = renderHtml(d, [], readFileSync(join(HERE, "template.html"), "utf8"), await laidOut(d));
    expect(html).toContain('"layouts":{');
  });
});

describe("wrapText", () => {
  test("breaks by width: full-width 12px, other 7px", () => {
    expect(wrapText("あいうえお", 36)).toEqual(["あいう", "えお"]);
    expect(wrapText("abcdefgh", 21)).toEqual(["abc", "def", "gh"]);
  });

  test("never returns an empty array", () => {
    expect(wrapText("", 10)).toEqual([""]);
  });
});
