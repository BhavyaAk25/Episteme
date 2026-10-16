"use client";

import { useProjectStore } from "@/store/useProjectStore";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useUIStore } from "@/store/useUIStore";
import { StatusTag } from "@/components/shared/StatusTag";
import { SidebarLoadingSkeleton } from "@/components/shared/LoadingStates";
import { TemplateSelector } from "./TemplateSelector";
import { motion, AnimatePresence } from "framer-motion";

export function OntologySidebar() {
  const { ontology, isGenerating } = useProjectStore();
  const { selectNode, nodes } = useCanvasStore();
  const { sidebarOpen, toggleSidebar, sidebarWidth, openInspector } = useUIStore();

  const handleObjectClick = (objectId: string) => {
    const node = nodes.find((n) => n.data.objectTypeId === objectId);
    if (node) {
      selectNode(node.id);
      openInspector();
    }
  };

  return (
    <>
      {/* Toggle button — positioned at right edge of sidebar, vertically centered */}
      <button
        onClick={toggleSidebar}
        className="absolute top-1/2 -translate-y-1/2 z-20 bg-white border border-[#d4c5b0] rounded-r-lg p-2 hover:bg-[#faf8f4] transition-all shadow-md"
        style={{
          left: sidebarOpen ? sidebarWidth : 0,
          transition: "left 300ms ease-in-out",
        }}
        title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
      >
        <svg
          className={`w-4 h-4 text-[#8b7355] transition-transform ${
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
                {ontology
                  ? `${ontology.objectTypes.length} tables · ${ontology.linkTypes.length} relationships`
                  : "Nothing generated yet"}
              </p>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              <div className="px-5 pt-4 pb-10">
                <TemplateSelector />

                {ontology ? (
                  <>
                    <div className="mt-6 mb-4 -mx-5 border-t border-border/70" />

                    {/* Object Types */}
                    <div>
                      <h3 className="ui-section-title">Object Types</h3>
                      <div className="mt-3 space-y-1.5">
                        {ontology.objectTypes.map((obj) => (
                          <button
                            key={obj.id}
                            onClick={() => handleObjectClick(obj.id)}
                            className="w-full text-left px-3 py-2.5 rounded-lg bg-white/60 hover:bg-white border border-transparent hover:border-border/60 transition-colors group"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <span className="text-[13px] text-foreground font-semibold leading-snug">
                                  {obj.name}
                                </span>
                                <p className="text-[12px] text-muted mt-0.5 leading-snug line-clamp-2">
                                  {obj.description}
                                </p>
                              </div>
                              <StatusTag status={obj.status} />
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mt-6 mb-4 -mx-5 border-t border-border/70" />

                    {/* Action Types */}
                    <div>
                      <h3 className="ui-section-title">Actions</h3>
                      <div className="mt-3 space-y-1">
                        {ontology.actionTypes.map((action) => (
                          <div
                            key={action.id}
                            className="px-3 py-2 rounded-lg flex items-center gap-2.5"
                          >
                            <svg
                              className="w-4 h-4 text-warning shrink-0"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M13 10V3L4 14h7v7l9-11h-7z"
                              />
                            </svg>
                            <span className="text-[13px] text-foreground font-medium">
                              {action.name}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Interfaces */}
                    {ontology.interfaces.length > 0 && (
                      <>
                    <div className="mt-6 mb-4 -mx-5 border-t border-border/70" />

                        <div>
                          <h3 className="ui-section-title">Interfaces</h3>
                          <div className="mt-3 space-y-1">
                            {ontology.interfaces.map((iface) => (
                              <div
                                key={iface.id}
                                className="px-3 py-2 rounded-lg flex items-center gap-2.5"
                              >
                                <svg
                                  className="w-4 h-4 text-[#8b7355] shrink-0"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                  />
                                </svg>
                                <span className="text-[13px] text-foreground font-medium">
                                  {iface.name}
                                </span>
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
                  <div className="mt-8 text-[#8b7355]">
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
