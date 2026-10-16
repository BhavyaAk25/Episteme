"use client";

import { useProjectStore } from "@/store/useProjectStore";
import { useSimulationStore } from "@/store/useSimulationStore";

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
  const { erd, isGenerating } = useProjectStore();
  const { results, isRunning, isFixing } = useSimulationStore();

  if (!erd && !isGenerating) {
    return null;
  }

  const openIssues = (results?.incidents ?? []).filter((incident) => incident.status === "open").length;

  const steps: Step[] = [
    { label: "Schema", state: isGenerating ? "active" : erd ? "done" : "pending" },
    {
      label: "Verify",
      state: isRunning ? "active" : results ? "done" : "pending",
    },
    {
      label: openIssues > 0 ? `Fix ${openIssues} issue${openIssues === 1 ? "" : "s"}` : "Fix issues",
      state: isFixing
        ? "active"
        : !results
          ? "pending"
          : openIssues > 0
            ? "attention"
            : "done",
    },
  ];

  return (
    <ol className="flex items-center" aria-label="Workflow progress">
      {steps.map((step, index) => (
        <li key={step.label} className="flex items-center">
          <div className="flex items-center gap-1.5">
            {step.state === "done" ? (
              <span className="w-4 h-4 rounded-full bg-[#2E7D32] flex items-center justify-center">
                <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </span>
            ) : step.state === "active" ? (
              <span className="w-3.5 h-3.5 rounded-full border-2 border-[#1565C0]/30 border-t-[#1565C0] animate-spin" />
            ) : step.state === "attention" ? (
              <span className="w-3 h-3 rounded-full bg-warning" />
            ) : (
              <span className="w-2.5 h-2.5 rounded-full bg-[#bbb]" />
            )}
            <span
              className={`text-[12px] ${
                step.state === "done"
                  ? "text-[#2E7D32]"
                  : step.state === "active"
                    ? "text-[#1565C0] font-semibold"
                    : step.state === "attention"
                      ? "text-warning font-semibold"
                      : "text-[#999]"
              }`}
            >
              {step.label}
            </span>
          </div>
          {index < steps.length - 1 && (
            <span className={`w-8 h-px mx-2 ${step.state === "done" ? "bg-[#2E7D32]" : "bg-[rgba(0,0,0,0.15)]"}`} />
          )}
        </li>
      ))}
    </ol>
  );
}
