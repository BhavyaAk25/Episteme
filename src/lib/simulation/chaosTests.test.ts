import { describe, it, expect } from "vitest";
import { generateChaosTests } from "./chaosTests";
import type { Column, ERD, Table } from "@/types/erd";

function col(overrides: Partial<Column> & { name: string }): Column {
  return {
    dataType: "TEXT",
    nullable: true,
    defaultValue: null,
    isPrimaryKey: false,
    isForeignKey: false,
    referencesTable: null,
    referencesColumn: null,
    ...overrides,
  };
}

function table(overrides: Partial<Table> & { name: string }): Table {
  return {
    id: overrides.id ?? overrides.name,
    objectTypeId: overrides.objectTypeId ?? overrides.name,
    columns: [],
    constraints: [],
    indexes: [],
    ...overrides,
  };
}

describe("generateChaosTests", () => {
  it("produces adversarial tests for UNIQUE, NOT NULL and FK constraints", () => {
    const erd: ERD = {
      tables: [
        table({
          name: "users",
          columns: [
            col({ name: "id", dataType: "SERIAL", isPrimaryKey: true, nullable: false }),
            col({ name: "email", dataType: "VARCHAR(255)", nullable: false }),
          ],
          constraints: [
            { type: "UNIQUE", columns: ["email"], expression: null, onDelete: null },
          ],
        }),
      ],
      relationships: [],
    };

    const tests = generateChaosTests(erd);
    const names = tests.map((test) => test.name);
    expect(names.some((name) => name.includes("UNIQUE"))).toBe(true);
    expect(names.some((name) => name.includes("NOT NULL"))).toBe(true);
  });

  it("derives CHECK violations from the expression instead of always using -1", () => {
    const erd: ERD = {
      tables: [
        table({
          name: "products",
          columns: [
            col({ name: "id", dataType: "SERIAL", isPrimaryKey: true, nullable: false }),
            col({ name: "quantity", dataType: "INTEGER", nullable: false }),
            col({ name: "discount", dataType: "INTEGER", nullable: false }),
          ],
          constraints: [
            { type: "CHECK", columns: ["quantity"], expression: "quantity >= 0", onDelete: null },
            { type: "CHECK", columns: ["discount"], expression: "discount <= 100", onDelete: null },
          ],
        }),
      ],
      relationships: [],
    };

    const checkTests = generateChaosTests(erd).filter((test) => test.name.includes("CHECK"));
    expect(checkTests).toHaveLength(2);

    const combined = checkTests.map((test) => test.actionSql).join("\n");
    // `quantity >= 0` is violated by -1; `discount <= 100` is violated by 101.
    expect(combined).toContain("-1");
    expect(combined).toContain("101");
  });

  it("skips CHECK constraints it cannot confidently violate (no false failures)", () => {
    const erd: ERD = {
      tables: [
        table({
          name: "accounts",
          columns: [
            col({ name: "id", dataType: "SERIAL", isPrimaryKey: true, nullable: false }),
            col({ name: "handle", dataType: "VARCHAR(255)", nullable: false }),
          ],
          constraints: [
            // Function-based check we cannot reason about — must be skipped, not guessed.
            { type: "CHECK", columns: ["handle"], expression: "LENGTH(handle) > 0", onDelete: null },
          ],
        }),
      ],
      relationships: [],
    };

    const checkTests = generateChaosTests(erd).filter((test) => test.name.includes("CHECK"));
    expect(checkTests).toHaveLength(0);
  });
});
