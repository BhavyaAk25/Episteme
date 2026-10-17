import { useProjectStore } from "@/store/useProjectStore";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useSimulationStore } from "@/store/useSimulationStore";
import { useErdStore } from "@/store/useErdStore";
import { useProjectsStore } from "@/store/useProjectsStore";
import { importErd } from "@/lib/erd/model";
import { layoutErd } from "@/lib/erd/layout";

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
      body: JSON.stringify({ prompt, templateId, stream: true }),
    });
  } catch {
    useProjectStore.getState().setGenerationError({
      message: "Couldn't reach the server. Check your connection and try again.",
      reason: "network",
      retryAfterSec: null,
    });
    return;
  }

  // Errors before streaming starts (validation, rate limit) come back as JSON.
  const isStream = response.headers.get("content-type")?.includes("ndjson");
  let body: unknown = null;
  let ok = response.ok;

  if (isStream && response.body) {
    const outcome = await readGenerationStream(response.body);
    body = outcome.body;
    ok = outcome.ok;
  } else {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  }

  if (!ok) {
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

  useCanvasStore.getState().selectNode(null);
  if (result.erd) {
    // Lay out before loading so the new schema arrives as one undoable step
    // (Undo brings back whatever was on the canvas before).
    const erd = importErd(result.erd);
    let positions = {};
    try {
      positions = await layoutErd(erd);
    } catch {
      positions = {};
    }
    const projects = useProjectsStore.getState();
    await projects.checkpoint("Your edits before regenerating");
    useErdStore.getState().loadErd(erd, positions);
    useCanvasStore.getState().requestFit();
    await projects.addVersion(`Generated: ${prompt.slice(0, 80)}`);

    // Name an untitled project after what was generated.
    const current = projects.projects.find((p) => p.id === projects.currentProjectId);
    const domain = (result.plan?.domain ?? "").trim();
    if (current && current.name === "Untitled project" && domain) {
      projects.renameProject(current.id, domain.slice(0, 48));
    }
  }
}

/** Read NDJSON progress events until the final result or error arrives. */
async function readGenerationStream(stream: ReadableStream<Uint8Array>): Promise<{ ok: boolean; body: unknown }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: { ok: boolean; body: unknown } | null = null;

  const handle = (line: string) => {
    if (!line.trim()) return;
    let event: { type?: string; phase?: string; tables?: string[]; payload?: unknown };
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.type === "progress" && event.phase) {
      useProjectStore.getState().setGenerationProgress({
        phase: event.phase as "plan" | "ontology" | "erd" | "relationships",
        tables: event.tables ?? [],
      });
    } else if (event.type === "result") {
      final = { ok: true, body: event.payload };
    } else if (event.type === "error") {
      final = { ok: false, body: event.payload };
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(handle);
    }
    handle(buffer);
  } catch {
    return { ok: false, body: { error: "The connection dropped while generating. Try again." } };
  }

  return final ?? { ok: false, body: { error: "Generation ended without a result. Try again." } };
}
