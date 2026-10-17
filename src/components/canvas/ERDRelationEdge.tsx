"use client";

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
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
  const isSelected = selected || selectedEdgeId === id;
  const tone = isSelected ? "selected" : "default";

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
          strokeWidth: isSelected ? 2 : 1.5,
          strokeDasharray: edgeData?.required ? undefined : "6 4",
        }}
      />
      {isSelected && edgeData && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
            }}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-white/95 text-[#6B5A3E] border border-[rgba(0,0,0,0.08)] shadow-sm"
          >
            {edgeData.fromColumn} → {edgeData.toColumn} · ON DELETE {edgeData.onDelete.replace("_", " ")}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const ERDRelationEdge = memo(ERDRelationEdgeComponent);
