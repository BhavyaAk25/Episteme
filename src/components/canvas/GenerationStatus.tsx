"use client";

import { useEffect, useState } from "react";
import { useProjectStore } from "@/store/useProjectStore";
import { useUIStore } from "@/store/useUIStore";
import { useCanvasStore } from "@/store/useCanvasStore";
import { generateSchema } from "@/lib/actions/generateSchema";

function useElapsedSeconds(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
}

/**
 * Honest generation feedback on the canvas: a loading card with elapsed
 * time while the AI works, and a clear error card (with next steps) when it
 * fails. Never shows fake progress.
 */
export function GenerationStatus() {
  const { isGenerating, generationStartedAt, generationError, setGenerationError } = useProjectStore();
  const hasNodes = useCanvasStore((state) => state.nodes.length > 0);
  const elapsed = useElapsedSeconds(isGenerating ? generationStartedAt : null);

  if (isGenerating) {
    if (hasNodes) {
      return (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5 rounded-full border border-border bg-surface px-4 py-2 shadow-md">
          <span className="w-3.5 h-3.5 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
          <span className="text-[13px] text-foreground">Generating a new schema… {elapsed}s</span>
        </div>
      );
    }

    return (
      <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
        <div className="w-[380px] max-w-[90%] rounded-xl border border-border bg-surface p-6 shadow-lg text-center">
          <span className="inline-block w-6 h-6 rounded-full border-[3px] border-accent/25 border-t-accent animate-spin" />
          <h3 className="mt-3 text-[15px] font-semibold text-foreground">Designing your schema</h3>
          <p className="mt-1 text-[13px] text-muted">
            The AI is working out tables, columns and relationships. This usually takes 20–60 seconds.
          </p>
          <p className="mt-3 font-mono text-[12px] text-muted">{elapsed}s elapsed</p>
        </div>
      </div>
    );
  }

  if (!generationError) {
    return null;
  }

  const showTemplates = () => {
    const ui = useUIStore.getState();
    if (!ui.sidebarOpen) ui.toggleSidebar();
    setGenerationError(null);
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(56,40,22,0.12)] p-4">
      <div role="alert" className="w-[440px] max-w-full rounded-xl border border-border bg-surface p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 w-9 h-9 shrink-0 rounded-full bg-error/15 flex items-center justify-center">
            <svg className="w-5 h-5 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-foreground">Couldn&apos;t generate a schema</h3>
            <p className="mt-1 text-[13px] text-muted">{generationError.message}</p>
            {generationError.retryAfterSec ? (
              <p className="mt-1 text-[12px] text-muted">Try again in about {generationError.retryAfterSec}s.</p>
            ) : null}
            <p className="mt-2 text-[13px] text-muted">
              Nothing was changed{hasNodes ? " — your current schema is still here" : ""}. You can try again, or start from one of the built-in templates.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {hasNodes && (
            <button onClick={() => setGenerationError(null)} className="ui-ghost-btn">
              Dismiss
            </button>
          )}
          <button onClick={showTemplates} className="ui-ghost-btn">
            Use a template
          </button>
          <button onClick={() => void generateSchema()} className="ui-primary-btn">
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
