"use client";

import { useCallback, useState } from "react";
import { Panel, useReactFlow } from "@xyflow/react";
import { useStore } from "zustand";
import { useErdStore, undoErd, redoErd } from "@/store/useErdStore";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useUIStore } from "@/store/useUIStore";
import { useProjectStore } from "@/store/useProjectStore";
import { layoutErd } from "@/lib/erd/layout";
import { HistoryPanel } from "@/components/projects/HistoryPanel";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl+";

function ToolButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="h-8 px-2.5 rounded-md flex items-center gap-1.5 text-[12px] font-medium text-foreground hover:bg-foreground/[0.05] disabled:opacity-35 disabled:hover:bg-transparent transition-colors"
    >
      {children}
    </button>
  );
}

const NEW_TABLE = { width: 280, height: 110 };
const GAP = 24;

/** Nearest spot to `start` where a new table doesn't overlap an existing one. */
function findFreeSpot(start: { x: number; y: number }): { x: number; y: number } {
  const rects = useCanvasStore.getState().nodes.map((node) => ({
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? 280,
    height: node.measured?.height ?? 200,
  }));
  const fits = (x: number, y: number) =>
    rects.every(
      (r) =>
        x + NEW_TABLE.width + GAP <= r.x ||
        x >= r.x + r.width + GAP ||
        y + NEW_TABLE.height + GAP <= r.y ||
        y >= r.y + r.height + GAP
    );
  const STEP = 40;
  for (let ring = 0; ring <= 30; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = start.x + dx * STEP;
        const y = start.y + dy * STEP;
        if (fits(x, y)) return { x, y };
      }
    }
  }
  return start;
}

/** Editing toolbar, rendered inside <ReactFlow>. */
export function CanvasToolbar({ disabled }: { disabled: boolean }) {
  const { screenToFlowPosition } = useReactFlow();
  const canUndo = useStore(useErdStore.temporal, (state) => state.pastStates.length > 0);
  const canRedo = useStore(useErdStore.temporal, (state) => state.futureStates.length > 0);
  const hasTables = useErdStore((state) => (state.erd?.tables.length ?? 0) > 0);
  const [tidying, setTidying] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const handleAddTable = useCallback(() => {
    const pane = document.querySelector(".react-flow")?.getBoundingClientRect();
    const center = pane
      ? screenToFlowPosition({ x: pane.left + pane.width / 2, y: pane.top + pane.height / 2 })
      : { x: 0, y: 0 };
    const tableId = useErdStore.getState().addTable(findFreeSpot({ x: center.x - 140, y: center.y - 60 }));
    if (tableId) {
      useCanvasStore.getState().selectNode(tableId);
      useCanvasStore.getState().requestFocus(tableId);
      useUIStore.getState().openInspector();
    }
  }, [screenToFlowPosition]);

  const handleTidy = useCallback(async () => {
    const erd = useErdStore.getState().erd;
    if (!erd) return;
    setTidying(true);
    try {
      const measured = Object.fromEntries(
        useCanvasStore
          .getState()
          .nodes.filter((n) => n.measured?.width && n.measured?.height)
          .map((n) => [n.id, { width: n.measured!.width!, height: n.measured!.height! }])
      );
      const positions = await layoutErd(erd, measured);
      useErdStore.getState().setPositions(positions);
      useCanvasStore.getState().requestFit();
    } finally {
      setTidying(false);
    }
  }, []);

  return (
    <Panel position="top-left" className="!m-3">
      <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface/95 backdrop-blur px-1 py-1 shadow-sm">
        <ToolButton onClick={handleAddTable} disabled={disabled} title="Add table">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeWidth={2} d="M12 5v14M5 12h14" />
          </svg>
          Table
        </ToolButton>
        <span className="w-px h-5 bg-border mx-1" />
        <ToolButton onClick={undoErd} disabled={disabled || !canUndo} title={`Undo (${mod}Z)`}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11" />
          </svg>
        </ToolButton>
        <ToolButton onClick={redoErd} disabled={disabled || !canRedo} title={`Redo (${mod}${isMac ? "⇧Z" : "Y"})`}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13" />
          </svg>
        </ToolButton>
        <span className="w-px h-5 bg-border mx-1" />
        <ToolButton onClick={() => void handleTidy()} disabled={disabled || !hasTables || tidying} title="Tidy up layout">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5h6v5H4zM14 14h6v5h-6zM14 5h6v5h-6zM10 7.5h4M17 10v4" />
          </svg>
          {tidying ? "Arranging…" : "Tidy up"}
        </ToolButton>
        <ToolButton
          onClick={() => {
            useProjectStore.getState().setCurrentBuildStep(0);
            useProjectStore.getState().setIsPlaying(true);
          }}
          disabled={disabled || !hasTables}
          title="Replay how this schema is built"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M6.3 4.2A1 1 0 004.8 5v10a1 1 0 001.5.8l8-5a1 1 0 000-1.6l-8-5z" />
          </svg>
          Replay
        </ToolButton>
        <span className="w-px h-5 bg-border mx-1" />
        <ToolButton onClick={() => setHistoryOpen(!historyOpen)} disabled={disabled} title="Version history">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 2M3.05 11a9 9 0 11.5 4M3 4v5h5" />
          </svg>
          History
        </ToolButton>
      </div>
      {historyOpen && !disabled && <HistoryPanel onClose={() => setHistoryOpen(false)} />}
    </Panel>
  );
}
