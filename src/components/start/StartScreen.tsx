"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { ERD } from "@/types/erd";
import { useUIStore } from "@/store/useUIStore";
import { useErdStore } from "@/store/useErdStore";
import { useProjectStore } from "@/store/useProjectStore";
import { TEMPLATES, loadTemplate, type TemplateId } from "@/lib/actions/templates";

const SchemaPreview3D = dynamic(() => import("./SchemaPreview3D").then((m) => m.SchemaPreview3D), { ssr: false });

const EXAMPLES = [
  { label: "Vet clinic", prompt: "A veterinary clinic chain: owners have pets, vets work at several clinics, appointments become visits with diagnoses, prescriptions and invoices paid in parts." },
  { label: "Ride sharing", prompt: "A ride-sharing app with riders, drivers, vehicles, trips with fare breakdowns, ratings both ways, and promo codes." },
  { label: "Library", prompt: "A library where members borrow book copies; each loan has a due date and return date; members can place holds; overdue loans create fines." },
];

function useTemplateErd(id: TemplateId): ERD | null {
  const [erd, setErd] = useState<ERD | null>(null);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([import("@/lib/gemini/fallbackGeneration"), import("@/lib/erd/model")]).then(([gen, model]) => {
      if (cancelled) return;
      const template = TEMPLATES.find((t) => t.id === id)!;
      setErd(model.importErd(gen.createFallbackGeneration(template.prompt, { templateId: id }).erd));
    });
    return () => {
      cancelled = true;
    };
  }, [id]);
  return erd;
}

/** First screen: four ways to start, and a real schema in 3D to explore. */
export function StartScreen() {
  const [previewId, setPreviewId] = useState<TemplateId>("saas");
  const erd = useTemplateErd(previewId);
  const preview = TEMPLATES.find((t) => t.id === previewId)!;

  const focusDescription = (prompt?: string) => {
    if (prompt) useProjectStore.getState().setPrompt(prompt, null);
    window.setTimeout(() => document.querySelector<HTMLInputElement>('input[aria-label="System description"]')?.focus(), 30);
  };

  const options: Array<{ title: string; body: string; action: () => void; key?: string }> = [
    { title: "Describe it", body: "Type what you're building above. The AI drafts the tables and links, then you check it in Postgres.", action: () => focusDescription(), key: "/" },
    { title: "Open a template", body: "Inventory, SaaS billing or e-commerce, ready to edit.", action: () => void loadTemplate(previewId) },
    { title: "Import SQL", body: "Paste CREATE TABLE statements or upload a dump from Postgres, MySQL or SQLite.", action: () => useUIStore.getState().setImportOpen(true) },
    { title: "Blank canvas", body: "Add tables and draw foreign keys yourself.", action: () => useErdStore.getState().startBlank(), key: "N" },
  ];

  return (
    <div className="w-full max-w-[1040px] px-6 py-8 grid gap-10 @min-[740px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center pointer-events-auto">
      <div className="min-w-0">
        <h2 className="font-display text-[2rem] leading-[1.1] tracking-tight text-foreground">Design a database you can trust.</h2>
        <p className="mt-3 text-[14px] leading-relaxed text-muted max-w-[44ch]">
          Describe your system, refine the diagram, then run it in real Postgres right here in your browser. Nothing leaves your machine
          unless you use the AI.
        </p>

        <ul className="mt-6 divide-y divide-border rounded-xl border border-border bg-surface/80 overflow-hidden">
          {options.map((option) => (
            <li key={option.title}>
              <button onClick={option.action} className="group w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.03] focus:outline-none">
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-foreground">{option.title}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{option.body}</span>
                </span>
                {option.key && (
                  <kbd className="mt-0.5 shrink-0 px-1.5 py-px rounded border border-border text-[11px] font-mono text-muted">{option.key}</kbd>
                )}
                <span className="mt-0.5 shrink-0 text-muted group-hover:text-foreground transition-colors" aria-hidden="true">→</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="text-muted mr-1">Try:</span>
          {EXAMPLES.map((example) => (
            <button
              key={example.label}
              onClick={() => focusDescription(example.prompt)}
              className="h-7 px-2.5 rounded-full border border-border text-foreground hover:border-accent/60 transition-colors"
            >
              {example.label}
            </button>
          ))}
        </div>
      </div>

      <figure className="min-w-0 @max-[739px]:hidden">
        <div className="relative aspect-square max-h-[460px] w-full rounded-2xl border border-border bg-surface/40 overflow-hidden">
          {erd && <SchemaPreview3D key={previewId} erd={erd} onPick={() => void loadTemplate(previewId)} className="absolute inset-0" />}
        </div>
        <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div role="tablist" aria-label="Example schema" className="flex gap-1">
            {TEMPLATES.map((template) => (
              <button
                key={template.id}
                role="tab"
                aria-selected={template.id === previewId}
                onClick={() => setPreviewId(template.id)}
                className={`h-7 px-2.5 rounded-md text-[12px] whitespace-nowrap ${template.id === previewId ? "bg-pill text-foreground font-medium" : "text-muted hover:text-foreground"}`}
              >
                {template.title}
              </button>
            ))}
          </div>
          <button onClick={() => void loadTemplate(previewId)} className="text-[12px] text-accent hover:underline shrink-0">
            Open {preview.title} →
          </button>
        </figcaption>
        <p className="mt-1 text-[11px] text-muted">
          {erd ? `${erd.tables.length} tables, ${erd.relationships.length} links.` : ""} Drag to turn, hover a table to see what it links to.
        </p>
      </figure>
    </div>
  );
}
