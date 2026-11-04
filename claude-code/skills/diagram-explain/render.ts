#!/usr/bin/env bun
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, isAbsolute, join, relative, resolve } from "path";
// Not read at run time next to import.meta.url: in the `bun build --compile` binary that is the
// virtual /$bunfs root, so the files must be embedded.
import template from "./template.html" with { type: "text" };

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
export type DiagramNode = {
  id: string;
  lane: string;
  order: number;
  label: string;
  kind: Kind;
  ref?: Ref;
  deepDive?: { category: string; why: string };
};
export type DiagramEdge = { id: string; from: string; to: string; data: string; kind: Kind; ref?: Ref };
export type Step = { title: string; description: string; changes: Record<string, (typeof CHANGES)[number]> };
export type Diagram = {
  version: 1;
  mode: Mode;
  slug: string;
  title: string;
  summary: string;
  lanes: { id: string; label: string }[];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  steps: Step[];
  boundaries: { label: string; reason: string }[];
  recall: { question: string; answer: string }[];
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
  errors: string[],
): void {
  const present = new Map([...kinds].map(([id, kind]) => [id, kind === "existing"]));
  const added = new Set<string>();
  steps.forEach((s, i) => {
    const where = `steps[${i}]`;
    if (!isObj(s)) return void errors.push(`${where}: must be an object`);
    if (!isText(s.title, 120)) errors.push(`${where}: title required (<=120 chars)`);
    if (!isText(s.description, 1000)) errors.push(`${where}: description required (<=1000 chars)`);
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
    if (kind === "proposed" && !added.has(id)) errors.push(`proposed ${id} is never added in a step`);
  }
}

export function validate(raw: unknown): { diagram: Diagram } | { errors: string[] } {
  const errors: string[] = [];
  if (!isObj(raw)) return { errors: ["top level must be an object"] };
  if (raw.version !== 1) errors.push("version must be 1");
  if (raw.mode !== undefined && raw.mode !== "explain" && raw.mode !== "plan") errors.push("mode must be explain or plan");
  const isPlan = raw.mode === "plan";
  if (typeof raw.slug !== "string" || !SLUG.test(raw.slug)) errors.push("slug must match [a-z0-9][a-z0-9-]{0,59}");
  if (!isText(raw.title, 200)) errors.push("title required (<=200 chars)");
  if (raw.summary !== undefined && !(typeof raw.summary === "string" && raw.summary.length <= 2000)) {
    errors.push("summary must be a string (<=2000 chars)");
  }

  const lanes = new Set<string>();
  if (!Array.isArray(raw.lanes) || raw.lanes.length < 1 || raw.lanes.length > 8) errors.push("lanes: 1-8 lanes required");
  else
    raw.lanes.forEach((l, i) => {
      if (!isObj(l) || typeof l.id !== "string" || !ID.test(l.id) || !isText(l.label, 60)) {
        errors.push(`lanes[${i}]: id and label (<=60 chars) required`);
      } else if (lanes.has(l.id)) errors.push(`lanes[${i}]: duplicate id ${l.id}`);
      else lanes.add(l.id);
    });

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
  if (!Array.isArray(raw.nodes) || raw.nodes.length < 1 || raw.nodes.length > 60) errors.push("nodes: 1-60 nodes required");
  else
    raw.nodes.forEach((n, i) => {
      const where = `nodes[${i}]`;
      if (!isObj(n)) return void errors.push(`${where}: must be an object`);
      const kind = checkElement(n, where, errors);
      if (claim(n.id, where) && kind) kinds.set(n.id, kind);
      if (typeof n.lane !== "string" || !lanes.has(n.lane)) errors.push(`${where}: unknown lane`);
      if (!isInt(n.order, 0, 49)) errors.push(`${where}: order must be 0-49`);
      const cell = `${n.lane}/${n.order}`;
      if (cells.has(cell)) errors.push(`${where}: another node already sits at lane ${n.lane} order ${n.order}`);
      cells.add(cell);
      if (!isText(n.label, 120)) errors.push(`${where}: label required (<=120 chars)`);
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
    if (!Array.isArray(raw.recall) || raw.recall.length < 1 || raw.recall.length > 8) errors.push("recall: must be an array of 1-8 items");
    else
      raw.recall.forEach((r, i) => {
        if (!isObj(r) || !isText(r.question, 200) || !isText(r.answer, 1500)) {
          errors.push(`recall[${i}]: question (<=200) and answer (<=1500) required`);
        }
      });
  }

  // An invalid steps value skips the replay: its "never added" noise would only bury the real error.
  if (raw.steps !== undefined && (!Array.isArray(raw.steps) || raw.steps.length > 30)) errors.push("steps: at most 30 steps");
  else checkSteps((raw.steps as unknown[]) ?? [], kinds, endpoints, errors);

  if (errors.length > 0) return { errors };
  const withKind = (x: unknown) => ({ ...(x as Obj), kind: (x as Obj).kind ?? "existing" });
  return {
    diagram: {
      ...raw,
      mode: isPlan ? "plan" : "explain",
      summary: raw.summary ?? "",
      nodes: (raw.nodes as unknown[]).map(withKind),
      edges: ((raw.edges as unknown[]) ?? []).map(withKind),
      steps: raw.steps ?? [],
      boundaries: raw.boundaries ?? [],
      recall: raw.recall ?? [],
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

export function renderHtml(diagram: Diagram, checks: RefCheck[], template: string): string {
  for (const marker of ["__DATA__", "__TITLE__"]) {
    if (template.split(marker).length !== 2) throw new Error(`template must contain ${marker} exactly once`);
  }
  const fill: Record<string, string> = {
    __DATA__: embedJson({ diagram, checks }),
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

export function main(argv: string[], log = console.log, fail = console.error, opts: MainOptions = {}): number {
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
  const html = renderHtml(diagram, checks, template);
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

if (import.meta.main) process.exit(main(process.argv.slice(2)));
