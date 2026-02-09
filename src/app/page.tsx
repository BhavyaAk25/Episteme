"use client";

import { useEffect } from "react";
import { TopBar } from "@/components/topbar/TopBar";
import { OntologySidebar } from "@/components/sidebar/OntologySidebar";
import { ERDCanvas } from "@/components/canvas/ERDCanvas";
import { BuildAnimation } from "@/components/canvas/BuildAnimation";
import { CanvasControls } from "@/components/canvas/CanvasControls";
import { RightInspector } from "@/components/inspector/RightInspector";
import { BottomDrawer } from "@/components/simulation/BottomDrawer";
import { ExportModal } from "@/components/export/ExportModal";
import { useUIStore } from "@/store/useUIStore";
import { useProjectStore } from "@/store/useProjectStore";
import { motion, AnimatePresence } from "framer-motion";

export default function Home() {
  const { sidebarOpen } = useUIStore();
  const { error, errorTitle, setError } = useProjectStore();

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
        <div
          className="flex-1 relative"
          style={{
            marginLeft: sidebarOpen ? 0 : 0,
          }}
        >
          <ERDCanvas />
          <BuildAnimation />
          <CanvasControls />
        </div>

        {/* Right Inspector */}
        <RightInspector />
      </div>

      {/* Bottom Drawer */}
      <BottomDrawer />

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
