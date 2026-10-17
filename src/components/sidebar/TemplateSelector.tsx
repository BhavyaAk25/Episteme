"use client";

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

  const applyTemplate = (template: TemplateDefinition) => {
    setPrompt(template.prompt, template.id as "inventory" | "saas" | "ecommerce");
  };

  return (
    <div>
      <h3 className="ui-section-title mb-3">Start from a template</h3>
      <div className="space-y-2">
        {templates.map((template) => {
          const isActive = template.id === templateId;
          return (
            <button
              key={template.id}
              type="button"
              disabled={isGenerating}
              onClick={() => applyTemplate(template)}
              className={`w-full border rounded-lg px-3 py-2.5 flex flex-col items-start text-left gap-0.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                isActive
                  ? "border-brand bg-elevated/80"
                  : "border-border/70 bg-elevated/55 hover:bg-elevated/80 hover:border-brand"
              }`}
            >
              <div className={`text-[13px] text-foreground leading-tight ${isActive ? "font-semibold" : "font-medium"}`}>
                {template.title}
              </div>
              <div className="text-[12px] text-muted leading-snug">
                {template.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
