// Only the part of the ELK JSON graph format that layout.ts reads or writes.
export interface ElkLabel {
  id?: string;
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}
export interface ElkPoint {
  x: number;
  y: number;
}
export interface ElkSection {
  startPoint: ElkPoint;
  endPoint: ElkPoint;
  bendPoints?: ElkPoint[];
}
export interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  labels?: ElkLabel[];
  sections?: ElkSection[];
}
export interface ElkNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: ElkNode[];
  edges?: ElkEdge[];
  layoutOptions?: Record<string, string>;
}
declare class ELK {
  constructor();
  layout(graph: ElkNode): Promise<ElkNode>;
}
export default ELK;
