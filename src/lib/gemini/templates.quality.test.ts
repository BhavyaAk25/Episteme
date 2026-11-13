import { describe, expect, it } from "vitest";
import { createFallbackGeneration } from "./fallbackGeneration";
import { importErd } from "@/lib/erd/model";
import { applyOps } from "@/lib/erd/applyOps";
import { autoFixErd, lintErd } from "@/lib/verify/linter";

describe("built-in templates", () => {
  it.each(["inventory", "saas", "ecommerce"] as const)("%s has no errors or warnings once loaded", (id) => {
    const { erd } = autoFixErd(importErd(createFallbackGeneration("", { templateId: id }).erd), (b, ops) => applyOps(b, ops).erd);
    const problems = lintErd(erd).filter((i) => i.severity !== "info").map((i) => i.title);
    expect(problems).toEqual([]);
  });
});
