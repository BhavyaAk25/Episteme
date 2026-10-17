"use client";

import { useProjectsStore } from "@/store/useProjectsStore";
import { useErdStore } from "@/store/useErdStore";
import { timeAgo } from "./ProjectSwitcher";

/** Saved versions of the open project. Restoring is itself undoable. */
export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const { versions, addVersion, restoreVersion } = useProjectsStore();
  const hasTables = useErdStore((state) => (state.erd?.tables.length ?? 0) > 0);

  return (
    <div className="mt-2 w-[320px] rounded-xl border border-border bg-surface shadow-xl overflow-hidden">
      <div className="px-3 py-2.5 border-b border-border flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-foreground">Version history</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void addVersion("Saved by you")}
            disabled={!hasTables}
            className="h-7 px-2.5 rounded-md text-[12px] font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            Save version
          </button>
          <button onClick={onClose} aria-label="Close history" className="w-7 h-7 rounded-md text-muted hover:text-foreground">
            ×
          </button>
        </div>
      </div>
      {versions.length === 0 ? (
        <p className="px-3 py-4 text-[12px] text-muted">
          No versions yet. One is saved each time you generate, apply an AI change, or click Save version.
        </p>
      ) : (
        <ul className="max-h-[320px] overflow-y-auto py-1">
          {versions.map((version, index) => (
            <li key={version.id} className="group px-3 py-2 flex items-start justify-between gap-3 hover:bg-foreground/[0.03]">
              <span className="min-w-0">
                <span className="block text-[12px] text-foreground leading-snug break-words">{version.label}</span>
                <span className="block text-[11px] text-muted">
                  {timeAgo(version.createdAt)} · {version.tableCount} table{version.tableCount === 1 ? "" : "s"}
                  {index === 0 ? " · latest" : ""}
                </span>
              </span>
              <button
                onClick={() => void restoreVersion(version.id)}
                className="shrink-0 h-7 px-2.5 rounded-md border border-border text-[11px] font-medium text-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-elevated transition-opacity"
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
