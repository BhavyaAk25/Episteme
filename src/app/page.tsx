"use client";

import { useEffect } from "react";
import { TopBar } from "@/components/topbar/TopBar";
import { OntologySidebar } from "@/components/sidebar/OntologySidebar";
import { ERDCanvas } from "@/components/canvas/ERDCanvas";
import { BuildAnimation } from "@/components/canvas/BuildAnimation";
import { CanvasControls } from "@/components/canvas/CanvasControls";
import { GenerationStatus } from "@/components/canvas/GenerationStatus";
import { RightInspector } from "@/components/inspector/RightInspector";
import { VerifyPanel } from "@/components/verify/VerifyPanel";
import { ExportModal } from "@/components/export/ExportModal";
import { useProjectStore } from "@/store/useProjectStore";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useErdStore } from "@/store/useErdStore";
import { useSimulationStore } from "@/store/useSimulationStore";
import { useProjectsStore } from "@/store/useProjectsStore";
import { layoutErd } from "@/lib/erd/layout";
import type { ERD } from "@/types/erd";

function readLegacyErd(): ERD | null {
  try {
    const raw = window.localStorage.getItem("episteme-project");
    const erd = raw ? (JSON.parse(raw) as { state?: { erd?: ERD | null } }).state?.erd : null;
    return erd && Array.isArray(erd.tables) ? erd : null;
  } catch {
    return null;
  }
}
import { motion, AnimatePresence } from "framer-motion";

export default function Home() {
  const { error, errorTitle, setError } = useProjectStore();

  // Restore the last session from localStorage on mount.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      Promise.resolve(useProjectStore.persist.rehydrate()),
      Promise.resolve(useErdStore.persist.rehydrate()),
    ]).then(async () => {
      if (cancelled) return;
      const erdState = useErdStore.getState();
      let erd = erdState.erd;
      let positions = erdState.positions;

      // Sessions saved before the editor kept the ERD in the project store.
      if (!erd) {
        erd = readLegacyErd();
        positions = {};
      }

      if (erd) {
        const missingPositions = erd.tables.some((table) => !positions[table.id]);
        if (missingPositions) {
          try {
            positions = { ...(await layoutErd(erd)), ...positions };
          } catch {
            // Fall back to the built-in layered positions.
          }
        }
        if (cancelled) return;
        useErdStore.getState().loadErd(erd, positions, { resetHistory: true });
        useCanvasStore.getState().requestFit();
      }

      await Promise.resolve(useProjectsStore.persist.rehydrate());
      if (!cancelled) await useProjectsStore.getState().init();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Autosave the open project to IndexedDB shortly after any change.
  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      if (!useProjectsStore.getState().ready) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void useProjectsStore.getState().saveCurrent(), 800);
    };
    const unsubscribeErd = useErdStore.subscribe((state, previous) => {
      if (state.erd !== previous.erd || state.positions !== previous.positions) schedule();
    });
    const unsubscribeProject = useProjectStore.subscribe((state, previous) => {
      if (state.prompt !== previous.prompt || state.ontology !== previous.ontology) schedule();
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribeErd();
      unsubscribeProject();
    };
  }, []);

  // Simulation results describe one version of the schema; clear them on edit.
  useEffect(
    () =>
      useErdStore.subscribe((state, previous) => {
        if (state.erd !== previous.erd && useSimulationStore.getState().run) {
          useSimulationStore.getState().reset();
        }
      }),
    []
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setError(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setError]);

  return (
    <div className="h-screen flex flex-col bg-canvas overflow-hidden">
      {/* Top Bar */}
      <TopBar />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Sidebar */}
        <OntologySidebar />

        {/* Center Canvas */}
        <div className="flex-1 relative">
          <ERDCanvas />
          <BuildAnimation />
          <CanvasControls />
          <GenerationStatus />
        </div>

        {/* Right Inspector */}
        <RightInspector />
      </div>

      {/* Bottom Drawer */}
      <VerifyPanel />

      {/* Export Modal */}
      <ExportModal />

      {/* Error Modal */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[rgba(56,40,22,0.22)] backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setError(null)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-surface rounded-xl border border-border p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-error/20 flex items-center justify-center shrink-0">
                  <svg
                    className="w-5 h-5 text-error"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold text-foreground">
                      {errorTitle ?? "Error"}
                    </h3>
                    <button
                      onClick={() => setError(null)}
                      className="h-7 w-7 rounded-md border border-border text-muted hover:text-foreground hover:bg-node transition-colors"
                      aria-label="Close error"
                    >
                      ×
                    </button>
                  </div>
                  <p className="mt-1 max-h-56 overflow-y-auto text-sm text-muted whitespace-pre-wrap break-words pr-1">
                    {error}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => setError(null)}
                  className="px-4 py-2 rounded-lg bg-surface border border-border text-foreground text-sm font-medium hover:bg-node transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
