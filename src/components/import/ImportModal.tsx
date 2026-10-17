"use client";

import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useUIStore } from "@/store/useUIStore";
import { useProjectsStore } from "@/store/useProjectsStore";
import { useCanvasStore } from "@/store/useCanvasStore";
import { importErd } from "@/lib/erd/model";
import { layoutErd } from "@/lib/erd/layout";

const EXAMPLE = `CREATE TABLE authors (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE books (
  id SERIAL PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  price NUMERIC(10,2) CHECK (price >= 0)
);`;

const MAX_BYTES = 2_000_000;

/** Paste or upload SQL DDL; it's run in Postgres in the browser and turned into a diagram. */
export function ImportModal() {
  const { importOpen, setImportOpen, showNotice } = useUIStore();
  const [sql, setSql] = useState("");
  const [name, setName] = useState("Imported schema");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const close = () => {
    setImportOpen(false);
    setError(null);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError("That file is over 2 MB. Export just the schema (pg_dump --schema-only).");
      return;
    }
    setSql(await file.text());
    setName(file.name.replace(/\.[^.]+$/, "") || "Imported schema");
  };

  const handleImport = async () => {
    if (!sql.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { importSql } = await import("@/lib/import/fromSql");
      const { erd: raw, skipped } = await importSql(sql);
      const erd = importErd(raw);
      const positions = await layoutErd(erd).catch(() => ({}));
      await useProjectsStore.getState().createProjectFrom({ name, erd, positions, versionLabel: "Imported from SQL" });
      useCanvasStore.getState().requestFit();
      showNotice(
        `Imported ${erd.tables.length} table${erd.tables.length === 1 ? "" : "s"} and ${erd.relationships.length} relationship${erd.relationships.length === 1 ? "" : "s"}${skipped.length ? ` (${skipped.length} item${skipped.length === 1 ? "" : "s"} skipped)` : ""}.`
      );
      setSql("");
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't import that SQL.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {importOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(30,22,12,0.35)] backdrop-blur-sm p-4"
          onClick={close}
        >
          <motion.div
            initial={{ scale: 0.97, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, y: 8 }}
            role="dialog"
            aria-modal="true"
            aria-label="Import SQL"
            className="w-[640px] max-w-full rounded-xl border border-border bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="text-[16px] font-semibold text-foreground">Import SQL</h2>
                <p className="text-[12px] text-muted">
                  Paste CREATE TABLE statements (PostgreSQL, e.g. <span className="font-mono">pg_dump --schema-only</span>; simple MySQL dumps work too). It opens as a new project.
                </p>
              </div>
              <button onClick={close} aria-label="Close" className="w-8 h-8 rounded-lg text-muted hover:text-foreground hover:bg-foreground/5">×</button>
            </div>
            <div className="p-5 space-y-3">
              <textarea
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                placeholder={EXAMPLE}
                spellCheck={false}
                aria-label="SQL to import"
                className="w-full h-64 p-3 rounded-lg border border-border bg-canvas font-mono text-[12px] text-foreground placeholder:text-muted/70 focus:outline-none focus:border-accent resize-y"
              />
              <div className="flex items-center gap-2">
                <label className="text-[12px] text-muted shrink-0" htmlFor="import-name">Project name</label>
                <input
                  id="import-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="flex-1 min-w-0 h-8 px-2 rounded-md border border-border bg-canvas text-[13px] focus:outline-none focus:border-accent"
                />
                <input ref={fileRef} type="file" accept=".sql,.txt,text/plain" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0])} />
                <button onClick={() => fileRef.current?.click()} className="ui-ghost-btn !min-h-8 !py-1">Upload .sql</button>
              </div>
              {error && <p role="alert" className="text-[13px] text-error">{error}</p>}
              <div className="flex items-center justify-between gap-3 pt-1">
                <button onClick={() => setSql(EXAMPLE)} className="text-[12px] text-accent hover:underline">Use an example</button>
                <button onClick={() => void handleImport()} disabled={!sql.trim() || busy} className="ui-primary-btn disabled:opacity-40">
                  {busy ? "Reading schema…" : "Import"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
