"use client";

import { useState } from "react";
import { useSimulationStore } from "@/store/useSimulationStore";
import { useUIStore } from "@/store/useUIStore";
import { motion, AnimatePresence } from "framer-motion";
import { IncidentCard } from "./IncidentCard";

export function BottomDrawer() {
  const { results, isRunning, isFixing } = useSimulationStore();
  const { drawerOpen, toggleDrawer, drawerHeight } = useUIStore();
  const [showSeedData, setShowSeedData] = useState(false);

  const hasResults = Boolean(results);
  const canToggle = isRunning || hasResults;
  const passedCount = results?.passedCount ?? 0;
  const failedCount = results?.failedCount ?? 0;
  const hasSeedData = Boolean(results && results.seedPreview.length > 0);
  const activeTab: "incidents" | "seed_data" = showSeedData && hasSeedData
    ? "seed_data"
    : "incidents";

  return (
    <div>
      {/* Toggle bar — 40px inline strip */}
      {canToggle && (
        <button
          onClick={toggleDrawer}
          className="w-full h-10 bg-[rgba(255,252,247,0.95)] border-t border-border px-5 relative flex items-center hover:bg-[rgba(0,0,0,0.02)] transition-colors"
        >
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-3">
              <span className="text-[13px] font-medium text-foreground">
                Verification Results
              </span>
              {(hasResults || isRunning) && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-bold text-success">{passedCount} passed</span>
                  <span className="text-[12px] text-muted">/</span>
                  <span className="text-[12px] font-bold text-error">{failedCount} failed</span>
                </div>
              )}
            </div>
          </div>
          <svg
            className={`w-4 h-4 text-muted transition-transform ml-auto ${
              drawerOpen ? "rotate-180" : ""
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 15l7-7 7 7"
            />
          </svg>
        </button>
      )}

      {/* Drawer content */}
      <AnimatePresence>
        {drawerOpen && (hasResults || isRunning) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: drawerHeight, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="bg-surface border-t border-border overflow-hidden shadow-[0_-10px_24px_rgba(86,61,38,0.12)]"
            style={{ minHeight: 200 }}
          >
            <div className="h-full flex flex-col">
              {/* Header */}
              <div className="px-5 py-2.5 border-b border-border relative flex items-center shrink-0">
                <div className="flex items-center gap-4">
                  {isRunning && (
                    <span className="flex items-center gap-2 text-[13px] text-accent">
                      <span className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                      Running tests...
                    </span>
                  )}
                  {isFixing && !isRunning && (
                    <span className="flex items-center gap-2 text-[13px] text-warning">
                      <span className="w-3 h-3 border-2 border-warning/30 border-t-warning rounded-full animate-spin" />
                      Applying patches...
                    </span>
                  )}
                </div>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-16">
                  <h3 className="font-semibold text-foreground text-[15px] truncate">
                    Simulation Results
                  </h3>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  {hasResults && (
                    <div className="hidden md:flex items-center gap-1 rounded-xl border border-border bg-canvas p-0.5">
                      <button
                        onClick={() => setShowSeedData(false)}
                        className={`h-7 px-3 rounded-lg text-[13px] font-medium transition-colors ${
                          activeTab === "incidents"
                            ? "bg-surface text-foreground"
                            : "text-muted hover:text-foreground"
                        }`}
                      >
                        Incidents
                      </button>
                      <button
                        onClick={() => setShowSeedData(true)}
                        className={`h-7 px-3 rounded-lg text-[13px] font-medium transition-colors ${
                          activeTab === "seed_data"
                            ? "bg-surface text-foreground"
                            : "text-muted hover:text-foreground"
                        }`}
                        disabled={!hasSeedData}
                      >
                        Seed Data
                      </button>
                    </div>
                  )}
                  <span className="inline-flex items-center h-7 px-3 rounded-md bg-success/15 text-success text-[12px] font-bold leading-none whitespace-nowrap">
                    {passedCount} passed
                  </span>
                  <span className="inline-flex items-center h-7 px-3 rounded-md bg-error/15 text-error text-[12px] font-bold leading-none whitespace-nowrap">
                    {failedCount} failed
                  </span>
                  <button
                    onClick={toggleDrawer}
                    className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[rgba(0,0,0,0.05)] transition-colors"
                    aria-label="Close results drawer"
                    title="Close drawer"
                  >
                    <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-5">
                {isRunning && (!results || results.testResults.length === 0) ? (
                  <div className="flex items-center justify-center h-full text-center">
                    <div>
                      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-accent/20 flex items-center justify-center">
                        <span className="w-5 h-5 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
                      </div>
                      <p className="text-foreground font-medium text-[15px]">
                        Running simulation...
                      </p>
                      <p className="text-[13px] text-muted mt-1">
                        Seeding data and executing chaos tests.
                      </p>
                    </div>
                  </div>
                ) : results && activeTab === "seed_data" ? (
                  <div className="grid gap-3">
                    {results.seedPreview.map((tablePreview) => (
                      <div key={tablePreview.table} className="rounded-xl border border-border bg-node p-3">
                        <div className="flex items-center justify-between gap-3">
                          <h4 className="font-mono text-[13px] text-foreground">
                            {tablePreview.table}
                          </h4>
                          <span className="text-[12px] text-[#8B7355]">
                            {tablePreview.totalRows} rows seeded
                          </span>
                        </div>
                        {tablePreview.columns.length > 0 ? (
                          <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-canvas">
                            <table className="min-w-full text-[12px]">
                              <thead className="border-b border-border bg-node-header/60">
                                <tr>
                                  {tablePreview.columns.map((column) => (
                                    <th key={column} className="px-2 py-1.5 text-left font-medium text-[#8B7355] whitespace-nowrap">
                                      {column}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {tablePreview.rows.map((row, rowIndex) => (
                                  <tr key={`${tablePreview.table}-${rowIndex}`} className="border-b last:border-b-0 border-border/60">
                                    {row.map((value, valueIndex) => (
                                      <td key={`${tablePreview.table}-${rowIndex}-${valueIndex}`} className="px-2 py-1.5 text-foreground whitespace-nowrap">
                                        {String(value)}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="mt-2 text-[12px] text-[#8B7355]">No sample rows available.</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : results && results.incidents.length > 0 ? (
                  <div className="grid gap-3">
                    {results.incidents.map((incident) => (
                      <IncidentCard key={incident.id} incident={incident} />
                    ))}
                  </div>
                ) : results && results.failedCount === 0 && results.totalTests > 0 ? (
                  /* Success state — large centered checkmark with green tint */
	                  <div className="flex items-center justify-center h-full text-center">
	                    <div className="p-8 rounded-2xl bg-[rgba(46,125,50,0.05)] flex flex-col items-center text-center">
	                      <div className="w-12 h-12 mb-3 rounded-full bg-success/20 flex items-center justify-center">
	                        <svg
	                          className="w-6 h-6 text-success"
	                          fill="none"
	                          stroke="currentColor"
	                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      </div>
                      <p className="text-foreground font-semibold text-[15px]">
                        All tests passed!
                      </p>
                      <p className="text-[13px] text-muted mt-1">
                        Your schema is verified and ready for export.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-muted py-8 text-[13px]">
                    No incidents yet.
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
