"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
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
import { copyTables, type TableClipboard } from "@/lib/erd/model";
import { duplicateTables, selectPasted } from "@/lib/actions/clipboard";
import { ERDTableNode } from "./ERDTableNode";
import { ERDRelationEdge } from "./ERDRelationEdge";
import { CanvasAutoFit, CANVAS_FIT_OPTIONS } from "./CanvasAutoFit";
import { CanvasToolbar } from "./CanvasToolbar";
import { SelectionBar } from "./SelectionBar";
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

const FOCUS_MIN_TABLES = 12;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

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

  const nodeSignatures = useRef(new Map<string, string>());

  // Big schemas: when a table is selected, fade everything it isn't linked
  // to, so its neighbourhood is readable. Done in CSS so no node re-renders.
  const focusCss = useMemo(() => {
    if (!viewErd || viewErd.tables.length <= FOCUS_MIN_TABLES || !selectedNodeId) return "";
    const table = viewErd.tables.find((t) => t.id === selectedNodeId);
    if (!table) return "";
    const rels = viewErd.relationships.filter((r) => r.fromTable === table.name || r.toTable === table.name);
    const names = new Set([table.name, ...rels.flatMap((r) => [r.fromTable, r.toTable])]);
    const nodeIds = viewErd.tables.filter((t) => names.has(t.name)).map((t) => t.id);
    const ids = [...nodeIds, ...rels.map((r) => r.id)];
    if (!ids.every((id) => SAFE_ID.test(id))) return "";
    const not = (list: string[]) => list.map((id) => `:not([data-id="${id}"])`).join("");
    return (
      `.erd-focus .react-flow__node${not(nodeIds)}{opacity:.25}` +
      `.erd-focus .react-flow__edge${not(rels.map((r) => r.id))}{opacity:.12}`
    );
  }, [viewErd, selectedNodeId]);

  // Rebuild React Flow nodes whenever the ERD (or its layout) changes, keeping
  // what React Flow already knows about each node (measured size, selection).
  useEffect(() => {
    const fresh = viewErd ? erdToNodes(viewErd, ontology, positions) : [];
    const { nodes: previous, selectedNodeId: selectedId } = useCanvasStore.getState();
    const previousById = new Map(previous.map((node) => [node.id, node]));
    const added = new Set(previewing ? diff.addedTableIds : []);
    const changed = new Set(previewing ? diff.changedTableIds : []);
    const signatures = nodeSignatures.current;
    const nextSignatures = new Map<string, string>();
    setNodes(
      fresh.map((node) => {
        const data = { ...node.data, diff: added.has(node.id) ? ("added" as const) : changed.has(node.id) ? ("changed" as const) : undefined };
        const prev = previousById.get(node.id);
        // On big schemas most tables are untouched by an edit: keep their node
        // object so React Flow (and the memoized node) skip re-rendering them.
        const signature = `${node.position.x},${node.position.y},${replaying}|${JSON.stringify(data)}`;
        nextSignatures.set(node.id, signature);
        if (prev && signatures.get(node.id) === signature) return prev;
        return {
          ...node,
          data,
          measured: prev?.measured,
          // Keep multi-selection across edits; fall back to the inspected table.
          selected: prev?.selected ?? node.id === selectedId,
          draggable: !replaying,
        };
      })
    );
    nodeSignatures.current = nextSignatures;
  }, [viewErd, ontology, positions, replaying, previewing, diff, setNodes]);

  // Edges follow live node positions so each end attaches to the facing side.
  const detail = useUIStore((state) => state.nodeDetail);
  const edges = useMemo(() => {
    if (!viewErd) return [];
    const livePositions = Object.fromEntries(nodes.map((node) => [node.id, node.position]));
    const widths = Object.fromEntries(nodes.map((node) => [node.id, node.measured?.width ?? 280]));
    const visible = (column: { isPrimaryKey: boolean; isForeignKey: boolean }) =>
      detail === "full" ? true : detail === "keys" ? column.isPrimaryKey || column.isForeignKey : false;
    return erdToEdges(viewErd, livePositions, widths, visible).map((edge) => ({
      ...edge,
      selected: edge.id === selectedEdgeId,
    }));
  }, [viewErd, nodes, selectedEdgeId, detail]);

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
      const selectedIds = useCanvasStore.getState().nodes.filter((n) => n.selected).map((n) => n.id);
      if (mod && key === "a") {
        event.preventDefault();
        useCanvasStore.getState().setNodes(useCanvasStore.getState().nodes.map((n) => ({ ...n, selected: true })));
        return;
      }
      if (mod && key === "d") {
        const ids = selectedIds.length ? selectedIds : [useCanvasStore.getState().selectedNodeId].filter(Boolean) as string[];
        if (ids.length === 0) return;
        event.preventDefault();
        duplicateTables(ids);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        const { selectedEdgeId: edgeId, selectedNodeId: nodeId } = useCanvasStore.getState();
        if (edgeId) {
          event.preventDefault();
          useErdStore.getState().deleteRelationship(edgeId);
          selectEdge(null);
        } else if (selectedIds.length > 1) {
          event.preventDefault();
          useErdStore.getState().deleteTables(selectedIds);
          selectNode(null);
        } else if (nodeId || selectedIds.length === 1) {
          event.preventDefault();
          useErdStore.getState().deleteTable(nodeId ?? selectedIds[0]);
          selectNode(null);
        }
      }
    };
    const onCopy = (event: ClipboardEvent) => {
      if (replaying || isTypingTarget(event.target)) return;
      const ids = useCanvasStore.getState().nodes.filter((n) => n.selected).map((n) => n.id);
      const erd = useErdStore.getState().erd;
      if (!erd || ids.length === 0 || !event.clipboardData) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", JSON.stringify({ episteme: "tables", ...copyTables(erd, ids) }));
    };
    const onPaste = (event: ClipboardEvent) => {
      if (replaying || isTypingTarget(event.target)) return;
      const text = event.clipboardData?.getData("text/plain");
      if (!text || !text.includes('"episteme":"tables"')) return;
      try {
        const clip = JSON.parse(text) as TableClipboard & { episteme: string };
        event.preventDefault();
        selectPasted(useErdStore.getState().pasteTables(clip, { x: 48, y: 48 }));
      } catch {
        /* not ours */
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("copy", onCopy);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("paste", onPaste);
    };
  }, [replaying, selectEdge, selectNode]);

  const hasSchema = Boolean(viewErd);
  const showEmptyState = !isGenerating && !generationError && nodes.length === 0 && !replaying;

  return (
    <div className={`w-full h-full ${focusCss ? "erd-focus" : ""}`}>
      {focusCss && <style>{focusCss}</style>}
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
        zoomOnDoubleClick={false}
        nodesConnectable={!replaying}
        deleteKeyCode={null}
        connectionLineStyle={{ stroke: "var(--accent-blue)", strokeWidth: 2 }}
        fitView
        fitViewOptions={CANVAS_FIT_OPTIONS}
        minZoom={0.02}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <CanvasAutoFit />
        {hasSchema && <CanvasToolbar disabled={replaying} />}
        {!replaying && <SelectionBar />}
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--dots)" />
        <Controls position="bottom-right" showInteractive={false} className="@max-[1040px]:!mb-20" />
        {nodes.length >= 4 && (
          <MiniMap
            position="bottom-left"
            pannable
            zoomable
            nodeStrokeColor={(node) => (node.id === selectedNodeId ? "var(--accent-blue)" : "var(--border)")}
            nodeBorderRadius={4}
            className="@max-[720px]:!hidden @max-[1040px]:!mb-20"
            style={{ width: 140, height: 88 }}
          />
        )}
      </ReactFlow>

      <EditorToast />
      {hasSchema && <AiEditBar />}

      {showEmptyState && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none dotted-grid-bg">
          <div className={`text-center px-6 ${hasSchema ? "max-w-[400px]" : "max-w-[640px]"}`}>
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
              <StartOptions />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StartOptions() {
  const options: Array<{ title: string; body: string; action: () => void }> = [
    {
      title: "Describe it",
      body: "Type what you're building in the bar above. The AI drafts tables and relationships.",
      action: () => document.querySelector<HTMLInputElement>('input[aria-label="System description"]')?.focus(),
    },
    {
      title: "Start from a template",
      body: "Inventory, SaaS or e-commerce — a solid starting point you can edit.",
      action: () => {
        const ui = useUIStore.getState();
        if (!ui.sidebarOpen) ui.toggleSidebar();
      },
    },
    {
      title: "Import SQL",
      body: "Paste CREATE TABLE statements or upload a schema dump to see it as a diagram.",
      action: () => useUIStore.getState().setImportOpen(true),
    },
    {
      title: "Blank canvas",
      body: "Add tables and draw foreign keys yourself.",
      action: () => useErdStore.getState().startBlank(),
    },
  ];
  return (
    <>
      <h3 className="text-[18px] font-semibold text-foreground">Design a database</h3>
      <p className="mt-1 text-[13px] text-muted">Pick how you want to start. Everything stays in your browser.</p>
      <div className="mt-5 grid grid-cols-2 gap-2.5 text-left pointer-events-auto">
        {options.map((option) => (
          <button
            key={option.title}
            onClick={option.action}
            className="rounded-xl border border-border bg-surface px-4 py-3 hover:border-accent/50 hover:shadow-sm transition-all"
          >
            <span className="block text-[14px] font-semibold text-foreground">{option.title}</span>
            <span className="mt-0.5 block text-[12px] text-muted leading-snug">{option.body}</span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-[12px] text-muted">
        Press <kbd className="px-1.5 py-px rounded border border-border bg-surface font-mono text-[11px]">?</kbd> for keyboard shortcuts.
      </p>
    </>
  );
}
