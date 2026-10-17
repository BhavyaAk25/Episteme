import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { BuildPhase, Plan, GenerationResponse } from "@/types/gemini";
import type { Ontology } from "@/types/ontology";

export interface GenerationProgress {
  phase: "plan" | "ontology" | "erd" | "relationships";
  tables: string[];
}

export interface GenerationError {
  message: string;
  reason: string | null;
  retryAfterSec: number | null;
}

interface ProjectState {
  // Input
  prompt: string;
  templateId: "inventory" | "saas" | "ecommerce" | null;

  // Generation state
  isGenerating: boolean;
  currentPhase: BuildPhase | null;
  error: string | null;
  errorTitle: string | null;
  generationStartedAt: number | null;
  generationError: GenerationError | null;
  generationProgress: GenerationProgress | null;

  // Generated data
  plan: Plan | null;
  ontology: Ontology | null;
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
  setGenerationError: (error: GenerationError | null) => void;
  setGenerationProgress: (progress: GenerationProgress | null) => void;

  // Animation controls
  setCurrentBuildStep: (step: number) => void;
  setIsPlaying: (playing: boolean) => void;

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
  generationStartedAt: null as number | null,
  generationError: null as GenerationError | null,
  generationProgress: null as GenerationProgress | null,
  plan: null,
  ontology: null,
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
    (set) => ({
  ...initialState,

  setPrompt: (prompt, templateId) => set({ prompt, templateId: templateId ?? null }),

  // Only transient flags are reset here. The previous schema (and its
  // generation metadata) stays on screen until a new one actually arrives,
  // so a failed generation never wipes the user's work.
  startGeneration: () => set({
    isGenerating: true,
    generationStartedAt: Date.now(),
    generationError: null,
    generationProgress: null,
    error: null,
    currentBuildStep: 0,
    isPlaying: false,
  }),

  setPhase: (phase) => set({ currentPhase: phase }),

  setGenerationResult: (result) => set({
    plan: result.plan,
    ontology: result.ontology,
    generationMode: result.generationMode ?? result.source ?? "gemini",
    fallbackDomain: result.fallbackDomain ?? null,
    generationWarning: result.warning ?? null,
    geminiAttempted: result.geminiAttempted ?? false,
    fallbackReason: result.fallbackReason ?? null,
    domainDecisionSource: result.domainDecisionSource ?? null,
    isGenerating: false,
    generationStartedAt: null,
    generationError: null,
    currentPhase: "verify",
  }),

  setError: (error) => set({
    error,
    errorTitle: error ? "Error" : null,
    isGenerating: false,
    generationStartedAt: null,
  }),

  setErrorWithTitle: (title, error) => set({
    error,
    errorTitle: error ? title : null,
    isGenerating: false,
    generationStartedAt: null,
  }),

  setGenerationProgress: (generationProgress) => set({ generationProgress }),

  setGenerationError: (generationError) => set({
    generationError,
    isGenerating: false,
    generationStartedAt: null,
  }),

  setCurrentBuildStep: (step) => set({ currentBuildStep: step }),

  setIsPlaying: (playing) => set({ isPlaying: playing }),


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
