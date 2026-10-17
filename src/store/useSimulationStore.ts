import { create } from "zustand";
import type { VerifyRun } from "@/lib/verify/runner";
import { useErdStore } from "./useErdStore";

/**
 * Results of running the schema in real Postgres (PGlite). Cleared whenever
 * the schema changes, since they describe one version of it.
 */
interface SimulationState {
  isRunning: boolean;
  progress: string | null;
  run: VerifyRun | null;
  error: string | null;
  runTests: () => Promise<void>;
  reset: () => void;
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  isRunning: false,
  progress: null,
  run: null,
  error: null,

  runTests: async () => {
    const erd = useErdStore.getState().erd;
    if (!erd || erd.tables.length === 0 || get().isRunning) return;
    set({ isRunning: true, progress: "Starting Postgres…", error: null, run: null });
    try {
      const { runVerification } = await import("@/lib/verify/runner");
      const run = await runVerification(erd, (progress) => set({ progress }));
      // Ignore results if the schema changed while tests were running.
      if (useErdStore.getState().erd === erd) set({ run });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Couldn't run the database tests." });
    } finally {
      set({ isRunning: false, progress: null });
    }
  },

  reset: () => set({ run: null, error: null, progress: null }),
}));
