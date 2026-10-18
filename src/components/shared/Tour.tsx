"use client";

import { useEffect, useState } from "react";
import { useUIStore } from "@/store/useUIStore";

const DONE_KEY = "episteme-tour-done";

const STEPS: Array<{ selector: string; title: string; body: string }> = [
  {
    selector: 'input[aria-label="System description"]',
    title: "1. Describe your system",
    body: "Type what you're building and press Enter. The AI drafts tables and relationships, or start from a template or SQL.",
  },
  {
    selector: '[data-tour="toolbar"]',
    title: "2. Edit the diagram",
    body: "Add tables, undo/redo, tidy the layout. Drag from a column to another table to create a foreign key; double-click names to rename.",
  },
  {
    selector: '[data-tour="run-tests"]',
    title: "3. Test it in real Postgres",
    body: "Runs your schema in Postgres inside the browser and checks every rule. Issues come with one-click fixes.",
  },
  {
    selector: '[data-tour="export"]',
    title: "4. Export or share",
    body: "Download PostgreSQL, MySQL, SQLite, Prisma or Drizzle, an image of the diagram, or copy a share link.",
  },
];

/** A short, skippable introduction. Shown once; reopen from ? or ⌘K. */
export function Tour() {
  const { tourOpen, setTourOpen } = useUIStore();
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // First visit on a desktop-size screen.
  useEffect(() => {
    let done = true;
    try {
      done = Boolean(window.localStorage.getItem(DONE_KEY));
    } catch {
      /* storage unavailable: don't nag */
    }
    if (done || window.innerWidth < 1024) return;
    const timer = window.setTimeout(() => setTourOpen(true), 1500);
    return () => window.clearTimeout(timer);
  }, [setTourOpen]);

  useEffect(() => {
    if (!tourOpen) return;
    const update = () => setRect(document.querySelector(STEPS[step].selector)?.getBoundingClientRect() ?? null);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [tourOpen, step]);

  if (!tourOpen) return null;

  const finish = () => {
    try {
      window.localStorage.setItem(DONE_KEY, "1");
    } catch {
      /* ignore */
    }
    setTourOpen(false);
    setStep(0);
  };

  const current = STEPS[step];
  const width = 320;
  const top = rect ? Math.min(window.innerHeight - 190, rect.bottom + 12) : window.innerHeight / 2 - 80;
  const left = rect ? Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2)) : window.innerWidth / 2 - width / 2;

  return (
    <div className="fixed inset-0 z-[55]" role="dialog" aria-modal="true" aria-label="Product tour">
      <div className="absolute inset-0 bg-black/35" onClick={finish} />
      {rect && (
        <div
          className="absolute rounded-lg ring-2 ring-accent pointer-events-none transition-all"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12, boxShadow: "0 0 0 9999px rgba(0,0,0,0.25)" }}
        />
      )}
      <div className="absolute rounded-xl border border-border bg-surface p-4 shadow-2xl" style={{ top, left, width }}>
        <p className="text-[14px] font-semibold text-foreground">{current.title}</p>
        <p className="mt-1 text-[13px] text-muted leading-snug">{current.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <button onClick={finish} className="text-[12px] text-muted hover:text-foreground">Skip tour</button>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted">{step + 1} / {STEPS.length}</span>
            {step > 0 && (
              <button onClick={() => setStep(step - 1)} className="ui-ghost-btn !min-h-8 !py-1 !px-3">Back</button>
            )}
            <button onClick={() => (step === STEPS.length - 1 ? finish() : setStep(step + 1))} className="ui-primary-btn !min-h-8 !py-1 !px-3">
              {step === STEPS.length - 1 ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
