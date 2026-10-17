"use client";

import { useProjectStore } from "@/store/useProjectStore";
import { useSimulationStore } from "@/store/useSimulationStore";
import { useErdStore } from "@/store/useErdStore";
import { useIssues } from "@/lib/verify/useIssues";

type StepState = "done" | "active" | "attention" | "pending";

interface Step {
  label: string;
  state: StepState;
}

/**
 * Real workflow progress, derived from actual app state:
 * schema generated → tests run → issues fixed.
 */
export function PhaseProgress() {
  const isGenerating = useProjectStore((state) => state.isGenerating);
  const erd = useErdStore((state) => ((state.erd?.tables.length ?? 0) > 0 ? state.erd : null));
  const run = useSimulationStore((state) => state.run);
  const isRunning = useSimulationStore((state) => state.isRunning);
  const issues = useIssues();

  if (!erd && !isGenerating) {
    return null;
  }

  const openIssues = issues.filter((issue) => issue.severity !== "info").length;

  const steps: Step[] = [
    { label: "Schema", state: isGenerating ? "active" : erd ? "done" : "pending" },
    {
      label: "Verify",
      state: isRunning ? "active" : run ? "done" : "pending",
    },
    {
      label: openIssues > 0 ? `Fix ${openIssues} issue${openIssues === 1 ? "" : "s"}` : "Fix issues",
      state: openIssues > 0 ? "attention" : run ? "done" : "pending",
    },
  ];

  return (
    <ol className="flex items-center" aria-label="Workflow progress">
      {steps.map((step, index) => (
        <li key={step.label} className="flex items-center">
          <div className="flex items-center gap-1.5">
            {step.state === "done" ? (
              <span className="w-4 h-4 rounded-full bg-success flex items-center justify-center">
                <svg className="w-2.5 h-2.5 text-canvas" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </span>
            ) : step.state === "active" ? (
              <span className="w-3.5 h-3.5 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
            ) : step.state === "attention" ? (
              <span className="w-3 h-3 rounded-full bg-warning" />
            ) : (
              <span className="w-2.5 h-2.5 rounded-full bg-border-hover" />
            )}
            <span
              className={`text-[12px] ${
                step.state === "done"
                  ? "text-success"
                  : step.state === "active"
                    ? "text-accent font-semibold"
                    : step.state === "attention"
                      ? "text-warning font-semibold"
                      : "text-muted"
              }`}
            >
              {step.label}
            </span>
          </div>
          {index < steps.length - 1 && (
            <span className={`w-8 h-px mx-2 ${step.state === "done" ? "bg-success" : "bg-foreground/[0.15]"}`} />
          )}
        </li>
      ))}
    </ol>
  );
}
