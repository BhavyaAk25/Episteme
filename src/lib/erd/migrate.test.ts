import { describe, expect, it } from "vitest";
import type { Column, ERD, Table } from "@/types/erd";
import { erdToSql } from "@/lib/ontology/transformer";
import { importSql } from "@/lib/import/fromSql";
import { runVerification } from "@/lib/verify/runner";
import { migrationSql, verifyMigration } from "./migrate";
import { normalizeErd, renameTable, updateColumn, upsertEnum, upsertView } from "./model";

const col = (name: string, dataType: string, extra: Partial<Column> = {}): Column => ({
  name,
  dataType,
  nullable: true,
  defaultValue: null,
  isPrimaryKey: false,
  isForeignKey: false,
  referencesTable: null,
  referencesColumn: null,
  ...extra,
});

const table = (id: string, name: string, columns: Column[], extra: Partial<Table> = {}): Table => ({
  id,
  name,
  objectTypeId: id,
  columns,
  constraints: [],
  indexes: [],
  ...extra,
});

function shop(): ERD {
  return normalizeErd({
    tables: [
      table("t_customers", "customers", [
        col("id", "SERIAL", { isPrimaryKey: true, nullable: false }),
        col("email", "TEXT", { nullable: false }),
        col("name", "TEXT"),
      ], { constraints: [{ type: "UNIQUE", columns: ["email"], expression: null, onDelete: null }] }),
      table("t_orders", "orders", [
        col("id", "SERIAL", { isPrimaryKey: true, nullable: false }),
        col("customer_id", "INTEGER", { nullable: false }),
        col("total", "NUMERIC(10,2)", { nullable: false, defaultValue: "0" }),
        col("note", "TEXT"),
      ], { indexes: [{ name: "idx_orders_customer_id", columns: ["customer_id"], unique: false }] }),
    ],
    relationships: [
      { id: "r1", fromTable: "orders", toTable: "customers", fromColumn: "customer_id", toColumn: "id", cardinality: "1:N", required: true, onDelete: "CASCADE" },
    ],
  });
}

/** The parts of a database's shape a migration must reproduce. */
async function shapeOf(sql: string) {
  const { erd } = await importSql(sql);
  return {
    tables: erd.tables
      .map((t) => ({
        name: t.name,
        columns: t.columns.map((c) => [c.name, c.dataType, c.nullable, c.defaultValue, c.generated ?? null, c.comment ?? null]),
        pk: t.columns.filter((c) => c.isPrimaryKey).map((c) => c.name),
        unique: t.constraints.filter((c) => c.type === "UNIQUE").map((c) => c.columns.join(",")).sort(),
        checks: t.constraints.filter((c) => c.type === "CHECK").length,
        indexes: t.indexes.map((i) => `${i.name}:${i.columns.join(",")}:${i.unique}`).sort(),
        comment: t.comment ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    relationships: erd.relationships.map((r) => `${r.fromTable}.${r.fromColumn}->${r.toTable}.${r.toColumn}:${r.onDelete}`).sort(),
    enums: erd.enums,
    views: erd.views?.map((v) => v.name).sort(),
  };
}

function must<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error((result as unknown as { error: string }).error);
  return result as Extract<T, { ok: true }>;
}

describe("migrationSql", () => {
  it("reports no changes for identical schemas", () => {
    expect(migrationSql(shop(), shop()).changes).toBe(0);
  });

  it("turns the old database into exactly the new schema", async () => {
    const before = shop();
    let after = must(renameTable(before, "t_customers", "clients")).erd;
    after = must(upsertEnum(after, "order_status", ["pending", "paid", "shipped"])).erd;
    const orders = after.tables.find((t) => t.name === "orders")!;
    after = must(updateColumn(after, orders.id, "note", { name: "notes", comment: "Shown on the packing slip" })).erd;
    after = {
      ...after,
      tables: after.tables.map((t) =>
        t.name === "orders"
          ? {
              ...t,
              comment: "One checkout",
              columns: [
                ...t.columns.map((c) => (c.name === "total" ? { ...c, dataType: "NUMERIC(12,2)" } : c)),
                col("status", "order_status", { nullable: false, defaultValue: "'pending'" }),
                col("total_cents", "BIGINT", { generated: "(total * 100)::bigint" }),
              ],
              indexes: [],
            }
          : t
      ),
    };
    after = must(upsertView(after, { name: "client_totals", sql: "SELECT customer_id, sum(total) AS spent FROM orders GROUP BY customer_id" })).erd;
    after = normalizeErd(after);

    const migration = migrationSql(before, after);
    expect(migration.changes).toBeGreaterThan(0);
    expect(migration.sql).toContain("ALTER TABLE customers RENAME TO clients;");
    expect(migration.sql).toContain("RENAME COLUMN note TO notes");

    const migrated = await shapeOf(`${erdToSql(before)}\n\n${migration.sql}`);
    const target = await shapeOf(erdToSql(after));
    expect(migrated).toEqual(target);
    expect(await verifyMigration(before, after, migration.sql)).toEqual({ ok: true });
  }, 60_000);

  it("warns before steps that can lose data", () => {
    const before = shop();
    const after = normalizeErd({
      ...before,
      tables: before.tables.map((t) =>
        t.name === "customers" ? { ...t, columns: [...t.columns, col("tier", "TEXT", { nullable: false })] } : t
      ),
    });
    const { warnings } = migrationSql(before, after);
    expect(warnings.join(" ")).toMatch(/NOT NULL without a default/);
  });
});

describe("Postgres features round-trip", () => {
  it("imports enums, comments, generated columns and views it exports", async () => {
    let erd = shop();
    erd = must(upsertEnum(erd, "order_status", ["pending", "paid"])).erd;
    erd = {
      ...erd,
      tables: erd.tables.map((t) =>
        t.name === "orders"
          ? { ...t, comment: "Checkouts", columns: [...t.columns, col("status", "order_status", { nullable: false }), col("total_cents", "BIGINT", { generated: "(total * 100)::bigint" })] }
          : t
      ),
    };
    erd = must(upsertView(erd, { name: "big_orders", sql: "SELECT id, total FROM orders WHERE total > 100;" })).erd;

    const { erd: imported } = await importSql(erdToSql(erd));
    const orders = imported.tables.find((t) => t.name === "orders")!;
    expect(imported.enums).toEqual([{ name: "order_status", values: ["pending", "paid"] }]);
    expect(orders.comment).toBe("Checkouts");
    expect(orders.columns.find((c) => c.name === "status")?.dataType).toBe("order_status");
    expect(orders.columns.find((c) => c.name === "total_cents")?.generated).toMatch(/total \* \(?100\)?/);
    expect(imported.views?.map((v) => v.name)).toEqual(["big_orders"]);
  }, 60_000);

  it("seeds enum and generated columns and tests views in real Postgres", async () => {
    let erd = must(upsertEnum(shop(), "order_status", ["pending", "paid"])).erd;
    erd = {
      ...erd,
      tables: erd.tables.map((t) =>
        t.name === "orders" ? { ...t, columns: [...t.columns, col("status", "order_status", { nullable: false }), col("total_cents", "BIGINT", { generated: "(total * 100)::bigint" })] } : t
      ),
    };
    erd = must(upsertView(erd, { name: "paid_orders", sql: "SELECT * FROM orders WHERE status = 'paid'" })).erd;

    const run = await runVerification(erd);
    expect(run.ddlProblems).toEqual([]);
    const failed = run.tests.filter((t) => t.status === "fail");
    expect(failed).toEqual([]);
    expect(run.tests.some((t) => t.title.includes("only accepts order_status values") && t.status === "pass")).toBe(true);
    expect(run.tests.some((t) => t.kind === "view" && t.status === "pass")).toBe(true);
  }, 60_000);
});
