"use client";

import { useMemo, useState } from "react";
import { useProjectStore } from "@/store/useProjectStore";
import { useSimulationStore } from "@/store/useSimulationStore";
import { useUIStore } from "@/store/useUIStore";

export function ExportModal() {
  const { exportModalOpen, closeExportModal } = useUIStore();
  const { schemaSql, ontology, prompt } = useProjectStore();
  const { results } = useSimulationStore();

  const [isExporting, setIsExporting] = useState(false);
  const [includeSql, setIncludeSql] = useState(true);
  const [includeOntology, setIncludeOntology] = useState(true);
  const [includeReport, setIncludeReport] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canExport = useMemo(() => {
    return Boolean(schemaSql && ontology && !isExporting && (includeSql || includeOntology || includeReport));
  }, [schemaSql, ontology, isExporting, includeSql, includeOntology, includeReport]);

  const handleExport = async () => {
    if (!canExport || !schemaSql || !ontology) return;

    setError(null);
    setIsExporting(true);

    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaSql,
          ontology,
          prompt,
          simulationResults: results,
          includeSql,
          includeOntology,
          includeReport,
        }),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "Export request failed");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `episteme_export_${Date.now()}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      closeExportModal();
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  };

  if (!exportModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(56,40,22,0.24)] backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Export Bundle</h2>
            <p className="mt-1 text-sm text-muted">
              Download production-ready artifacts as a single zip package.
            </p>
          </div>
          <button
            onClick={closeExportModal}
            className="h-8 w-8 rounded-md border border-border text-muted hover:text-foreground hover:bg-node transition-colors"
            aria-label="Close export modal"
          >
            ×
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="flex items-center justify-between rounded-lg border border-border bg-canvas px-3 py-2">
            <span className="text-sm text-foreground font-medium">schema.sql</span>
            <input
              type="checkbox"
              checked={includeSql}
              onChange={(event) => setIncludeSql(event.target.checked)}
            />
          </label>

          <label className="flex items-center justify-between rounded-lg border border-border bg-canvas px-3 py-2">
            <span className="text-sm text-foreground font-medium">ontology.json</span>
            <input
              type="checkbox"
              checked={includeOntology}
              onChange={(event) => setIncludeOntology(event.target.checked)}
            />
          </label>

          <label className="flex items-center justify-between rounded-lg border border-border bg-canvas px-3 py-2">
            <span className="text-sm text-foreground font-medium">verification_report.html</span>
            <input
              type="checkbox"
              checked={includeReport}
              onChange={(event) => setIncludeReport(event.target.checked)}
            />
          </label>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={closeExportModal}
            className="px-4 h-9 rounded-lg border border-border text-sm text-foreground hover:bg-node transition-colors"
            disabled={isExporting}
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={!canExport}
            className="px-4 h-9 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent/90 transition-colors"
          >
            {isExporting ? "Exporting..." : "Download Zip"}
          </button>
        </div>
      </div>
    </div>
  );
}
