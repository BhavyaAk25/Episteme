import { describe, expect, it } from "vitest";
import type { ERD } from "@/types/erd";
import { applyOps } from "@/lib/erd/applyOps";
import { importErd } from "@/lib/erd/model";
import { checkFix, guardFixOps } from "./fixCheck";
import { lintErd, type Issue } from "./linter";

const erd: ERD = importErd({
  tables: [
    {
      id: "t_customers",
      name: "customers",
      objectTypeId: "customers",
      columns: [
        { name: "id", dataType: "SERIAL", nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, referencesTable: null, referencesColumn: null },
        { name: "email", dataType: "TEXT", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
        { name: "phone_1", dataType: "TEXT", nullable: true, defaultValue: null, isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
        { name: "phone_2", dataType: "TEXT", nullable: true, defaultValue: null, isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
      ],
      constraints: [{ type: "CHECK", columns: ["email"], expression: "is_valid_email(email)", onDelete: null }],
      indexes: [],
    },
  ],
  relationships: [],
});

describe("Ask AI to fix", () => {
  const repeated: Issue = { id: "customers:phones", severity: "warning", table: "customers", title: "customers repeats phone (phone_1, phone_2)", detail: "", askAi: "Move phone_1, phone_2 into a child table." };

  it("blocks dropping tables and columns the problem doesn't mention", () => {
    const { allowed, blocked } = guardFixOps(
      [
        { op: "drop_table", table: "customers" },
        { op: "drop_column", table: "customers", column: "email" },
        { op: "drop_column", table: "customers", column: "phone_1" },
        { op: "rename_table", table: "customers", new_name: "clients" },
      ],
      repeated
    );
    expect(allowed).toEqual([{ op: "drop_column", table: "customers", column: "phone_1" }]);
    expect(blocked.map((b) => b.ok)).toEqual([false, false, false]);
  });

  it("can remove a broken CHECK by its expression", () => {
    const { erd: fixed, results } = applyOps(erd, [{ op: "drop_check", table: "customers", expression: "(IS_VALID_EMAIL(email))" }]);
    expect(results[0].ok).toBe(true);
    expect(fixed.tables[0].constraints.some((c) => c.type === "CHECK")).toBe(false);
  });

  it("confirms a fix in real Postgres, and rejects one that doesn't work", async () => {
    const rejected: Issue = { id: "ddl:0", severity: "error", table: "customers", title: "Postgres rejected the SQL for customers", detail: "function is_valid_email(text) does not exist" };
    const good = applyOps(erd, [{ op: "drop_check", table: "customers", expression: "is_valid_email(email)" }]).erd;
    const bad = applyOps(erd, [{ op: "add_check", table: "customers", expression: "email <> ''" }]).erd;
    expect((await checkFix(rejected, erd, good, "", 1)).resolved).toBe(true);
    expect((await checkFix(rejected, erd, bad, "", 1)).resolved).toBe(false);
  }, 60_000);

  it("checks design issues against the proposed schema", async () => {
    const issue = lintErd(erd).find((i) => i.title.includes("repeats"))!;
    const unchanged = await checkFix(issue, erd, erd, "", 0);
    expect(unchanged.resolved).toBe(false);
  });
});
