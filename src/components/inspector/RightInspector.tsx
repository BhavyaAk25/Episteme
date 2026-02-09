"use client";

import { useCanvasStore } from "@/store/useCanvasStore";
import { useUIStore } from "@/store/useUIStore";
import { motion, AnimatePresence } from "framer-motion";
import { StatusTag, ConfidenceBadge } from "@/components/shared/StatusTag";
import type { ERDNodeData, ERDEdgeData } from "@/types/erd";

export function RightInspector() {
  const { nodes, edges, selectedNodeId, selectedEdgeId } = useCanvasStore();
  const { inspectorOpen, closeInspector, inspectorWidth } = useUIStore();

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId);

  const nodeData = selectedNode?.data as ERDNodeData | undefined;
  const edgeData = selectedEdge?.data as ERDEdgeData | undefined;

  return (
    <AnimatePresence>
      {inspectorOpen && (selectedNode || selectedEdge) && (
        <motion.div
          initial={{ x: inspectorWidth, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: inspectorWidth, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="h-full bg-surface border-l border-border flex flex-col overflow-hidden shadow-sm"
          style={{ width: inspectorWidth }}
          >
          {/* Header */}
          <div className="relative p-5 border-b border-border flex items-center">
            <h2
              className={`absolute left-1/2 -translate-x-1/2 font-bold text-foreground pointer-events-none ${
                selectedNode ? "text-[18px]" : "text-[16px] whitespace-nowrap"
              }`}
            >
              {selectedNode ? "Table Details" : "Relationship Details"}
            </h2>
            <button
              onClick={closeInspector}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[rgba(0,0,0,0.05)] transition-colors z-10"
            >
              <svg
                className="w-5 h-5 text-muted"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {nodeData && (
              <div>
                {/* Table name and status */}
                <div className="mb-4">
                  <h3 className="text-[16px] font-semibold text-foreground text-center">
                    {nodeData.tableName}
                  </h3>
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <StatusTag status={nodeData.status} />
                    <ConfidenceBadge confidence={nodeData.confidence} />
                  </div>
                </div>

                {/* Columns */}
                <div>
                  <div className="h-8" />
                  <div className="-mx-5 border-t border-border/70" />
                  <div className="h-0" />
                  <h4 className="ui-section-title text-center">
                    Columns ({nodeData.columns.length})
                  </h4>
                  <div className="mt-5 space-y-2 pb-2">
                    {nodeData.columns.map((col, idx) => (
                      <div
                        key={col.name}
                        className={`flex items-center justify-between pl-4 pr-16 py-3 rounded-xl ${
                          idx % 2 === 0 ? "bg-[rgba(0,0,0,0.02)]" : ""
                        }`}
                      >
                        <div className="flex flex-1 items-center gap-2 min-w-0 pr-4">
                          {col.isPrimaryKey && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#FFF8E1] text-[#D4A017]">
                              PK
                            </span>
                          )}
                          {col.isForeignKey && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#E3F2FD] text-[#4A9EFF]">
                              FK
                            </span>
                          )}
                          <span className="text-[13px] text-foreground truncate">
                            {col.name}
                          </span>
                        </div>
                        <div className="flex items-center justify-end gap-2 min-w-[156px] shrink-0">
                          <span className="text-[12px] text-[#8B7355] whitespace-nowrap text-right">
                            {col.dataType}
                          </span>
                          {!col.nullable && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[rgba(0,0,0,0.05)] text-[#8B7355]">
                              NOT NULL
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Constraints */}
                {nodeData.constraints.length > 0 && (
                  <div>
                    <div className="h-10" />
                    <div className="-mx-5 border-t border-border/70" />
                    <div className="h-0" />
                    <h4 className="ui-section-title text-center">
                      Constraints ({nodeData.constraints.length})
                    </h4>
                    <div className="mt-5 space-y-3 pb-2">
                      {nodeData.constraints.map((constraint, idx) => (
                        <div
                          key={idx}
                          className="px-4 py-3 rounded-xl text-[13px] bg-[rgba(0,0,0,0.02)] whitespace-normal break-words leading-[1.4]"
                        >
                          <span
                            className={
                              constraint.type === "PRIMARY_KEY"
                                ? "text-[#D4A017] font-semibold"
                                : constraint.type === "FOREIGN_KEY"
                                ? "text-[#4A9EFF] font-semibold"
                                : constraint.type === "UNIQUE"
                                ? "text-[#7B1FA2] font-semibold"
                                : "text-success font-semibold"
                            }
                          >
                            {constraint.type}
                          </span>
                          <span className="text-[#8B7355] ml-2">
                            ({constraint.columns.join(", ")})
                          </span>
                          {constraint.expression && (
                            <div className="text-[12px] text-[#8B7355] mt-2">
                              {constraint.expression}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Indexes */}
                {nodeData.indexes.length > 0 && (
                  <div>
                    <div className="h-10" />
                    <div className="-mx-5 border-t border-border/70" />
                    <div className="h-0" />
                    <h4 className="ui-section-title text-center">
                      Indexes ({nodeData.indexes.length})
                    </h4>
                    <div className="mt-5 space-y-3 pb-2">
                      {nodeData.indexes.map((index) => (
                        <div
                          key={index.name}
                          className="px-4 py-3 rounded-xl text-[13px] bg-[rgba(0,0,0,0.02)] whitespace-normal break-words leading-[1.4]"
                        >
                          <span className="text-accent">{index.name}</span>
                          <span className="text-[#8B7355] ml-2">
                            ({index.columns.join(", ")})
                          </span>
                          {index.unique && (
                            <span className="text-[#7B1FA2] ml-2 text-[11px] font-semibold">UNIQUE</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {edgeData && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-[16px] font-mono font-semibold text-foreground text-center break-words">
                    {edgeData.fromColumn} → {edgeData.toColumn}
                  </h3>
                </div>

                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_auto] items-center pl-6 pr-[56px] py-2.5 rounded-lg bg-[rgba(0,0,0,0.02)]">
                    <span className="min-w-0 truncate text-[13px] text-[#8B7355] pr-3">Cardinality</span>
                    <span className="justify-self-end mr-2 whitespace-nowrap font-mono text-[13px] text-foreground">
                      {edgeData.cardinality}
                    </span>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] items-center pl-6 pr-[56px] py-2.5 rounded-lg">
                    <span className="min-w-0 truncate text-[13px] text-[#8B7355] pr-3">Required</span>
                    <span className="justify-self-end mr-2 whitespace-nowrap font-mono text-[13px] text-foreground">
                      {edgeData.required ? "Yes" : "No"}
                    </span>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] items-center pl-6 pr-[56px] py-2.5 rounded-lg bg-[rgba(0,0,0,0.02)]">
                    <span className="min-w-0 truncate text-[13px] text-[#8B7355] pr-3">On Delete</span>
                    <span className="justify-self-end mr-2 whitespace-nowrap font-mono text-[13px] text-foreground">
                      {edgeData.onDelete}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
