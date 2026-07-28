import { describe, it, expect } from "vitest";
import { erdToSql, erdToNodes, erdToEdges } from "./transformer";
import type { Column, ERD, Relationship, Table } from "@/types/erd";
import type { Ontology } from "@/types/ontology";

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

const erd: ERD = {
  tables: [
    table({
      name: "customers",
      columns: [
        col({ name: "id", dataType: "SERIAL", isPrimaryKey: true, nullable: false }),
        col({ name: "email", dataType: "VARCHAR(255)", nullable: false }),
      ],
      constraints: [
        { type: "UNIQUE", columns: ["email"], expression: null, onDelete: null },
        { type: "CHECK", columns: ["email"], expression: "email <> ''", onDelete: null },
      ],
    }),
    table({
      name: "orders",
      columns: [
        col({ name: "id", dataType: "SERIAL", isPrimaryKey: true, nullable: false }),
        col({
          name: "customer_id",
          dataType: "INTEGER",
          nullable: false,
          isForeignKey: true,
          referencesTable: "customers",
          referencesColumn: "id",
        }),
      ],
      constraints: [
        { type: "FOREIGN_KEY", columns: ["customer_id"], expression: null, onDelete: "CASCADE" },
      ],
    }),
  ],
  relationships: [
    {
      id: "rel_1",
      fromTable: "orders",
      toTable: "customers",
      fromColumn: "customer_id",
      toColumn: "id",
      cardinality: "1:N",
      required: true,
      onDelete: "CASCADE",
    } satisfies Relationship,
  ],
};

const ontology: Ontology = {
  objectTypes: [
    {
      id: "customers",
      name: "Customers",
      description: "",
      status: "active",
      confidence: "high",
      implementsInterfaces: [],
      properties: [],
    },
    {
      id: "orders",
      name: "Orders",
      description: "",
      status: "experimental",
      confidence: "medium",
      implementsInterfaces: [],
      properties: [],
    },
  ],
  linkTypes: [],
  actionTypes: [],
  interfaces: [],
};

describe("erdToSql (PostgreSQL dialect)", () => {
  const sql = erdToSql(erd);

  it("creates a table per ERD table", () => {
    expect(sql).toContain("CREATE TABLE customers");
    expect(sql).toContain("CREATE TABLE orders");
  });

  it("emits foreign keys as ALTER TABLE statements", () => {
    expect(sql).toContain("ALTER TABLE orders ADD CONSTRAINT");
    expect(sql).toContain("REFERENCES customers(id)");
    expect(sql).toContain("ON DELETE CASCADE");
  });

  it("preserves UNIQUE and CHECK constraints", () => {
    expect(sql).toContain("UNIQUE (email)");
    expect(sql).toContain("CHECK (email <> '')");
  });
});

describe("erdToNodes", () => {
  const nodes = erdToNodes(erd, ontology);

  it("returns one node per table with status/confidence from the ontology", () => {
    expect(nodes).toHaveLength(2);
    const orders = nodes.find((node) => node.data.tableName === "orders");
    expect(orders?.data.status).toBe("experimental");
    expect(orders?.data.confidence).toBe("medium");
  });

  it("places a dependent table to the right of its parent", () => {
    const customers = nodes.find((node) => node.data.tableName === "customers");
    const orders = nodes.find((node) => node.data.tableName === "orders");
    expect(orders!.position.x).toBeGreaterThan(customers!.position.x);
  });
});

describe("erdToEdges", () => {
  const edges = erdToEdges(erd);

  it("returns one edge per relationship marked as generated", () => {
    expect(edges).toHaveLength(1);
    expect(edges[0].data?.edgeSource).toBe("generated");
    expect(edges[0].data?.cardinality).toBe("1:N");
  });

  it("binds the edge to the FK source handle", () => {
    expect(edges[0].sourceHandle).toBe("customer_id-source");
    expect(edges[0].source).toBe("orders");
    expect(edges[0].target).toBe("customers");
  });
});
