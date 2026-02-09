"use client";

import type { Incident } from "@/types/simulation";
import { PatchDiffView } from "./PatchDiffView";

interface IncidentCardProps {
  incident: Incident;
}

const statusConfig = {
  open: {
    label: "Open",
    className: "bg-error/20 text-error",
  },
  fixing: {
    label: "Fixing",
    className: "bg-warning/20 text-warning",
  },
  fixed: {
    label: "Fixed",
    className: "bg-success/20 text-success",
  },
  wont_fix: {
    label: "Won't Fix",
    className: "bg-muted/20 text-muted",
  },
};

export function IncidentCard({ incident }: IncidentCardProps) {
  const config = statusConfig[incident.status];

  return (
    <div className="p-3 rounded-lg bg-node border border-border hover:border-border-hover transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${config.className}`}>
              {config.label}
            </span>
            <span className="text-xs text-muted font-mono">
              {incident.testResult.category}
            </span>
          </div>
          <h4 className="font-mono text-sm text-foreground mt-1 truncate">
            {incident.testResult.testName}
          </h4>
          {incident.testResult.error && (
            <p className="text-xs text-error mt-1 line-clamp-2 font-mono">
              {incident.testResult.error}
            </p>
          )}
        </div>

        {incident.patch && (
          <div className="shrink-0">
            <span className="text-xs text-success">Patched</span>
          </div>
        )}
      </div>

      {incident.rootCause && (
        <div className="mt-2 p-2 rounded bg-surface text-xs text-muted">
          <span className="font-medium text-foreground">Root cause: </span>
          {incident.rootCause}
        </div>
      )}

      {incident.patch && (
        <div className="mt-2">
          <details className="group">
            <summary className="text-xs text-accent cursor-pointer hover:text-accent/80">
              View patch and diff
            </summary>
            {incident.patch.explanation && (
              <p className="mt-2 text-xs text-muted">
                {incident.patch.explanation}
              </p>
            )}
            <pre className="mt-2 p-2 rounded bg-canvas text-xs text-foreground font-mono overflow-x-auto">
              {incident.patch.migrationSql}
            </pre>
            {incident.patch.beforeSchemaSql && incident.patch.afterSchemaSql && (
              <PatchDiffView
                beforeSql={incident.patch.beforeSchemaSql}
                afterSql={incident.patch.afterSchemaSql}
              />
            )}
            {incident.patch.verified === false && incident.patch.verificationError && (
              <p className="mt-2 text-xs text-error font-mono">
                Verification failed: {incident.patch.verificationError}
              </p>
            )}
          </details>
        </div>
      )}
    </div>
  );
}
