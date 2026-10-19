import { create } from "zustand";
import type { Issue } from "@/lib/verify/linter";
import { askForReview } from "@/lib/actions/assist";
import { useProjectsStore } from "./useProjectsStore";

/**
 * AI design review findings for the current project. They join the Issues
 * list (each with "Ask AI to fix") until dismissed, fixed or re-reviewed.
 */
interface ReviewState {
  status: "idle" | "loading" | "done" | "error";
  projectId: string | null;
  findings: Issue[];
  error: string | null;
  review: () => Promise<void>;
  dismiss: (id: string) => void;
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  status: "idle",
  projectId: null,
  findings: [],
  error: null,

  review: async () => {
    if (get().status === "loading") return;
    const projectId = useProjectsStore.getState().currentProjectId;
    set({ status: "loading", error: null });
    const result = await askForReview();
    if (!result.ok) {
      set({ status: "error", error: result.error });
      return;
    }
    set({
      status: "done",
      projectId,
      findings: result.data.findings.map((f, i) => ({
        id: `review:${Date.now()}:${i}`,
        severity: f.severity,
        table: f.table,
        title: f.title,
        detail: f.detail,
        askAi: f.fix_request || `Fix this design problem: ${f.title}`,
      })),
    });
  },

  dismiss: (id) => set({ findings: get().findings.filter((f) => f.id !== id) }),
}));
