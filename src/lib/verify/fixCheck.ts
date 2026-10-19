/**
 * Checks used by "Ask AI to fix": keep a fix from deleting unrelated data,
 * and confirm the proposed schema really removes the issue without adding
 * new errors (re-running Postgres when the issue came from the database).
 */
import type { ERD } from "@/types/erd";
import type { EditOp, OpResult } from "@/lib/erd/applyOps";
import { lintErd, type Issue } from "./linter";
import { promptCoverage } from "./coverage";

export interface FixVerdict {
  resolved: boolean;
  message: string;
}

/** The problem description sent to the AI. */
export function problemText(issue: Issue): string {
  return [
    `Problem: ${issue.title}`,
    issue.detail && `Details: ${issue.detail}`,
    issue.askAi && `Goal: ${issue.askAi}`,
    issue.context,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Remove operations a fix should never make: dropping or renaming tables,
 * and dropping columns the problem doesn't mention.
 */
export function guardFixOps(ops: EditOp[], issue: Issue): { allowed: EditOp[]; blocked: OpResult[] } {
  const text = `${issue.title} ${issue.detail} ${issue.askAi ?? ""}`.toLowerCase();
  const mentions = (name: string) => new RegExp(`\\b${name.toLowerCase()}\\b`).test(text);
  const allowed: EditOp[] = [];
  const blocked: OpResult[] = [];
  for (const op of ops) {
    if (op.op === "drop_table") {
      blocked.push({ label: `Remove table ${op.table}`, ok: false, error: "blocked: a fix never deletes a table" });
    } else if (op.op === "rename_table") {
      blocked.push({ label: `Rename ${op.table} → ${op.new_name}`, ok: false, error: "blocked: a fix doesn't rename tables" });
    } else if (op.op === "drop_column" && !mentions(op.column)) {
      blocked.push({ label: `Remove ${op.table}.${op.column}`, ok: false, error: "blocked: that column isn't part of the problem" });
    } else {
      allowed.push(op);
    }
  }
  return { allowed, blocked };
}

const errorTitles = (erd: ERD) => new Set(lintErd(erd).filter((i) => i.severity === "error").map((i) => i.id));

/** Does `after` remove `issue` without introducing new errors? */
export async function checkFix(issue: Issue, before: ERD, after: ERD, prompt: string, failingBefore: number): Promise<FixVerdict> {
  const newErrors = [...errorTitles(after)].filter((id) => !errorTitles(before).has(id));
  if (newErrors.length) return { resolved: false, message: `It introduces a new problem: ${newErrors[0].split(":").slice(1).join(":")}` };

  if (issue.id.startsWith("test:") || issue.id.startsWith("ddl:")) {
    const { runVerification } = await import("./runner");
    const run = await runVerification(after);
    if (issue.id.startsWith("ddl:")) {
      const still = run.ddlProblems.find((p) => p.table === issue.table);
      if (still) return { resolved: false, message: `Postgres still rejects it: ${still.error}` };
    } else {
      const still = run.tests.find((t) => t.title === issue.testTitle && t.status === "fail");
      if (still) return { resolved: false, message: `The test still fails: ${still.detail ?? still.title}` };
    }
    const failing = run.tests.filter((t) => t.status === "fail").length + run.ddlProblems.length;
    if (failing > Math.max(0, failingBefore - 1)) {
      const first = run.ddlProblems[0]?.error ?? run.tests.find((t) => t.status === "fail")?.title;
      return { resolved: false, message: `Re-tested in Postgres: it breaks something else (${first}).` };
    }
    return { resolved: true, message: "Re-tested in Postgres: this fixes it." };
  }

  // Design-review findings come from the AI; there's no rule to re-check.
  if (issue.id.startsWith("review:")) {
    return { resolved: true, message: "Applies cleanly with no new problems. Design suggestions can't be verified automatically: review the change." };
  }

  const remaining = [...lintErd(after), ...promptCoverage(prompt, after)];
  if (remaining.some((i) => i.id === issue.id)) return { resolved: false, message: "Checked: the problem is still there." };
  return { resolved: true, message: "Checked: this fixes it." };
}
