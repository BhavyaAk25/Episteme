"use client";

import { useCallback, useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  ConnectionMode,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type Connection,
  type OnNodeDrag,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useUIStore } from "@/store/useUIStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useErdStore, undoErd, redoErd } from "@/store/useErdStore";
import { useReplayView } from "@/lib/erd/useReplayView";
import { useAiEditStore } from "@/store/useAiEditStore";
import { AiEditBar } from "./AiEditBar";
import { erdToNodes, erdToEdges, parseColumnHandleId } from "@/lib/ontology/transformer";
import { ERDTableNode } from "./ERDTableNode";
import { ERDRelationEdge } from "./ERDRelationEdge";
import { CanvasAutoFit, CANVAS_FIT_OPTIONS } from "./CanvasAutoFit";
import { CanvasToolbar } from "./CanvasToolbar";
import { CrowsFootMarkers } from "./CrowsFootMarkers";
import { EditorToast } from "./EditorToast";
import type { ERDNodeData } from "@/types/erd";

const nodeTypes = { erdTable: ERDTableNode };
const edgeTypes = { erdRelation: ERDRelationEdge };

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
}

export function ERDCanvas() {
  const { viewErd, locked: replaying, previewing } = useReplayView();
  const savedPositions = useErdStore((state) => state.positions);
  const previewPositions = useAiEditStore((state) => state.previewPositions);
  const diff = useAiEditStore((state) => state.diff);
  const positions = useMemo(
    () => (previewing ? { ...savedPositions, ...previewPositions } : savedPositions),
    [previewing, savedPositions, previewPositions]
  );
  const ontology = useProjectStore((state) => state.ontology);
  const isGenerating = useProjectStore((state) => state.isGenerating);
  const generationError = useProjectStore((state) => state.generationError);
  const { nodes, selectedNodeId, selectedEdgeId, onNodesChange, setNodes, selectNode, selectEdge, setViewport } =
    useCanvasStore();
  const { openInspector } = useUIStore();

  // Rebuild React Flow nodes whenever the ERD (or its layout) changes, keeping
  // what React Flow already knows about each node (measured size, selection).
  useEffect(() => {
    const fresh = viewErd ? erdToNodes(viewErd, ontology, positions) : [];
    const { nodes: previous, selectedNodeId: selectedId } = useCanvasStore.getState();
    const previousById = new Map(previous.map((node) => [node.id, node]));
    const added = new Set(previewing ? diff.addedTableIds : []);
    const changed = new Set(previewing ? diff.changedTableIds : []);
    setNodes(
      fresh.map((node) => ({
        ...node,
        data: { ...node.data, diff: added.has(node.id) ? "added" : changed.has(node.id) ? "changed" : undefined },
        measured: previousById.get(node.id)?.measured,
        selected: node.id === selectedId,
        draggable: !replaying,
      }))
    );
  }, [viewErd, ontology, positions, replaying, previewing, diff, setNodes]);

  // Edges follow live node positions so each end attaches to the facing side.
  const edges = useMemo(() => {
    if (!viewErd) return [];
    const livePositions = Object.fromEntries(nodes.map((node) => [node.id, node.position]));
    const widths = Object.fromEntries(nodes.map((node) => [node.id, node.measured?.width ?? 280]));
    return erdToEdges(viewErd, livePositions, widths).map((edge) => ({
      ...edge,
      selected: edge.id === selectedEdgeId,
    }));
  }, [viewErd, nodes, selectedEdgeId]);

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

  // Commit dragged positions as one undoable step.
  const onNodeDragStop: OnNodeDrag<Node<ERDNodeData>> = useCallback((_, __, draggedNodes) => {
    useErdStore
      .getState()
      .setPositions(Object.fromEntries(draggedNodes.map((node) => [node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) }])));
  }, []);

  // Drag from a column to another table's key: create a foreign key.
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const relationshipId = useErdStore.getState().addRelationship({
        fromTableId: connection.source,
        toTableId: connection.target,
        fromColumn: parseColumnHandleId(connection.sourceHandle),
        toColumn: parseColumnHandleId(connection.targetHandle),
      });
      if (relationshipId) {
        selectEdge(relationshipId);
        openInspector();
      }
    },
    [selectEdge, openInspector]
  );

  // Delete, undo and redo shortcuts.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (replaying || isTypingTarget(event.target)) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redoErd();
        else undoErd();
        return;
      }
      if (mod && key === "y") {
        event.preventDefault();
        redoErd();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        const { selectedEdgeId: edgeId, selectedNodeId: nodeId } = useCanvasStore.getState();
        if (edgeId) {
          event.preventDefault();
          useErdStore.getState().deleteRelationship(edgeId);
          selectEdge(null);
        } else if (nodeId) {
          event.preventDefault();
          useErdStore.getState().deleteTable(nodeId);
          selectNode(null);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [replaying, selectEdge, selectNode]);

  const hasSchema = Boolean(viewErd);
  const showEmptyState = !isGenerating && !generationError && nodes.length === 0 && !replaying;

  return (
    <div className="w-full h-full">
      <CrowsFootMarkers />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onViewportChange={setViewport}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        nodesConnectable={!replaying}
        deleteKeyCode={null}
        connectionLineStyle={{ stroke: "var(--accent-blue)", strokeWidth: 2 }}
        fitView
        fitViewOptions={CANVAS_FIT_OPTIONS}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <CanvasAutoFit />
        {hasSchema && <CanvasToolbar disabled={replaying} />}
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(0,0,0,0.06)" />
        <Controls position="bottom-right" showInteractive={false} />
        {nodes.length > 1 && (
          <MiniMap
            position="bottom-left"
            pannable
            zoomable
            nodeColor={() => "#D4C5A9"}
            nodeStrokeColor={(node) => (node.id === selectedNodeId ? "var(--accent-blue)" : "var(--border)")}
            nodeBorderRadius={4}
            maskColor="rgba(244, 233, 215, 0.65)"
            style={{ width: 176, height: 112 }}
          />
        )}
      </ReactFlow>

      <EditorToast />
      {hasSchema && <AiEditBar />}

      {showEmptyState && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none dotted-grid-bg">
          <div className="text-center max-w-[400px] px-6">
            <div className="mx-auto mb-3 w-14 h-14 rounded-2xl bg-surface border border-border flex items-center justify-center">
              <svg className="w-7 h-7 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
                />
              </svg>
            </div>
            {hasSchema ? (
              <>
                <h3 className="text-[16px] font-semibold text-foreground">Empty schema</h3>
                <p className="mt-1 text-[13px] text-muted">Use <strong>+ Table</strong> in the toolbar to add your first table.</p>
              </>
            ) : (
              <>
                <h3 className="text-[16px] font-semibold text-foreground">Design a database</h3>
                <p className="mt-1 text-[13px] text-muted">
                  Describe your system in the bar above and press Generate, pick a template on the left, or start from scratch.
                </p>
                <button
                  onClick={() => useErdStore.getState().startBlank()}
                  className="ui-ghost-btn mt-4 pointer-events-auto"
                >
                  Start with a blank canvas
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
