/**
 * Run the schema in real Postgres (PGlite) and check it behaves as declared:
 * the exported DDL executes, realistic rows can be inserted, and NOT NULL,
 * UNIQUE, FOREIGN KEY, CHECK and ON DELETE rules are actually enforced.
 */
import type { PGlite } from "@electric-sql/pglite";
import type { Column, ERD, Relationship, Table } from "@/types/erd";
import { erdToSql } from "@/lib/ontology/transformer";
import { isColumnUnique } from "@/lib/erd/model";
import { createPostgres, toPgError, SQLSTATE } from "./pg";
import { checkViolation, isAutoIncrement, validLiteral } from "./values";

export type TestKind = "insert" | "not_null" | "unique" | "foreign_key" | "check" | "on_delete";

export interface DbTest {
  id: string;
  table: string;
  kind: TestKind;
  title: string;
  status: "pass" | "fail" | "skip";
  detail: string | null;
  sql: string;
}

export interface DdlProblem {
  table: string | null;
  statement: string;
  error: string;
}

export interface SeedPreview {
  table: string;
  columns: string[];
  rows: string[][];
}

export interface VerifyRun {
  startedAt: number;
  durationMs: number;
  ddlProblems: DdlProblem[];
  tests: DbTest[];
  seed: SeedPreview[];
}

const ROWS_PER_TABLE = 5;

function statementTable(statement: string): string | null {
  const match = statement.match(/^(?:CREATE TABLE|ALTER TABLE)\s+([a-z_][a-z0-9_]*)/i) ?? statement.match(/\bON\s+([a-z_][a-z0-9_]*)\s*\(/i);
  return match ? match[1] : null;
}

/** Parents before children, so foreign keys have rows to point at. */
function insertionOrder(erd: ERD): Table[] {
  const byName = new Map(erd.tables.map((t) => [t.name, t]));
  const ordered: Table[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (table: Table) => {
    if (state.get(table.name)) return;
    state.set(table.name, "visiting");
    for (const rel of erd.relationships) {
      if (rel.fromTable !== table.name || rel.toTable === table.name) continue;
      const parent = byName.get(rel.toTable);
      if (parent && state.get(parent.name) !== "visiting") visit(parent);
    }
    state.set(table.name, "done");
    ordered.push(table);
  };
  erd.tables.forEach(visit);
  return ordered;
}

function fkFor(erd: ERD, table: Table, column: Column): Relationship | undefined {
  return erd.relationships.find((r) => r.fromTable === table.name && r.fromColumn === column.name);
}

/** Columns we supply on insert: skip auto-increment and defaulted columns. */
function insertColumns(table: Table): Column[] {
  return table.columns.filter((c) => !isAutoIncrement(c) && !(c.defaultValue && !c.isForeignKey));
}

function missingReference(column: Column): string {
  const type = column.dataType.toUpperCase();
  if (/UUID/.test(type)) return "'00000000-0000-0000-0000-000000000000'";
  if (/INT|SERIAL|NUMERIC|DECIMAL/.test(type)) return "-999999";
  return "'__missing_reference__'";
}

/** INSERT for one fresh row; FKs point at existing parent rows unless overridden. */
function insertSql(erd: ERD, table: Table, overrides: Record<string, string>, row: number, returning?: string): string | null {
  const columns = insertColumns(table);
  if (columns.length === 0) return `INSERT INTO ${table.name} DEFAULT VALUES${returning ? ` RETURNING ${returning}` : ""}`;
  const values = columns.map((column) => {
    if (column.name in overrides) return overrides[column.name];
    const rel = fkFor(erd, table, column);
    if (rel) return `(SELECT ${rel.toColumn} FROM ${rel.toTable} ORDER BY ${rel.toColumn} DESC LIMIT 1)`;
    return validLiteral(table, column, row);
  });
  return `INSERT INTO ${table.name} (${columns.map((c) => c.name).join(", ")}) VALUES (${values.join(", ")})${returning ? ` RETURNING ${returning}` : ""}`;
}

export async function runVerification(erd: ERD, onProgress?: (message: string) => void): Promise<VerifyRun> {
  const startedAt = Date.now();
  const tests: DbTest[] = [];
  const ddlProblems: DdlProblem[] = [];
  const seed: SeedPreview[] = [];
  let counter = 0;
  const addTest = (test: Omit<DbTest, "id">) => tests.push({ ...test, id: `t${++counter}` });

  onProgress?.("Starting Postgres…");
  const pg: PGlite = await createPostgres();

  try {
    // 1. The exact DDL Episteme exports.
    onProgress?.("Creating tables…");
    const statements = erdToSql(erd)
      .split(/;\s*\n\s*\n/)
      .map((s) => s.trim().replace(/;$/, ""))
      .filter(Boolean);
    for (const statement of statements) {
      try {
        await pg.exec(`${statement};`);
      } catch (error) {
        ddlProblems.push({ table: statementTable(statement), statement, error: toPgError(error).message });
      }
    }

    const existing = new Set(
      (await pg.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).rows.map((r) => r.table_name)
    );

    // 2. Seed realistic rows, parents first.
    onProgress?.("Inserting sample data…");
    const seeded = new Map<string, number>();
    for (const table of insertionOrder(erd)) {
      if (!existing.has(table.name)) continue;
      const columns = insertColumns(table);
      let inserted = 0;
      let firstError: string | null = null;
      const emptyParents = new Set<string>();
      let lastSql = "";

      for (let row = 0; row < ROWS_PER_TABLE; row += 1) {
        const values: string[] = [];
        let skipRow = false;
        for (const column of columns) {
          const rel = fkFor(erd, table, column);
          if (rel) {
            const parentRows = rel.toTable === table.name ? inserted : seeded.get(rel.toTable) ?? 0;
            if (parentRows === 0) {
              if (column.nullable) values.push("NULL");
              else {
                skipRow = true;
                emptyParents.add(rel.toTable);
              }
              continue;
            }
            const offset = isColumnUnique(table, column.name) ? row : row % parentRows;
            if (offset >= parentRows) {
              skipRow = true;
              continue;
            }
            values.push(`(SELECT ${rel.toColumn} FROM ${rel.toTable} ORDER BY ${rel.toColumn} OFFSET ${offset} LIMIT 1)`);
          } else {
            values.push(validLiteral(table, column, row));
          }
        }
        if (skipRow) break;

        lastSql = columns.length
          ? `INSERT INTO ${table.name} (${columns.map((c) => c.name).join(", ")}) VALUES (${values.join(", ")})`
          : `INSERT INTO ${table.name} DEFAULT VALUES`;
        try {
          await pg.exec(`${lastSql};`);
          inserted += 1;
        } catch (error) {
          firstError ??= toPgError(error).message;
        }
      }

      seeded.set(table.name, inserted);
      addTest({
        table: table.name,
        kind: "insert",
        title: `${table.name}: accepts valid rows`,
        status: inserted > 0 ? "pass" : "fail",
        detail:
          inserted > 0
            ? `${inserted} sample rows inserted`
            : firstError ??
              `No row could be inserted: it requires a row in ${[...emptyParents].join(", ") || "a parent table"}, which has none.`,
        sql: lastSql,
      });
    }

    // 3. Constraint tests, each isolated in a savepoint.
    onProgress?.("Testing constraints…");
    await pg.exec("BEGIN;");
    let savepoint = 0;
    const expectError = async (
      base: { table: string; kind: TestKind; title: string },
      sql: string,
      code: string
    ) => {
      const name = `sp_${++savepoint}`;
      await pg.exec(`SAVEPOINT ${name};`);
      try {
        await pg.exec(`${sql};`);
        addTest({ ...base, status: "fail", detail: "The database accepted a row that should have been rejected.", sql });
      } catch (error) {
        const pgError = toPgError(error);
        if (pgError.code === code) {
          addTest({ ...base, status: "pass", detail: pgError.message, sql });
        } else {
          addTest({
            ...base,
            status: "skip",
            detail: `Rejected for a different reason: ${pgError.message}`,
            sql,
          });
        }
      } finally {
        await pg.exec(`ROLLBACK TO SAVEPOINT ${name};`);
      }
    };

    for (const table of erd.tables) {
      if (!existing.has(table.name) || !seeded.get(table.name)) continue;
      const columns = insertColumns(table);
      const freshRow = (overrides: Record<string, string>, row = 50) =>
        columns.map((column) => {
          if (column.name in overrides) return overrides[column.name];
          const rel = fkFor(erd, table, column);
          if (rel) return `(SELECT ${rel.toColumn} FROM ${rel.toTable} ORDER BY ${rel.toColumn} DESC LIMIT 1)`;
          return validLiteral(table, column, row);
        });
      const insert = (overrides: Record<string, string>, row?: number) =>
        `INSERT INTO ${table.name} (${columns.map((c) => c.name).join(", ")}) VALUES (${freshRow(overrides, row).join(", ")})`;
      if (columns.length === 0) continue;

      // NOT NULL
      for (const column of columns.filter((c) => !c.nullable && !c.isPrimaryKey)) {
        await expectError(
          { table: table.name, kind: "not_null", title: `${table.name}.${column.name}: rejects NULL` },
          insert({ [column.name]: "NULL" }),
          SQLSTATE.notNull
        );
      }

      // UNIQUE (single and multi-column)
      const uniqueSets = [
        ...table.constraints.filter((c) => c.type === "UNIQUE").map((c) => c.columns),
        ...table.indexes.filter((i) => i.unique).map((i) => i.columns),
      ];
      const seen = new Set<string>();
      for (const set of uniqueSets) {
        const key = set.join(",");
        if (seen.has(key) || !set.every((name) => columns.some((c) => c.name === name))) continue;
        seen.add(key);
        const overrides = Object.fromEntries(set.map((name) => [name, `(SELECT ${name} FROM ${table.name} ORDER BY 1 LIMIT 1)`]));
        await expectError(
          { table: table.name, kind: "unique", title: `${table.name}: rejects duplicate (${set.join(", ")})` },
          insert(overrides, 77),
          SQLSTATE.unique
        );
      }

      // FOREIGN KEY
      for (const column of columns.filter((c) => fkFor(erd, table, c))) {
        await expectError(
          { table: table.name, kind: "foreign_key", title: `${table.name}.${column.name}: rejects a missing ${fkFor(erd, table, column)?.toTable} reference` },
          insert({ [column.name]: missingReference(column) }, 88),
          SQLSTATE.foreignKey
        );
      }

      // CHECK
      for (const constraint of table.constraints.filter((c) => c.type === "CHECK")) {
        const column = columns.find((c) => constraint.columns.includes(c.name));
        const violating = column ? checkViolation(table, column) : null;
        if (!column || !violating) continue;
        await expectError(
          { table: table.name, kind: "check", title: `${table.name}: enforces CHECK (${constraint.expression})` },
          insert({ [column.name]: violating }, 99),
          SQLSTATE.check
        );
      }
    }

    // ON DELETE behaviour, isolated: a fresh parent with one fresh child, so
    // other foreign keys to the same parent can't interfere.
    const tableByName = new Map(erd.tables.map((t) => [t.name, t]));
    let freshRow = 300;
    for (const rel of erd.relationships) {
      const parent = tableByName.get(rel.toTable);
      const child = tableByName.get(rel.fromTable);
      if (!parent || !child || rel.fromTable === rel.toTable || !seeded.get(rel.fromTable) || !seeded.get(rel.toTable)) continue;
      const base = {
        table: rel.fromTable,
        kind: "on_delete" as const,
        title: `${rel.toTable} → ${rel.fromTable}: ON DELETE ${rel.onDelete.replace("_", " ")}`,
      };
      const name = `sp_${++savepoint}`;
      await pg.exec(`SAVEPOINT ${name};`);
      let sql = "";
      try {
        freshRow += 1;
        const parentInsert = insertSql(erd, parent, {}, freshRow, rel.toColumn);
        const parentKey = parentInsert
          ? (await pg.query<Record<string, unknown>>(parentInsert)).rows[0]?.[rel.toColumn]
          : undefined;
        if (parentKey === undefined || parentKey === null) throw new Error("Couldn't create a parent row to test with.");
        const keyLiteral = typeof parentKey === "number" ? String(parentKey) : `'${String(parentKey).replace(/'/g, "''")}'`;
        const childInsert = insertSql(erd, child, { [rel.fromColumn]: keyLiteral }, freshRow);
        if (!childInsert) throw new Error("Couldn't create a child row to test with.");
        await pg.exec(`${childInsert};`);

        sql = `DELETE FROM ${rel.toTable} WHERE ${rel.toColumn} = ${keyLiteral}`;
        let deleteError: { message: string; code: string | null } | null = null;
        try {
          await pg.exec(`${sql};`);
        } catch (error) {
          deleteError = toPgError(error);
        }

        if (rel.onDelete === "RESTRICT" || rel.onDelete === "NO_ACTION") {
          const blocked = deleteError?.code === SQLSTATE.foreignKey;
          addTest({
            ...base,
            status: blocked ? "pass" : "fail",
            detail: blocked ? "Deleting a referenced parent is blocked." : deleteError ? deleteError.message : "The parent was deleted while a child still pointed at it.",
            sql,
          });
        } else if (deleteError) {
          addTest({ ...base, status: "fail", detail: deleteError.message, sql });
        } else {
          const remaining = Number(
            (await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${rel.fromTable} WHERE ${rel.fromColumn} = ${keyLiteral}`)).rows[0]?.n ?? 0
          );
          addTest({
            ...base,
            status: remaining === 0 ? "pass" : "fail",
            detail:
              remaining === 0
                ? rel.onDelete === "CASCADE" ? "The child row was deleted with its parent." : "The child's reference was cleared."
                : `${remaining} child row(s) still point at the deleted parent.`,
            sql,
          });
        }
      } catch (error) {
        addTest({ ...base, status: "skip", detail: `Couldn't set up the test: ${toPgError(error).message}`, sql });
      } finally {
        await pg.exec(`ROLLBACK TO SAVEPOINT ${name};`);
      }
    }
    await pg.exec("ROLLBACK;");

    // 4. Sample data preview.
    for (const table of erd.tables) {
      if (!existing.has(table.name)) continue;
      const result = await pg.query<Record<string, unknown>>(`SELECT * FROM ${table.name} LIMIT 5`);
      const columns = result.fields.map((f) => f.name);
      seed.push({
        table: table.name,
        columns,
        rows: result.rows.map((row) =>
          columns.map((c) => {
            const value = row[c];
            if (value === null || value === undefined) return "NULL";
            if (value instanceof Date) return value.toISOString().replace("T", " ").slice(0, 19);
            return typeof value === "object" ? JSON.stringify(value) : String(value);
          })
        ),
      });
    }
  } finally {
    await pg.close();
  }

  return { startedAt, durationMs: Date.now() - startedAt, ddlProblems, tests, seed };
}
