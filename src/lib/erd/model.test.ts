import { describe, expect, it } from "vitest";
import type { Column, ERD, Table } from "@/types/erd";
import { createFallbackGeneration } from "@/lib/gemini/fallbackGeneration";
import { erdToSql } from "@/lib/ontology/transformer";
import { erdToDrizzle, erdToMysql, erdToPrisma, erdToSqlite } from "@/lib/export/dialects";
import { importSql } from "@/lib/import/fromSql";
import { applyOps } from "./applyOps";
import {
  addRelationship,
  deleteColumn,
  importErd,
  renameTable,
  updateColumn,
  upsertEnum,
  upsertView,
} from "./model";

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
const table = (name: string, columns: Column[], extra: Partial<Table> = {}): Table => ({
  id: `t_${name}`,
  name,
  objectTypeId: name,
  columns,
  constraints: [],
  indexes: [],
  ...extra,
});

function blog(): ERD {
  let erd = importErd({
    tables: [
      table("authors", [col("id", "SERIAL", { isPrimaryKey: true, nullable: false }), col("email", "TEXT", { nullable: false })]),
      table("posts", [col("id", "SERIAL", { isPrimaryKey: true, nullable: false }), col("title", "TEXT", { nullable: false })], {
        constraints: [{ type: "CHECK", columns: ["title"], expression: "length(title) > 0", onDelete: null }],
      }),
    ],
    relationships: [],
  });
  const linked = addRelationship(erd, { fromTableId: "t_posts", toTableId: "t_authors" });
  if (!linked.ok) throw new Error(linked.error);
  erd = linked.erd;
  return erd;
}

describe("edit model", () => {
  it("creates a correctly typed FK column when linking tables", () => {
    const posts = blog().tables.find((t) => t.name === "posts")!;
    const fk = posts.columns.find((c) => c.name === "author_id");
    expect(fk).toMatchObject({ dataType: "INTEGER", isForeignKey: true, referencesTable: "authors", referencesColumn: "id" });
  });

  it("renames update relationships, CHECKs and views", () => {
    let erd = blog();
    const withView = upsertView(erd, { name: "post_titles", sql: "SELECT title FROM posts" });
    if (!withView.ok) throw new Error(withView.error);
    erd = withView.erd;
    const renamedTable = renameTable(erd, "t_posts", "articles");
    if (!renamedTable.ok) throw new Error(renamedTable.error);
    const renamedColumn = updateColumn(renamedTable.erd, "t_posts", "title", { name: "headline" });
    if (!renamedColumn.ok) throw new Error(renamedColumn.error);
    const result = renamedColumn.erd;
    expect(result.relationships[0]).toMatchObject({ fromTable: "articles", toTable: "authors" });
    expect(result.tables.find((t) => t.name === "articles")!.constraints.find((c) => c.type === "CHECK")?.expression).toBe("length(headline) > 0");
    expect(result.views?.[0].sql).toBe("SELECT title FROM articles");
  });

  it("refuses edits that would break the schema", () => {
    const erd = blog();
    expect(deleteColumn(erd, "t_authors", "id")).toMatchObject({ ok: false });
    expect(updateColumn(erd, "t_posts", "author_id", { dataType: "TEXT" })).toMatchObject({ ok: false });
    expect(updateColumn(erd, "t_posts", "title", { name: "select" })).toMatchObject({ ok: false });
    expect(updateColumn(erd, "t_posts", "title", { dataType: "TEXT); DROP TABLE authors; --" })).toMatchObject({ ok: false });
    expect(updateColumn(erd, "t_posts", "title", { defaultValue: "'x'; DROP TABLE authors" })).toMatchObject({ ok: false });
    expect(upsertEnum(erd, "text", ["a"])).toMatchObject({ ok: false });
    expect(upsertView(erd, { name: "v", sql: "DELETE FROM posts" })).toMatchObject({ ok: false });
  });

  it("applies AI operations one by one and reports failures", () => {
    const { erd, results } = applyOps(blog(), [
      { op: "create_enum", name: "post_status", values: ["draft", "published"] },
      { op: "add_column", table: "posts", column: { name: "status", type: "post_status", nullable: false, default: "'draft'" } },
      { op: "add_column", table: "missing", column: { name: "x" } },
      { op: "set_comment", table: "posts", column: "status", comment: "Publishing state" },
    ]);
    expect(results.map((r) => r.ok)).toEqual([true, true, false, true]);
    const status = erd.tables.find((t) => t.name === "posts")!.columns.find((c) => c.name === "status");
    expect(status).toMatchObject({ dataType: "post_status", comment: "Publishing state" });
  });
});

describe("loading untrusted schemas (share links, storage, AI)", () => {
  it("neutralises anything that could end a SQL statement", () => {
    const hostile = importErd({
      tables: [
        table("users; DROP TABLE x", [
          col("id", "SERIAL", { isPrimaryKey: true, nullable: false }),
          col("bio", "TEXT); DROP TABLE x; --"),
          col("nick", "TEXT", { defaultValue: "'a'; DROP TABLE x" }),
          col("total", "INTEGER", { generated: "1); DROP TABLE x; --" }),
        ], { constraints: [{ type: "CHECK", columns: ["id"], expression: "id > 0); DROP TABLE x; --", onDelete: null }] }),
      ],
      relationships: [],
      enums: [{ name: "bad type; DROP", values: ["o'neil"] }],
      views: [
        { id: "v1", name: "v1", sql: "SELECT 1; DROP TABLE x" },
        { id: "v2", name: "v2", sql: "DROP TABLE x" },
      ],
    });
    const sql = erdToSql(hostile);
    // The only semicolons left are statement terminators Episteme writes.
    for (const statement of sql.split(/\n\n/)) expect(statement.indexOf(";")).toBe(statement.length - 1);
    expect(sql).not.toMatch(/DROP TABLE/);
    expect(hostile.views).toEqual([]);
    expect(hostile.tables[0].name).toBe("users_drop_table_x");
  });

  it("keeps generated code free of template-literal injection", () => {
    const erd = importErd({
      tables: [table("items", [col("id", "SERIAL", { isPrimaryKey: true, nullable: false }), col("n", "INTEGER", { defaultValue: "${process.exit(1)} + \\`" })])],
      relationships: [],
    });
    const drizzle = erdToDrizzle(erd);
    expect(drizzle).toContain("\\${process.exit(1)}");
    expect(drizzle).not.toMatch(/[^\\]\$\{process/);
  });
});

describe("exporters", () => {
  const templates = ["inventory", "saas", "ecommerce"] as const;

  it.each(templates)("%s template: SQLite export runs in a real SQLite database", async (id) => {
    const { DatabaseSync } = await import("node:sqlite");
    const erd = importErd(createFallbackGeneration("", { templateId: id }).erd);
    const db = new DatabaseSync(":memory:");
    expect(() => db.exec(erdToSqlite(erd))).not.toThrow();
    const tables = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number };
    expect(tables.n).toBe(erd.tables.length + (erdToSqlite(erd).includes("AUTOINCREMENT") ? 1 : 0)); // + sqlite_sequence
    db.close();
  });

  it.each(templates)("%s template: PostgreSQL export round-trips through the importer", async (id) => {
    const erd = importErd(createFallbackGeneration("", { templateId: id }).erd);
    const { erd: imported } = await importSql(erdToSql(erd));
    expect(imported.tables.map((t) => t.name).sort()).toEqual(erd.tables.map((t) => t.name).sort());
    expect(imported.relationships.length).toBe(erd.relationships.length);
  }, 60_000);

  it("writes enums, comments and generated columns in every format", () => {
    let erd = blog();
    const e = upsertEnum(erd, "post_status", ["draft", "in review"]);
    if (!e.ok) throw new Error(e.error);
    erd = applyOps(e.erd, [
      { op: "add_column", table: "posts", column: { name: "status", type: "post_status", nullable: false } },
      { op: "add_column", table: "posts", column: { name: "title_length", type: "INTEGER" } },
      { op: "set_comment", table: "posts", comment: "Blog posts" },
    ]).erd;
    const generated = updateColumn(erd, "t_posts", "title_length", { generated: "(length(title))" });
    if (!generated.ok) throw new Error(generated.error);
    erd = generated.erd;
    expect(erd.tables.find((t) => t.name === "posts")!.columns.find((c) => c.name === "title_length")?.generated).toBe("length(title)");

    expect(erdToMysql(erd)).toMatch(/`status` ENUM\('draft', 'in review'\) NOT NULL/);
    expect(erdToMysql(erd)).toMatch(/GENERATED ALWAYS AS \(length\(title\)\) STORED/);
    expect(erdToSqlite(erd)).toMatch(/CHECK \(status IN \('draft', 'in review'\)\)/);
    expect(erdToPrisma(erd)).toMatch(/enum PostStatus \{\n {2}draft\n {2}in_review @map\("in review"\)/);
    expect(erdToPrisma(erd)).toContain("/// Blog posts");
    expect(erdToDrizzle(erd)).toContain('postStatusEnum("status")');
    expect(erdToDrizzle(erd)).toContain(".generatedAlwaysAs(sql`length(title)`)");
  });
});

describe("SQL import", () => {
  it("reads a simple MySQL dump, including inline ENUMs", async () => {
    const { erd } = await importSql(`
      CREATE TABLE \`authors\` (
        \`id\` INT(11) NOT NULL AUTO_INCREMENT,
        \`email\` VARCHAR(255) NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_email\` (\`email\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      CREATE TABLE \`posts\` (
        \`id\` INT(11) NOT NULL AUTO_INCREMENT,
        \`author_id\` INT(11) NOT NULL,
        \`status\` ENUM('draft','published') NOT NULL,
        \`is_pinned\` TINYINT(1) NOT NULL DEFAULT 0,
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`fk_author\` FOREIGN KEY (\`author_id\`) REFERENCES \`authors\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB;`);
    const posts = erd.tables.find((t) => t.name === "posts")!;
    expect(posts.columns.find((c) => c.name === "id")?.dataType).toBe("SERIAL");
    expect(posts.columns.find((c) => c.name === "is_pinned")).toMatchObject({ dataType: "BOOLEAN", defaultValue: "false" });
    expect(posts.constraints.some((c) => c.type === "CHECK" && /draft/.test(c.expression ?? ""))).toBe(true);
    expect(erd.relationships).toEqual([expect.objectContaining({ fromTable: "posts", toTable: "authors", onDelete: "CASCADE" })]);
    expect(erd.tables.find((t) => t.name === "authors")!.constraints.some((c) => c.type === "UNIQUE")).toBe(true);
  }, 60_000);

  it("explains SQL it can't run", async () => {
    await expect(importSql("CREATE TABLE broken (id INT REFERENCES nowhere(id));")).rejects.toThrow(/Postgres couldn't run this SQL/);
  }, 60_000);
});
