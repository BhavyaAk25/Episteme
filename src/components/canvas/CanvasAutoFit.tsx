"use client";

import { useEffect, useMemo, useRef } from "react";
import { useNodesInitialized, useReactFlow, type FitViewOptions } from "@xyflow/react";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useUIStore } from "@/store/useUIStore";

// Leave room for the toolbar (top) and the replay bar, minimap and zoom
// controls (bottom) so they never sit on top of tables after a fit.
export const CANVAS_FIT_OPTIONS: FitViewOptions = {
  padding: { top: "80px", right: "48px", bottom: "110px", left: "48px" },
  maxZoom: 1.1,
};

const PANEL_ANIMATION_MS = 350;
const MEASURE_DELAY_MS = 80;

/**
 * Re-fits the diagram when asked (new schema, tidy up) and when the sidebar
 * or results drawer changes the canvas size. Must be inside <ReactFlow>.
 */
export function CanvasAutoFit() {
  const { fitView } = useReactFlow();
  const fitRequest = useCanvasStore((state) => state.fitRequest);
  const focusRequest = useCanvasStore((state) => state.focusRequest);
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);
  const drawerOpen = useUIStore((state) => state.drawerOpen);
  const inspectorOpen = useUIStore((state) => state.inspectorOpen);
  const fitOptions = useMemo(() => ({ ...CANVAS_FIT_OPTIONS, duration: 300 }), []);
  const isFirstPanelRun = useRef(true);
  const nodesInitialized = useNodesInitialized();
  const fittedOnLoad = useRef(false);

  // After a page load, fit once the restored tables have been measured.
  useEffect(() => {
    if (!nodesInitialized || fittedOnLoad.current) return;
    const timer = window.setTimeout(() => {
      fittedOnLoad.current = true;
      void fitView(fitOptions);
    }, MEASURE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [nodesInitialized, fitView, fitOptions]);

  // Wait a moment so newly rendered nodes are measured before fitting.
  useEffect(() => {
    if (fitRequest === 0) return;
    const timer = window.setTimeout(() => void fitView(fitOptions), MEASURE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [fitRequest, fitView, fitOptions]);

  // Bring one table into view (e.g. picked from the sidebar).
  useEffect(() => {
    if (!focusRequest) return;
    void fitView({ nodes: [{ id: focusRequest.nodeId }], maxZoom: 1, padding: 0.6, duration: 300 });
  }, [focusRequest, fitView]);

  useEffect(() => {
    if (isFirstPanelRun.current) {
      isFirstPanelRun.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      // Keep the table being inspected in view; otherwise fit everything.
      const selected = useCanvasStore.getState().selectedNodeId;
      void (selected && inspectorOpen
        ? fitView({ nodes: [{ id: selected }], maxZoom: 1, padding: 0.6, duration: 300 })
        : fitView(fitOptions));
    }, PANEL_ANIMATION_MS);
    return () => window.clearTimeout(timer);
  }, [sidebarOpen, drawerOpen, inspectorOpen, fitView, fitOptions]);

  return null;
}
