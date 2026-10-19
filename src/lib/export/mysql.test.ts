import { describe, expect, it } from "vitest";
import { Parser } from "node-sql-parser";
import { createFallbackGeneration } from "@/lib/gemini/fallbackGeneration";
import { importErd } from "@/lib/erd/model";
import { erdToMysql, erdToSqlite } from "./dialects";
import { importSql } from "@/lib/import/fromSql";

const parser = new Parser();
const statements = (sql: string) =>
  sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/^--.*$/gm, "").trim())
    .filter(Boolean);

describe("MySQL export", () => {
  it.each(["inventory", "saas", "ecommerce"] as const)("%s template parses as MySQL", (id) => {
    const erd = importErd(createFallbackGeneration("", { templateId: id }).erd);
    for (const statement of statements(erdToMysql(erd))) {
      expect(() => parser.astify(statement, { database: "MySQL" }), statement).not.toThrow();
    }
  });
});

describe("SQLite dumps", () => {
  it("imports Episteme's own SQLite export back", async () => {
    const erd = importErd(createFallbackGeneration("", { templateId: "ecommerce" }).erd);
    const { erd: imported } = await importSql(erdToSqlite(erd));
    expect(imported.tables.map((t) => t.name).sort()).toEqual(erd.tables.map((t) => t.name).sort());
    expect(imported.relationships.length).toBe(erd.relationships.length);
  }, 60_000);
});
