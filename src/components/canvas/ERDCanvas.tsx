"use client";

import { useCallback, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useUIStore } from "@/store/useUIStore";
import { useProjectStore } from "@/store/useProjectStore";
import { CanvasLoadingSkeleton } from "@/components/shared/LoadingStates";
import { ERDTableNode } from "./ERDTableNode";
import { ERDRelationEdge } from "./ERDRelationEdge";
import type { ERDEdgeData } from "@/types/erd";

const nodeTypes = {
  erdTable: ERDTableNode,
};

const edgeTypes = {
  erdRelation: ERDRelationEdge,
};

export function ERDCanvas() {
  const {
    nodes,
    edges,
    selectedNodeId,
    selectedEdgeId,
    onNodesChange,
    onEdgesChange,
    selectNode,
    selectEdge,
    setViewport,
    addEdge: addEdgeToStore,
    setEdges,
  } = useCanvasStore();

  const { openInspector } = useUIStore();
  const { isGenerating, buildScript } = useProjectStore();
  const hasReplayScript = Boolean(buildScript && buildScript.steps.length > 0);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      selectNode(node.id);
      openInspector();
    },
    [selectNode, openInspector]
  );

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_, edge) => {
      selectEdge(edge.id);
      openInspector();
    },
    [selectEdge, openInspector]
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
    selectEdge(null);
  }, [selectNode, selectEdge]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const edgeId = `user-edge-${connection.source}-${connection.target}-${Date.now()}`;
      addEdgeToStore({
        id: edgeId,
        type: "erdRelation",
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
        data: {
          cardinality: "1:N" as const,
          required: false,
          onDelete: "RESTRICT" as const,
          fromColumn: "",
          toColumn: "",
          edgeSource: "user" as const,
        } satisfies ERDEdgeData,
      });
    },
    [addEdgeToStore]
  );

  // Delete selected edge on Backspace/Delete
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Backspace" || e.key === "Delete") {
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        if (selectedEdgeId) {
          setEdges(edges.filter((edge) => edge.id !== selectedEdgeId));
          selectEdge(null);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedEdgeId, edges, setEdges, selectEdge]);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onConnect={onConnect}
        onViewportChange={setViewport}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionLineStyle={{ stroke: "var(--accent-blue)", strokeWidth: 2 }}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{
          type: "erdRelation",
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="rgba(0,0,0,0.06)"
        />
        <Controls
          position="bottom-right"
          showInteractive={false}
        />
        {nodes.length > 1 && (
          <MiniMap
            position="bottom-left"
            pannable
            zoomable
            nodeColor={() => "#D4C5A9"}
            nodeStrokeColor={(node) =>
              node.id === selectedNodeId ? "var(--accent-blue)" : "var(--border)"
            }
            nodeBorderRadius={4}
            maskColor="rgba(244, 233, 215, 0.65)"
            style={{
              width: 176,
              height: 112,
            }}
          />
        )}
      </ReactFlow>

      {/* Empty state */}
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none dotted-grid-bg">
          {isGenerating ? (
            <CanvasLoadingSkeleton />
          ) : (
            <div className="text-center">
              <div className="flex items-center justify-center gap-4 mb-3">
                <div className="w-16 h-16 rounded-2xl bg-surface border border-border flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-muted"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
                    />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-foreground">
                  {hasReplayScript ? "Replay ready" : "No schema yet"}
                </h3>
              </div>
              <p className="text-[13px] text-muted max-w-[360px] mx-auto leading-[1.5]">
                {hasReplayScript
                  ? "Press Play to watch the schema build animation, or click Generate to produce a new system."
                  : "Describe your system in the prompt bar above and click Generate to create your database schema."}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
