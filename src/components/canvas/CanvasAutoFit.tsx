"use client";

import { useEffect, useMemo, useRef } from "react";
import { useReactFlow, type FitViewOptions } from "@xyflow/react";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useUIStore } from "@/store/useUIStore";

// Leave room at the bottom for the playback bar, minimap and zoom controls
// so they never sit on top of tables after a fit.
export const CANVAS_FIT_OPTIONS: FitViewOptions = {
  padding: { top: "40px", right: "48px", bottom: "150px", left: "48px" },
  maxZoom: 1.1,
};

const PANEL_ANIMATION_MS = 350;

/**
 * Re-fits the diagram when a new schema appears, when the build replay
 * finishes, and when the sidebar or results drawer changes the canvas size.
 * Must be rendered inside <ReactFlow>.
 */
export function CanvasAutoFit() {
  const { fitView } = useReactFlow();
  const nodeSignature = useCanvasStore((state) => state.nodes.map((node) => node.id).join("|"));
  const isPlaying = useProjectStore((state) => state.isPlaying);
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);
  const drawerOpen = useUIStore((state) => state.drawerOpen);
  const fitOptions = useMemo(() => ({ ...CANVAS_FIT_OPTIONS, duration: 300 }), []);
  const isFirstRun = useRef(true);

  // New schema (or end of replay): fit once nodes have been measured.
  useEffect(() => {
    if (!nodeSignature || isPlaying) return;
    const frame = window.requestAnimationFrame(() => {
      void fitView(fitOptions);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [nodeSignature, isPlaying, fitView, fitOptions]);

  // Canvas resized by a panel: refit after the panel animation finishes.
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void fitView(fitOptions);
    }, PANEL_ANIMATION_MS);
    return () => window.clearTimeout(timer);
  }, [sidebarOpen, drawerOpen, fitView, fitOptions]);

  return null;
}
