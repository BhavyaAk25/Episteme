"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ERDNodeData } from "@/types/erd";
import { useCanvasStore } from "@/store/useCanvasStore";

function ERDTableNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ERDNodeData;
  const { selectedNodeId } = useCanvasStore();
  const isSelected = selected || selectedNodeId === id;

  const getColumnIcon = (col: ERDNodeData["columns"][0]) => {
    if (col.isPrimaryKey) return { icon: "key", color: "text-[#D4A017]" };
    if (col.isForeignKey) return { icon: "link", color: "text-[#4A9EFF]" };
    return null;
  };

  const statusColor = {
    active: "bg-success",
    experimental: "bg-warning",
    deprecated: "bg-error",
  }[nodeData.status];

  const confidenceConfig = {
    high: {
      badgeDot: "bg-success",
      glow: "0 0 0 1px rgba(74, 222, 128, 0.22), 0 4px 12px rgba(74, 222, 128, 0.08)",
    },
    medium: {
      badgeDot: "bg-warning",
      glow: "0 0 0 1px rgba(251, 191, 36, 0.2), 0 4px 12px rgba(251, 191, 36, 0.08)",
    },
    low: {
      badgeDot: "bg-error",
      glow: "0 0 0 1px rgba(248, 113, 113, 0.2), 0 4px 12px rgba(248, 113, 113, 0.08)",
    },
  }[nodeData.confidence];

  return (
    <div
      className={`bg-node rounded-[10px] transition-all min-w-[280px] ${
        isSelected
          ? "border-[1.5px] border-[#B8976A] shadow-[0_0_0_2px_rgba(184,151,106,0.3)]"
          : "border-[1.5px] border-[rgba(0,0,0,0.12)] hover:border-[rgba(0,0,0,0.18)]"
      }`}
      style={!isSelected ? { boxShadow: `${confidenceConfig.glow}, 0 2px 8px rgba(0,0,0,0.06)` } : undefined}
    >
      {/* Table Header */}
      <div
        className="rounded-t-[10px] px-[14px] py-[10px] border-b border-[rgba(0,0,0,0.08)] flex items-center gap-2"
        style={{ background: "linear-gradient(135deg, #f6ebde 0%, #f0e1cc 100%)" }}
      >
        <span className={`w-2 h-2 rounded-full ${statusColor} shrink-0`} />
        <span className="font-mono font-bold text-foreground text-[13px] tracking-tight truncate">
          {nodeData.tableName}
        </span>
        <span className="ml-auto" title={`Confidence: ${nodeData.confidence}`}>
          <span className={`inline-block w-2 h-2 rounded-full ${confidenceConfig.badgeDot}`} />
        </span>
      </div>

      {/* Columns */}
      <div className="py-1.5">
        {nodeData.columns.map((col) => {
          const iconData = getColumnIcon(col);
          return (
            <div
              key={col.name}
              className="flex items-center gap-2 px-[14px] py-1 hover:bg-node-header/40 group"
            >
              {/* Icon or spacer */}
              <div className="w-4 h-4 flex items-center justify-center shrink-0">
                {iconData?.icon === "key" && (
                  <svg
                    className={`w-3 h-3 ${iconData.color}`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2 1 1 0 102 0 4 4 0 00-4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
                {iconData?.icon === "link" && (
                  <svg
                    className={`w-3 h-3 ${iconData.color}`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>

              {/* Column name */}
              <span className="text-[12px] font-mono text-foreground flex-1 truncate">
                {col.name}
              </span>

              {/* Data type — right-aligned, muted */}
              <span className="text-[12px] font-mono text-[#8B7355]">
                {col.dataType}
              </span>

              {/* Nullable indicator */}
              {!col.nullable && (
                <span className="text-[10px] text-error font-medium">*</span>
              )}

              {/* Handles for FK columns */}
              {col.isForeignKey && (
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`${col.name}-source`}
                  className="!w-2 !h-2 !bg-accent !border-0"
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Constraints section */}
      {nodeData.constraints.filter((c) => c.type !== "PRIMARY_KEY" && c.type !== "NOT_NULL").length > 0 && (
        <div className="px-[14px] py-1.5 border-t border-[rgba(0,0,0,0.06)] bg-[rgba(0,0,0,0.02)] space-y-1">
          {nodeData.constraints
            .filter((c) => c.type !== "PRIMARY_KEY" && c.type !== "NOT_NULL")
            .slice(0, 3)
            .map((constraint, idx) => (
              <div
                key={idx}
                className="flex items-center gap-1.5 text-[11px] text-muted"
              >
                {constraint.type === "UNIQUE" && (
                  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-[#E3F2FD] text-[#1565C0]">UQ</span>
                )}
                {constraint.type === "CHECK" && (
                  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-[#FFF8E1] text-[#F57F17]">CK</span>
                )}
                {constraint.type === "FOREIGN_KEY" && (
                  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-[#F3E5F5] text-[#7B1FA2]">FK</span>
                )}
                <span className="truncate font-mono text-[10px]">
                  ({constraint.columns.join(", ")})
                  {constraint.expression && ` ${constraint.expression}`}
                </span>
              </div>
            ))}
        </div>
      )}

      {/* Connection handles */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-surface !border-2 !border-accent"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-surface !border-2 !border-accent"
      />
    </div>
  );
}

export const ERDTableNode = memo(ERDTableNodeComponent);
