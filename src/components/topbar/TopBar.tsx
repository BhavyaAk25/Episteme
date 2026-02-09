"use client";

import { useCallback, useEffect } from "react";
import Image from "next/image";
import { useProjectStore } from "@/store/useProjectStore";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useSimulationStore } from "@/store/useSimulationStore";
import { useUIStore } from "@/store/useUIStore";
import { PhaseProgress } from "./PhaseProgress";
import { erdToNodes, erdToEdges, erdToSql } from "@/lib/ontology/transformer";
import { runSimulation } from "@/lib/simulation/testRunner";
import { verifyPatchedSchema } from "@/lib/simulation/autofixRunner";
import type { Patch } from "@/types/simulation";

interface AutoFixApiResponse {
  patches: Patch[];
  warnings?: string[];
}

function shouldIgnoreShortcuts(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

  export function TopBar() {
  const {
    prompt,
    setPrompt,
    isGenerating,
    currentPhase,
    startGeneration,
    erd,
    setSchemaSql,
    generationMode,
    fallbackDomain,
    generationWarning,
    templateId,
    geminiAttempted,
    fallbackReason,
    domainDecisionSource,
  } = useProjectStore();
  const { setNodes, setEdges } = useCanvasStore();
  const { isRunning: isSimulating, isFixing, results } = useSimulationStore();
  const { openExportModal } = useUIStore();
  const hasOpenIncidents = (results?.incidents ?? []).some((incident) => incident.status === "open");

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;
    startGeneration();

    // Reset canvas
    setNodes([]);
    setEdges([]);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, templateId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Generation failed");
      }

      const result = await response.json();

      // Store the generation result
      useProjectStore.getState().setGenerationResult(result);

      // Transform ERD to nodes and edges
      if (result.erd && result.ontology) {
        const nodes = erdToNodes(result.erd, result.ontology);
        const edges = erdToEdges(result.erd);
        setNodes(nodes);
        setEdges(edges);

        // Generate SQL
        const sql = erdToSql(result.erd);
        setSchemaSql(sql);
      }
    } catch (error) {
      useProjectStore.getState().setErrorWithTitle(
        "Generation Failed",
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  }, [prompt, isGenerating, startGeneration, setNodes, setEdges, setSchemaSql, templateId]);

  const handleSimulate = useCallback(async () => {
    if (!erd || isSimulating) return;

    const {
      startSimulation,
      stopSimulation,
      setResults,
      addTestResult,
      addIncident,
      reset: resetSimulation,
    } = useSimulationStore.getState();
    const { openDrawer } = useUIStore.getState();

    // Reset and start simulation
    resetSimulation();
    startSimulation();
    openDrawer();

    try {
      const results = await runSimulation(erd, (testResult) => {
        addTestResult(testResult);
        if (!testResult.passed) {
          addIncident({
            id: `incident_${testResult.testId}`,
            testResult,
            status: "open",
            rootCause: null,
            suggestedFix: null,
            patch: null,
            createdAt: Date.now(),
            fixedAt: null,
          });
        }
      });

      setResults(results);
    } catch (error) {
      stopSimulation();
      useProjectStore.getState().setErrorWithTitle(
        "Simulation Failed",
        error instanceof Error ? error.message : "Simulation failed"
      );
    }
  }, [erd, isSimulating]);

  const handleAutoFix = async () => {
    if (!erd || isFixing || isSimulating || isGenerating) return;

    const simulationStore = useSimulationStore.getState();
    const currentResults = simulationStore.results;

    if (!currentResults) {
      useProjectStore.getState().setErrorWithTitle(
        "Auto-Fix Unavailable",
        "Run simulation first to generate incidents."
      );
      return;
    }

    const targetIncidents = currentResults.incidents.filter(
      (incident) => incident.status === "open"
    );

    if (targetIncidents.length === 0) {
      useProjectStore.getState().setErrorWithTitle(
        "Auto-Fix Unavailable",
        "No open incidents to auto-fix."
      );
      return;
    }

    simulationStore.startFixing();
    for (const incident of targetIncidents) {
      simulationStore.updateIncidentStatus(incident.id, "fixing");
    }

    const originalSchemaSql = currentResults.schemaSql;

    try {
      const response = await fetch("/api/autofix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaSql: originalSchemaSql,
          incidents: targetIncidents,
          erd,
          maxIncidents: targetIncidents.length,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Auto-fix generation failed");
      }

      const { patches, warnings } = payload as AutoFixApiResponse;
      if (!patches || patches.length === 0) {
        throw new Error("No patches were generated for the current incidents.");
      }

      const verification = await verifyPatchedSchema(erd, patches);
      const patchByIncidentId = new Map<string, Patch>(
        patches.map((patch) => [patch.incidentId, patch])
      );
      const patchVerificationByIncidentId = new Map(
        verification.patchVerifications.map((entry) => [entry.patch.incidentId, entry])
      );

      const updatedIncidents = currentResults.incidents.map((incident) => {
        const generatedPatch = patchByIncidentId.get(incident.id);
        if (!generatedPatch) {
          if (incident.status === "fixing") {
            return { ...incident, status: "wont_fix" as const };
          }
          return incident;
        }

        const patchExecution = patchVerificationByIncidentId.get(incident.id);
        const rerunResult = verification.testResultById[incident.testResult.testId];
        const verified = Boolean(patchExecution?.applied && rerunResult?.passed);
        const verificationError = patchExecution?.error ?? rerunResult?.error ?? null;
        const patchWithMetadata: Patch = {
          ...generatedPatch,
          beforeSchemaSql: originalSchemaSql,
          afterSchemaSql: `${originalSchemaSql}\n\n${generatedPatch.migrationSql}`.trim(),
          verified,
          verificationError,
        };

        if (!verified) {
          return {
            ...incident,
            status: "open" as const,
            patch: patchWithMetadata,
            rootCause: generatedPatch.rootCause,
            suggestedFix: generatedPatch.explanation,
          };
        }

        return {
          ...incident,
          status: "fixed" as const,
          patch: patchWithMetadata,
          rootCause: generatedPatch.rootCause,
          suggestedFix: generatedPatch.explanation,
          fixedAt: Date.now(),
          testResult: rerunResult ?? incident.testResult,
        };
      });

      simulationStore.setResults({
        ...currentResults,
        totalTests: verification.totalTests,
        passedCount: verification.passedCount,
        failedCount: verification.failedCount,
        testResults: verification.testResults,
        incidents: updatedIncidents,
        completedAt: Date.now(),
      });

      if (warnings && warnings.length > 0) {
        useProjectStore.getState().setErrorWithTitle(
          "Auto-Fix Notice",
          warnings.join(" ")
        );
      }
    } catch (error) {
      for (const incident of targetIncidents) {
        simulationStore.updateIncidentStatus(incident.id, "open");
      }

      useProjectStore.getState().setErrorWithTitle(
        "Auto-Fix Failed",
        error instanceof Error ? error.message : "Auto-fix failed"
      );
    } finally {
      simulationStore.stopFixing();
    }
  };

  const handleExport = useCallback(() => {
    if (!erd) return;
    openExportModal();
  }, [erd, openExportModal]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const hasModifier = event.ctrlKey || event.metaKey;
      if (!hasModifier || shouldIgnoreShortcuts(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "g") {
        event.preventDefault();
        void handleGenerate();
      } else if (key === "s") {
        event.preventDefault();
        void handleSimulate();
      } else if (key === "e") {
        event.preventDefault();
        handleExport();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleGenerate, handleSimulate, handleExport]);

  const statusText = generationMode === "fallback"
    ? fallbackReason === "quota"
      ? "Gemini quota exhausted"
      : fallbackReason === "parse_error"
        ? "Gemini parse issue"
        : "Fallback mode"
    : generationMode === "gemini"
      ? "Gemini live"
      : "Ready";

  const statusTone = generationMode === "fallback"
    ? "bg-[#FFF3E0] text-[#E65100]"
    : generationMode === "gemini"
      ? "bg-[#E8F5E9] text-[#2E7D32]"
      : "bg-[rgba(0,0,0,0.04)] text-muted";

  const domainLabel = generationMode === "fallback"
    ? `${domainDecisionSource === "template_hint" ? "template" : domainDecisionSource ?? "auto"} · ${fallbackDomain ?? "generic"}`
    : null;

  const selectedTemplateLabel = templateId
    ? templateId === "saas"
      ? "SaaS"
      : templateId === "ecommerce"
        ? "E-Commerce"
        : "Inventory"
    : null;

  const showStatusRow =
    isGenerating ||
    Boolean(currentPhase) ||
    Boolean(erd) ||
    generationMode !== null ||
    Boolean(generationWarning) ||
    geminiAttempted;

  return (
    <header className="bg-surface/94 backdrop-blur border-b border-border px-4 md:px-6 pt-[calc(env(safe-area-inset-top,0px)+12px)] shadow-[0_6px_18px_rgba(86,61,38,0.08)]">
      <div className="min-h-[92px] flex items-center">
        <div className="flex items-center gap-4 w-full min-w-0">
          <div className="flex items-center gap-2.5 shrink-0 min-w-[152px]">
            <div className="w-10 h-10 flex items-center justify-center">
              <Image
                src="/brand/episteme-mark.svg"
                alt="Episteme logo"
                width={40}
                height={40}
                className="w-10 h-10 object-contain"
              />
            </div>
            <span className="font-display text-[2rem] leading-none tracking-tight text-foreground hidden sm:block">
              Episteme
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value, null)}
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              placeholder="Describe your system... (e.g., 'inventory management for sneaker brand')"
              className="w-full min-w-0 h-11 px-4 rounded-xl bg-canvas border border-border text-foreground text-[0.95rem] placeholder:text-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
              disabled={isGenerating}
            />
          </div>

          <button
            onClick={handleGenerate}
            title="Generate (Ctrl/Cmd + G)"
            disabled={!prompt.trim() || isGenerating}
            className="ui-primary-btn disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 shrink-0"
          >
            {isGenerating ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Generating...
              </>
            ) : (
              "Generate"
            )}
          </button>

          <div className="flex items-center gap-3 shrink-0 mr-12 md:mr-16">
            <button
              onClick={handleSimulate}
              title="Simulate (Ctrl/Cmd + S)"
              disabled={!erd || isSimulating || isGenerating}
              className="ui-ghost-btn disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Simulate
            </button>
            <button
              onClick={handleAutoFix}
              disabled={!erd || isFixing || isSimulating || isGenerating || !hasOpenIncidents}
              className="ui-ghost-btn disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isFixing ? "Fixing..." : "Auto-Fix"}
            </button>
            <button
              onClick={handleExport}
              title="Export (Ctrl/Cmd + E)"
              disabled={!erd}
              className="ui-ghost-btn disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Export
            </button>
          </div>
        </div>
      </div>

      {showStatusRow && (
        <div className="h-9 flex items-center gap-2.5 border-t border-border/60">
          <div className="flex items-center gap-2 shrink-0">
            <span
              title={generationWarning ?? "Generation status"}
              className={`inline-flex items-center px-2.5 py-0.5 text-[11px] font-medium rounded-xl border-0 ${statusTone}`}
            >
              {statusText}
            </span>
            {selectedTemplateLabel && (
              <span className="inline-flex items-center px-2.5 py-0.5 text-[11px] font-medium rounded-xl bg-[rgba(0,0,0,0.04)] text-muted">
                {selectedTemplateLabel}
              </span>
            )}
            {domainLabel && (
              <span className="hidden xl:inline-flex items-center px-2.5 py-0.5 text-[11px] font-medium rounded-xl bg-[rgba(0,0,0,0.04)] text-muted font-mono">
                {domainLabel}
              </span>
            )}
            {generationMode === "fallback" && geminiAttempted && (
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="text-[12px] text-[#4A9EFF] font-medium hover:underline bg-transparent border-none p-0 cursor-pointer disabled:opacity-50 transition-colors"
              >
                Retry Gemini
              </button>
            )}
          </div>

          <div className="hidden xl:flex min-w-0 flex-1 justify-center">
            <PhaseProgress />
          </div>
        </div>
      )}
    </header>
  );
}
