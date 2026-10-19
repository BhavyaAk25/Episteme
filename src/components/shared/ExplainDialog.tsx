"use client";

import { useEscape } from "@/lib/hooks/useEscape";
import { useMemo, useState } from "react";
import { useUIStore } from "@/store/useUIStore";
import { useErdStore } from "@/store/useErdStore";
import { useCanvasStore } from "@/store/useCanvasStore";
import { describeSchemaOffline } from "@/lib/erd/describe";
import { askForExplanation } from "@/lib/actions/assist";
import type { ExplainAnswer } from "@/lib/gemini/schemas";

/** "Explain this schema": a structural summary right away, an AI one on request. */
export function ExplainDialog() {
  const open = useUIStore((s) => s.explainOpen);
  if (!open) return null;
  return <ExplainBody />;
}

function ExplainBody() {
  const erd = useErdStore((s) => s.erd);
  const offline = useMemo(() => (erd ? describeSchemaOffline(erd) : null), [erd]);
  const [ai, setAi] = useState<ExplainAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => useUIStore.getState().setExplainOpen(false);
  useEscape(close);
  const answer = ai ?? offline;
  const tableIds = new Map(erd?.tables.map((t) => [t.name, t.id]) ?? []);

  const explain = async () => {
    setLoading(true);
    setError(null);
    const result = await askForExplanation();
    setLoading(false);
    if (result.ok) setAi(result.data);
    else setError(result.error);
  };

  const showTable = (name: string) => {
    const id = tableIds.get(name);
    if (!id) return;
    useCanvasStore.getState().selectNode(id);
    useCanvasStore.getState().requestFocus(id);
    close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Explain this schema"
        className="w-[640px] max-w-full max-h-[88vh] flex flex-col rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-3 shrink-0">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">Explain this schema</h2>
            <p className="text-[11px] text-muted">{ai ? "Written by AI from your schema." : "Built from the structure. Ask the AI for a fuller story."}</p>
          </div>
          <div className="flex items-center gap-2">
            {!ai && (
              <button onClick={() => void explain()} disabled={loading} className="h-8 px-3 rounded-lg border border-border text-[12px] font-medium text-foreground hover:bg-foreground/[0.04] disabled:opacity-50">
                {loading ? "Explaining…" : "Explain with AI"}
              </button>
            )}
            <button onClick={close} aria-label="Close" className="w-8 h-8 rounded-lg text-muted hover:text-foreground hover:bg-foreground/5">×</button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {error && <p className="text-[12px] text-error">{error}</p>}
          {answer && (
            <>
              <p className="text-[13px] leading-relaxed text-foreground">{answer.overview}</p>

              {answer.tables.length > 0 && (
                <section>
                  <h3 className="ui-section-title">Tables</h3>
                  <ul className="mt-2 space-y-2">
                    {answer.tables.map((t) => (
                      <li key={t.name} className="text-[12.5px] leading-snug">
                        <button
                          onClick={() => showTable(t.name)}
                          disabled={!tableIds.has(t.name)}
                          className="font-mono font-semibold text-foreground hover:text-accent disabled:hover:text-foreground"
                        >
                          {t.name}
                        </button>
                        <span className="text-muted"> — {t.purpose}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {answer.flows.length > 0 && (
                <section>
                  <h3 className="ui-section-title">How it&apos;s used</h3>
                  <ul className="mt-2 space-y-1.5 list-disc pl-5">
                    {answer.flows.map((f) => (
                      <li key={f} className="text-[12.5px] leading-snug text-foreground">{f}</li>
                    ))}
                  </ul>
                </section>
              )}

              {answer.notes.length > 0 && (
                <section>
                  <h3 className="ui-section-title">Worth knowing</h3>
                  <ul className="mt-2 space-y-1.5 list-disc pl-5">
                    {answer.notes.map((n) => (
                      <li key={n} className="text-[12.5px] leading-snug text-foreground">{n}</li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
