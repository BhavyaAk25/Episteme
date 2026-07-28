import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { BuildPhase, BuildScript, Plan, GenerationResponse } from "@/types/gemini";
import type { Ontology } from "@/types/ontology";
import type { ERD } from "@/types/erd";

interface ProjectState {
  // Input
  prompt: string;
  templateId: "inventory" | "saas" | "ecommerce" | null;

  // Generation state
  isGenerating: boolean;
  currentPhase: BuildPhase | null;
  error: string | null;
  errorTitle: string | null;

  // Generated data
  plan: Plan | null;
  ontology: Ontology | null;
  erd: ERD | null;
  buildScript: BuildScript | null;
  schemaSql: string | null;
  generationMode: "gemini" | "fallback" | null;
  fallbackDomain: "inventory" | "saas" | "ecommerce" | "generic" | null;
  generationWarning: string | null;
  geminiAttempted: boolean;
  fallbackReason: "quota" | "parse_error" | "validation_error" | "provider_error" | "config_error" | null;
  domainDecisionSource: "template_hint" | "classifier" | "gemini" | null;

  // Build animation
  currentBuildStep: number;
  isPlaying: boolean;

  // Actions
  setPrompt: (prompt: string, templateId?: "inventory" | "saas" | "ecommerce" | null) => void;
  startGeneration: () => void;
  setPhase: (phase: BuildPhase) => void;
  setGenerationResult: (result: GenerationResponse) => void;
  setError: (error: string | null) => void;
  setErrorWithTitle: (title: string, error: string) => void;
  setSchemaSql: (sql: string) => void;

  // Animation controls
  setCurrentBuildStep: (step: number) => void;
  setIsPlaying: (playing: boolean) => void;
  nextBuildStep: () => void;

  // Reset
  reset: () => void;
}

const initialState = {
  prompt: "",
  templateId: null as "inventory" | "saas" | "ecommerce" | null,
  isGenerating: false,
  currentPhase: null,
  error: null,
  errorTitle: null,
  plan: null,
  ontology: null,
  erd: null,
  buildScript: null,
  schemaSql: null,
  generationMode: null,
  fallbackDomain: null,
  generationWarning: null,
  geminiAttempted: false,
  fallbackReason: null as "quota" | "parse_error" | "validation_error" | "provider_error" | "config_error" | null,
  domainDecisionSource: null as "template_hint" | "classifier" | "gemini" | null,
  currentBuildStep: 0,
  isPlaying: false,
};

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
  ...initialState,

  setPrompt: (prompt, templateId) => set({ prompt, templateId: templateId ?? null }),

  startGeneration: () => set({
    isGenerating: true,
    currentPhase: "plan",
    error: null,
    generationWarning: null,
    fallbackDomain: null,
    generationMode: null,
    geminiAttempted: false,
    fallbackReason: null,
    domainDecisionSource: null,
    currentBuildStep: 0,
    isPlaying: false,
  }),

  setPhase: (phase) => set({ currentPhase: phase }),

  setGenerationResult: (result) => set({
    plan: result.plan,
    ontology: result.ontology,
    erd: result.erd,
    buildScript: result.buildScript,
    generationMode: result.generationMode ?? result.source ?? "gemini",
    fallbackDomain: result.fallbackDomain ?? null,
    generationWarning: result.warning ?? null,
    geminiAttempted: result.geminiAttempted ?? false,
    fallbackReason: result.fallbackReason ?? null,
    domainDecisionSource: result.domainDecisionSource ?? null,
    isGenerating: false,
    currentPhase: "verify",
  }),

  setError: (error) => set({
    error,
    errorTitle: error ? "Error" : null,
    isGenerating: false,
  }),

  setErrorWithTitle: (title, error) => set({
    error,
    errorTitle: error ? title : null,
    isGenerating: false,
  }),

  setSchemaSql: (sql) => set({ schemaSql: sql }),

  setCurrentBuildStep: (step) => set({ currentBuildStep: step }),

  setIsPlaying: (playing) => set({ isPlaying: playing }),

  nextBuildStep: () => {
    const { buildScript, currentBuildStep } = get();
    if (buildScript && currentBuildStep < buildScript.steps.length - 1) {
      set({ currentBuildStep: currentBuildStep + 1 });
    } else {
      set({ isPlaying: false });
    }
  },

  reset: () => set(initialState),
    }),
    {
      name: "episteme-project",
      storage: createJSONStorage(() => localStorage),
      // Manually rehydrated on the client (see page.tsx) so server and client
      // render the same empty state first and never mismatch.
      skipHydration: true,
      // Persist generated artifacts only — never transient/loading flags.
      partialize: (state) => ({
        prompt: state.prompt,
        templateId: state.templateId,
        plan: state.plan,
        ontology: state.ontology,
        erd: state.erd,
        buildScript: state.buildScript,
        schemaSql: state.schemaSql,
        generationMode: state.generationMode,
        fallbackDomain: state.fallbackDomain,
        generationWarning: state.generationWarning,
        geminiAttempted: state.geminiAttempted,
        fallbackReason: state.fallbackReason,
        domainDecisionSource: state.domainDecisionSource,
      }),
    }
  )
);
