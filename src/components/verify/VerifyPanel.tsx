"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSimulationStore } from "@/store/useSimulationStore";
import { useUIStore } from "@/store/useUIStore";
import { useErdStore } from "@/store/useErdStore";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useIssues, applyIssueFixes, askAiAboutIssue } from "@/lib/verify/useIssues";
import type { Issue, Severity } from "@/lib/verify/linter";
import type { DbTest } from "@/lib/verify/runner";

type Tab = "issues" | "tests" | "data";

const SEVERITY_STYLE: Record<Severity, { dot: string; label: string }> = {
  error: { dot: "bg-error", label: "Error" },
  warning: { dot: "bg-warning", label: "Warning" },
  info: { dot: "bg-muted", label: "Suggestion" },
};

function IssueRow({ issue }: { issue: Issue }) {
  const tableId = useErdStore((state) => state.erd?.tables.find((t) => t.name === issue.table)?.id);
  const style = SEVERITY_STYLE[issue.severity];
  return (
    <li className="px-4 py-2.5 flex items-start gap-3 border-b border-border/60 last:border-b-0">
      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${style.dot}`} title={style.label} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-foreground leading-snug">{issue.title}</p>
        <p className="mt-0.5 text-[12px] text-muted leading-snug">{issue.detail}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {tableId && (
          <button
            onClick={() => {
              useCanvasStore.getState().selectNode(tableId);
              useCanvasStore.getState().requestFocus(tableId);
              useUIStore.getState().openInspector();
            }}
            className="h-7 px-2 rounded-md text-[11px] text-muted hover:text-foreground hover:bg-foreground/[0.04]"
          >
            Show
          </button>
        )}
        {issue.fix ? (
          <button
            onClick={() => applyIssueFixes([issue])}
            className="h-7 px-2.5 rounded-md border border-accent/30 text-accent text-[12px] font-medium hover:bg-accent/10"
            title={issue.fix.label}
          >
            Fix: {issue.fix.label}
          </button>
        ) : issue.askAi ? (
          <button
            onClick={() => askAiAboutIssue(issue)}
            className="h-7 px-2.5 rounded-md border border-border text-foreground text-[12px] font-medium hover:bg-foreground/[0.04]"
          >
            Ask AI to fix
          </button>
        ) : null}
      </div>
    </li>
  );
}

function TestRow({ test }: { test: DbTest }) {
  const icon = test.status === "pass" ? "✓" : test.status === "fail" ? "✗" : "–";
  const color = test.status === "pass" ? "text-success" : test.status === "fail" ? "text-error" : "text-muted";
  return (
    <li className="px-4 py-1.5 flex items-start gap-2.5 text-[12px] border-b border-border/40 last:border-b-0">
      <span className={`w-3 shrink-0 font-semibold ${color}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="font-mono text-foreground">{test.title}</span>
        {test.status !== "pass" && test.detail && <span className="block text-muted">{test.detail}</span>}
      </span>
    </li>
  );
}

/** Bottom panel: design issues, real-Postgres test results and sample rows. */
export function VerifyPanel() {
  const hasTables = useErdStore((state) => (state.erd?.tables.length ?? 0) > 0);
  const { run, isRunning, progress, error, runTests } = useSimulationStore();
  const { drawerOpen, toggleDrawer, drawerHeight } = useUIStore();
  const issues = useIssues();
  const [tab, setTab] = useState<Tab>("issues");
  const [showInfo, setShowInfo] = useState(false);

  const counts = useMemo(
    () => ({
      error: issues.filter((i) => i.severity === "error").length,
      warning: issues.filter((i) => i.severity === "warning").length,
      info: issues.filter((i) => i.severity === "info").length,
    }),
    [issues]
  );
  const fixable = issues.filter((i) => i.fix && i.severity !== "info");
  const visibleIssues = showInfo ? issues : issues.filter((i) => i.severity !== "info");
  const passed = run?.tests.filter((t) => t.status === "pass").length ?? 0;
  const failed = run?.tests.filter((t) => t.status === "fail").length ?? 0;
  const skipped = run?.tests.filter((t) => t.status === "skip").length ?? 0;

  if (!hasTables) return null;

  return (
    <div className="shrink-0">
      <div className="h-10 bg-surface/95 border-t border-border px-4 flex items-center gap-4">
        <button onClick={toggleDrawer} className="flex items-center gap-3 h-full flex-1 min-w-0 text-left" aria-expanded={drawerOpen}>
          <span className="text-[13px] font-semibold text-foreground">Checks</span>
          <span className="flex items-center gap-3 text-[12px]">
            <span className={counts.error ? "text-error font-semibold" : "text-muted"}>{counts.error} error{counts.error === 1 ? "" : "s"}</span>
            <span className={counts.warning ? "text-warning font-semibold" : "text-muted"}>{counts.warning} warning{counts.warning === 1 ? "" : "s"}</span>
            <span className="text-muted">{counts.info} suggestion{counts.info === 1 ? "" : "s"}</span>
          </span>
          <span className="text-[12px] text-muted truncate">
            {isRunning
              ? progress
              : run
                ? `· Postgres: ${passed} passed${failed ? `, ${failed} failed` : ""}${skipped ? `, ${skipped} skipped` : ""} in ${(run.durationMs / 1000).toFixed(1)}s`
                : "· Postgres tests not run yet"}
          </span>
        </button>
        <svg className={`w-4 h-4 text-muted transition-transform ${drawerOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </div>

      <AnimatePresence>
        {drawerOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: drawerHeight + 40, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="bg-surface border-t border-border overflow-hidden shadow-[0_-10px_24px_rgba(86,61,38,0.10)]"
          >
            <div className="h-full flex flex-col">
              <div className="px-4 h-11 border-b border-border flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-1" role="tablist">
                  {([
                    ["issues", `Issues (${counts.error + counts.warning})`],
                    ["tests", run ? `Postgres tests (${passed}/${run.tests.length})` : "Postgres tests"],
                    ["data", "Sample data"],
                  ] as Array<[Tab, string]>).map(([key, label]) => (
                    <button
                      key={key}
                      role="tab"
                      aria-selected={tab === key}
                      onClick={() => setTab(key)}
                      className={`h-8 px-3 rounded-md text-[12px] font-medium ${tab === key ? "bg-pill text-foreground" : "text-muted hover:text-foreground"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {tab === "issues" && fixable.length > 0 && (
                    <button onClick={() => applyIssueFixes(fixable)} className="h-8 px-3 rounded-md bg-brand text-white text-[12px] font-semibold">
                      Fix all {fixable.length}
                    </button>
                  )}
                  <button
                    onClick={() => void runTests()}
                    disabled={isRunning}
                    className="h-8 px-3 rounded-md border border-border text-[12px] font-medium text-foreground hover:bg-foreground/[0.04] disabled:opacity-50"
                  >
                    {isRunning ? "Running…" : run ? "Re-run tests" : "Run Postgres tests"}
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {error && <p className="px-4 py-3 text-[13px] text-error">{error}</p>}

                {tab === "issues" && (
                  <>
                    {visibleIssues.length === 0 ? (
                      <p className="px-4 py-6 text-[13px] text-muted text-center">
                        No errors or warnings.{" "}
                        {!run && "Run the Postgres tests to check the schema in a real database."}
                      </p>
                    ) : (
                      <ul>{visibleIssues.map((issue) => <IssueRow key={issue.id} issue={issue} />)}</ul>
                    )}
                    {counts.info > 0 && (
                      <button onClick={() => setShowInfo(!showInfo)} className="px-4 py-2 text-[12px] text-accent hover:underline">
                        {showInfo ? "Hide suggestions" : `Show ${counts.info} suggestion${counts.info === 1 ? "" : "s"}`}
                      </button>
                    )}
                  </>
                )}

                {tab === "tests" &&
                  (run ? (
                    <>
                      <p className="px-4 pt-3 pb-1 text-[12px] text-muted">
                        The exported SQL was run in a real Postgres database in your browser (PGlite), filled with sample rows, then each rule was tested.
                        {run.ddlProblems.length > 0 && ` ${run.ddlProblems.length} statement${run.ddlProblems.length === 1 ? "" : "s"} failed to run — see Issues.`}
                      </p>
                      <ul>{run.tests.map((test) => <TestRow key={test.id} test={test} />)}</ul>
                    </>
                  ) : (
                    <div className="px-4 py-6 text-center">
                      <p className="text-[13px] text-muted">
                        Runs your schema in real Postgres in the browser: creates the tables, inserts sample rows, and checks every NOT NULL, UNIQUE, foreign key, CHECK and ON DELETE rule.
                      </p>
                      <button onClick={() => void runTests()} disabled={isRunning} className="ui-primary-btn mt-3">
                        {isRunning ? progress ?? "Running…" : "Run Postgres tests"}
                      </button>
                    </div>
                  ))}

                {tab === "data" &&
                  (run && run.seed.length > 0 ? (
                    <div className="p-4 space-y-4">
                      {run.seed.map((table) => (
                        <div key={table.table}>
                          <h4 className="font-mono text-[12px] font-semibold text-foreground mb-1">{table.table}</h4>
                          <div className="overflow-x-auto rounded-md border border-border">
                            <table className="text-[11px] font-mono w-full">
                              <thead className="bg-node-header">
                                <tr>{table.columns.map((c) => <th key={c} className="px-2 py-1 text-left font-semibold whitespace-nowrap">{c}</th>)}</tr>
                              </thead>
                              <tbody>
                                {table.rows.length === 0 ? (
                                  <tr><td className="px-2 py-1 text-muted" colSpan={table.columns.length}>No rows</td></tr>
                                ) : (
                                  table.rows.map((row, i) => (
                                    <tr key={i} className="border-t border-border/60">
                                      {row.map((cell, j) => <td key={j} className="px-2 py-1 whitespace-nowrap max-w-[220px] truncate">{cell}</td>)}
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="px-4 py-6 text-[13px] text-muted text-center">Run the Postgres tests to see sample rows.</p>
                  ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
