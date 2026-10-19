import ELK from "elkjs/lib/elk.bundled.js";
import type { ERD, Table } from "@/types/erd";
import { estimateNodeHeight } from "@/lib/ontology/transformer";

export interface Size {
  width: number;
  height: number;
}

const elk = new ELK();
const LARGE_SCHEMA = 40;

/** Approximate rendered width of a table node (monospace 12px ≈ 7.2px/char). */
export function estimateNodeWidth(table: Table): number {
  const CHAR = 7.2;
  const nameChars = Math.max(table.name.length + 6, ...table.columns.map((c) => c.name.length + c.dataType.length + 6));
  return Math.max(280, Math.ceil(nameChars * CHAR + 48));
}

/**
 * Lay out the ERD with ELK's layered algorithm. Referenced (parent) tables
 * go left, tables that point at them go right, so FK lines run one way.
 * Uses measured node sizes when available, estimates otherwise.
 */
export async function layoutErd(
  erd: ERD,
  measured: Record<string, Size> = {}
): Promise<Record<string, { x: number; y: number }>> {
  if (erd.tables.length === 0) return {};

  const idByName = new Map(erd.tables.map((t) => [t.name, t.id]));

  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "140",
      "elk.spacing.nodeNode": "48",
      "elk.spacing.componentComponent": "90",
      "elk.separateConnectedComponents": "true",
      // Network simplex gives the straightest lines but grows steeply with
      // size (~7s at 100 tables); SIMPLE stays compact and takes ~0.25s.
      "elk.layered.nodePlacement.strategy": erd.tables.length > LARGE_SCHEMA ? "SIMPLE" : "NETWORK_SIMPLEX",
      // Deep chains of tables wrap into rows instead of one long strip.
      ...(erd.tables.length > LARGE_SCHEMA ? { "elk.layered.wrapping.strategy": "MULTI_EDGE", "elk.aspectRatio": "1.6" } : {}),
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.edgeRouting": "ORTHOGONAL",
    },
    children: erd.tables.map((table) => ({
      id: table.id,
      width: measured[table.id]?.width ?? estimateNodeWidth(table),
      height: measured[table.id]?.height ?? estimateNodeHeight(table),
    })),
    edges: erd.relationships
      .filter((r) => r.fromTable !== r.toTable)
      .map((r) => ({
        id: r.id,
        // Parent -> child, so parents land in earlier (left) layers.
        sources: [idByName.get(r.toTable) ?? ""],
        targets: [idByName.get(r.fromTable) ?? ""],
      }))
      .filter((e) => e.sources[0] && e.targets[0]),
  };

  const result = await elk.layout(graph);
  const positions: Record<string, { x: number; y: number }> = {};
  for (const child of result.children ?? []) {
    positions[child.id] = { x: Math.round(child.x ?? 0), y: Math.round(child.y ?? 0) };
  }
  return positions;
}
