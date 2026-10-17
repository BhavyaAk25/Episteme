"use client";

import { useEffect } from "react";
import { useErdStore } from "@/store/useErdStore";

/** Shows why an edit was rejected (invalid name, broken reference, …). */
export function EditorToast() {
  const lastError = useErdStore((state) => state.lastError);
  const clearError = useErdStore((state) => state.clearError);

  useEffect(() => {
    if (!lastError) return;
    const timer = window.setTimeout(clearError, 6000);
    return () => window.clearTimeout(timer);
  }, [lastError, clearError]);

  if (!lastError) return null;

  return (
    <div
      role="alert"
      className="absolute top-3 left-1/2 -translate-x-1/2 z-40 max-w-[520px] flex items-start gap-3 rounded-lg border border-error/30 bg-surface px-4 py-2.5 shadow-lg"
    >
      <span className="mt-1 w-2 h-2 rounded-full bg-error shrink-0" />
      <p className="text-[13px] text-foreground">{lastError}</p>
      <button onClick={clearError} aria-label="Dismiss" className="text-muted hover:text-foreground text-[16px] leading-none">
        ×
      </button>
    </div>
  );
}
