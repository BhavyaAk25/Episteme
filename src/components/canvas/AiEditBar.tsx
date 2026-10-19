"use client";

import { useState } from "react";
import { useAiEditStore } from "@/store/useAiEditStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useReplayView } from "@/lib/erd/useReplayView";
import { useProjectsStore } from "@/store/useProjectsStore";
import { useErdStore } from "@/store/useErdStore";

const EXAMPLES = ["add product reviews with a 1–5 rating", "track who created each order", "let products belong to many categories"];

const Sparkle = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6L12 2zm6 12l.9 2.6L21.5 18l-2.6.9L18 21.5l-.9-2.6L14.5 18l2.6-1.4L18 14z" />
  </svg>
);

/**
 * "Ask AI to change…" — type a change, review the proposed edits on the
 * canvas, then apply (one undoable step) or discard.
 */
export function AiEditBar() {
  const { status, summary, results, error, diff, instruction, request, accept, discard, fixing, verdict, previewErd } = useAiEditStore();
  const currentErd = useErdStore((state) => state.erd);
  const isGenerating = useProjectStore((state) => state.isGenerating);
  const { active: replaying } = useReplayView();
  const [draft, setDraft] = useState("");
  const [showAll, setShowAll] = useState(false);

  if (isGenerating || replaying) return null;

  if (status === "preview") {
    const applied = results.filter((r) => r.ok).length;
    const changesNothing = previewErd === currentErd;
    const failed = results.length - applied;
    const visible = showAll ? results : results.slice(0, 6);
    return (
      <div className="absolute bottom-3 left-3 right-3 mx-auto max-w-[520px] @min-[1040px]:bottom-auto @min-[1040px]:top-3 @min-[1040px]:left-auto @min-[1040px]:mx-0 @min-[1040px]:w-[480px] z-30 rounded-xl border border-border bg-surface shadow-xl">
        <div className="px-4 pt-3 pb-2 flex items-start gap-2.5">
          <span className="mt-0.5 text-accent"><Sparkle /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-muted truncate" title={instruction}>“{instruction}”</p>
            <p className="mt-0.5 text-[13px] text-foreground leading-snug">{summary || "Proposed changes are shown on the canvas."}</p>
          </div>
        </div>
        {verdict && (
          <p
            role="status"
            className={`mx-4 mb-2 px-2.5 py-1.5 rounded-md text-[12px] leading-snug ${
              verdict.resolved ? "bg-success/10 text-success" : "bg-warning/10 text-foreground"
            }`}
          >
            <span className={verdict.resolved ? "" : "text-warning font-semibold"}>{verdict.resolved ? "✓ " : "Not fixed yet: "}</span>
            {verdict.message}
          </p>
        )}
        {results.length > 0 && (
          <ul className="px-4 pb-2 space-y-0.5 max-h-[180px] overflow-y-auto">
            {visible.map((result, index) => (
              <li key={index} className="flex items-start gap-2 text-[12px]">
                <span className={result.ok ? "text-success" : "text-error"}>{result.ok ? "✓" : "✗"}</span>
                <span
                  className={`font-mono ${!result.ok ? "text-muted line-through" : /^Remove /.test(result.label) ? "text-warning" : "text-foreground"}`}
                  title={result.ok && /^Remove /.test(result.label) ? "Deletes data in this column or table" : undefined}
                >
                  {result.label}
                </span>
                {!result.ok && result.error && <span className="text-[11px] text-error">— {result.error}</span>}
              </li>
            ))}
            {results.length > 6 && (
              <li>
                <button onClick={() => setShowAll(!showAll)} className="text-[12px] text-accent hover:underline">
                  {showAll ? "Show fewer" : `Show all ${results.length}`}
                </button>
              </li>
            )}
          </ul>
        )}
        {diff.removedTableNames.length > 0 && (
          <p className="px-4 pb-2 text-[12px] text-error">Removes: {diff.removedTableNames.join(", ")}</p>
        )}
        <div className="px-4 py-2.5 border-t border-border flex items-center justify-between gap-3">
          <span className="text-[11px] text-muted">
            {applied} change{applied === 1 ? "" : "s"}
            {failed > 0 ? ` · ${failed} skipped` : ""} · <span className="text-success">green = new</span>,{" "}
            <span className="text-warning">amber = changed</span>
          </span>
          <div className="flex gap-2">
            <button onClick={discard} className="ui-ghost-btn !min-h-8 !py-1 !px-3">
              Discard
            </button>
            {fixing && verdict && !verdict.resolved && (
              <button onClick={() => void useAiEditStore.getState().requestFix(fixing)} className="ui-ghost-btn !min-h-8 !py-1 !px-3">
                Try again
              </button>
            )}
            <button
              onClick={async () => {
                const projects = useProjectsStore.getState();
                await projects.checkpoint("Your edits before AI change");
                accept();
                await projects.addVersion(fixing ? `AI fix: ${fixing.title}` : `AI: ${instruction}`);
              }}
              disabled={applied === 0 || changesNothing}
              className="ui-primary-btn !min-h-8 !py-1 !px-3 disabled:opacity-40"
            >
              {fixing ? (verdict?.resolved ? "Apply fix" : "Apply anyway") : "Apply changes"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const loading = status === "loading";
  const submit = () => {
    if (!draft.trim()) return;
    void request(draft);
  };

  return (
    <div className="absolute bottom-3 left-3 right-3 mx-auto max-w-[520px] @min-[1040px]:bottom-auto @min-[1040px]:top-3 @min-[1040px]:left-auto @min-[1040px]:mx-0 @min-[1040px]:w-[420px] z-30">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-center gap-2 rounded-full border border-border bg-surface/95 backdrop-blur pl-3.5 pr-1 py-1 shadow-sm focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15"
      >
        <span className="text-accent"><Sparkle /></span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Ask AI to change… e.g. “${EXAMPLES[0]}”`}
          aria-label="Ask AI to change the schema"
          maxLength={1000}
          disabled={loading}
          className="flex-1 min-w-0 h-8 bg-transparent text-[13px] text-foreground placeholder:text-muted focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !draft.trim()}
          className="h-8 px-3.5 rounded-full bg-brand text-brand-ink text-[12px] font-semibold disabled:opacity-40 flex items-center gap-1.5"
        >
          {loading ? (
            <>
              <span className="w-3 h-3 border-2 border-brand-ink/40 border-t-brand-ink rounded-full animate-spin" />
              Thinking…
            </>
          ) : (
            "Ask AI"
          )}
        </button>
      </form>
      {status === "error" && error && (
        <div role="alert" className="mt-2 ml-auto w-fit max-w-full flex items-start gap-2 rounded-lg border border-error/30 bg-surface px-3 py-2 shadow-sm">
          <p className="text-[12px] text-foreground">{error}</p>
          <button onClick={discard} aria-label="Dismiss" className="text-muted hover:text-foreground leading-none">×</button>
        </div>
      )}
    </div>
  );
}
