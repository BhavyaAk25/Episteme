"use client";

import { useProjectStore } from "@/store/useProjectStore";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useErdStore } from "@/store/useErdStore";
import { useUIStore } from "@/store/useUIStore";
import { SidebarLoadingSkeleton } from "@/components/shared/LoadingStates";
import { TemplateSelector } from "./TemplateSelector";
import { motion, AnimatePresence } from "framer-motion";

export function OntologySidebar() {
  const { ontology, isGenerating } = useProjectStore();
  const erd = useErdStore((state) => state.erd);
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const { sidebarOpen, toggleSidebar, sidebarWidth, openInspector } = useUIStore();

  const handleTableClick = (tableId: string) => {
    useCanvasStore.getState().selectNode(tableId);
    useCanvasStore.getState().requestFocus(tableId);
    openInspector();
  };

  return (
    <>
      {/* Toggle button — positioned at right edge of sidebar, vertically centered */}
      <button
        onClick={toggleSidebar}
        className="absolute top-1/2 -translate-y-1/2 z-20 bg-elevated border border-border rounded-r-lg p-2 hover:bg-pill transition-all shadow-md"
        style={{
          left: sidebarOpen ? sidebarWidth : 0,
          transition: "left 300ms ease-in-out",
        }}
        title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
      >
        <svg
          className={`w-4 h-4 text-muted transition-transform ${
            sidebarOpen ? "" : "rotate-180"
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
      </button>

      {/* Sidebar panel */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ x: -sidebarWidth, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -sidebarWidth, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="h-full bg-surface border-r border-border/60 flex flex-col overflow-hidden"
            style={{ width: sidebarWidth }}
          >
            {/* Header */}
            <div className="px-5 pt-5 pb-4 border-b border-border/60">
              <h2 className="text-[17px] leading-tight font-semibold text-foreground">Schema</h2>
              <p className="mt-1 text-[12px] text-muted">
                {erd
                  ? `${erd.tables.length} table${erd.tables.length === 1 ? "" : "s"} · ${erd.relationships.length} relationship${erd.relationships.length === 1 ? "" : "s"}`
                  : "Nothing here yet"}
              </p>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              <div className="px-5 pt-4 pb-10">
                <TemplateSelector />

                {erd ? (
                  <>
                    <div className="mt-6 mb-4 -mx-5 border-t border-border/70" />

                    <div>
                      <h3 className="ui-section-title">Tables</h3>
                      {erd.tables.length === 0 && (
                        <p className="mt-3 text-[12px] text-muted">No tables yet. Use + Table on the canvas.</p>
                      )}
                      <div className="mt-3 space-y-1">
                        {erd.tables.map((table) => {
                          const description = ontology?.objectTypes.find((o) => o.id === table.objectTypeId)?.description;
                          const isSelected = table.id === selectedNodeId;
                          return (
                            <button
                              key={table.id}
                              onClick={() => handleTableClick(table.id)}
                              className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                                isSelected
                                  ? "bg-elevated border-accent/40"
                                  : "bg-elevated/60 border-transparent hover:bg-elevated hover:border-border/60"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-[12px] font-semibold text-foreground truncate">{table.name}</span>
                                <span className="text-[11px] text-muted shrink-0">{table.columns.length} cols</span>
                              </div>
                              {description && (
                                <p className="text-[11px] text-muted mt-0.5 leading-snug line-clamp-1">{description}</p>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {(ontology?.actionTypes.length ?? 0) > 0 && (
                      <>
                        <div className="mt-6 mb-4 -mx-5 border-t border-border/70" />
                        <div>
                          <h3 className="ui-section-title">Actions (from AI plan)</h3>
                          <div className="mt-3 space-y-1">
                            {ontology?.actionTypes.map((action) => (
                              <div key={action.id} className="px-3 py-1.5 rounded-lg flex items-center gap-2.5" title={action.description}>
                                <svg className="w-3.5 h-3.5 text-warning shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                <span className="text-[12px] text-foreground">{action.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </>
                ) : isGenerating ? (
                  <div className="mt-10">
                    <SidebarLoadingSkeleton />
                  </div>
                ) : (
                  <div className="mt-8 text-muted">
                    <p>No ontology yet.</p>
                    <p className="mt-1 text-sm">
                      Enter a system description and click Generate.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
