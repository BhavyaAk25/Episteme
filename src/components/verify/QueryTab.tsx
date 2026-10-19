"use client";

import { useMemo, useState } from "react";
import { useErdStore } from "@/store/useErdStore";
import { useSimulationStore, type QueryResult } from "@/store/useSimulationStore";
import { exampleQueries } from "@/lib/erd/describe";
import { askForSql } from "@/lib/actions/assist";
import { ResultTable } from "./ResultTable";

/**
 * Query playground: run SQL against the sample rows the Postgres tests
 * inserted (all in the browser), with example queries and English → SQL.
 */
export function QueryTab() {
  const erd = useErdStore((s) => s.erd);
  const hasDb = useSimulationStore((s) => Boolean(s.db));
  const isRunning = useSimulationStore((s) => s.isRunning);
  const progress = useSimulationStore((s) => s.progress);
  const examples = useMemo(() => (erd ? exampleQueries(erd) : []), [erd]);
  const [sql, setSql] = useState(() => examples[0]?.sql ?? "");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [aiNote, setAiNote] = useState<{ text: string; error: boolean } | null>(null);

  const run = async (text = sql) => {
    if (!text.trim() || running) return;
    setRunning(true);
    setResult(await useSimulationStore.getState().runQuery(text));
    setRunning(false);
  };

  const ask = async () => {
    if (!question.trim() || asking) return;
    setAsking(true);
    setAiNote(null);
    const answer = await askForSql(question.trim());
    setAsking(false);
    if (!answer.ok) {
      setAiNote({ text: answer.error, error: true });
    } else if (!answer.data.sql) {
      setAiNote({ text: answer.data.explanation || "The schema can't answer that question.", error: true });
    } else {
      setSql(answer.data.sql);
      setResult(null);
      setAiNote({ text: `${answer.data.explanation} Review it, then run it.`, error: false });
    }
  };

  return (
    <div className="p-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="min-w-0 space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask in English, e.g. top 5 customers by total spent"
            aria-label="Question for the AI"
            maxLength={500}
            className="flex-1 min-w-0 h-8 px-3 rounded-lg border border-border bg-elevated/70 text-[12px] focus:outline-none focus:border-accent"
          />
          <button type="submit" disabled={!question.trim() || asking} className="h-8 px-3 rounded-lg border border-border text-[12px] font-medium text-foreground hover:bg-foreground/[0.04] disabled:opacity-50">
            {asking ? "Writing…" : "Write SQL"}
          </button>
        </form>
        {aiNote && <p className={`text-[11px] ${aiNote.error ? "text-error" : "text-muted"}`}>{aiNote.text}</p>}

        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void run();
            }
          }}
          rows={7}
          spellCheck={false}
          aria-label="SQL query"
          placeholder="SELECT * FROM …"
          className="w-full px-3 py-2 rounded-lg border border-border bg-elevated/70 font-mono text-[12px] leading-relaxed text-foreground focus:outline-none focus:border-accent resize-y"
        />
        <div className="flex items-center gap-2">
          <button onClick={() => void run()} disabled={!sql.trim() || running || isRunning} className="ui-primary-btn !h-8 !text-[12px]" title="Run (⌘/Ctrl + Enter)">
            {running || isRunning ? (isRunning ? progress ?? "Preparing data…" : "Running…") : "Run query"}
          </button>
          <button
            onClick={() => {
              setResult(null);
              void useSimulationStore.getState().runTests();
            }}
            disabled={isRunning}
            className="h-8 px-3 rounded-lg text-[12px] text-muted hover:text-foreground disabled:opacity-50"
            title="Recreate the database with fresh sample rows"
          >
            Reset data
          </button>
        </div>

        {examples.length > 0 && (
          <div>
            <p className="text-[11px] text-muted mb-1.5">Examples</p>
            <div className="flex flex-wrap gap-1.5">
              {examples.map((example) => (
                <button
                  key={example.label}
                  onClick={() => {
                    setSql(example.sql);
                    void run(example.sql);
                  }}
                  className="h-7 px-2.5 rounded-md border border-border/80 text-[11px] text-foreground hover:bg-foreground/[0.04]"
                >
                  {example.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="min-w-0">
        {result ? (
          result.error ? (
            <p className="text-[12px] text-error font-mono whitespace-pre-wrap">{result.error}</p>
          ) : (
            <>
              <p className="mb-1.5 text-[11px] text-muted">
                {result.columns.length
                  ? `${result.rowCount} row${result.rowCount === 1 ? "" : "s"}${result.truncated ? " (showing the first 200)" : ""}`
                  : `Done, ${result.rowCount} row${result.rowCount === 1 ? "" : "s"} affected`}{" "}
                · {Math.round(result.durationMs)} ms
              </p>
              <ResultTable columns={result.columns} rows={result.rows} maxHeight={320} />
            </>
          )
        ) : (
          <p className="text-[12px] text-muted leading-relaxed">
            Runs in a real Postgres database in your browser, filled with sample rows{hasDb ? "" : " (created the first time you run a query)"}. Changes you make here only affect the sample data.
          </p>
        )}
      </div>
    </div>
  );
}
