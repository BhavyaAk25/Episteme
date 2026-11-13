import { describe, expect, it } from "vitest";
import type { Column } from "@/types/erd";
import { importErd } from "@/lib/erd/model";
import { runVerification } from "./runner";

const col = (name: string, dataType: string, extra: Partial<Column> = {}): Column => ({
  name, dataType, nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null, ...extra,
});

describe("Postgres tests", () => {
  it("seeds rows that satisfy ordering rules between columns", async () => {
    const erd = importErd({
      tables: [
        {
          id: "t_bookings", name: "bookings", objectTypeId: "bookings",
          columns: [
            col("id", "SERIAL", { isPrimaryKey: true }),
            col("start_time", "TIMESTAMP"),
            col("end_time", "TIMESTAMP"),
            col("issued_on", "DATE"),
            col("due_on", "DATE"),
            col("min_guests", "INTEGER"),
            col("max_guests", "INTEGER"),
          ],
          constraints: [
            { type: "CHECK", columns: ["start_time", "end_time"], expression: "end_time > start_time", onDelete: null },
            { type: "CHECK", columns: ["issued_on", "due_on"], expression: "issued_on < due_on", onDelete: null },
            { type: "CHECK", columns: ["min_guests", "max_guests"], expression: "max_guests >= min_guests", onDelete: null },
          ],
          indexes: [],
        },
        {
          id: "t_guests", name: "guests", objectTypeId: "guests",
          columns: [col("id", "SERIAL", { isPrimaryKey: true }), col("booking_id", "INTEGER", { isForeignKey: true, referencesTable: "bookings", referencesColumn: "id" })],
          constraints: [], indexes: [],
        },
      ],
      relationships: [],
    });
    const run = await runVerification(erd);
    expect(run.tests.filter((t) => t.status === "fail")).toEqual([]);
    expect(run.tests.find((t) => t.title === "guests: accepts valid rows")?.status).toBe("pass");
  }, 60_000);
});

describe("Postgres tests, harder cases", () => {
  it("handles defaulted columns in CHECKs and two-column unique rules", async () => {
    const erd = importErd({
      tables: [
        {
          id: "t_ws", name: "workspaces", objectTypeId: "workspaces",
          columns: [col("id", "SERIAL", { isPrimaryKey: true }), col("name", "TEXT")], constraints: [], indexes: [],
        },
        {
          id: "t_labels", name: "labels", objectTypeId: "labels",
          columns: [col("id", "SERIAL", { isPrimaryKey: true }), col("workspace_id", "INTEGER", { isForeignKey: true, referencesTable: "workspaces", referencesColumn: "id" }), col("name", "TEXT")],
          constraints: [{ type: "UNIQUE", columns: ["workspace_id", "name"], expression: null, onDelete: null }], indexes: [],
        },
        {
          id: "t_loans", name: "loans", objectTypeId: "loans",
          columns: [col("id", "SERIAL", { isPrimaryKey: true }), col("loan_date", "TIMESTAMP", { defaultValue: "NOW()" }), col("due_date", "TIMESTAMP"), col("return_date", "TIMESTAMP", { nullable: true })],
          constraints: [
            { type: "CHECK", columns: ["due_date", "loan_date"], expression: "due_date > loan_date", onDelete: null },
            { type: "CHECK", columns: ["return_date", "loan_date"], expression: "return_date IS NULL OR return_date >= loan_date", onDelete: null },
          ],
          indexes: [],
        },
      ],
      relationships: [],
    });
    const run = await runVerification(erd);
    expect(run.tests.filter((t) => t.status === "fail").map((t) => `${t.title}: ${t.detail}`)).toEqual([]);
    expect(run.tests.find((t) => t.title === "labels: rejects duplicate (workspace_id, name)")?.status).toBe("pass");
  }, 60_000);
});
