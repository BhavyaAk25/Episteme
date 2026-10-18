"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/utils/reportError";

/** Friendly crash screen instead of a blank page. Work is saved in the browser. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportError("react", error), [error]);
  return (
    <div className="h-screen flex items-center justify-center bg-canvas p-6">
      <div className="max-w-md rounded-xl border border-border bg-surface p-6 shadow-lg">
        <h1 className="text-[17px] font-semibold text-foreground">Something went wrong</h1>
        <p className="mt-2 text-[13px] text-muted">
          Episteme hit an unexpected error. Your projects are saved in this browser, so nothing should be lost. The problem was reported automatically.
        </p>
        <div className="mt-5 flex gap-2">
          <button onClick={reset} className="ui-primary-btn">Try again</button>
          <button onClick={() => window.location.reload()} className="ui-ghost-btn">Reload page</button>
        </div>
      </div>
    </div>
  );
}
