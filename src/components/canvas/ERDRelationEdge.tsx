"use client";

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useStore, type EdgeProps } from "@xyflow/react";
import type { ERDEdgeData } from "@/types/erd";
import { useCanvasStore } from "@/store/useCanvasStore";
import { MARKER_COLORS, markerId, type EndKind } from "./CrowsFootMarkers";

/**
 * Edge from the FK column (source, the child) to the referenced column
 * (target, the parent), drawn in crow's-foot notation:
 * - parent end: exactly one if the FK is NOT NULL, otherwise zero-or-one
 * - child end: zero-or-many for 1:N, zero-or-one for 1:1
 */
function endKinds(data: ERDEdgeData | undefined): { source: EndKind; target: EndKind } {
  const cardinality = data?.cardinality ?? "1:N";
  if (cardinality === "M:N") return { source: "many-optional", target: "many-optional" };
  return {
    source: cardinality === "1:1" ? "one-optional" : "many-optional",
    target: data?.required ? "one-mandatory" : "one-optional",
  };
}

const words = (name: string) => name.replace(/_/g, " ");
const singular = (name: string) =>
  words(name.endsWith("ies") ? `${name.slice(0, -3)}y` : /(ss|x|ch|sh)es$/.test(name) ? name.slice(0, -2) : name.endsWith("s") && !name.endsWith("ss") ? name.slice(0, -1) : name);

/** "Each order has one customer; deleting a customer is blocked while orders point to it." */
function describeRelationship(data: ERDEdgeData): string {
  const child = data.fromTable!;
  const parent = data.toTable!;
  const has =
    data.fromTable === data.toTable
      ? `Each ${singular(child)} can point to another ${singular(child)}`
      : data.cardinality === "1:1"
        ? `Each ${singular(parent)} has at most one ${singular(child)}`
        : `Each ${singular(child)} ${data.required ? "has one" : "may have one"} ${singular(parent)}`;
  const onDelete =
    data.onDelete === "CASCADE"
      ? `deleting a ${singular(parent)} also deletes its ${words(child)}`
      : data.onDelete === "SET_NULL"
        ? `deleting a ${singular(parent)} clears the link`
        : `deleting a ${singular(parent)} is blocked while ${words(child)} point to it`;
  return `${has}; ${onDelete}.`;
}

/** Readable at any zoom: counter-scales when the diagram is zoomed out. */
function EdgeLabel({ data, x, y }: { data: ERDEdgeData; x: number; y: number }) {
  const zoom = useStore((state) => state.transform[2]);
  const scale = Math.min(2.2, Math.max(1, 1 / zoom));
  return (
    <EdgeLabelRenderer>
      <div
        style={{
          position: "absolute",
          // Just above the line, and above the tables (which would cover it).
          transform: `translate(${x}px, ${y}px) scale(${scale}) translate(-50%, calc(-100% - 8px))`,
          transformOrigin: "0 0",
          pointerEvents: "none",
          zIndex: 1001,
        }}
        className="w-max max-w-[300px] px-2.5 py-1.5 rounded-md bg-elevated border border-foreground/[0.12] shadow-lg"
      >
        <span className="block font-mono text-[10px] text-muted">
          {data.fromTable ? `${data.fromTable}.` : ""}
          {data.fromColumn} → {data.toTable ? `${data.toTable}.` : ""}
          {data.toColumn}
        </span>
        {data.fromTable && data.toTable && <span className="block text-[11px] leading-snug text-foreground">{describeRelationship(data)}</span>}
      </div>
    </EdgeLabelRenderer>
  );
}

function ERDRelationEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const edgeData = data as ERDEdgeData | undefined;
  const selectedEdgeId = useCanvasStore((state) => state.selectedEdgeId);
  const hovered = useCanvasStore((state) => state.hoveredEdgeId === id);
  const isSelected = selected || selectedEdgeId === id;
  const hot = isSelected || hovered;
  const tone = hot ? "selected" : "default";

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 10,
    offset: 28,
  });

  const kinds = endKinds(edgeData);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerStart={`url(#${markerId(kinds.source, tone)})`}
        markerEnd={`url(#${markerId(kinds.target, tone)})`}
        interactionWidth={16}
        style={{
          stroke: MARKER_COLORS[tone],
          strokeWidth: hot ? 2 : 1.5,
          strokeDasharray: edgeData?.required ? undefined : "6 4",
        }}
      />
      {hot && edgeData && <EdgeLabel data={edgeData} x={labelX} y={labelY} />}
    </>
  );
}

export const ERDRelationEdge = memo(ERDRelationEdgeComponent);
