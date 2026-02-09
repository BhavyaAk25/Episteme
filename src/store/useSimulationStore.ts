import { create } from "zustand";
import type {
  SimulationResults,
  Incident,
  TestResult,
  Patch,
  IncidentStatus,
} from "@/types/simulation";

interface SimulationState {
  isRunning: boolean;
  isFixing: boolean;
  results: SimulationResults | null;

  // Actions
  startSimulation: () => void;
  stopSimulation: () => void;
  setResults: (results: SimulationResults) => void;
  addTestResult: (result: TestResult) => void;
  addIncident: (incident: Incident) => void;
  updateIncidentStatus: (incidentId: string, status: IncidentStatus) => void;
  applyPatch: (incidentId: string, patch: Patch) => void;

  // Fix mode
  startFixing: () => void;
  stopFixing: () => void;

  // Reset
  reset: () => void;
}

const initialState = {
  isRunning: false,
  isFixing: false,
  results: null,
};

export const useSimulationStore = create<SimulationState>((set) => ({
  ...initialState,

  startSimulation: () => set({
    isRunning: true,
    results: {
      totalTests: 0,
      passedCount: 0,
      failedCount: 0,
      testResults: [],
      incidents: [],
      seedPreview: [],
      schemaSql: "",
      startedAt: Date.now(),
      completedAt: null,
    },
  }),

  stopSimulation: () => set({ isRunning: false }),

  setResults: (results) => set({
    results,
    isRunning: false,
  }),

  addTestResult: (result) => set((state) => {
    if (!state.results) return state;
    return {
      results: {
        ...state.results,
        totalTests: state.results.totalTests + 1,
        passedCount: state.results.passedCount + (result.passed ? 1 : 0),
        failedCount: state.results.failedCount + (result.passed ? 0 : 1),
        testResults: [...state.results.testResults, result],
      },
    };
  }),

  addIncident: (incident) => set((state) => {
    if (!state.results) return state;
    return {
      results: {
        ...state.results,
        incidents: [...state.results.incidents, incident],
      },
    };
  }),

  updateIncidentStatus: (incidentId, status) => set((state) => {
    if (!state.results) return state;
    return {
      results: {
        ...state.results,
        incidents: state.results.incidents.map((inc) =>
          inc.id === incidentId
            ? { ...inc, status, fixedAt: status === "fixed" ? Date.now() : inc.fixedAt }
            : inc
        ),
      },
    };
  }),

  applyPatch: (incidentId, patch) => set((state) => {
    if (!state.results) return state;
    return {
      results: {
        ...state.results,
        incidents: state.results.incidents.map((inc) =>
          inc.id === incidentId
            ? { ...inc, patch, status: "fixed" as const, fixedAt: Date.now() }
            : inc
        ),
      },
    };
  }),

  startFixing: () => set({ isFixing: true }),

  stopFixing: () => set({ isFixing: false }),

  reset: () => set(initialState),
}));
