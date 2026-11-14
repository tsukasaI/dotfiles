import ELK, { type ElkEdge, type ElkNode } from "./vendor/elk.bundled.js";
import type { Diagram, DiagramEdge, DiagramNode, View } from "./render.ts";

export type Point = { x: number; y: number };
export type NodeBox = { x: number; y: number; w: number; h: number; lines: string[]; kind: string[]; sub: string[] };
export type EdgeRoute = { points: Point[]; label?: { x: number; y: number; w: number; h: number; lines: string[] } };
export type ViewLayout = {
  width: number;
  height: number;
  nodes: Record<string, NodeBox>;
  edges: Record<string, EdgeRoute>;
  boundary?: { x: number; y: number; w: number; h: number };
  headers: { x: number; y: number; text: string }[];
};
export type Layouts = Record<string, { desktop: ViewLayout; phone: ViewLayout }>;

const LINE = 14;
const PAD_X = 8;
const PAD_Y = 8;
const MIN_W = 110;
const MARGIN = 10;
const HEADER_H = 26;
// Not an ID the schema accepts, so it cannot collide with a node or edge id.
const BOUNDARY = "boundary#";

// Phones lay out top to bottom with narrower boxes, replacing the old transposed grid.
const PROFILES = {
  desktop: { direction: "RIGHT", maxW: 200, labelW: 160 },
  phone: { direction: "DOWN", maxW: 150, labelW: 120 },
} as const;
type Profile = (typeof PROFILES)[keyof typeof PROFILES];

const C4_KIND = {
  person: "Person",
  system: "Software System",
  external: "External System",
  container: "Container",
  database: "Container",
  queue: "Container",
} as const;

// The one text measure: full-width 12px, other 7px, matching what the template draws at 12px.
export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += (ch.codePointAt(0) ?? 0) > 255 ? 12 : 7;
  return w;
}

export function wrapText(text: string, maxPx: number): string[] {
  const lines: string[] = [];
  let cur = "";
  let w = 0;
  for (const ch of text) {
    const cw = textWidth(ch);
    if (w + cw > maxPx && cur !== "") {
      lines.push(cur);
      cur = "";
      w = 0;
    }
    cur += ch;
    w += cw;
  }
  if (cur !== "") lines.push(cur);
  return lines.length > 0 ? lines : [""];
}

const kindText = (c4: NonNullable<DiagramNode["c4"]>) => `[${C4_KIND[c4.type]}${c4.tech ? `: ${c4.tech}` : ""}]`;

function sizeNode(n: DiagramNode, maxW: number, zoom: boolean): NodeBox {
  const type = n.c4?.type;
  // A queue's end caps eat 10px on each side; a person's head, a database's lid and the zoom link need height.
  const extraW = type === "queue" ? 20 : 0;
  const extraH = (type === "person" ? 10 : type === "database" ? 8 : 0) + (zoom ? 14 : 0);
  const inner = maxW - 2 * PAD_X - extraW;
  const lines = wrapText(n.label, inner);
  const kind = n.c4 ? wrapText(kindText(n.c4), inner) : [];
  const sub = n.sub ? wrapText(n.sub, inner) : [];
  const widest = Math.max(...[...lines, ...kind, ...sub].map(textWidth));
  return {
    x: 0,
    y: 0,
    w: Math.min(maxW, Math.max(MIN_W, widest + 2 * PAD_X + extraW)),
    h: (lines.length + kind.length + sub.length) * LINE + 2 * PAD_Y + extraH,
    lines,
    kind,
    sub,
  };
}

type LabelBox = { w: number; h: number; lines: string[] };
function sizeLabel(e: DiagramEdge, maxW: number, tech: boolean): LabelBox {
  const lines = wrapText(e.data, maxW);
  if (tech && e.tech) lines.push(`[${e.tech}]`);
  return { w: Math.max(...lines.map(textWidth)), h: lines.length * LINE, lines };
}

type Rect = { x: number; y: number; w: number; h: number };

async function layoutOne(elk: ELK, diagram: Diagram, view: View, profile: Profile): Promise<ViewLayout> {
  const nodeById = new Map(diagram.nodes.map(n => [n.id, n]));
  let ids: string[];
  let partitions: Map<string, number> | undefined;
  let members: Set<string> | undefined;
  let zoomNode: string | undefined;
  if (view.type === "c4") {
    ids = view.items.map(it => it.node);
    if (view.boundary) members = new Set(view.boundary.nodes);
    zoomNode = view.zoom?.node;
  } else {
    const laneIndex = new Map(diagram.lanes.map((l, i) => [l.id, i]));
    const lane = (n: DiagramNode) => laneIndex.get(n.lane ?? "") ?? 0;
    const ordered = [...diagram.nodes].sort((a, b) => lane(a) - lane(b) || (a.order ?? 0) - (b.order ?? 0));
    ids = ordered.map(n => n.id);
    partitions = new Map(ordered.map(n => [n.id, lane(n)]));
  }

  const boxes = new Map<string, NodeBox>();
  for (const id of ids) {
    const node = nodeById.get(id);
    if (!node) throw new Error(`view ${view.id}: unknown node ${id}`);
    boxes.set(id, sizeNode(node, profile.maxW, id === zoomNode));
  }

  const leaf = (id: string): ElkNode => {
    const b = boxes.get(id);
    return {
      id,
      width: b?.w ?? 0,
      height: b?.h ?? 0,
      ...(partitions ? { layoutOptions: { "elk.partitioning.partition": String(partitions.get(id) ?? 0) } } : {}),
    };
  };
  const rootChildren: ElkNode[] = [];
  const rootEdges: ElkEdge[] = [];
  const boundaryChildren: ElkNode[] = [];
  const boundaryEdges: ElkEdge[] = [];
  const boundaryNode: ElkNode | undefined = members && {
    id: BOUNDARY,
    layoutOptions: { "elk.padding": "[top=16,left=16,bottom=30,right=16]" },
    children: boundaryChildren,
    edges: boundaryEdges,
  };
  for (const id of ids) {
    if (boundaryNode && members?.has(id)) {
      if (!rootChildren.includes(boundaryNode)) rootChildren.push(boundaryNode);
      boundaryChildren.push(leaf(id));
    } else rootChildren.push(leaf(id));
  }

  const viewEdges = diagram.edges.filter(e => boxes.has(e.from) && boxes.has(e.to));
  const labels = new Map<string, LabelBox>();
  for (const e of viewEdges) {
    const label = sizeLabel(e, profile.labelW, view.type === "c4");
    labels.set(e.id, label);
    const edge: ElkEdge = { id: e.id, sources: [e.from], targets: [e.to], labels: [{ text: label.lines.join(" "), width: label.w, height: label.h }] };
    // Defined in the lowest common ancestor, so its coordinates are relative to that node.
    (members?.has(e.from) && members.has(e.to) ? boundaryEdges : rootEdges).push(edge);
  }

  const laid = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": profile.direction,
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.spacing.nodeNode": "36",
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",
      "elk.spacing.edgeNode": "24",
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.spacing.edgeLabel": "4",
      "elk.padding": "[top=20,left=20,bottom=20,right=20]",
      ...(partitions ? { "elk.partitioning.activate": "true" } : {}),
    },
    children: rootChildren,
    edges: rootEdges,
  });

  const rects = new Map<string, Rect>();
  const walk = (n: ElkNode, ox: number, oy: number): void => {
    for (const c of n.children ?? []) {
      const x = ox + (c.x ?? 0);
      const y = oy + (c.y ?? 0);
      rects.set(c.id, { x, y, w: c.width ?? 0, h: c.height ?? 0 });
      walk(c, x, y);
    }
  };
  walk(laid, 0, 0);

  const holders: { edges: ElkEdge[]; ox: number; oy: number }[] = [{ edges: laid.edges ?? [], ox: 0, oy: 0 }];
  const boundaryRect = rects.get(BOUNDARY);
  if (boundaryRect) {
    holders.push({ edges: laid.children?.find(c => c.id === BOUNDARY)?.edges ?? [], ox: boundaryRect.x, oy: boundaryRect.y });
  }

  const routes = new Map<string, EdgeRoute>();
  for (const { edges, ox, oy } of holders) {
    for (const e of edges) {
      const s = e.sections?.[0];
      if (!s) continue;
      const points = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map(p => ({ x: p.x + ox, y: p.y + oy }));
      const l = e.labels?.[0];
      const box = labels.get(e.id);
      routes.set(e.id, { points, ...(l && box ? { label: { x: ox + (l.x ?? 0), y: oy + (l.y ?? 0), ...box } } : {}) });
    }
  }
  for (const e of viewEdges) {
    const a = rects.get(e.from);
    const b = rects.get(e.to);
    if (!routes.has(e.id) && a && b) {
      routes.set(e.id, { points: [{ x: a.x + a.w / 2, y: a.y + a.h / 2 }, { x: b.x + b.w / 2, y: b.y + b.h / 2 }] });
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number, w = 0, h = 0): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };
  for (const r of rects.values()) grow(r.x, r.y, r.w, r.h);
  for (const r of routes.values()) {
    for (const p of r.points) grow(p.x, p.y);
    if (r.label) grow(r.label.x, r.label.y, r.label.w, r.label.h);
  }

  const headerH = view.type === "structure" ? HEADER_H : 0;
  const dx = MARGIN - minX;
  const dy = MARGIN - minY + headerH;
  const nodes = new Map<string, NodeBox>();
  for (const id of ids) {
    const r = rects.get(id);
    const b = boxes.get(id);
    if (r && b) nodes.set(id, { ...b, x: Math.round(r.x + dx), y: Math.round(r.y + dy), w: Math.round(r.w), h: Math.round(r.h) });
  }
  const edgeOut = new Map<string, EdgeRoute>();
  for (const [id, r] of routes) {
    edgeOut.set(id, {
      points: r.points.map(p => ({ x: Math.round(p.x + dx), y: Math.round(p.y + dy) })),
      ...(r.label ? { label: { ...r.label, x: Math.round(r.label.x + dx), y: Math.round(r.label.y + dy) } } : {}),
    });
  }

  const headers: ViewLayout["headers"] = [];
  if (view.type === "structure") {
    diagram.lanes.forEach((lane, i) => {
      const own = [...nodes].filter(([id]) => partitions?.get(id) === i).map(([, b]) => b);
      if (own.length === 0) return;
      const x = Math.min(...own.map(b => b.x));
      const y = Math.min(...own.map(b => b.y));
      headers.push(profile.direction === "RIGHT" ? { x, y: 16, text: lane.label } : { x: MARGIN, y: y - 8, text: lane.label });
    });
  }

  const boundary = boundaryRect && {
    x: Math.round(boundaryRect.x + dx),
    y: Math.round(boundaryRect.y + dy),
    w: Math.round(boundaryRect.w),
    h: Math.round(boundaryRect.h),
  };
  return {
    width: Math.round(maxX - minX + 2 * MARGIN),
    height: Math.round(maxY - minY + 2 * MARGIN + headerH),
    nodes: Object.fromEntries(nodes),
    edges: Object.fromEntries(edgeOut),
    ...(boundary ? { boundary } : {}),
    headers,
  };
}

export async function layoutViews(diagram: Diagram): Promise<Layouts> {
  const elk = new ELK();
  const out = new Map<string, Layouts[string]>();
  // Sequential: one ELK instance, and the output order stays the same from run to run.
  for (const view of diagram.views) {
    if (view.type !== "structure" && view.type !== "c4") continue;
    const desktop = await layoutOne(elk, diagram, view, PROFILES.desktop);
    const phone = await layoutOne(elk, diagram, view, PROFILES.phone);
    out.set(view.id, { desktop, phone });
  }
  return Object.fromEntries(out);
}
