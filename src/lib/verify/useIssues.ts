"use client";

import { useMemo } from "react";
import { useErdStore } from "@/store/useErdStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSimulationStore } from "@/store/useSimulationStore";
import { useAiEditStore } from "@/store/useAiEditStore";
import { applyOps } from "@/lib/erd/applyOps";
import { lintErd, type Issue } from "./linter";
import { promptCoverage } from "./coverage";

/** Everything worth fixing: design checks, prompt coverage, and Postgres results. */
export function useIssues(): Issue[] {
  const erd = useErdStore((state) => state.erd);
  const prompt = useProjectStore((state) => state.prompt);
  const run = useSimulationStore((state) => state.run);

  return useMemo(() => {
    if (!erd || erd.tables.length === 0) return [];
    const fromDatabase: Issue[] = [
      ...(run?.ddlProblems ?? []).map((problem, index) => ({
        id: `ddl:${index}`,
        severity: "error" as const,
        table: problem.table,
        title: `Postgres rejected the SQL${problem.table ? ` for ${problem.table}` : ""}`,
        detail: problem.error,
        askAi: `Fix this PostgreSQL error${problem.table ? ` in table ${problem.table}` : ""}: "${problem.error}".`,
        context: `Failing statement:\n${problem.statement.slice(0, 800)}`,
      })),
      ...(run?.tests ?? [])
        .filter((test) => test.status === "fail")
        .map((test) => ({
          id: `test:${test.id}`,
          severity: "error" as const,
          table: test.table,
          title: `Test failed: ${test.title}`,
          detail: test.detail ?? "",
          askAi: `A database test failed for table ${test.table}: "${test.title}" — ${test.detail}. Fix the schema so it behaves correctly.`,
          context: `Test SQL that ran:\n${test.sql.slice(0, 800)}\nPostgres said: ${test.detail ?? "(nothing)"}`,
          testTitle: test.title,
        })),
    ];
    const order = { error: 0, warning: 1, info: 2 };
    return [...fromDatabase, ...lintErd(erd), ...promptCoverage(prompt, erd)].sort(
      (a, b) => order[a.severity] - order[b.severity]
    );
  }, [erd, prompt, run]);
}

/** Apply one or more issues' fixes as a single undoable edit. */
export function applyIssueFixes(issues: Issue[]): void {
  const { erd, positions, loadErd } = useErdStore.getState();
  if (!erd) return;
  const ops = issues.flatMap((issue) => issue.fix?.ops ?? []);
  if (ops.length === 0) return;
  const result = applyOps(erd, ops);
  const failed = result.results.filter((r) => !r.ok);
  loadErd(result.erd, positions);
  if (failed.length > 0) {
    useErdStore.setState({ lastError: `${failed.length} fix${failed.length === 1 ? "" : "es"} couldn't be applied: ${failed[0].error}` });
  }
}

/** Ask the AI to fix one issue; the checked result is previewed on the canvas. */
export function askAiAboutIssue(issue: Issue): void {
  if (!issue.askAi) return;
  void useAiEditStore.getState().requestFix(issue);
}
