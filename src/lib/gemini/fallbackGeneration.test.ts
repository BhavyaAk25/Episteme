import { describe, it, expect } from "vitest";
import {
  createFallbackGeneration,
  detectFallbackDomain,
  buildScriptFromErd,
} from "./fallbackGeneration";

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

describe("buildScriptFromErd", () => {
  const erd = createFallbackGeneration("inventory system", { templateId: "inventory" }).erd;
  const steps = buildScriptFromErd(erd).steps;

  it("produces steps whose data shape matches the animation processor", () => {
    const addTable = steps.find((step) => step.type === "add_table");
    expect(typeof addTable?.data.table_name).toBe("string");

    const addColumn = steps.find((step) => step.type === "add_column");
    expect(typeof addColumn?.data.table_name).toBe("string");
    expect(typeof addColumn?.data.column).toBe("object");

    const addRelationship = steps.find((step) => step.type === "add_relationship");
    if (addRelationship) {
      expect(typeof addRelationship.data.from_table).toBe("string");
      expect(typeof addRelationship.data.to_table).toBe("string");
    }
  });

  it("emits an add_table step for every table in the ERD", () => {
    const tableNames = new Set(erd.tables.map((table) => table.name));
    const stepTableNames = steps
      .filter((step) => step.type === "add_table")
      .map((step) => step.data.table_name as string);
    expect(stepTableNames.sort()).toEqual([...tableNames].sort());
  });
});
