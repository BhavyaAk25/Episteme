"use client";

import { useEscape } from "@/lib/hooks/useEscape";
import { useMemo, useState } from "react";
import { useUIStore, type ObjectEditorTarget } from "@/store/useUIStore";
import { useErdStore } from "@/store/useErdStore";
import { useSimulationStore, type QueryResult } from "@/store/useSimulationStore";
import { cleanViewSql } from "@/lib/erd/model";
import { ResultTable } from "@/components/verify/ResultTable";

const inputClass =
  "w-full h-9 px-3 rounded-lg border border-border bg-elevated/70 font-mono text-[13px] text-foreground focus:outline-none focus:border-accent";
const areaClass =
  "w-full px-3 py-2 rounded-lg border border-border bg-elevated/70 font-mono text-[12px] leading-relaxed text-foreground focus:outline-none focus:border-accent resize-y";

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-[560px] max-w-full max-h-[90vh] flex flex-col rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between shrink-0">
          <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-lg text-muted hover:text-foreground hover:bg-foreground/5">
            ×
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function EnumEditor({ name, onClose }: { name?: string; onClose: () => void }) {
  const existing = useErdStore((s) => s.erd?.enums?.find((e) => e.name === name));
  const tables = useErdStore((s) => s.erd?.tables);
  const usedBy = useMemo(
    () =>
      (tables ?? []).flatMap((t) => t.columns.filter((c) => name && c.dataType.toLowerCase() === name).map((c) => `${t.name}.${c.name}`)),
    [tables, name]
  );
  const lastError = useErdStore((s) => s.lastError);
  const [draftName, setDraftName] = useState(existing?.name ?? "");
  const [values, setValues] = useState(existing?.values.join("\n") ?? "");
  const [tried, setTried] = useState(false);

  const save = () => {
    setTried(true);
    const ok = useErdStore.getState().upsertEnum(draftName.trim(), values.split("\n"), existing?.name);
    if (ok) onClose();
  };

  return (
    <Shell title={existing ? `Enum type ${existing.name}` : "New enum type"} onClose={onClose}>
      <p className="text-[12px] text-muted mb-4">
        A fixed list of allowed values, like an order&apos;s status. Postgres rejects anything else. Set a column&apos;s type to this name to use it.
      </p>
      <label className="block text-[12px] font-medium text-foreground mb-1" htmlFor="enum-name">Type name</label>
      <input id="enum-name" autoFocus value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="order_status" spellCheck={false} className={inputClass} />
      <label className="block mt-4 text-[12px] font-medium text-foreground mb-1" htmlFor="enum-values">Values, one per line, in order</label>
      <textarea id="enum-values" value={values} onChange={(e) => setValues(e.target.value)} rows={6} placeholder={"pending\npaid\nshipped"} spellCheck={false} className={areaClass} />
      {usedBy.length > 0 && <p className="mt-2 text-[11px] text-muted">Used by {usedBy.join(", ")}.</p>}
      {tried && lastError && <p className="mt-3 text-[12px] text-error">{lastError}</p>}
      <div className="mt-5 flex items-center justify-between">
        {existing ? (
          <button
            onClick={() => {
              useErdStore.getState().deleteEnum(existing.name);
              onClose();
            }}
            className="h-9 px-3 rounded-lg text-[12px] font-medium text-error hover:bg-error/10"
            title={usedBy.length ? "Columns using it become TEXT" : undefined}
          >
            Delete type
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button onClick={onClose} className="h-9 px-3 rounded-lg border border-border text-[12px] font-medium text-foreground hover:bg-foreground/[0.04]">Cancel</button>
          <button onClick={save} disabled={!draftName.trim() || !values.trim()} className="ui-primary-btn">{existing ? "Save" : "Create type"}</button>
        </div>
      </div>
    </Shell>
  );
}

function ViewEditor({ id, onClose }: { id?: string; onClose: () => void }) {
  const existing = useErdStore((s) => s.erd?.views?.find((v) => v.id === id));
  const lastError = useErdStore((s) => s.lastError);
  const [draftName, setDraftName] = useState(existing?.name ?? "");
  const [sql, setSql] = useState(existing?.sql ?? "");
  const [tried, setTried] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);

  const save = () => {
    setTried(true);
    if (useErdStore.getState().upsertView({ id: existing?.id, name: draftName.trim(), sql })) onClose();
  };

  const test = async () => {
    setTesting(true);
    setResult(await useSimulationStore.getState().runQuery(`SELECT * FROM (\n${cleanViewSql(sql)}\n) AS preview LIMIT 20`));
    setTesting(false);
  };

  return (
    <Shell title={existing ? `View ${existing.name}` : "New view"} onClose={onClose}>
      <p className="text-[12px] text-muted mb-4">A saved query you can select from like a table. Exported as CREATE VIEW after the tables.</p>
      <label className="block text-[12px] font-medium text-foreground mb-1" htmlFor="view-name">View name</label>
      <input id="view-name" autoFocus value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="customer_totals" spellCheck={false} className={inputClass} />
      <label className="block mt-4 text-[12px] font-medium text-foreground mb-1" htmlFor="view-sql">Query</label>
      <textarea
        id="view-sql"
        value={sql}
        onChange={(e) => {
          setSql(e.target.value);
          setResult(null);
        }}
        rows={8}
        placeholder={"SELECT customer_id, count(*) AS orders\nFROM orders\nGROUP BY customer_id"}
        spellCheck={false}
        className={areaClass}
      />
      {tried && lastError && <p className="mt-3 text-[12px] text-error">{lastError}</p>}
      {result && (
        <div className="mt-3">
          {result.error ? (
            <p className="text-[12px] text-error font-mono">{result.error}</p>
          ) : (
            <>
              <p className="mb-1 text-[11px] text-muted">{result.rowCount} row{result.rowCount === 1 ? "" : "s"} from the sample data</p>
              <ResultTable columns={result.columns} rows={result.rows} />
            </>
          )}
        </div>
      )}
      <div className="mt-5 flex items-center justify-between gap-2">
        <div className="flex gap-2">
          {existing && (
            <button
              onClick={() => {
                useErdStore.getState().deleteView(existing.id);
                onClose();
              }}
              className="h-9 px-3 rounded-lg text-[12px] font-medium text-error hover:bg-error/10"
            >
              Delete view
            </button>
          )}
          <button
            onClick={() => void test()}
            disabled={!sql.trim() || testing}
            className="h-9 px-3 rounded-lg border border-border text-[12px] font-medium text-foreground hover:bg-foreground/[0.04] disabled:opacity-50"
            title="Run the query against sample data in Postgres"
          >
            {testing ? "Testing…" : "Test in Postgres"}
          </button>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="h-9 px-3 rounded-lg border border-border text-[12px] font-medium text-foreground hover:bg-foreground/[0.04]">Cancel</button>
          <button onClick={save} disabled={!draftName.trim() || !sql.trim()} className="ui-primary-btn">{existing ? "Save" : "Create view"}</button>
        </div>
      </div>
    </Shell>
  );
}

/** Create or edit an enum type or a view. */
export function ObjectEditorDialog() {
  const target = useUIStore((s) => s.objectEditor);
  const close = () => useUIStore.getState().setObjectEditor(null);
  if (!target) return null;
  const key = (t: ObjectEditorTarget) => (t.kind === "enum" ? `enum:${t.name ?? ""}` : `view:${t.id ?? ""}`);
  return target.kind === "enum" ? (
    <EnumEditor key={key(target)} name={target.name} onClose={close} />
  ) : (
    <ViewEditor key={key(target)} id={target.id} onClose={close} />
  );
}
