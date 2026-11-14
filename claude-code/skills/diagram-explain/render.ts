#!/usr/bin/env bun
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, isAbsolute, join, relative, resolve } from "path";
// Not read at run time next to import.meta.url: in the `bun build --compile` binary that is the
// virtual /$bunfs root, so the files must be embedded.
import template from "./template.html" with { type: "text" };
import { layoutViews, type Layouts } from "./layout.ts";

const CHANGES = ["added", "changed", "removed"] as const;

const MAX_JSON_BYTES = 1_000_000;
const MAX_SOURCE_BYTES = 2_000_000;
const MAX_EXCERPT_LINES = 40;
const MAX_EXCERPT_CHARS = 4000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
const ID = /^[A-Za-z0-9_-]{1,40}$/;

type Kind = "existing" | "proposed";
export type Mode = "explain" | "plan";
export type Ref = { file: string; line: number; excerpt: string };
const CARD_FIELDS = ["role", "actor", "trigger", "failure"] as const;
const VIEW_TYPES = ["structure", "calltree", "sequence", "dataflow", "c4"] as const;
const C4_TYPES = ["person", "system", "external", "container", "database", "queue"] as const;
const C4_LEVEL_TYPES: Record<string, readonly string[]> = {
  context: ["person", "system", "external"],
  container: ["person", "container", "database", "queue", "external"],
};

export type CardField = string | { na: string };
export type Card = Record<(typeof CARD_FIELDS)[number], CardField>;
export type DiagramNode = {
  id: string;
  lane?: string;
  order?: number;
  label: string;
  sub?: string;
  c4?: { type: (typeof C4_TYPES)[number]; tech?: string };
  kind: Kind;
  card: Card;
  ref?: Ref;
  deepDive?: { category: string; why: string };
};
export type View = { id: string; type: (typeof VIEW_TYPES)[number]; title?: string } & (
  | { type: "structure" }
  | { type: "calltree"; items: { node: string; parent?: string }[] }
  | { type: "sequence"; participants: string[]; messages: string[] }
  | { type: "dataflow"; items: { node: string; value: string }[] }
  | {
      type: "c4";
      level: "context" | "container";
      items: { node: string }[];
      boundary?: { label: string; nodes: string[] };
      zoom?: { node: string; view: string };
    }
);
export type Check = {
  node: string;
  question: string;
  choices: { text: string; correct?: true; why: string }[];
};
export type DiagramEdge = { id: string; from: string; to: string; data: string; tech?: string; kind: Kind; ref?: Ref };
export type Step = {
  title: string;
  description: string;
  changes: Record<string, (typeof CHANGES)[number]>;
  predict?: { question: string; hint?: string };
};
export type TraceStep = {
  text: string;
  active: string[];
  state?: Record<string, string>;
  tone?: "error";
};
export type Scenario = {
  id: string;
  title: string;
  summary?: string;
  uses?: string[];
  initial?: Record<string, string>;
  trace: TraceStep[];
};
export type Diagram = {
  version: 2;
  mode: Mode;
  slug: string;
  title: string;
  summary: string;
  lanes: { id: string; label: string }[];
  views: View[];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  steps: Step[];
  scenarios: Scenario[];
  state: { key: string; label?: string }[];
  boundaries: { label: string; reason: string }[];
  recall: { question: string; answer: string }[];
  glossary: { term: string; definition: string }[];
  example?: { title: string; trace: { node: string; text: string }[] };
  openQuestions: { question: string; answer: string }[];
  checks: Check[];
  explainPrompt?: { checklist: string[] };
};

export type RefStatus = "ok" | "moved" | "mismatch" | "missing" | "outside";
export type RefCheck = { id: string; file: string; line: number; status: RefStatus; foundAt?: number };

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const isText = (x: unknown, max: number): x is string => typeof x === "string" && x.trim() !== "" && x.length <= max;
const isInt = (x: unknown, min: number, max: number): x is number =>
  Number.isInteger(x) && (x as number) >= min && (x as number) <= max;

function checkRef(x: unknown, where: string, errors: string[]): void {
  if (!isObj(x)) return void errors.push(`${where}: ref must be an object`);
  if (typeof x.file !== "string" || x.file === "" || isAbsolute(x.file) || x.file.includes("\0")) {
    errors.push(`${where}: ref.file must be a path relative to the repo root`);
  }
  if (!isInt(x.line, 1, 10_000_000)) errors.push(`${where}: ref.line must be a positive integer`);
  if (!isText(x.excerpt, MAX_EXCERPT_CHARS) || excerptLines(x.excerpt).length > MAX_EXCERPT_LINES) {
    errors.push(`${where}: ref.excerpt must be 1-${MAX_EXCERPT_LINES} lines, at most ${MAX_EXCERPT_CHARS} chars`);
  }
}

function checkElement(x: Obj, where: string, errors: string[]): Kind | undefined {
  const kind = x.kind === undefined ? "existing" : x.kind;
  if (kind !== "existing" && kind !== "proposed") {
    errors.push(`${where}: kind must be existing or proposed`);
    return undefined;
  }
  if (kind === "proposed" && x.ref !== undefined) errors.push(`${where}: a proposed element has no code to reference`);
  if (kind === "existing" && x.ref !== undefined) checkRef(x.ref, where, errors);
  return kind;
}

function checkSteps(
  steps: unknown[],
  kinds: Map<string, Kind>,
  endpoints: Map<string, [string, string]>,
  usedByScenario: Set<string>,
  errors: string[],
): void {
  const present = new Map([...kinds].map(([id, kind]) => [id, kind === "existing"]));
  const added = new Set<string>();
  steps.forEach((s, i) => {
    const where = `steps[${i}]`;
    if (!isObj(s)) return void errors.push(`${where}: must be an object`);
    if (!isText(s.title, 120)) errors.push(`${where}: title required (<=120 chars)`);
    if (!isText(s.description, 1000)) errors.push(`${where}: description required (<=1000 chars)`);
    if (s.predict !== undefined) {
      const p = s.predict;
      if (!isObj(p) || !isText(p.question, 200) || (p.hint !== undefined && !isText(p.hint, 300))) {
        errors.push(`${where}: predict needs a question (<=200 chars) and an optional hint (<=300 chars)`);
      }
    }
    if (!isObj(s.changes) || Object.keys(s.changes).length === 0) return void errors.push(`${where}: changes required`);
    for (const [id, change] of Object.entries(s.changes)) {
      if (!kinds.has(id)) {
        errors.push(`${where}: unknown id ${id}`);
        continue;
      }
      if (!CHANGES.includes(change as never)) {
        errors.push(`${where}: ${id} change must be added, changed or removed`);
        continue;
      }
      const isPresent = present.get(id);
      if (change === "added") {
        if (kinds.get(id) === "existing") errors.push(`${where}: existing ${id} cannot be added`);
        else if (isPresent || added.has(id)) errors.push(`${where}: ${id} is added twice`);
        present.set(id, true);
        added.add(id);
      } else if (!isPresent) {
        errors.push(`${where}: ${id} is ${change} while absent`);
      } else if (change === "removed") {
        present.set(id, false);
      }
    }
    for (const [edge, [from, to]] of endpoints) {
      if (present.get(edge) && (!present.get(from) || !present.get(to))) {
        errors.push(`${where}: edge ${edge} is shown while an endpoint is absent`);
      }
    }
  });
  for (const [id, kind] of kinds) {
    if (kind === "proposed" && !added.has(id) && !usedByScenario.has(id)) errors.push(`proposed ${id} is never added in a step`);
  }
}

function checkState(raw: unknown, errors: string[]): Set<string> {
  const keys = new Set<string>();
  checkList(raw, "state", 8, errors, (s, where) => {
    if (!isObj(s) || typeof s.key !== "string" || !ID.test(s.key) || (s.label !== undefined && !isText(s.label, 40))) {
      return void errors.push(`${where}: key (matching ${ID.source}) and an optional label (<=40 chars) required`);
    }
    if (keys.has(s.key)) errors.push(`${where}: duplicate key ${s.key}`);
    keys.add(s.key);
  });
  if (Array.isArray(raw) && raw.length === 0) errors.push("state: 1-8 entries required");
  return keys;
}

function checkStateValues(x: unknown, where: string, keys: Set<string>, errors: string[]): void {
  if (!isObj(x)) return void errors.push(`${where}: must be an object of state key to text`);
  for (const [k, v] of Object.entries(x)) {
    if (!keys.has(k)) errors.push(`${where}: undeclared state key ${k}`);
    else if (!isText(v, 120)) errors.push(`${where}.${k}: value must be text (<=120 chars)`);
  }
}

// Returns the proposed ids some scenario shows, so checkSteps does not report them as never added.
function checkScenarios(
  raw: unknown,
  kinds: Map<string, Kind>,
  endpoints: Map<string, [string, string]>,
  stateKeys: Set<string>,
  errors: string[],
): Set<string> {
  const used = new Set<string>();
  const ids = new Set<string>();
  checkList(raw, "scenarios", 4, errors, (s, where) => {
    if (!isObj(s)) return void errors.push(`${where}: must be an object`);
    if (typeof s.id !== "string" || !ID.test(s.id)) errors.push(`${where}: id must match ${ID.source}`);
    else if (ids.has(s.id)) errors.push(`${where}: duplicate id ${s.id}`);
    else ids.add(s.id);
    if (!isText(s.title, 40)) errors.push(`${where}: title required (<=40 chars)`);
    if (s.summary !== undefined && !isText(s.summary, 300)) errors.push(`${where}: summary must be text (<=300 chars)`);

    const present = new Set([...kinds].filter(([, kind]) => kind === "existing").map(([id]) => id));
    if (s.uses !== undefined) {
      if (!Array.isArray(s.uses)) errors.push(`${where}: uses must be an array of proposed element ids`);
      else
        for (const id of s.uses) {
          if (typeof id !== "string" || kinds.get(id) !== "proposed") errors.push(`${where}: uses ${String(id)} is not a proposed element`);
          else {
            present.add(id);
            used.add(id);
          }
        }
    }
    for (const [edge, [from, to]] of endpoints) {
      if (present.has(edge) && (!present.has(from) || !present.has(to))) {
        errors.push(`${where}: edge ${edge} is shown while an endpoint is absent`);
      }
    }
    if (s.initial !== undefined) checkStateValues(s.initial, `${where}.initial`, stateKeys, errors);

    if (!Array.isArray(s.trace) || s.trace.length < 1 || s.trace.length > 20) {
      return void errors.push(`${where}: trace must be an array of 1-20`);
    }
    s.trace.forEach((t, i) => {
      const at = `${where}.trace[${i}]`;
      if (!isObj(t)) return void errors.push(`${at}: must be an object`);
      if (!isText(t.text, 200)) errors.push(`${at}: text required (<=200 chars)`);
      if (t.tone !== undefined && t.tone !== "error") errors.push(`${at}: tone must be "error"`);
      if (t.state !== undefined) checkStateValues(t.state, `${at}.state`, stateKeys, errors);
      if (!Array.isArray(t.active) || t.active.length < 1 || t.active.length > 6) {
        return void errors.push(`${at}: active must be an array of 1-6 element ids`);
      }
      for (const a of t.active) {
        if (typeof a !== "string" || !kinds.has(a)) errors.push(`${at}: unknown id ${String(a)}`);
        else if (!present.has(a)) errors.push(`${at}: active ${a} is not shown in this scenario`);
      }
    });
  });
  if (Array.isArray(raw) && raw.length === 0) errors.push("scenarios: 1-4 scenarios required");
  return used;
}

function checkCard(card: unknown, where: string, errors: string[]): void {
  if (!isObj(card)) return void errors.push(`${where}: card required (role, actor, trigger, failure)`);
  for (const field of CARD_FIELDS) {
    const v = card[field];
    const na = isObj(v) ? v.na : undefined;
    if (isText(v, 400)) continue;
    if (isObj(v) && "na" in v) {
      if (!isText(na, 200)) errors.push(`${where}: card.${field} na needs a non-empty reason (<=200 chars)`);
    } else errors.push(`${where}: card.${field} must be text (<=400 chars) or { "na": reason }`);
  }
}

function checkCalltree(items: unknown, where: string, nodeIds: Set<string>, errors: string[]): void {
  if (!Array.isArray(items) || items.length < 1 || items.length > 60) return void errors.push(`${where}: items must be an array of 1-60`);
  const listed = new Set<string>();
  for (const [i, it] of items.entries()) {
    if (!isObj(it) || typeof it.node !== "string" || !nodeIds.has(it.node)) {
      errors.push(`${where}.items[${i}]: unknown node`);
    } else if (listed.has(it.node)) errors.push(`${where}.items[${i}]: node ${it.node} appears twice`);
    else listed.add(it.node);
  }
  const parentOf = new Map<string, string | undefined>();
  for (const [i, it] of items.entries()) {
    if (!isObj(it) || typeof it.node !== "string") continue;
    if (it.parent !== undefined && (typeof it.parent !== "string" || !listed.has(it.parent))) {
      errors.push(`${where}.items[${i}]: parent must be a node in the same items list`);
      continue;
    }
    parentOf.set(it.node, it.parent as string | undefined);
  }
  const roots = [...parentOf].filter(([, p]) => p === undefined);
  if (roots.length !== 1) errors.push(`${where}: exactly one root (item without parent) required, found ${roots.length}`);
  for (const start of parentOf.keys()) {
    let at: string | undefined = start;
    for (let hops = 0; at !== undefined && hops <= parentOf.size; hops++) at = parentOf.get(at);
    if (at !== undefined) return void errors.push(`${where}: parent links form a cycle`);
  }
}

function checkC4(
  v: Obj,
  where: string,
  nodeIds: Set<string>,
  c4Types: Map<string, string>,
  zooms: { where: string; view: string }[],
  errors: string[],
): void {
  const level = v.level === "context" || v.level === "container" ? v.level : undefined;
  if (level === undefined) errors.push(`${where}: level must be context or container`);

  const placed = new Set<string>();
  if (!Array.isArray(v.items) || v.items.length < 1 || v.items.length > 20) errors.push(`${where}: items must be an array of 1-20`);
  else
    v.items.forEach((it, i) => {
      const at = `${where}.items[${i}]`;
      if (!isObj(it) || typeof it.node !== "string" || !nodeIds.has(it.node)) return void errors.push(`${at}: unknown node`);
      if (placed.has(it.node)) errors.push(`${at}: node ${it.node} appears twice`);
      const type = c4Types.get(it.node);
      if (type === undefined) errors.push(`${at}: node ${it.node} needs a c4 type`);
      else if (level !== undefined && !C4_LEVEL_TYPES[level].includes(type)) {
        errors.push(`${at}: type ${type} is not allowed in a ${level} view`);
      }
      placed.add(it.node);
    });

  if (v.boundary === undefined) {
    if (level === "container") errors.push(`${where}: boundary required in a container view`);
  } else if (level === "context") errors.push(`${where}: boundary is not allowed in a context view`);
  else {
    const b = v.boundary;
    if (!isObj(b) || !isText(b.label, 60) || !Array.isArray(b.nodes) || b.nodes.length < 1) {
      errors.push(`${where}: boundary needs a label (<=60 chars) and a non-empty nodes array`);
    } else {
      for (const id of b.nodes) {
        if (typeof id !== "string" || !placed.has(id)) errors.push(`${where}: boundary node ${String(id)} is not in items`);
      }
    }
  }

  if (v.zoom !== undefined) {
    const z = v.zoom;
    if (!isObj(z) || typeof z.node !== "string" || typeof z.view !== "string") errors.push(`${where}: zoom needs a node and a view`);
    else {
      if (c4Types.get(z.node) !== "system" || !placed.has(z.node)) errors.push(`${where}: zoom.node must be a system node in items`);
      zooms.push({ where, view: z.view });
    }
  }
}

function checkViews(
  views: unknown,
  nodeIds: Set<string>,
  endpoints: Map<string, [string, string]>,
  c4Types: Map<string, string>,
  errors: string[],
): void {
  if (!Array.isArray(views) || views.length < 1 || views.length > 4) return void errors.push("views: 1-4 views required");
  const ids = new Set<string>();
  const c4Levels = new Map<string, unknown>();
  const zooms: { where: string; view: string }[] = [];
  views.forEach((v, i) => {
    const where = `views[${i}]`;
    if (!isObj(v)) return void errors.push(`${where}: must be an object`);
    if (typeof v.id !== "string" || !ID.test(v.id)) errors.push(`${where}: id must match ${ID.source}`);
    else if (ids.has(v.id)) errors.push(`${where}: duplicate id ${v.id}`);
    else ids.add(v.id);
    if (v.title !== undefined && !isText(v.title, 40)) errors.push(`${where}: title must be text (<=40 chars)`);
    switch (v.type) {
      case "structure":
        break;
      case "calltree":
        checkCalltree(v.items, where, nodeIds, errors);
        break;
      case "sequence": {
        const p = v.participants;
        const parts = new Set<string>();
        if (!Array.isArray(p) || p.length < 1 || p.length > 6) errors.push(`${where}: participants must be an array of 1-6 node ids`);
        else
          for (const id of p) {
            if (typeof id !== "string" || !nodeIds.has(id)) errors.push(`${where}: unknown participant ${String(id)}`);
            else if (parts.has(id)) errors.push(`${where}: duplicate participant ${id}`);
            else parts.add(id);
          }
        if (!Array.isArray(v.messages) || v.messages.length < 1 || v.messages.length > 60) {
          errors.push(`${where}: messages must be an array of 1-60 edge ids`);
          break;
        }
        for (const m of v.messages) {
          const ends = typeof m === "string" ? endpoints.get(m) : undefined;
          if (!ends) errors.push(`${where}: unknown edge ${String(m)}`);
          else if (!parts.has(ends[0]) || !parts.has(ends[1])) {
            errors.push(`${where}: edge ${String(m)} has an endpoint that is not a participant`);
          }
        }
        break;
      }
      case "dataflow":
        if (!Array.isArray(v.items) || v.items.length < 2 || v.items.length > 20) {
          errors.push(`${where}: items must be an array of 2-20`);
          break;
        }
        v.items.forEach((it, j) => {
          if (!isObj(it) || typeof it.node !== "string" || !nodeIds.has(it.node) || !isText(it.value, 300)) {
            errors.push(`${where}.items[${j}]: existing node and value (<=300 chars) required`);
          }
        });
        break;
      case "c4":
        checkC4(v, where, nodeIds, c4Types, zooms, errors);
        if (typeof v.id === "string") c4Levels.set(v.id, v.level);
        break;
      default:
        errors.push(`${where}: type must be one of ${VIEW_TYPES.join(", ")}`);
    }
  });
  for (const z of zooms) {
    if (c4Levels.get(z.view) !== "container") errors.push(`${z.where}: zoom.view must be the id of a container c4 view`);
  }
}

function checkList(x: unknown, name: string, max: number, errors: string[], each: (item: unknown, where: string) => void): void {
  if (x === undefined) return;
  if (!Array.isArray(x) || x.length > max) return void errors.push(`${name}: must be an array of at most ${max}`);
  x.forEach((item, i) => each(item, `${name}[${i}]`));
}

function checkExtras(raw: Obj, nodeIds: Set<string>, errors: string[]): void {
  const terms = new Set<string>();
  checkList(raw.glossary, "glossary", 15, errors, (g, where) => {
    if (!isObj(g) || !isText(g.term, 40) || !isText(g.definition, 300)) {
      return void errors.push(`${where}: term (<=40) and definition (<=300) required`);
    }
    if (terms.has(g.term)) errors.push(`${where}: duplicate term ${g.term}`);
    terms.add(g.term);
  });

  if (raw.example !== undefined) {
    const ex = raw.example;
    if (!isObj(ex) || !isText(ex.title, 120)) errors.push("example: title required (<=120 chars)");
    else if (!Array.isArray(ex.trace) || ex.trace.length < 1 || ex.trace.length > 12) errors.push("example: trace must be an array of 1-12");
    else
      ex.trace.forEach((t, i) => {
        if (!isObj(t) || typeof t.node !== "string" || !nodeIds.has(t.node) || !isText(t.text, 300)) {
          errors.push(`example.trace[${i}]: existing node and text (<=300 chars) required`);
        }
      });
  }

  checkList(raw.openQuestions, "openQuestions", 8, errors, (q, where) => {
    if (!isObj(q) || !isText(q.question, 200) || !isText(q.answer, 1500)) {
      errors.push(`${where}: question (<=200) and answer (<=1500) required`);
    }
  });

  const perNode = new Map<string, number>();
  checkList(raw.checks, "checks", 20, errors, (c, where) => {
    if (!isObj(c) || typeof c.node !== "string" || !nodeIds.has(c.node) || !isText(c.question, 200)) {
      return void errors.push(`${where}: existing node and question (<=200) required`);
    }
    perNode.set(c.node, (perNode.get(c.node) ?? 0) + 1);
    if (perNode.get(c.node) === 3) errors.push(`${where}: at most 2 checks per node (${c.node})`);
    if (!Array.isArray(c.choices) || c.choices.length < 3 || c.choices.length > 4) {
      return void errors.push(`${where}: choices must be an array of 3-4`);
    }
    c.choices.forEach((ch, j) => {
      if (!isObj(ch) || !isText(ch.text, 150) || !isText(ch.why, 300) || (ch.correct !== undefined && ch.correct !== true)) {
        errors.push(`${where}.choices[${j}]: text (<=150), why (<=300) and optional correct: true required`);
      }
    });
    const correct = c.choices.filter(ch => isObj(ch) && ch.correct === true).length;
    if (correct !== 1) errors.push(`${where}: exactly one choice must be correct, found ${correct}`);
  });

  if (raw.explainPrompt !== undefined) {
    const cl = isObj(raw.explainPrompt) ? raw.explainPrompt.checklist : undefined;
    if (!Array.isArray(cl) || cl.length < 1 || cl.length > 8 || !cl.every(c => isText(c, 200))) {
      errors.push("explainPrompt: checklist must be an array of 1-8 texts (<=200 chars each)");
    }
  }
}

export function validate(raw: unknown): { diagram: Diagram } | { errors: string[] } {
  const errors: string[] = [];
  if (!isObj(raw)) return { errors: ["top level must be an object"] };
  if (raw.version !== 2) errors.push("version must be 2");
  if (raw.mode !== undefined && raw.mode !== "explain" && raw.mode !== "plan") errors.push("mode must be explain or plan");
  const isPlan = raw.mode === "plan";
  if (typeof raw.slug !== "string" || !SLUG.test(raw.slug)) errors.push("slug must match [a-z0-9][a-z0-9-]{0,59}");
  if (!isText(raw.title, 200)) errors.push("title required (<=200 chars)");
  if (raw.summary !== undefined && !(typeof raw.summary === "string" && raw.summary.length <= 2000)) {
    errors.push("summary must be a string (<=2000 chars)");
  }

  const hasStructure = Array.isArray(raw.views) && raw.views.some(v => isObj(v) && v.type === "structure");
  const lanes = new Set<string>();
  if (hasStructure || raw.lanes !== undefined) {
    if (!Array.isArray(raw.lanes) || raw.lanes.length < 1 || raw.lanes.length > 8) errors.push("lanes: 1-8 lanes required for a structure view");
    else
      raw.lanes.forEach((l, i) => {
        if (!isObj(l) || typeof l.id !== "string" || !ID.test(l.id) || !isText(l.label, 60)) {
          errors.push(`lanes[${i}]: id and label (<=60 chars) required`);
        } else if (lanes.has(l.id)) errors.push(`lanes[${i}]: duplicate id ${l.id}`);
        else lanes.add(l.id);
      });
  }

  const kinds = new Map<string, Kind>();
  const claim = (id: unknown, where: string): id is string => {
    if (typeof id !== "string" || !ID.test(id)) {
      errors.push(`${where}: id must match ${ID.source}`);
      return false;
    }
    if (kinds.has(id)) {
      errors.push(`${where}: duplicate id ${id}`);
      return false;
    }
    return true;
  };

  const cells = new Set<string>();
  const c4Types = new Map<string, string>();
  if (!Array.isArray(raw.nodes) || raw.nodes.length < 1 || raw.nodes.length > 60) errors.push("nodes: 1-60 nodes required");
  else
    raw.nodes.forEach((n, i) => {
      const where = `nodes[${i}]`;
      if (!isObj(n)) return void errors.push(`${where}: must be an object`);
      const kind = checkElement(n, where, errors);
      if (claim(n.id, where) && kind) kinds.set(n.id, kind);
      if (hasStructure || n.lane !== undefined || n.order !== undefined) {
        if (typeof n.lane !== "string" || !lanes.has(n.lane)) errors.push(`${where}: unknown lane`);
        if (!isInt(n.order, 0, 49)) errors.push(`${where}: order must be 0-49`);
        const cell = `${n.lane}/${n.order}`;
        if (cells.has(cell)) errors.push(`${where}: another node already sits at lane ${n.lane} order ${n.order}`);
        cells.add(cell);
      }
      if (!isText(n.label, 120)) errors.push(`${where}: label required (<=120 chars)`);
      if (n.sub !== undefined && !isText(n.sub, 24)) errors.push(`${where}: sub must be text (<=24 chars)`);
      if (n.c4 !== undefined) {
        const c = n.c4;
        if (!isObj(c) || !C4_TYPES.includes(c.type as never) || (c.tech !== undefined && !isText(c.tech, 40))) {
          errors.push(`${where}: c4 needs a type (${C4_TYPES.join(", ")}) and an optional tech (<=40 chars)`);
        } else if (typeof n.id === "string") c4Types.set(n.id, c.type as string);
      }
      checkCard(n.card, typeof n.id === "string" ? `${where} (${n.id})` : where, errors);
      if (n.deepDive !== undefined) {
        const dd = n.deepDive;
        if (!isPlan) errors.push(`${where}: deepDive requires mode "plan"`);
        else if (!isObj(dd) || !isText(dd.category, 60) || !isText(dd.why, 1500)) {
          errors.push(`${where}: deepDive needs a category and why (<=1500 chars)`);
        }
      }
    });

  const nodeIds = new Set(kinds.keys());
  const endpoints = new Map<string, [string, string]>();
  if (raw.edges !== undefined && (!Array.isArray(raw.edges) || raw.edges.length > 120)) errors.push("edges: at most 120");
  else
    for (const [i, e] of ((raw.edges as unknown[]) ?? []).entries()) {
      const where = `edges[${i}]`;
      if (!isObj(e)) {
        errors.push(`${where}: must be an object`);
        continue;
      }
      const ok = claim(e.id, where);
      if (typeof e.from !== "string" || !nodeIds.has(e.from)) errors.push(`${where}: unknown from`);
      if (typeof e.to !== "string" || !nodeIds.has(e.to)) errors.push(`${where}: unknown to`);
      if (e.from === e.to) errors.push(`${where}: from and to must differ`);
      if (!isText(e.data, 80)) errors.push(`${where}: data label required (<=80 chars)`);
      if (e.tech !== undefined && !isText(e.tech, 40)) errors.push(`${where}: tech must be text (<=40 chars)`);
      const kind = checkElement(e, where, errors);
      if (ok && kind) {
        kinds.set(e.id as string, kind);
        endpoints.set(e.id as string, [e.from as string, e.to as string]);
      }
    }

  if (raw.boundaries !== undefined) {
    if (!isPlan) errors.push('boundaries: requires mode "plan"');
    else if (!Array.isArray(raw.boundaries) || raw.boundaries.length > 30) errors.push("boundaries: at most 30");
    else
      raw.boundaries.forEach((b, i) => {
        if (!isObj(b) || !isText(b.label, 120) || !isText(b.reason, 500)) {
          errors.push(`boundaries[${i}]: label (<=120) and reason (<=500) required`);
        }
      });
  }

  if (raw.recall !== undefined) {
    if (!Array.isArray(raw.recall) || raw.recall.length < 1 || raw.recall.length > 3) errors.push("recall: must be an array of 1-3 items");
    else
      raw.recall.forEach((r, i) => {
        if (!isObj(r) || !isText(r.question, 200) || !isText(r.answer, 1500)) {
          errors.push(`recall[${i}]: question (<=200) and answer (<=1500) required`);
        }
      });
  }

  checkViews(raw.views, nodeIds, endpoints, c4Types, errors);
  checkExtras(raw, nodeIds, errors);

  if (raw.scenarios !== undefined) {
    if (isPlan) errors.push('scenarios: not allowed in mode "plan"');
    if (Array.isArray(raw.steps) && raw.steps.length > 0) errors.push("scenarios: cannot be combined with steps");
  }
  if (raw.state !== undefined && raw.scenarios === undefined) errors.push("state: requires scenarios");
  const stateKeys = checkState(raw.state, errors);
  const usedByScenario = checkScenarios(raw.scenarios, kinds, endpoints, stateKeys, errors);

  // An invalid steps value skips the replay: its "never added" noise would only bury the real error.
  if (raw.steps !== undefined && (!Array.isArray(raw.steps) || raw.steps.length > 30)) errors.push("steps: at most 30 steps");
  else checkSteps((raw.steps as unknown[]) ?? [], kinds, endpoints, usedByScenario, errors);

  if (errors.length > 0) return { errors };
  const withKind = (x: unknown) => ({ ...(x as Obj), kind: (x as Obj).kind ?? "existing" });
  return {
    diagram: {
      ...raw,
      mode: isPlan ? "plan" : "explain",
      summary: raw.summary ?? "",
      lanes: raw.lanes ?? [],
      nodes: (raw.nodes as unknown[]).map(withKind),
      edges: ((raw.edges as unknown[]) ?? []).map(withKind),
      steps: raw.steps ?? [],
      scenarios: raw.scenarios ?? [],
      state: raw.state ?? [],
      boundaries: raw.boundaries ?? [],
      recall: raw.recall ?? [],
      glossary: raw.glossary ?? [],
      openQuestions: raw.openQuestions ?? [],
      checks: raw.checks ?? [],
    } as unknown as Diagram,
  };
}

function excerptLines(excerpt: string): string[] {
  const lines = excerpt.split(/\r?\n/).map(l => l.trimEnd());
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  return lines;
}

function matchesAt(source: string[], want: string[], start: number): boolean {
  return want.every((l, k) => source[start + k] === l);
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  // Not startsWith(".."): a file literally named "..foo" is inside the root.
  return rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith("../");
}

export function checkRefs(diagram: Diagram, root: string): RefCheck[] {
  const rootReal = realpathSync(root);
  const sources = new Map<string, string[] | "missing" | "outside">();
  const load = (file: string) => {
    const cached = sources.get(file);
    if (cached !== undefined) return cached;
    let result: string[] | "missing" | "outside";
    const target = resolve(rootReal, file);
    if (!within(rootReal, target)) result = "outside";
    else {
      try {
        // realpath after the lexical check: a symlink inside the repo can still point out of it.
        const real = realpathSync(target);
        if (!within(rootReal, real)) result = "outside";
        else if (!statSync(real).isFile() || statSync(real).size > MAX_SOURCE_BYTES) result = "missing";
        else result = readFileSync(real, "utf8").split(/\r?\n/).map(l => l.trimEnd());
      } catch {
        result = "missing";
      }
    }
    sources.set(file, result);
    return result;
  };

  const elements: { id: string; ref?: Ref }[] = [...diagram.nodes, ...diagram.edges];
  return elements.flatMap(({ id, ref }) => {
    if (!ref) return [];
    const base = { id, file: ref.file, line: ref.line };
    const source = load(ref.file);
    if (typeof source === "string") return [{ ...base, status: source }];
    const want = excerptLines(ref.excerpt);
    if (matchesAt(source, want, ref.line - 1)) return [{ ...base, status: "ok" as const }];
    for (let i = 0; i + want.length <= source.length; i++) {
      if (matchesAt(source, want, i)) return [{ ...base, status: "moved" as const, foundAt: i + 1 }];
    }
    return [{ ...base, status: "mismatch" as const }];
  });
}

// \u escapes keep the payload from closing the <script> element or being
// parsed as HTML, whatever the repo's code excerpts contain. The separators are
// built from char codes: a literal U+2028 in a regex literal is a syntax error.
export function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replaceAll(String.fromCharCode(0x2028), "\\u2028")
    .replaceAll(String.fromCharCode(0x2029), "\\u2029");
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function renderHtml(diagram: Diagram, checks: RefCheck[], template: string, layouts: Layouts = {}): string {
  for (const marker of ["__DATA__", "__TITLE__"]) {
    if (template.split(marker).length !== 2) throw new Error(`template must contain ${marker} exactly once`);
  }
  const fill: Record<string, string> = {
    __DATA__: embedJson({ diagram, checks, layouts }),
    __TITLE__: escapeHtml(diagram.title),
  };
  // One pass with a function replacer: a string replacement would expand $& and $' found in the
  // payload, and sequential split/join would rescan inserted text for the next marker (a title
  // of "__DATA__" would receive the payload).
  return template.replace(/__DATA__|__TITLE__/g, m => fill[m]);
}

export function outputPath(
  slug: string,
  env: Record<string, string | undefined> = process.env,
  dirName = "diagram-explain",
): string {
  return join(env.TMPDIR || tmpdir(), dirName, slug, "index.html");
}

export type MainOptions = {
  extraValidate?: (raw: unknown, errors: string[]) => void;
  defaultMode?: Mode;
  outDirName?: string;
};

const USAGE = "usage: render.ts <diagram.json> [--root <dir>] [--out <path>]";

// null: the flag is present without a usable value.
function takeFlag(args: string[], name: string): string | undefined | null {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  if (!value || value.startsWith("--")) return null;
  args.splice(at, 2);
  return value;
}

export async function main(argv: string[], log = console.log, fail = console.error, opts: MainOptions = {}): Promise<number> {
  const args = [...argv];
  const root = takeFlag(args, "--root");
  const outFlag = takeFlag(args, "--out");
  if (root === null || outFlag === null || args.length !== 1) return fail(USAGE), 2;

  let raw: unknown;
  try {
    if (statSync(args[0]).size > MAX_JSON_BYTES) return fail(`diagram.json is over ${MAX_JSON_BYTES} bytes`), 1;
    raw = JSON.parse(readFileSync(args[0], "utf8"));
  } catch (err) {
    return fail(`cannot read diagram.json: ${String(err)}`), 1;
  }
  if (opts.defaultMode && isObj(raw) && raw.mode === undefined) raw = { ...raw, mode: opts.defaultMode };

  const result = validate(raw);
  const errors = "errors" in result ? [...result.errors] : [];
  opts.extraValidate?.(raw, errors);
  if ("errors" in result || errors.length > 0) {
    return fail(["invalid diagram.json; no HTML written:", ...errors.map(e => `- ${e}`)].join("\n")), 1;
  }

  const { diagram } = result;
  let checks: RefCheck[] = [];
  if ([...diagram.nodes, ...diagram.edges].some(x => x.ref)) {
    const rootDir = root ?? process.cwd();
    try {
      checks = checkRefs(diagram, rootDir);
    } catch (err) {
      return fail(`cannot read repo root ${rootDir}: ${String(err)}`), 1;
    }
  }
  let layouts: Layouts;
  try {
    layouts = await layoutViews(diagram);
  } catch (err) {
    return fail(`cannot lay out the diagram: ${String(err)}`), 1;
  }
  const html = renderHtml(diagram, checks, template, layouts);
  const out = outFlag ?? outputPath(diagram.slug, process.env, opts.outDirName);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);

  const bad = checks.filter(c => c.status !== "ok");
  log(out);
  if (checks.length > 0) log(`refs: ${checks.length - bad.length}/${checks.length} ok`);
  for (const c of bad) {
    log(`${c.status.toUpperCase()} ${c.id} ${c.file}:${c.line}${c.foundAt ? ` (found at line ${c.foundAt})` : ""}`);
  }
  return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
