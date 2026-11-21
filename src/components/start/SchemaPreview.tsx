"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ERD } from "@/types/erd";

/**
 * A miniature of a real schema, drawn the way the editor draws it: table
 * cards with their first columns and curved crow's-foot lines. A slight
 * tilt settles flat on hover; hovering a table highlights its links.
 */

const CARD_W = 210;
const HEADER = 32;
const ROW = 21;
const MAX_ROWS = 5;
const PAD = 28;

interface Box {
  x: number;
  y: number;
  h: number;
  rows: string[];
}

function cardHeight(columns: number): number {
  const shown = Math.min(columns, MAX_ROWS);
  return HEADER + shown * ROW + (columns > MAX_ROWS ? 18 : 0) + 8;
}

export function SchemaPreview({ erd, onPick, className = "" }: { erd: ERD; onPick?: () => void; className?: string }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }> | null>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [pointerInside, setPointerInside] = useState(false);

  // Lay the tables out with the same engine as the editor's Tidy up.
  useEffect(() => {
    let cancelled = false;
    setPositions(null);
    void import("@/lib/erd/layout").then(({ layoutErd }) =>
      layoutErd(
        erd,
        Object.fromEntries(erd.tables.map((t) => [t.id, { width: CARD_W, height: cardHeight(t.columns.length) }]))
      ).then((p) => {
        if (!cancelled) setPositions(p);
      })
    );
    return () => {
      cancelled = true;
    };
  }, [erd]);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const update = () => setFrame({ w: el.clientWidth, h: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const boxes = useMemo(() => {
    if (!positions) return null;
    const map = new Map<string, Box>();
    for (const table of erd.tables) {
      const p = positions[table.id];
      if (!p) continue;
      map.set(table.name, { x: p.x, y: p.y, h: cardHeight(table.columns.length), rows: table.columns.slice(0, MAX_ROWS).map((c) => c.name) });
    }
    return map;
  }, [positions, erd]);

  const bounds = useMemo(() => {
    if (!boxes || boxes.size === 0) return null;
    const all = [...boxes.values()];
    const minX = Math.min(...all.map((b) => b.x)) - PAD;
    const minY = Math.min(...all.map((b) => b.y)) - PAD;
    const maxX = Math.max(...all.map((b) => b.x + CARD_W)) + PAD;
    const maxY = Math.max(...all.map((b) => b.y + b.h)) + PAD;
    return { minX, minY, w: maxX - minX, h: maxY - minY };
  }, [boxes]);

  // Readable first: never shrink below ~72%; larger schemas are shown as a
  // window onto the middle of the diagram, fading out at the edges.
  const scale = bounds && frame.w ? Math.min(1, Math.max(0.72, Math.min(frame.w / bounds.w, frame.h / bounds.h))) : 0;

  const related = useMemo(() => {
    if (!hovered) return null;
    const set = new Set([hovered]);
    erd.relationships.forEach((r) => {
      if (r.fromTable === hovered) set.add(r.toTable);
      if (r.toTable === hovered) set.add(r.fromTable);
    });
    return set;
  }, [hovered, erd]);

  const edges = useMemo(() => {
    if (!boxes) return [];
    return erd.relationships.flatMap((rel) => {
      const child = boxes.get(rel.fromTable);
      const parent = boxes.get(rel.toTable);
      if (!child || !parent || rel.fromTable === rel.toTable) return [];
      const rowY = (box: Box, column: string) => {
        const index = box.rows.indexOf(column);
        return box.y + (index >= 0 ? HEADER + 4 + index * ROW + ROW / 2 : HEADER / 2);
      };
      const childRight = child.x + CARD_W / 2 > parent.x + CARD_W / 2;
      // Parent on the left: leave from its right edge into the child's left edge.
      const x1 = childRight ? parent.x + CARD_W : parent.x;
      const x2 = childRight ? child.x : child.x + CARD_W;
      const y1 = rowY(parent, rel.toColumn);
      const y2 = rowY(child, rel.fromColumn);
      const bend = Math.max(36, Math.abs(x2 - x1) * 0.45) * (childRight ? 1 : -1);
      return [
        {
          id: rel.id,
          from: rel.fromTable,
          to: rel.toTable,
          optional: !rel.required,
          d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
        },
      ];
    });
  }, [boxes, erd]);

  const tilted = !pointerInside;

  return (
    <div
      ref={frameRef}
      className={`overflow-hidden ${className || "relative"}`}
      style={{
        maskImage: "radial-gradient(ellipse 80% 78% at 50% 50%, #000 62%, transparent 100%)",
        WebkitMaskImage: "radial-gradient(ellipse 80% 78% at 50% 50%, #000 62%, transparent 100%)",
      }}
      onPointerEnter={() => setPointerInside(true)}
      onPointerLeave={() => {
        setPointerInside(false);
        setHovered(null);
      }}
    >
      {bounds && scale > 0 && (
        <button
          type="button"
          onClick={onPick}
          aria-label={`Open this template: ${erd.tables.length} tables`}
          className="absolute left-1/2 top-1/2 block cursor-pointer motion-safe:transition-transform motion-safe:duration-700 motion-safe:ease-out"
          style={{
            width: bounds.w,
            height: bounds.h,
            transform: `translate(-50%, -50%) scale(${scale}) ${tilted ? "perspective(1400px) rotateX(9deg) rotateY(-9deg)" : ""}`,
            transformOrigin: "center",
          }}
        >
          <svg className="absolute inset-0 overflow-visible" width={bounds.w} height={bounds.h} viewBox={`${bounds.minX} ${bounds.minY} ${bounds.w} ${bounds.h}`} aria-hidden="true">
            <defs>
              {(["idle", "hot"] as const).map((tone) => (
                <g key={tone}>
                  <marker id={`pv-many-${tone}`} viewBox="0 0 20 16" refX={20} refY={8} markerWidth={20} markerHeight={16} markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                    <path d="M12 8 L20 2.5 M12 8 L20 13.5 M12 8 L20 8" fill="none" strokeWidth={1.4} strokeLinecap="round" style={{ stroke: tone === "hot" ? "var(--edge-selected)" : "var(--edge)" }} />
                  </marker>
                  <marker id={`pv-one-${tone}`} viewBox="0 0 20 16" refX={20} refY={8} markerWidth={20} markerHeight={16} markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                    <path d="M12.5 3.5 V12.5 M16 3.5 V12.5" fill="none" strokeWidth={1.4} strokeLinecap="round" style={{ stroke: tone === "hot" ? "var(--edge-selected)" : "var(--edge)" }} />
                  </marker>
                </g>
              ))}
            </defs>
            {edges.map((edge) => {
              const hot = hovered !== null && (edge.from === hovered || edge.to === hovered);
              const tone = hot ? "hot" : "idle";
              return (
                <path
                  key={edge.id}
                  d={edge.d}
                  fill="none"
                  strokeWidth={hot ? 1.8 : 1.4}
                  strokeDasharray={edge.optional ? "5 4" : undefined}
                  markerStart={`url(#pv-one-${tone})`}
                  markerEnd={`url(#pv-many-${tone})`}
                  style={{
                    stroke: hot ? "var(--edge-selected)" : "var(--edge)",
                    opacity: hovered && !hot ? 0.25 : 1,
                    transition: "opacity 160ms, stroke 160ms",
                  }}
                />
              );
            })}
          </svg>

          {erd.tables.map((table) => {
            const box = boxes?.get(table.name);
            if (!box) return null;
            const dim = related && !related.has(table.name);
            const isHot = hovered === table.name;
            const extra = table.columns.length - box.rows.length;
            return (
              <div
                key={table.id}
                onPointerEnter={() => setHovered(table.name)}
                onPointerLeave={() => setHovered((h) => (h === table.name ? null : h))}
                className={`absolute rounded-[10px] border-[1.5px] bg-node text-left shadow-[0_2px_10px_rgba(0,0,0,0.08)] transition-[opacity,border-color] duration-150 ${
                  isHot ? "border-accent" : "border-foreground/[0.12]"
                }`}
                style={{ left: box.x - bounds.minX, top: box.y - bounds.minY, width: CARD_W, height: box.h, opacity: dim ? 0.3 : 1 }}
              >
                <div
                  className="rounded-t-[9px] px-3 border-b border-foreground/[0.08] flex items-center gap-2"
                  style={{ height: HEADER, background: "linear-gradient(135deg, var(--node-header-from) 0%, var(--node-header-to) 100%)" }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
                  <span className="font-mono font-bold text-[12px] text-foreground truncate">{table.name}</span>
                </div>
                <div className="pt-1">
                  {table.columns.slice(0, MAX_ROWS).map((column) => (
                    <div key={column.name} className="flex items-center gap-2 px-3 font-mono text-[11px]" style={{ height: ROW }}>
                      <span className={`w-3 text-[10px] ${column.isPrimaryKey ? "text-warning" : column.isForeignKey ? "text-accent" : "text-transparent"}`}>
                        {column.isPrimaryKey ? "●" : column.isForeignKey ? "→" : "·"}
                      </span>
                      <span className="flex-1 truncate text-foreground">{column.name}</span>
                      <span className="text-muted text-[10px] truncate max-w-[80px]">{column.dataType.toLowerCase()}</span>
                    </div>
                  ))}
                  {extra > 0 && <div className="px-3 pl-8 text-[10px] text-muted" style={{ height: 18 }}>+{extra} more</div>}
                </div>
              </div>
            );
          })}
        </button>
      )}
    </div>
  );
}
