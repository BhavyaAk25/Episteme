"use client";

import { useProjectStore } from "@/store/useProjectStore";
import type { BuildPhase } from "@/types/gemini";

const phases: { key: BuildPhase; label: string }[] = [
  { key: "plan", label: "Plan" },
  { key: "ontology", label: "Ontology" },
  { key: "erd", label: "ERD" },
  { key: "constraints", label: "Constraints" },
  { key: "actions", label: "Actions" },
  { key: "verify", label: "Verify" },
];

export function PhaseProgress() {
  const { currentPhase, isGenerating } = useProjectStore();

  if (!currentPhase && !isGenerating) {
    return null;
  }

  const currentIndex = phases.findIndex((p) => p.key === currentPhase);

  return (
    <div className="flex items-center">
      {phases.map((phase, index) => {
        const isComplete = currentIndex > index;
        const isCurrent = currentIndex === index;

        return (
          <div key={phase.key} className="flex items-center">
            <div className="flex items-center gap-1.5">
              {/* Dot / checkmark / spinner */}
              {isComplete ? (
                <div className="w-4 h-4 rounded-full bg-[#2E7D32] flex items-center justify-center">
                  <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              ) : isCurrent && isGenerating ? (
                <div className="w-3 h-3 rounded-full bg-[#1565C0] animate-pulse" />
              ) : (
                <div className="w-2.5 h-2.5 rounded-full bg-[#999]" />
              )}
              <span
                className={`text-[12px] ${
                  isComplete
                    ? "text-[#2E7D32]"
                    : isCurrent
                    ? "text-[#1565C0] font-semibold"
                    : "text-[#999]"
                }`}
              >
                {phase.label}
              </span>
            </div>
            {/* Connecting line */}
            {index < phases.length - 1 && (
              <div className={`w-6 h-px mx-1 ${isComplete ? "bg-[#2E7D32]" : "bg-[rgba(0,0,0,0.15)]"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
