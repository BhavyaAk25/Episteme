import { useErdStore } from "@/store/useErdStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useProjectsStore } from "@/store/useProjectsStore";
import { useCanvasStore } from "@/store/useCanvasStore";
import { importErd } from "@/lib/erd/model";
import { layoutErd } from "@/lib/erd/layout";

export type TemplateId = "inventory" | "saas" | "ecommerce";

export const TEMPLATES: Array<{ id: TemplateId; title: string; prompt: string; description: string }> = [
  {
    id: "inventory",
    title: "Inventory",
    prompt: "Inventory management for a sneaker brand with warehouses, SKUs, stock movements and audit trails.",
    description: "Warehouses, products, stock levels, movements.",
  },
  {
    id: "saas",
    title: "SaaS billing",
    prompt: "Multi-tenant SaaS billing with organizations, users, plans, subscriptions and invoices.",
    description: "Organizations, users, plans, subscriptions, invoices.",
  },
  {
    id: "ecommerce",
    title: "E-commerce",
    prompt: "E-commerce store with customers, products, orders, order items and payments.",
    description: "Customers, products, orders, payments.",
  },
];

/**
 * Load a built-in template instantly (no AI call). Into the current project
 * if it's empty, otherwise as a new project. Undoable either way.
 */
export async function loadTemplate(id: TemplateId, options: { newProject?: boolean } = {}): Promise<void> {
  const template = TEMPLATES.find((t) => t.id === id);
  if (!template) return;
  const { createFallbackGeneration } = await import("@/lib/gemini/fallbackGeneration");
  const generated = createFallbackGeneration(template.prompt, { templateId: id, geminiAttempted: false });
  const erd = importErd(generated.erd);
  const positions = await layoutErd(erd).catch(() => ({}));

  const current = useErdStore.getState().erd;
  const projects = useProjectsStore.getState();
  if (options.newProject || (current && current.tables.length > 0)) {
    await projects.createProjectFrom({
      name: `${template.title} template`,
      prompt: template.prompt,
      erd,
      positions,
      versionLabel: `Started from the ${template.title} template`,
    });
  } else {
    useErdStore.getState().loadErd(erd, positions);
    await projects.addVersion(`Started from the ${template.title} template`);
    const meta = projects.projects.find((p) => p.id === projects.currentProjectId);
    if (meta?.name === "Untitled project") projects.renameProject(meta.id, `${template.title} template`);
  }
  useProjectStore.setState({
    prompt: template.prompt,
    templateId: id,
    plan: generated.plan,
    ontology: generated.ontology,
    generationMode: null,
    generationWarning: null,
    generationError: null,
  });
  useCanvasStore.getState().requestFit();
}
