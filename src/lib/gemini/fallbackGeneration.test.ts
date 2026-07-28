import { describe, it, expect } from "vitest";
import { createFallbackGeneration, detectFallbackDomain } from "./fallbackGeneration";

describe("detectFallbackDomain", () => {
  it("honors an explicit template id", () => {
    expect(detectFallbackDomain("anything at all", "saas")).toBe("saas");
    expect(detectFallbackDomain("anything at all", "ecommerce")).toBe("ecommerce");
    expect(detectFallbackDomain("anything at all", "inventory")).toBe("inventory");
  });

  it("classifies free-text prompts by domain keywords", () => {
    expect(detectFallbackDomain("inventory and stock management for a warehouse")).toBe("inventory");
    expect(detectFallbackDomain("a subscription SaaS with tenants, plans and billing")).toBe("saas");
    expect(detectFallbackDomain("online store with a shopping cart and checkout")).toBe("ecommerce");
  });
});

describe("createFallbackGeneration", () => {
  it("returns a structurally complete, self-consistent schema", () => {
    const payload = createFallbackGeneration("inventory management for a sneaker brand", {
      templateId: "inventory",
    });

    expect(payload.erd.tables.length).toBeGreaterThan(0);
    expect(payload.ontology.objectTypes.length).toBeGreaterThan(0);
    expect(payload.buildScript.steps.length).toBeGreaterThan(0);
    expect(payload.fallbackDomain).toBe("inventory");
    expect(payload.domainDecisionSource).toBe("template_hint");

    // Integrity: every relationship must reference tables that actually exist.
    const tableNames = new Set(payload.erd.tables.map((table) => table.name));
    for (const relationship of payload.erd.relationships) {
      expect(tableNames.has(relationship.fromTable)).toBe(true);
      expect(tableNames.has(relationship.toTable)).toBe(true);
    }

    // Integrity: every foreign key column must reference an existing table.
    for (const table of payload.erd.tables) {
      for (const column of table.columns) {
        if (column.isForeignKey && column.referencesTable) {
          expect(tableNames.has(column.referencesTable)).toBe(true);
        }
      }
    }
  });

  it("carries through the fallback reason and gemini-attempted flag", () => {
    const payload = createFallbackGeneration("some prompt", {
      geminiAttempted: true,
      fallbackReason: "quota",
    });
    expect(payload.geminiAttempted).toBe(true);
    expect(payload.fallbackReason).toBe("quota");
  });
});
