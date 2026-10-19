"use client";

import { useMemo } from "react";
import { Panel } from "@xyflow/react";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useErdStore } from "@/store/useErdStore";
import { TABLE_COLORS, TABLE_COLOR_NAMES } from "@/lib/erd/colors";
import { duplicateTables } from "@/lib/actions/clipboard";

type Align = "left" | "top" | "hcenter" | "vcenter" | "hdistribute" | "vdistribute";

/** Actions for several selected tables: align, distribute, color, duplicate, delete. */
export function SelectionBar() {
  // Select the stable nodes array, then derive (a fresh array from the selector would re-render forever).
  const nodes = useCanvasStore((state) => state.nodes);
  const selected = useMemo(() => nodes.filter((n) => n.selected), [nodes]);
  if (selected.length < 2) return null;

  const ids = selected.map((n) => n.id);
  const size = (n: (typeof selected)[number]) => ({ w: n.measured?.width ?? 280, h: n.measured?.height ?? 160 });

  const align = (mode: Align) => {
    const positions: Record<string, { x: number; y: number }> = {};
    if (mode === "left") {
      const x = Math.min(...selected.map((n) => n.position.x));
      selected.forEach((n) => (positions[n.id] = { x, y: n.position.y }));
    } else if (mode === "top") {
      const y = Math.min(...selected.map((n) => n.position.y));
      selected.forEach((n) => (positions[n.id] = { x: n.position.x, y }));
    } else if (mode === "hcenter") {
      const center = selected.reduce((sum, n) => sum + n.position.y + size(n).h / 2, 0) / selected.length;
      selected.forEach((n) => (positions[n.id] = { x: n.position.x, y: Math.round(center - size(n).h / 2) }));
    } else if (mode === "vcenter") {
      const center = selected.reduce((sum, n) => sum + n.position.x + size(n).w / 2, 0) / selected.length;
      selected.forEach((n) => (positions[n.id] = { x: Math.round(center - size(n).w / 2), y: n.position.y }));
    } else if (mode === "hdistribute") {
      const sorted = [...selected].sort((a, b) => a.position.x - b.position.x);
      const total = sorted.reduce((sum, n) => sum + size(n).w, 0);
      const span = sorted[sorted.length - 1].position.x + size(sorted[sorted.length - 1]).w - sorted[0].position.x;
      const gap = Math.max(24, (span - total) / (sorted.length - 1));
      let x = sorted[0].position.x;
      sorted.forEach((n) => {
        positions[n.id] = { x: Math.round(x), y: n.position.y };
        x += size(n).w + gap;
      });
    } else {
      const sorted = [...selected].sort((a, b) => a.position.y - b.position.y);
      const total = sorted.reduce((sum, n) => sum + size(n).h, 0);
      const span = sorted[sorted.length - 1].position.y + size(sorted[sorted.length - 1]).h - sorted[0].position.y;
      const gap = Math.max(24, (span - total) / (sorted.length - 1));
      let y = sorted[0].position.y;
      sorted.forEach((n) => {
        positions[n.id] = { x: n.position.x, y: Math.round(y) };
        y += size(n).h + gap;
      });
    }
    useErdStore.getState().setPositions(positions);
  };

  const button = "h-7 px-2 rounded-md text-[12px] text-foreground hover:bg-foreground/[0.06]";
  return (
    <Panel position="bottom-center" className="!mb-4 @max-[1040px]:!mb-20">
      <div role="toolbar" aria-label="Selected tables" className="flex items-center gap-1 rounded-lg border border-border bg-surface/95 backdrop-blur px-2 py-1 shadow-md">
        <span className="px-1 text-[12px] font-medium text-foreground">{selected.length} tables</span>
        <span className="w-px h-5 bg-border mx-1" />
        <button className={button} onClick={() => align("left")} title="Align left edges">Align left</button>
        <button className={button} onClick={() => align("top")} title="Align top edges">Align top</button>
        <button className={button} onClick={() => align("hcenter")} title="Line up in a row">Row</button>
        <button className={button} onClick={() => align("vcenter")} title="Line up in a column">Column</button>
        <button className={button} onClick={() => align("hdistribute")} title="Space evenly left to right">↔ Space</button>
        <button className={button} onClick={() => align("vdistribute")} title="Space evenly top to bottom">↕ Space</button>
        <span className="w-px h-5 bg-border mx-1" />
        {TABLE_COLOR_NAMES.map((color) => (
          <button
            key={color}
            onClick={() => useErdStore.getState().setTableColor(ids, color)}
            title={`Color: ${color}`}
            aria-label={`Color ${color}`}
            className="w-4 h-4 rounded-full border border-border"
            style={{ background: TABLE_COLORS[color] }}
          />
        ))}
        <button className={button} onClick={() => useErdStore.getState().setTableColor(ids, null)} title="Remove color">None</button>
        <span className="w-px h-5 bg-border mx-1" />
        <button className={button} onClick={() => duplicateTables(ids)} title="Duplicate (⌘D)">Duplicate</button>
        <button
          className="h-7 px-2 rounded-md text-[12px] text-error hover:bg-error/10"
          onClick={() => {
            useErdStore.getState().deleteTables(ids);
            useCanvasStore.getState().selectNode(null);
          }}
          title="Delete selected tables"
        >
          Delete
        </button>
      </div>
    </Panel>
  );
}
