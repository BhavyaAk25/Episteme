"use client";

import { useEffect, useState } from "react";
import { useProjectsStore } from "@/store/useProjectsStore";

function ago(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
}

/** Quiet autosave status: "Saving…" / "Saved · just now" / "Not saved". */
export function SaveIndicator() {
  const saveState = useProjectsStore((state) => state.saveState);
  const lastSavedAt = useProjectsStore((state) => state.lastSavedAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  if (saveState === "idle") return null;

  const label =
    saveState === "pending" || saveState === "saving"
      ? "Saving…"
      : saveState === "error"
        ? "Not saved (browser storage unavailable)"
        : `Saved${lastSavedAt ? ` · ${ago(lastSavedAt, now)}` : ""}`;

  return (
    <span
      className={`hidden md:inline-flex items-center gap-1.5 text-[12px] shrink-0 ${saveState === "error" ? "text-error" : "text-muted"}`}
      title="Projects are saved automatically in this browser"
      aria-live="polite"
    >
      {saveState === "saved" && (
        <svg className="w-3.5 h-3.5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      )}
      {label}
    </span>
  );
}
