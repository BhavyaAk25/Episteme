import { describe, it, expect } from "vitest";
import {
  erdToSqliteSql,
  columnTypeIsInteger,
  isColumnAutoPrimaryKey,
} from "./sqlGenerator";
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

describe("columnTypeIsInteger", () => {
  it("recognizes integer-family types", () => {
    expect(columnTypeIsInteger("INTEGER")).toBe(true);
    expect(columnTypeIsInteger("BIGINT")).toBe(true);
    expect(columnTypeIsInteger("SERIAL")).toBe(true);
  });

  it("rejects non-integer types", () => {
    expect(columnTypeIsInteger("VARCHAR(255)")).toBe(false);
    expect(columnTypeIsInteger("NUMERIC(10,2)")).toBe(false);
  });
});

describe("isColumnAutoPrimaryKey", () => {
  it("is true for a lone serial primary key", () => {
    const idColumn = col({ name: "id", dataType: "SERIAL", isPrimaryKey: true });
    const t = table({ name: "users", columns: [idColumn, col({ name: "email" })] });
    expect(isColumnAutoPrimaryKey(t, idColumn)).toBe(true);
  });

  it("is false when the PK is composite", () => {
    const a = col({ name: "a", dataType: "SERIAL", isPrimaryKey: true });
    const b = col({ name: "b", dataType: "INTEGER", isPrimaryKey: true });
    const t = table({ name: "join_table", columns: [a, b] });
    expect(isColumnAutoPrimaryKey(t, a)).toBe(false);
  });
});

describe("erdToSqliteSql", () => {
  const erd: ERD = {
    tables: [
      table({
        name: "users",
        columns: [
          col({ name: "id", dataType: "SERIAL", isPrimaryKey: true, nullable: false }),
          col({ name: "email", dataType: "VARCHAR(255)", nullable: false }),
          col({ name: "balance", dataType: "NUMERIC(12,2)" }),
        ],
        indexes: [{ name: "idx_users_email", columns: ["email"], unique: true }],
      }),
      table({
        name: "orders",
        columns: [
          col({ name: "id", dataType: "SERIAL", isPrimaryKey: true, nullable: false }),
          col({
            name: "user_id",
            dataType: "INTEGER",
            nullable: false,
            isForeignKey: true,
            referencesTable: "users",
            referencesColumn: "id",
          }),
        ],
        constraints: [
          { type: "FOREIGN_KEY", columns: ["user_id"], expression: null, onDelete: "CASCADE" },
        ],
      }),
    ],
    relationships: [],
  };

  const sql = erdToSqliteSql(erd);

  it("emits AUTOINCREMENT for a serial primary key", () => {
    expect(sql).toContain("id INTEGER PRIMARY KEY AUTOINCREMENT");
  });

  it("maps PostgreSQL types to SQLite storage classes", () => {
    expect(sql).toContain("email TEXT NOT NULL");
    expect(sql).toContain("balance REAL");
  });

  it("emits an inline FK that references an existing table", () => {
    expect(sql).toContain("REFERENCES users(id)");
    expect(sql).toContain("ON DELETE CASCADE");
  });

  it("creates declared indexes", () => {
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email)");
  });

  it("skips REFERENCES to tables that do not exist", () => {
    const dangling: ERD = {
      tables: [
        table({
          name: "orphan",
          columns: [
            col({ name: "id", dataType: "SERIAL", isPrimaryKey: true, nullable: false }),
            col({
              name: "ghost_id",
              dataType: "INTEGER",
              isForeignKey: true,
              referencesTable: "missing_table",
              referencesColumn: "id",
            }),
          ],
        }),
      ],
      relationships: [],
    };
    expect(erdToSqliteSql(dangling)).not.toContain("REFERENCES missing_table");
  });
});
