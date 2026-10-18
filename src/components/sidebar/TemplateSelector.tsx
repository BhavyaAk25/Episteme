"use client";

import { useState } from "react";
import { useProjectStore } from "@/store/useProjectStore";
import { TEMPLATES, loadTemplate, type TemplateId } from "@/lib/actions/templates";

/** Built-in starting points. Loads instantly; edit or Ask AI to adapt it afterwards. */
export function TemplateSelector() {
  const isGenerating = useProjectStore((state) => state.isGenerating);
  const [loading, setLoading] = useState<TemplateId | null>(null);

  return (
    <div>
      <h3 className="ui-section-title mb-3">Start from a template</h3>
      <div className="space-y-2">
        {TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            disabled={isGenerating || loading !== null}
            onClick={async () => {
              setLoading(template.id);
              try {
                await loadTemplate(template.id);
              } finally {
                setLoading(null);
              }
            }}
            className="w-full border rounded-lg px-3 py-2.5 flex flex-col items-start text-left gap-0.5 transition-colors border-border/70 bg-elevated/55 hover:bg-elevated/80 hover:border-brand disabled:opacity-50"
          >
            <span className="text-[13px] text-foreground font-medium leading-tight">
              {loading === template.id ? "Loading…" : template.title}
            </span>
            <span className="text-[12px] text-muted leading-snug">{template.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
