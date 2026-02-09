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
  const { sidebarOpen, toggleSidebar, sidebarWidth } = useUIStore();

  const handleObjectClick = (objectId: string) => {
    const node = nodes.find((n) => n.data.objectTypeId === objectId);
    if (node) {
      selectNode(node.id);
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
            <div className="px-6 pt-7 pb-6 border-b border-border/60 text-center flex flex-col items-center">
              <h2 className="text-2xl leading-tight font-semibold text-foreground mb-1">Data Schema Map</h2>
              <p className="text-[12px] text-muted uppercase tracking-[0.14em]">
                {ontology
                  ? `${ontology.objectTypes.length} objects, ${ontology.linkTypes.length} links`
                  : "Generate to see ontology"}
              </p>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              <div className="px-6 pt-5 pb-14">
                <TemplateSelector />

                {ontology ? (
                  <>
                    {/* Divider between Templates and Object Types */}
                    <div className="h-8" />
                    <div className="-mx-6 border-t border-border/70" />
                    <div className="h-0" />

                    {/* Object Types */}
                    <div>
                      <h3 className="ui-section-title text-center">Object Types</h3>
                      <div className="mt-5 space-y-6">
                        {ontology.objectTypes.map((obj) => (
                          <button
                            key={obj.id}
                            onClick={() => handleObjectClick(obj.id)}
                            className="w-full text-left px-5 py-5 rounded-2xl bg-white/70 hover:bg-white/90 border border-transparent hover:border-border/60 transition-colors group"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0 pr-4">
                                <span className="text-[16px] text-foreground font-semibold leading-snug">
                                  {obj.name}
                                </span>
                                <p className="text-[13px] text-muted mt-2 leading-relaxed line-clamp-2">
                                  {obj.description}
                                </p>
                              </div>
                              <StatusTag status={obj.status} />
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Divider between Object Types and Actions */}
                    <div className="h-10" />
                    <div className="-mx-6 border-t border-border/70" />
                    <div className="h-0" />

                    {/* Action Types */}
                    <div>
                      <h3 className="ui-section-title text-center">Actions</h3>
                      <div className="mt-5 space-y-3">
                        {ontology.actionTypes.map((action) => (
                          <button
                            key={action.id}
                            className="w-full text-left px-6 py-4 rounded-xl hover:bg-white/70 transition-colors flex items-center gap-3"
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
                            <span className="text-[15px] text-foreground font-medium">
                              {action.name}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Interfaces */}
                    {ontology.interfaces.length > 0 && (
                      <>
                        {/* Divider between Actions and Interfaces */}
                        <div className="h-10" />
                        <div className="-mx-6 border-t border-border/70" />
                        <div className="h-0" />

                        <div>
                          <h3 className="ui-section-title text-center">Interfaces</h3>
                          <div className="mt-5 space-y-3">
                            {ontology.interfaces.map((iface) => (
                              <button
                                key={iface.id}
                                className="w-full text-left px-6 py-4 rounded-xl hover:bg-white/70 transition-colors flex items-center gap-3"
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
                                <span className="text-[15px] text-foreground font-medium">
                                  {iface.name}
                                </span>
                              </button>
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
                  <div className="mt-10 text-center text-[#8b7355]">
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
