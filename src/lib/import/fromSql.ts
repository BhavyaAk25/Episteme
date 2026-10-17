/**
 * Import PostgreSQL DDL: run it in PGlite (real Postgres in the browser),
 * then read the resulting catalog back into an ERD. Postgres does the
 * parsing, so anything pg_dump --schema-only produces is understood.
 */
import type { Column, ERD, OnDeleteAction, Table, TableConstraint, TableIndex } from "@/types/erd";
import { createPostgres, toPgError } from "@/lib/verify/pg";

export interface ImportResult {
  erd: ERD;
  skipped: string[];
}

const ON_DELETE: Record<string, OnDeleteAction> = { a: "NO_ACTION", r: "RESTRICT", c: "CASCADE", n: "SET_NULL", d: "RESTRICT" };

function friendlyType(formatted: string, isSerial: boolean): string {
  const t = formatted.toLowerCase();
  if (isSerial) return t === "bigint" ? "BIGSERIAL" : t === "smallint" ? "SMALLSERIAL" : "SERIAL";
  return t
    .replace(/^character varying/, "varchar")
    .replace(/^character\b/, "char")
    .replace(/^timestamp\(\d\) /, "timestamp ")
    .replace(/^timestamp without time zone$/, "timestamp")
    .replace(/^timestamp with time zone$/, "timestamptz")
    .replace(/^time without time zone$/, "time")
    .replace(/^double precision$/, "double precision")
    .toUpperCase();
}

/** Strip noisy casts from defaults/checks: 'active'::character varying → 'active'. */
function tidyExpression(expression: string): string {
  let result = expression.replace(/::(character varying|text|numeric|integer|bigint|jsonb|json|timestamp[a-z ]*|date|boolean)(\[\])?/gi, "");
  // Drop redundant outer parentheses: ((qty > 0)) → qty > 0
  while (/^\(([\s\S]*)\)$/.test(result) && balanced(result.slice(1, -1))) result = result.slice(1, -1);
  return result;
}

function balanced(text: string): boolean {
  let depth = 0;
  for (const char of text) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** Lightly adapt common MySQL-isms so simple MySQL dumps also import. */
export function adaptDialect(sql: string): string {
  return sql
    .replace(/`/g, '"')
    .replace(/\bINT\s*\(\d+\)/gi, "INTEGER")
    .replace(/\b(INTEGER|INT|BIGINT)\b([^,\n]*?)\bAUTO_INCREMENT\b/gi, (_, type: string, rest: string) => `${/BIG/i.test(type) ? "BIGSERIAL" : "SERIAL"}${rest}`)
    .replace(/\)\s*ENGINE\s*=\s*\w+[^;]*;/gi, ");")
    .replace(/\bDATETIME\b/gi, "TIMESTAMP")
    .replace(/\bTINYINT\s*\(\s*1\s*\)([^,\n]*?)DEFAULT\s+'?([01])'?/gi, (_, rest: string, bit: string) => `BOOLEAN${rest}DEFAULT ${bit === "1" ? "true" : "false"}`)
    .replace(/\bTINYINT\s*\(\s*1\s*\)/gi, "BOOLEAN")
    .replace(/\bUNSIGNED\b/gi, "")
    .replace(/^\s*(SET|USE|LOCK|UNLOCK)\b[^;]*;/gim, "")
    .replace(/,\s*(UNIQUE\s+)?KEY\s+"?\w+"?\s*\(([^)]*)\)/gi, (_, unique: string | undefined, cols: string) => (unique ? `, UNIQUE (${cols})` : ""));
}

export async function importSql(rawSql: string): Promise<ImportResult> {
  const pg = await createPostgres();
  const skipped: string[] = [];
  try {
    try {
      await pg.exec(rawSql);
    } catch (first) {
      // Retry once with MySQL-isms translated; report the original error if that fails too.
      try {
        await pg.close();
      } catch {
        /* ignore */
      }
      const retry = await createPostgres();
      try {
        await retry.exec(adaptDialect(rawSql));
        return await introspect(retry, skipped);
      } catch {
        throw new Error(`Postgres couldn't run this SQL: ${toPgError(first).message}`);
      } finally {
        await retry.close();
      }
    }
    return await introspect(pg, skipped);
  } finally {
    try {
      await pg.close();
    } catch {
      /* already closed */
    }
  }
}

async function introspect(pg: Awaited<ReturnType<typeof createPostgres>>, skipped: string[]): Promise<ImportResult> {
  const tables = (
    await pg.query<{ oid: number; name: string }>(
      `SELECT c.oid, c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r','p') ORDER BY c.oid`
    )
  ).rows;
  if (tables.length === 0) throw new Error("No tables were found. Paste CREATE TABLE statements (for example from pg_dump --schema-only).");

  const columns = (
    await pg.query<{ table_oid: number; attnum: number; name: string; type: string; not_null: boolean; default_value: string | null }>(
      `SELECT a.attrelid AS table_oid, a.attnum, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
              a.attnotnull AS not_null, pg_get_expr(d.adbin, d.adrelid) AS default_value
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = ANY($1) AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attrelid, a.attnum`,
      [tables.map((t) => t.oid)]
    )
  ).rows;

  const constraints = (
    await pg.query<{ table_oid: number; name: string; type: string; cols: number[]; ref_oid: number; ref_cols: number[] | null; on_delete: string; def: string; index_oid: number }>(
      `SELECT conrelid AS table_oid, conname AS name, contype AS type, conkey AS cols, confrelid AS ref_oid, confkey AS ref_cols,
              confdeltype AS on_delete, pg_get_constraintdef(oid) AS def, conindid AS index_oid
       FROM pg_constraint WHERE conrelid = ANY($1)`,
      [tables.map((t) => t.oid)]
    )
  ).rows;

  const indexes = (
    await pg.query<{ table_oid: number; index_oid: number; name: string; unique: boolean; primary: boolean; cols: string }>(
      `SELECT i.indrelid AS table_oid, i.indexrelid AS index_oid, c.relname AS name, i.indisunique AS unique, i.indisprimary AS primary,
              i.indkey::text AS cols
       FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE i.indrelid = ANY($1)`,
      [tables.map((t) => t.oid)]
    )
  ).rows;

  const tableName = new Map(tables.map((t) => [t.oid, t.name]));
  const columnName = (tableOid: number, attnum: number) => columns.find((c) => c.table_oid === tableOid && c.attnum === attnum)?.name ?? "";
  const constraintIndexes = new Set(constraints.map((c) => c.index_oid).filter(Boolean));

  const erdTables: Table[] = tables.map((t) => {
    const pkCols = new Set(constraints.filter((c) => c.table_oid === t.oid && c.type === "p").flatMap((c) => c.cols));
    const cols: Column[] = columns
      .filter((c) => c.table_oid === t.oid)
      .map((c) => {
        const serial = /^nextval\(/.test(c.default_value ?? "") && /int/.test(c.type);
        return {
          name: c.name,
          dataType: friendlyType(c.type, serial),
          nullable: !c.not_null,
          defaultValue: serial || !c.default_value ? null : tidyExpression(c.default_value),
          isPrimaryKey: pkCols.has(c.attnum),
          isForeignKey: false,
          referencesTable: null,
          referencesColumn: null,
        };
      });

    const tableConstraints: TableConstraint[] = [];
    for (const c of constraints.filter((k) => k.table_oid === t.oid)) {
      if (c.type === "u") {
        tableConstraints.push({ type: "UNIQUE", columns: c.cols.map((n) => columnName(t.oid, n)), expression: null, onDelete: null });
      } else if (c.type === "c") {
        const expression = tidyExpression(c.def.replace(/^CHECK\s*/i, "").replace(/\s*NOT VALID$/i, ""));
        tableConstraints.push({ type: "CHECK", columns: c.cols?.map((n) => columnName(t.oid, n)) ?? [], expression, onDelete: null });
      }
    }

    const tableIndexes: TableIndex[] = indexes
      .filter((i) => i.table_oid === t.oid && !i.primary && !constraintIndexes.has(i.index_oid))
      .map((i) => ({
        name: i.name,
        unique: i.unique,
        columns: i.cols.split(" ").map(Number).filter((n) => n > 0).map((n) => columnName(t.oid, n)),
      }))
      .filter((i) => i.columns.length > 0);

    return { id: `tbl_${t.name}`, name: t.name, objectTypeId: `obj_${t.name}`, columns: cols, constraints: tableConstraints, indexes: tableIndexes };
  });

  const relationships: ERD["relationships"] = [];
  for (const fk of constraints.filter((c) => c.type === "f")) {
    if (fk.cols.length !== 1 || !fk.ref_cols || fk.ref_cols.length !== 1) {
      skipped.push(`${tableName.get(fk.table_oid)}.${fk.name}: multi-column foreign keys aren't supported yet`);
      continue;
    }
    const fromTable = tableName.get(fk.table_oid) ?? "";
    const toTable = tableName.get(fk.ref_oid) ?? "";
    const fromColumn = columnName(fk.table_oid, fk.cols[0]);
    const child = erdTables.find((t) => t.name === fromTable);
    const column = child?.columns.find((c) => c.name === fromColumn);
    const unique = child?.constraints.some((c) => c.type === "UNIQUE" && c.columns.length === 1 && c.columns[0] === fromColumn);
    relationships.push({
      id: `rel_${fk.name}`,
      fromTable,
      toTable,
      fromColumn,
      toColumn: columnName(fk.ref_oid, fk.ref_cols[0]),
      cardinality: unique || column?.isPrimaryKey ? "1:1" : "1:N",
      required: column ? !column.nullable : true,
      onDelete: ON_DELETE[fk.on_delete] ?? "RESTRICT",
    });
  }

  return { erd: { tables: erdTables, relationships }, skipped };
}
