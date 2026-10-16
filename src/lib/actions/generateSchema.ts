import { useProjectStore } from "@/store/useProjectStore";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useSimulationStore } from "@/store/useSimulationStore";
import { erdToNodes, erdToEdges, erdToSql } from "@/lib/ontology/transformer";

interface GenerateErrorBody {
  error?: string;
  errorCode?: string;
  reason?: string;
  retryAfterSec?: number | null;
}

/**
 * Generate a schema from the current prompt.
 *
 * The existing schema stays on the canvas until a new one arrives, so a
 * failed request never wipes the user's work.
 */
export async function generateSchema(): Promise<void> {
  const project = useProjectStore.getState();
  const { prompt, templateId, isGenerating } = project;
  if (!prompt.trim() || isGenerating) return;

  project.startGeneration();

  let response: Response;
  try {
    response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, templateId }),
    });
  } catch {
    useProjectStore.getState().setGenerationError({
      message: "Couldn't reach the server. Check your connection and try again.",
      reason: "network",
      retryAfterSec: null,
    });
    return;
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const errorBody = (body ?? {}) as GenerateErrorBody;
    useProjectStore.getState().setGenerationError({
      message: errorBody.error || `Generation failed (HTTP ${response.status}).`,
      reason: errorBody.reason ?? null,
      retryAfterSec: errorBody.retryAfterSec ?? null,
    });
    return;
  }

  const result = body as Parameters<ReturnType<typeof useProjectStore.getState>["setGenerationResult"]>[0];
  useProjectStore.getState().setGenerationResult(result);

  // Results from the previous schema no longer apply.
  useSimulationStore.getState().reset();

  const canvas = useCanvasStore.getState();
  canvas.selectNode(null);
  if (result.erd && result.ontology) {
    canvas.setNodes(erdToNodes(result.erd, result.ontology));
    canvas.setEdges(erdToEdges(result.erd));
    useProjectStore.getState().setSchemaSql(erdToSql(result.erd));
  } else {
    canvas.setNodes([]);
    canvas.setEdges([]);
  }
}
