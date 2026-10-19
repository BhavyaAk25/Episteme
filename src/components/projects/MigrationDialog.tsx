"use client";

import { useEscape } from "@/lib/hooks/useEscape";
import { useMemo, useState } from "react";
import { useUIStore } from "@/store/useUIStore";
import { useErdStore } from "@/store/useErdStore";
import { useProjectsStore } from "@/store/useProjectsStore";
import { migrationSql, verifyMigration } from "@/lib/erd/migrate";
import { timeAgo } from "./ProjectSwitcher";

const CURRENT = "current";

/** ALTER statements that upgrade a database from one saved version to another. */
export function MigrationDialog() {
  const fromId = useUIStore((s) => s.migrationFrom);
  if (!fromId) return null;
  return <MigrationDialogBody key={fromId} initialFrom={fromId} />;
}

function MigrationDialogBody({ initialFrom }: { initialFrom: string }) {
  const versions = useProjectsStore((s) => s.versions);
  const current = useErdStore((s) => s.erd);
  const [fromId, setFromId] = useState(initialFrom);
  const [toId, setToId] = useState(CURRENT);
  const [copied, setCopied] = useState(false);
  const [check, setCheck] = useState<{ state: "idle" | "running" } | { state: "done"; ok: boolean; message: string }>({ state: "idle" });
  const close = () => useUIStore.getState().setMigrationFrom(null);
  useEscape(close);

  const from = versions.find((v) => v.id === fromId)?.erd ?? null;
  const to = toId === CURRENT ? current : versions.find((v) => v.id === toId)?.erd ?? null;
  const migration = useMemo(() => (from && to ? migrationSql(from, to) : null), [from, to]);

  const label = (id: string) => {
    const v = versions.find((x) => x.id === id);
    return v ? `${v.label} · ${timeAgo(v.createdAt)}` : "";
  };

  const download = () => {
    if (!migration) return;
    const url = URL.createObjectURL(new Blob([migration.sql], { type: "text/sql" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `migration-${new Date().toISOString().slice(0, 10)}.sql`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const verify = async () => {
    if (!from || !to || !migration) return;
    setCheck({ state: "running" });
    const result = await verifyMigration(from, to, migration.sql);
    setCheck({
      state: "done",
      ok: result.ok,
      message: result.ok ? "Verified in Postgres: applying this to the old schema gives exactly the new one." : result.error,
    });
  };

  const selectClass = "h-8 px-2 rounded-md border border-border bg-elevated text-[12px] text-foreground max-w-full";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Migration SQL"
        className="w-[720px] max-w-full max-h-[90vh] flex flex-col rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between shrink-0">
          <h2 className="text-[15px] font-semibold text-foreground">Migration SQL</h2>
          <button onClick={close} aria-label="Close" className="w-8 h-8 rounded-lg text-muted hover:text-foreground hover:bg-foreground/5">×</button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <span>From</span>
            <select
              value={fromId}
              onChange={(e) => {
                setFromId(e.target.value);
                setCheck({ state: "idle" });
              }}
              className={selectClass}
              aria-label="Migrate from version"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>{label(v.id)}</option>
              ))}
            </select>
            <span>to</span>
            <select
              value={toId}
              onChange={(e) => {
                setToId(e.target.value);
                setCheck({ state: "idle" });
              }}
              className={selectClass}
              aria-label="Migrate to version"
            >
              <option value={CURRENT}>Current schema</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>{label(v.id)}</option>
              ))}
            </select>
          </div>

          {migration && (
            <>
              {migration.warnings.length > 0 && (
                <ul className="rounded-lg border border-warning/40 bg-warning/[0.06] px-3 py-2 space-y-1">
                  {migration.warnings.map((w) => (
                    <li key={w} className="text-[12px] text-foreground flex gap-2">
                      <span className="text-warning">!</span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              )}
              <pre className="rounded-lg border border-border bg-canvas px-3 py-2.5 text-[11.5px] leading-relaxed font-mono text-foreground overflow-auto max-h-[42vh] whitespace-pre">
                {migration.sql}
              </pre>
              {check.state === "done" && <p className={`text-[12px] ${check.ok ? "text-success" : "text-error"}`}>{check.message}</p>}
            </>
          )}
          <p className="text-[11px] text-muted">
            PostgreSQL. Tables are matched across renames; a column that disappears and is replaced in the same position by one of the same type is treated as renamed. Read it before running it on real data.
          </p>
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2 shrink-0">
          <button
            onClick={() => void verify()}
            disabled={!migration?.changes || check.state === "running"}
            className="h-9 px-3 rounded-lg border border-border text-[12px] font-medium text-foreground hover:bg-foreground/[0.04] disabled:opacity-50"
          >
            {check.state === "running" ? "Checking…" : "Verify in Postgres"}
          </button>
          <button
            onClick={() => {
              if (!migration) return;
              void navigator.clipboard.writeText(migration.sql).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              });
            }}
            disabled={!migration?.changes}
            className="h-9 px-3 rounded-lg border border-border text-[12px] font-medium text-foreground hover:bg-foreground/[0.04] disabled:opacity-50"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button onClick={download} disabled={!migration?.changes} className="ui-primary-btn">Download .sql</button>
        </div>
      </div>
    </div>
  );
}
