"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ERDNodeData } from "@/types/erd";
import { columnHandleId } from "@/lib/ontology/transformer";

const KeyIcon = () => (
  <svg className="w-3 h-3 text-warning" fill="currentColor" viewBox="0 0 20 20" aria-label="Primary key">
    <path
      fillRule="evenodd"
      d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2 1 1 0 102 0 4 4 0 00-4-4z"
      clipRule="evenodd"
    />
  </svg>
);

const LinkIcon = () => (
  <svg className="w-3 h-3 text-accent" fill="currentColor" viewBox="0 0 20 20" aria-label="Foreign key">
    <path
      fillRule="evenodd"
      d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z"
      clipRule="evenodd"
    />
  </svg>
);

// Every column has a connection point on both sides. Drag from a column to
// another table's key to create a foreign key.
const handleClass = "erd-handle !w-2.5 !h-2.5 !min-w-0 !min-h-0 !bg-elevated !border-[1.5px] !border-accent";

function ERDTableNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as ERDNodeData;
  const unique = new Set(nodeData.uniqueColumns ?? []);
  const footerConstraints = nodeData.constraints.filter(
    (c) => c.type === "CHECK" || (c.type === "UNIQUE" && c.columns.length > 1)
  );

  const statusColor = {
    active: "bg-success",
    experimental: "bg-warning",
    deprecated: "bg-error",
  }[nodeData.status];

  return (
    <div
      className={`erd-node relative bg-node rounded-[10px] min-w-[280px] border-[1.5px] transition-shadow ${
        nodeData.diff === "added"
          ? "border-success shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent-green)_22%,transparent)]"
          : nodeData.diff === "changed"
            ? "border-warning shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent-amber)_22%,transparent)]"
            : selected
              ? "border-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent-blue)_22%,transparent)]"
              : "border-foreground/[0.12] hover:border-foreground/[0.22] shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
      }`}
    >
      {nodeData.diff && (
        <span
          className={`absolute -top-2.5 right-3 px-1.5 py-px rounded text-[10px] font-semibold text-white ${
            nodeData.diff === "added" ? "bg-success" : "bg-warning"
          }`}
        >
          {nodeData.diff === "added" ? "New" : "Changed"}
        </span>
      )}
      <div
        className="rounded-t-[9px] px-3.5 py-2.5 border-b border-foreground/[0.08] flex items-center gap-2"
        style={{ background: "linear-gradient(135deg, var(--node-header-from) 0%, var(--node-header-to) 100%)" }}
      >
        <span className={`w-2 h-2 rounded-full ${statusColor} shrink-0`} title={`Status: ${nodeData.status}`} />
        <span className="font-mono font-bold text-foreground text-[13px] tracking-tight truncate">
          {nodeData.tableName}
        </span>
        <span className="ml-auto text-[10px] text-muted font-mono">{nodeData.columns.length} cols</span>
      </div>

      <div className="py-1">
        {nodeData.columns.length === 0 && (
          <div className="px-3.5 py-1.5 text-[11px] text-muted italic">No columns</div>
        )}
        {nodeData.columns.map((col) => (
          <div key={col.name} className="relative flex items-center gap-2 px-3.5 py-[5px] hover:bg-node-header/50">
            <Handle type="source" position={Position.Left} id={columnHandleId(col.name, "L")} className={handleClass} />
            <span className="w-4 h-4 flex items-center justify-center shrink-0">
              {col.isPrimaryKey ? <KeyIcon /> : col.isForeignKey ? <LinkIcon /> : null}
            </span>
            <span className={`text-[12px] font-mono flex-1 truncate ${col.isPrimaryKey ? "font-semibold text-foreground" : "text-foreground"}`}>
              {col.name}
            </span>
            {unique.has(col.name) && !col.isPrimaryKey && (
              <span className="text-[9px] font-mono font-semibold text-purple" title="Unique">UQ</span>
            )}
            <span className="text-[11px] font-mono text-muted">{col.dataType}</span>
            <span className="w-2 text-[10px] text-error font-semibold" title={col.nullable ? "Nullable" : "NOT NULL"}>
              {col.nullable ? "" : "*"}
            </span>
            <Handle type="source" position={Position.Right} id={columnHandleId(col.name, "R")} className={handleClass} />
          </div>
        ))}
      </div>

      {footerConstraints.length > 0 && (
        <div className="px-3.5 py-1.5 border-t border-foreground/[0.06] bg-foreground/[0.02] space-y-1 rounded-b-[9px]">
          {footerConstraints.slice(0, 3).map((constraint, idx) => (
            <div key={idx} className="flex items-center gap-1.5 text-[10px] text-muted">
              <span
                className={`inline-flex items-center rounded px-1 py-px font-mono font-semibold ${
                  constraint.type === "CHECK" ? "bg-warning/15 text-warning" : "bg-purple/15 text-purple"
                }`}
              >
                {constraint.type === "CHECK" ? "CK" : "UQ"}
              </span>
              <span className="truncate font-mono">
                {constraint.type === "CHECK" ? constraint.expression : `(${constraint.columns.join(", ")})`}
              </span>
            </div>
          ))}
          {footerConstraints.length > 3 && (
            <div className="text-[10px] text-muted">+{footerConstraints.length - 3} more</div>
          )}
        </div>
      )}
    </div>
  );
}

export const ERDTableNode = memo(ERDTableNodeComponent);
