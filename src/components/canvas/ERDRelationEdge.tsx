"use client";

import { memo } from "react";
import {
  BaseEdge,
  Position,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import type { ERDEdgeData } from "@/types/erd";
import { useCanvasStore } from "@/store/useCanvasStore";
import { edgeEndLabels } from "@/lib/ontology/cardinality";

/** Place an end label just outside the node, on whichever side the handle is. */
function labelOffsetX(position: Position): number {
  return position === Position.Left ? -13 : 13;
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
  const { selectedEdgeId } = useCanvasStore();
  const isSelected = selected || selectedEdgeId === id;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isUserEdge = edgeData?.edgeSource === "user";

  // Edge styling — warm brown default per spec
  const edgeColor = isSelected
    ? "var(--accent-blue)"
    : isUserEdge
    ? "var(--accent-purple)"
    : "#C4A97D";

  const strokeDasharray = isUserEdge ? "8,4" : edgeData?.required ? undefined : "5,5";

  // Cardinality labels: source = FK-holding table, target = referenced table.
  const { source: sourceLabel, target: targetLabel } = edgeEndLabels(
    edgeData?.cardinality ?? "1:N"
  );

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: edgeColor,
          strokeWidth: isSelected ? 2 : 1.5,
          strokeDasharray,
        }}
      />
      <EdgeLabelRenderer>
        {/* Source cardinality — always visible */}
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${sourceX + labelOffsetX(sourcePosition)}px, ${
              sourceY - 8
            }px)`,
            pointerEvents: "none",
          }}
          className="text-[11px] font-mono font-bold text-[#6B5A3E]"
        >
          {sourceLabel}
        </div>

        {/* Target cardinality — always visible */}
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${targetX + labelOffsetX(targetPosition)}px, ${
              targetY - 8
            }px)`,
            pointerEvents: "none",
          }}
          className="text-[11px] font-mono font-bold text-[#6B5A3E]"
        >
          {targetLabel}
        </div>

        {/* Detail label — shown on selection (React Flow architecture prevents CSS hover on edge labels) */}
        {isSelected && edgeData?.onDelete && edgeData.onDelete !== "NO_ACTION" && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-white/90 text-[#8B7355] border border-[rgba(0,0,0,0.08)] shadow-sm"
          >
            ON DELETE {edgeData.onDelete}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

export const ERDRelationEdge = memo(ERDRelationEdgeComponent);
