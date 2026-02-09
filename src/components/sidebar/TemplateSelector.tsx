"use client";

import { useState } from "react";
import { useProjectStore } from "@/store/useProjectStore";

interface TemplateDefinition {
  id: string;
  title: string;
  prompt: string;
  description: string;
}

const templates: TemplateDefinition[] = [
  {
    id: "inventory",
    title: "Inventory",
    prompt:
      "Build an inventory management system for a sneaker brand with warehouses, SKUs, purchase orders, stock transfers, low-stock alerts, and audit trails.",
    description: "Warehouses, SKUs, transfers, reorder rules.",
  },
  {
    id: "saas",
    title: "SaaS",
    prompt:
      "Build a multi-tenant SaaS billing platform with organizations, users, roles, subscriptions, invoices, payments, plans, and usage metering.",
    description: "Tenants, subscriptions, invoices, usage.",
  },
  {
    id: "ecommerce",
    title: "E-Commerce",
    prompt:
      "Build an e-commerce backend with customers, products, variants, carts, orders, payments, shipments, returns, and inventory synchronization.",
    description: "Catalog, orders, payments, returns.",
  },
];

export function TemplateSelector() {
  const { setPrompt, isGenerating, templateId } = useProjectStore();
  const [selectedTemplateId, setSelectedTemplateId] = useState<TemplateDefinition["id"]>("inventory");
  const effectiveTemplateId = templateId ?? selectedTemplateId;

  const applyTemplate = (template: TemplateDefinition) => {
    setSelectedTemplateId(template.id);
    setPrompt(template.prompt, template.id as "inventory" | "saas" | "ecommerce");
  };

  return (
    <div className="pt-6 pb-0">
      <h3 className="ui-section-title mb-6 text-center">Quick Templates</h3>
      <div className="space-y-5">
        {templates.map((template) => {
          const isActive = template.id === effectiveTemplateId;
          return (
            <button
              key={template.id}
              type="button"
              disabled={isGenerating}
              onClick={() => applyTemplate(template)}
              className={`w-full border rounded-2xl px-6 py-6 min-h-[112px] flex flex-col items-center justify-center text-center gap-2.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                isActive
                  ? "border-[#c4a574] bg-white/80"
                  : "border-border/70 bg-white/55 hover:bg-white/80 hover:border-[#c4a574]"
              }`}
            >
              <div className={`text-[16px] text-foreground leading-tight ${isActive ? "font-semibold" : "font-medium"}`}>
                {template.title}
              </div>
              <div className="text-[13px] text-muted leading-relaxed max-w-[26ch] mx-auto">
                {template.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
