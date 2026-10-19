/**
 * Pure editing operations on the ERD.
 *
 * Invariants kept by `normalizeErd` after every edit:
 * - Relationships are the source of truth for foreign keys. A column is an
 *   FK exactly when a relationship starts from it, and its FOREIGN_KEY
 *   constraint (with ON DELETE) mirrors that relationship.
 * - A relationship is "required" exactly when its FK column is NOT NULL.
 * - The PRIMARY_KEY constraint mirrors the columns flagged isPrimaryKey.
 * - Constraints, indexes and relationships never point at missing
 *   tables or columns.
 */
import type {
  Column,
  EnumType,
  ERD,
  OnDeleteAction,
  Relationship,
  Table,
  TableColor,
  TableConstraint,
} from "@/types/erd";
import type { Cardinality } from "@/types/ontology";

export type EditResult<T = object> = ({ ok: true; erd: ERD } & T) | { ok: false; error: string };

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

// Words that would need quoting in PostgreSQL or SQLite. Rejecting them keeps
// the generated SQL valid without quoting every identifier.
const RESERVED = new Set([
  "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "asymmetric", "both", "case", "cast",
  "check", "collate", "column", "constraint", "create", "current_date", "current_time",
  "current_timestamp", "current_user", "default", "deferrable", "desc", "distinct", "do", "else", "end",
  "except", "false", "fetch", "for", "foreign", "from", "grant", "group", "having", "in", "index",
  "initially", "intersect", "into", "is", "join", "key", "lateral", "leading", "left", "limit",
  "localtime", "localtimestamp", "not", "null", "offset", "on", "only", "or", "order", "outer",
  "placing", "primary", "references", "returning", "right", "select", "session_user", "some",
  "symmetric", "table", "then", "to", "trailing", "true", "union", "unique", "user", "using",
  "values", "when", "where", "window", "with",
]);

export function validateIdentifier(name: string, kind: "table" | "column"): string | null {
  if (!name) return `${kind === "table" ? "Table" : "Column"} name can't be empty.`;
  if (name.length > 63) return "Names must be 63 characters or fewer.";
  if (!IDENTIFIER.test(name)) return "Use lowercase letters, numbers and underscores, starting with a letter.";
  if (RESERVED.has(name)) return `"${name}" is a reserved SQL word. Try "${name}s" or "app_${name}".`;
  return null;
}

/** Turn free text into a valid identifier, e.g. "Order Items" -> "order_items". */
export function toIdentifier(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "_$1");
}

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function singular(name: string): string {
  if (name.endsWith("ies") && name.length > 3) return `${name.slice(0, -3)}y`;
  if (/(ss|x|ch|sh)es$/.test(name)) return name.slice(0, -2);
  if (name.endsWith("s") && !name.endsWith("ss") && name.length > 1) return name.slice(0, -1);
  return name;
}

/** Type a foreign key column should use to reference `column`. */
export function referencingType(dataType: string): string {
  const upper = dataType.toUpperCase();
  if (upper === "BIGSERIAL") return "BIGINT";
  if (upper === "SMALLSERIAL") return "SMALLINT";
  if (upper === "SERIAL") return "INTEGER";
  return dataType;
}

const sameColumns = (a: string[], b: string[]) => a.length === b.length && a.every((c, i) => c === b[i]);

export function isColumnUnique(table: Table, columnName: string): boolean {
  return (
    table.constraints.some((c) => c.type === "UNIQUE" && sameColumns(c.columns, [columnName])) ||
    table.indexes.some((i) => i.unique && sameColumns(i.columns, [columnName]))
  );
}

function findTable(erd: ERD, tableId: string): Table | undefined {
  return erd.tables.find((t) => t.id === tableId);
}

function mapTable(erd: ERD, tableId: string, fn: (table: Table) => Table): ERD {
  return { ...erd, tables: erd.tables.map((t) => (t.id === tableId ? fn(t) : t)) };
}

// ---------------------------------------------------------------------------
// Consistency
// ---------------------------------------------------------------------------

export function normalizeErd(erd: ERD): ERD {
  const tableByName = new Map(erd.tables.map((t) => [t.name, t]));

  // 1. Keep only relationships whose tables and columns exist; one per FK column.
  const seenFk = new Set<string>();
  const relationships: Relationship[] = [];
  for (const rel of erd.relationships) {
    const from = tableByName.get(rel.fromTable);
    const to = tableByName.get(rel.toTable);
    if (!from || !to) continue;
    if (!from.columns.some((c) => c.name === rel.fromColumn)) continue;
    if (!to.columns.some((c) => c.name === rel.toColumn)) continue;
    const key = `${rel.fromTable}.${rel.fromColumn}`;
    if (seenFk.has(key)) continue;
    seenFk.add(key);
    relationships.push(rel);
  }

  const relByFk = new Map(relationships.map((r) => [`${r.fromTable}.${r.fromColumn}`, r]));

  // 2. Derive FK flags, FK/PK constraints; drop dangling constraints & indexes.
  const tables = erd.tables.map((table) => {
    const columnNames = new Set(table.columns.map((c) => c.name));

    const columns: Column[] = table.columns.map((column) => {
      const rel = relByFk.get(`${table.name}.${column.name}`);
      return {
        ...column,
        isForeignKey: Boolean(rel),
        referencesTable: rel ? rel.toTable : null,
        referencesColumn: rel ? rel.toColumn : null,
      };
    });

    const otherConstraints = table.constraints.filter(
      (c) =>
        c.type !== "FOREIGN_KEY" &&
        c.type !== "PRIMARY_KEY" &&
        c.columns.every((name) => columnNames.has(name))
    );

    const pkColumns = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
    const pkConstraint: TableConstraint[] = pkColumns.length
      ? [{ type: "PRIMARY_KEY", columns: pkColumns, expression: null, onDelete: null }]
      : [];

    const fkConstraints: TableConstraint[] = relationships
      .filter((r) => r.fromTable === table.name)
      .map((r) => ({ type: "FOREIGN_KEY", columns: [r.fromColumn], expression: null, onDelete: r.onDelete }));

    return {
      ...table,
      columns,
      constraints: [...pkConstraint, ...fkConstraints, ...otherConstraints],
      indexes: table.indexes.filter((i) => i.columns.length > 0 && i.columns.every((name) => columnNames.has(name))),
    };
  });

  // 3. Required mirrors NOT NULL on the FK column; SET NULL needs a nullable column.
  const normalizedTables = new Map(tables.map((t) => [t.name, t]));
  const finalRelationships = relationships.map((rel) => {
    const fkColumn = normalizedTables.get(rel.fromTable)?.columns.find((c) => c.name === rel.fromColumn);
    const required = fkColumn ? !fkColumn.nullable : rel.required;
    const onDelete: OnDeleteAction = required && rel.onDelete === "SET_NULL" ? "RESTRICT" : rel.onDelete;
    return { ...rel, required, onDelete };
  });

  // Keep FK constraints in step with any onDelete correction above.
  const relOnDelete = new Map(finalRelationships.map((r) => [`${r.fromTable}.${r.fromColumn}`, r.onDelete]));
  const finalTables = tables.map((table) => ({
    ...table,
    constraints: table.constraints.map((c) =>
      c.type === "FOREIGN_KEY" ? { ...c, onDelete: relOnDelete.get(`${table.name}.${c.columns[0]}`) ?? c.onDelete } : c
    ),
  }));

  return { ...erd, tables: finalTables, relationships: finalRelationships };
}

// Anything that is spliced into SQL unquoted must not be able to end the
// statement. Names are coerced to plain identifiers; expressions and types
// with statement separators are dropped.
const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SAFE_TYPE = /^[A-Za-z_][A-Za-z0-9_ ]*(\(\s*\d+\s*(,\s*\d+\s*)?\))?[A-Za-z0-9_ ]*(\[\])?$/;
/** Error message when a data type isn't a plain SQL type name, else null. */
export function validateDataType(dataType: string): string | null {
  return SAFE_TYPE.test(dataType.trim()) ? null : `"${dataType.trim().slice(0, 40)}" isn't a valid type. Use a type like TEXT, INTEGER or NUMERIC(12,2).`;
}

// Every generated statement starts with Episteme's own prefix, so without a
// semicolon a fragment can't start a statement of its own.
const unsafeExpression = (text: string | null | undefined) => typeof text === "string" && text.includes(";");

function safeName(name: unknown, fallback: string): string {
  const text = typeof name === "string" ? name : "";
  if (SAFE_NAME.test(text) && text.length <= 63) return text;
  return (toIdentifier(text) || fallback).slice(0, 63);
}

/**
 * Make an ERD from an untrusted source (share link, storage, AI output) safe
 * to turn into SQL: every identifier is a plain name, data types look like
 * types, and no default, CHECK, generated expression or view can end the
 * statement it is placed in.
 */
export function sanitizeErd(erd: ERD): ERD {
  const tableNames = new Map<string, string>();
  const columnNames = new Map<string, Map<string, string>>();
  const fixColumn = (table: string, column: string) => columnNames.get(table)?.get(column) ?? column;

  const tables = (erd.tables ?? []).map((table, ti) => {
    const name = safeName(table.name, `table_${ti + 1}`);
    tableNames.set(table.name, name);
    const map = new Map<string, string>();
    columnNames.set(table.name, map);
    const columns = (table.columns ?? []).map((column, ci) => {
      const columnName = safeName(column.name, `column_${ci + 1}`);
      map.set(column.name, columnName);
      return {
        ...column,
        name: columnName,
        dataType: typeof column.dataType === "string" && SAFE_TYPE.test(column.dataType.trim()) ? column.dataType.trim() : "TEXT",
        defaultValue: unsafeExpression(column.defaultValue) ? null : column.defaultValue ?? null,
        generated: unsafeExpression(column.generated) ? null : column.generated ?? null,
      };
    });
    const rename = (cols: string[]) => (cols ?? []).map((c) => map.get(c) ?? c);
    return {
      ...table,
      name,
      columns,
      constraints: (table.constraints ?? [])
        .filter((c) => !(c.type === "CHECK" && unsafeExpression(c.expression)))
        .map((c) => ({ ...c, columns: rename(c.columns) })),
      indexes: (table.indexes ?? []).map((i, ii) => ({ ...i, name: safeName(i.name, `idx_${name}_${ii + 1}`), columns: rename(i.columns) })),
    };
  });

  const relationships = (erd.relationships ?? []).map((r) => ({
    ...r,
    fromTable: tableNames.get(r.fromTable) ?? safeName(r.fromTable, "missing"),
    toTable: tableNames.get(r.toTable) ?? safeName(r.toTable, "missing"),
    fromColumn: fixColumn(r.fromTable, r.fromColumn),
    toColumn: fixColumn(r.toTable, r.toColumn),
  }));
  // Column references inside tables follow the renamed tables too.
  const fixedTables = tables.map((t) => ({
    ...t,
    columns: t.columns.map((c) =>
      c.referencesTable
        ? { ...c, referencesTable: tableNames.get(c.referencesTable) ?? c.referencesTable, referencesColumn: c.referencesColumn ? fixColumn(c.referencesTable, c.referencesColumn) : c.referencesColumn }
        : c
    ),
  }));

  const enums = erd.enums
    ?.filter((e) => Array.isArray(e.values))
    .map((e, i) => ({ name: safeName(e.name, `enum_${i + 1}`).toLowerCase(), values: e.values.map(String) }));
  const views = erd.views
    ?.filter((v) => typeof v.sql === "string" && /^(select|with)\b/i.test(cleanViewSql(v.sql)) && !unsafeExpression(cleanViewSql(v.sql)))
    .map((v, i) => ({ ...v, name: safeName(v.name, `view_${i + 1}`), sql: cleanViewSql(v.sql) }));

  return { ...erd, tables: fixedTables, relationships, ...(enums ? { enums } : {}), ...(views ? { views } : {}) };
}

/**
 * Prepare an ERD coming from generation or storage: make table ids unique,
 * turn FK-flagged columns that lack a relationship into relationships, then
 * normalize.
 */
export function importErd(raw: ERD): ERD {
  const input = sanitizeErd(raw);
  const usedIds = new Set<string>();
  const tables = input.tables.map((table) => {
    let id = table.id || randomId("tbl");
    while (usedIds.has(id)) id = randomId("tbl");
    usedIds.add(id);
    const constraints = table.constraints ?? [];
    const uniqueKeys = new Set(constraints.filter((c) => c.type === "UNIQUE").map((c) => c.columns.join(",")));
    return {
      ...table,
      id,
      constraints,
      // A unique index on exactly the columns of a UNIQUE constraint is a duplicate.
      indexes: (table.indexes ?? []).filter((i) => !(i.unique && uniqueKeys.has(i.columns.join(",")))),
    };
  });

  const relationships = [...input.relationships];
  const existing = new Set(relationships.map((r) => `${r.fromTable}.${r.fromColumn}`));
  const tableNames = new Set(tables.map((t) => t.name));

  for (const table of tables) {
    for (const column of table.columns) {
      if (!column.isForeignKey || !column.referencesTable || !tableNames.has(column.referencesTable)) continue;
      const key = `${table.name}.${column.name}`;
      if (existing.has(key)) continue;
      const fkConstraint = table.constraints.find((c) => c.type === "FOREIGN_KEY" && c.columns.includes(column.name));
      const target = tables.find((t) => t.name === column.referencesTable);
      const toColumn =
        column.referencesColumn ?? target?.columns.find((c) => c.isPrimaryKey)?.name ?? "id";
      relationships.push({
        id: randomId("rel"),
        fromTable: table.name,
        toTable: column.referencesTable,
        fromColumn: column.name,
        toColumn,
        cardinality: isColumnUnique(table, column.name) ? "1:1" : "1:N",
        required: !column.nullable,
        onDelete: fkConstraint?.onDelete ?? "RESTRICT",
      });
      existing.add(key);
    }
  }

  return normalizeErd({ ...input, tables, relationships });
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function uniqueTableName(erd: ERD, base: string): string {
  const names = new Set(erd.tables.map((t) => t.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

export function addTable(erd: ERD): EditResult<{ tableId: string }> {
  const name = uniqueTableName(erd, "new_table");
  const tableId = randomId("tbl");
  const table: Table = {
    id: tableId,
    name,
    objectTypeId: tableId,
    columns: [
      { name: "id", dataType: "SERIAL", nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, referencesTable: null, referencesColumn: null },
      { name: "created_at", dataType: "TIMESTAMP", nullable: false, defaultValue: "NOW()", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
    ],
    constraints: [],
    indexes: [],
  };
  return { ok: true, erd: normalizeErd({ ...erd, tables: [...erd.tables, table] }), tableId };
}

export interface NewColumnSpec {
  name: string;
  type?: string;
  nullable?: boolean;
  primaryKey?: boolean;
  defaultValue?: string | null;
}

/** Create a named table with columns. Adds `id SERIAL` if no primary key is given. */
export function createTable(
  erd: ERD,
  rawName: string,
  columnSpecs: NewColumnSpec[],
  position = erd.tables.length
): EditResult<{ tableId: string }> {
  const name = rawName.trim();
  const invalid = validateIdentifier(name, "table");
  if (invalid) return { ok: false, error: invalid };
  if (erd.tables.some((t) => t.name === name)) return { ok: false, error: `A table named "${name}" already exists.` };

  const columns: Column[] = [];
  for (const spec of columnSpecs) {
    const columnName = spec.name.trim();
    const columnInvalid = validateIdentifier(columnName, "column");
    if (columnInvalid) return { ok: false, error: `${name}.${columnName}: ${columnInvalid}` };
    if (columns.some((c) => c.name === columnName)) continue;
    const typeInvalid = spec.type?.trim() ? validateDataType(spec.type) : null;
    if (typeInvalid) return { ok: false, error: `${name}.${columnName}: ${typeInvalid}` };
    if (spec.defaultValue?.includes(";")) return { ok: false, error: `${name}.${columnName}: default values can't contain semicolons.` };
    columns.push({
      name: columnName,
      dataType: spec.type?.trim() || "TEXT",
      nullable: spec.primaryKey ? false : spec.nullable ?? true,
      defaultValue: spec.defaultValue?.trim() || null,
      isPrimaryKey: Boolean(spec.primaryKey),
      isForeignKey: false,
      referencesTable: null,
      referencesColumn: null,
    });
  }
  if (!columns.some((c) => c.isPrimaryKey)) {
    columns.unshift({ name: "id", dataType: "SERIAL", nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, referencesTable: null, referencesColumn: null });
  }

  const tableId = randomId("tbl");
  const tables = [...erd.tables];
  tables.splice(position, 0, { id: tableId, name, objectTypeId: tableId, columns, constraints: [], indexes: [] });
  return { ok: true, erd: normalizeErd({ ...erd, tables }), tableId };
}

export function renameTable(erd: ERD, tableId: string, rawName: string): EditResult {
  const table = findTable(erd, tableId);
  if (!table) return { ok: false, error: "Table not found." };
  const name = rawName.trim();
  if (name === table.name) return { ok: true, erd };
  const invalid = validateIdentifier(name, "table");
  if (invalid) return { ok: false, error: invalid };
  if (erd.tables.some((t) => t.name === name)) return { ok: false, error: `A table named "${name}" already exists.` };

  const oldName = table.name;
  const tables = erd.tables.map((t) => (t.id === tableId ? { ...t, name } : t));
  const relationships = erd.relationships.map((r) => ({
    ...r,
    fromTable: r.fromTable === oldName ? name : r.fromTable,
    toTable: r.toTable === oldName ? name : r.toTable,
  }));
  // Keep views pointing at the renamed table.
  const pattern = new RegExp(`\\b${oldName}\\b`, "g");
  const views = erd.views?.map((v) => ({ ...v, sql: v.sql.replace(pattern, name) }));
  return { ok: true, erd: normalizeErd({ ...erd, tables, relationships, views }) };
}

export function deleteTable(erd: ERD, tableId: string): EditResult {
  const table = findTable(erd, tableId);
  if (!table) return { ok: false, error: "Table not found." };
  return {
    ok: true,
    erd: normalizeErd({
      ...erd,
      tables: erd.tables.filter((t) => t.id !== tableId),
      relationships: erd.relationships.filter((r) => r.fromTable !== table.name && r.toTable !== table.name),
    }),
  };
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function uniqueColumnName(table: Table, base: string): string {
  const names = new Set(table.columns.map((c) => c.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

export function addColumn(erd: ERD, tableId: string): EditResult<{ columnName: string }> {
  const table = findTable(erd, tableId);
  if (!table) return { ok: false, error: "Table not found." };
  const columnName = uniqueColumnName(table, "new_column");
  const column: Column = {
    name: columnName,
    dataType: "TEXT",
    nullable: true,
    defaultValue: null,
    isPrimaryKey: false,
    isForeignKey: false,
    referencesTable: null,
    referencesColumn: null,
  };
  return {
    ok: true,
    erd: normalizeErd(mapTable(erd, tableId, (t) => ({ ...t, columns: [...t.columns, column] }))),
    columnName,
  };
}

export interface ColumnPatch {
  name?: string;
  dataType?: string;
  nullable?: boolean;
  defaultValue?: string | null;
  isPrimaryKey?: boolean;
  unique?: boolean;
  comment?: string | null;
  /** Generated column expression; null or "" makes it a normal column. */
  generated?: string | null;
}

/** "((a + b))" -> "a + b", but "length(x) + (y)" stays as it is. */
function stripOuterParens(text: string): string {
  let result = text.trim();
  const wraps = (t: string) => {
    if (!t.startsWith("(") || !t.endsWith(")")) return false;
    let depth = 0;
    for (let i = 0; i < t.length; i += 1) {
      if (t[i] === "(") depth += 1;
      else if (t[i] === ")") depth -= 1;
      if (depth === 0 && i < t.length - 1) return false;
    }
    return depth === 0;
  };
  while (wraps(result)) result = result.slice(1, -1).trim();
  return result;
}

export function updateColumn(erd: ERD, tableId: string, columnName: string, patch: ColumnPatch): EditResult {
  const table = findTable(erd, tableId);
  const column = table?.columns.find((c) => c.name === columnName);
  if (!table || !column) return { ok: false, error: "Column not found." };

  let next = erd;
  let currentName = columnName;

  if (patch.name !== undefined && patch.name.trim() !== columnName) {
    const name = patch.name.trim();
    const invalid = validateIdentifier(name, "column");
    if (invalid) return { ok: false, error: invalid };
    if (table.columns.some((c) => c.name === name)) {
      return { ok: false, error: `"${table.name}" already has a column named "${name}".` };
    }
    const rename = (cols: string[]) => cols.map((c) => (c === columnName ? name : c));
    next = mapTable(next, tableId, (t) => ({
      ...t,
      columns: t.columns.map((c) => (c.name === columnName ? { ...c, name } : c)),
      constraints: t.constraints.map((c) => ({
        ...c,
        columns: rename(c.columns),
        // Keep CHECK expressions pointing at the renamed column.
        expression: c.expression ? c.expression.replace(new RegExp(`\\b${columnName}\\b`, "g"), name) : c.expression,
      })),
      indexes: t.indexes.map((i) => ({ ...i, columns: rename(i.columns) })),
    }));
    next = {
      ...next,
      relationships: next.relationships.map((r) => ({
        ...r,
        fromColumn: r.fromTable === table.name && r.fromColumn === columnName ? name : r.fromColumn,
        toColumn: r.toTable === table.name && r.toColumn === columnName ? name : r.toColumn,
      })),
    };
    currentName = name;
  }

  if (patch.dataType?.trim()) {
    const typeInvalid = validateDataType(patch.dataType);
    if (typeInvalid) return { ok: false, error: typeInvalid };
  }
  if (patch.defaultValue !== undefined && patch.defaultValue !== null && patch.defaultValue.includes(";")) {
    return { ok: false, error: "Default values can't contain semicolons." };
  }
  const generated = patch.generated === undefined ? undefined : stripOuterParens(patch.generated?.trim() ?? "") || null;
  if (generated) {
    if (generated.includes(";")) return { ok: false, error: "Generated expressions can't contain semicolons." };
    if (patch.isPrimaryKey ?? column.isPrimaryKey) return { ok: false, error: "A primary key can't be a generated column." };
    if (column.isForeignKey) return { ok: false, error: "A foreign key can't be a generated column." };
  }

  next = mapTable(next, tableId, (t) => ({
    ...t,
    columns: t.columns.map((c) => {
      if (c.name !== currentName) return c;
      const isPrimaryKey = patch.isPrimaryKey ?? c.isPrimaryKey;
      return {
        ...c,
        dataType: patch.dataType?.trim() || c.dataType,
        // Primary key columns are always NOT NULL.
        nullable: isPrimaryKey ? false : patch.nullable ?? c.nullable,
        // Postgres doesn't allow a default on a generated column.
        defaultValue: (generated !== undefined ? generated : c.generated)
          ? null
          : patch.defaultValue !== undefined ? (patch.defaultValue?.trim() || null) : c.defaultValue,
        isPrimaryKey,
        comment: patch.comment !== undefined ? (patch.comment?.trim() || null) : c.comment,
        generated: generated !== undefined ? generated : c.generated,
      };
    }),
  }));

  // Changing an FK column's type would break the reference: keep the FK type
  // in line with what it references.
  if (patch.dataType !== undefined && column.isForeignKey) {
    const target = next.tables.find((t) => t.name === column.referencesTable);
    const referenced = target?.columns.find((c) => c.name === column.referencesColumn);
    if (referenced && referencingType(referenced.dataType).toUpperCase() !== patch.dataType.trim().toUpperCase()) {
      return {
        ok: false,
        error: `This column references ${column.referencesTable}.${column.referencesColumn} (${referenced.dataType}), so its type must be ${referencingType(referenced.dataType)}.`,
      };
    }
  }

  if (patch.unique !== undefined) {
    next = mapTable(next, tableId, (t) => {
      const withoutSingle = {
        constraints: t.constraints.filter((c) => !(c.type === "UNIQUE" && sameColumns(c.columns, [currentName]))),
        indexes: t.indexes.filter((i) => !(i.unique && sameColumns(i.columns, [currentName]))),
      };
      return patch.unique
        ? {
            ...t,
            ...withoutSingle,
            constraints: [...withoutSingle.constraints, { type: "UNIQUE", columns: [currentName], expression: null, onDelete: null }],
          }
        : { ...t, ...withoutSingle };
    });
    // A unique FK means at most one child per parent: 1:1.
    next = {
      ...next,
      relationships: next.relationships.map((r) =>
        r.fromTable === table.name && r.fromColumn === currentName && r.cardinality !== "M:N"
          ? { ...r, cardinality: patch.unique ? "1:1" : "1:N" }
          : r
      ),
    };
  }

  return { ok: true, erd: normalizeErd(next) };
}

export function deleteColumn(erd: ERD, tableId: string, columnName: string): EditResult {
  const table = findTable(erd, tableId);
  if (!table) return { ok: false, error: "Table not found." };
  const referencedBy = erd.relationships.filter((r) => r.toTable === table.name && r.toColumn === columnName);
  if (referencedBy.length > 0) {
    const names = referencedBy.map((r) => `${r.fromTable}.${r.fromColumn}`).join(", ");
    return { ok: false, error: `Can't delete "${columnName}": it's referenced by ${names}. Remove those relationships first.` };
  }
  return {
    ok: true,
    erd: normalizeErd({
      ...erd,
      tables: erd.tables.map((t) =>
        t.id === tableId ? { ...t, columns: t.columns.filter((c) => c.name !== columnName) } : t
      ),
      relationships: erd.relationships.filter((r) => !(r.fromTable === table.name && r.fromColumn === columnName)),
    }),
  };
}

export function moveColumn(erd: ERD, tableId: string, columnName: string, direction: -1 | 1): EditResult {
  return {
    ok: true,
    erd: mapTable(erd, tableId, (t) => {
      const index = t.columns.findIndex((c) => c.name === columnName);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= t.columns.length) return t;
      const columns = [...t.columns];
      [columns[index], columns[target]] = [columns[target], columns[index]];
      return { ...t, columns };
    }),
  };
}

// ---------------------------------------------------------------------------
// Constraints & indexes
// ---------------------------------------------------------------------------

export function addCheckConstraint(erd: ERD, tableId: string, rawExpression: string): EditResult {
  const expression = rawExpression.trim();
  if (!expression) return { ok: false, error: "Enter a CHECK expression, e.g. quantity >= 0." };
  if (expression.includes(";")) return { ok: false, error: "CHECK expressions can't contain semicolons." };
  const table = findTable(erd, tableId);
  if (!table) return { ok: false, error: "Table not found." };
  const columns = table.columns.filter((c) => new RegExp(`\\b${c.name}\\b`).test(expression)).map((c) => c.name);
  if (columns.length === 0) return { ok: false, error: "The expression should use at least one column of this table." };
  return {
    ok: true,
    erd: normalizeErd(
      mapTable(erd, tableId, (t) => ({
        ...t,
        constraints: [...t.constraints, { type: "CHECK", columns, expression, onDelete: null }],
      }))
    ),
  };
}

/** Remove a UNIQUE or CHECK constraint by its position in the table's constraint list. */
export function removeConstraint(erd: ERD, tableId: string, constraintIndex: number): EditResult {
  return {
    ok: true,
    erd: normalizeErd(
      mapTable(erd, tableId, (t) => ({
        ...t,
        constraints: t.constraints.filter(
          (c, i) => i !== constraintIndex || c.type === "PRIMARY_KEY" || c.type === "FOREIGN_KEY"
        ),
      }))
    ),
  };
}

export function addIndex(erd: ERD, tableId: string, columns: string[], unique: boolean): EditResult {
  const table = findTable(erd, tableId);
  if (!table) return { ok: false, error: "Table not found." };
  if (columns.length === 0) return { ok: false, error: "Pick at least one column to index." };
  if (table.indexes.some((i) => sameColumns(i.columns, columns))) {
    return { ok: false, error: "An index on those columns already exists." };
  }
  const base = `idx_${table.name}_${columns.join("_")}`.slice(0, 60);
  const names = new Set(erd.tables.flatMap((t) => t.indexes.map((i) => i.name)));
  let name = base;
  let n = 2;
  while (names.has(name)) name = `${base}_${n++}`;
  return {
    ok: true,
    erd: normalizeErd(mapTable(erd, tableId, (t) => ({ ...t, indexes: [...t.indexes, { name, columns, unique }] }))),
  };
}

export function removeIndex(erd: ERD, tableId: string, indexName: string): EditResult {
  return {
    ok: true,
    erd: normalizeErd(mapTable(erd, tableId, (t) => ({ ...t, indexes: t.indexes.filter((i) => i.name !== indexName) }))),
  };
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

/**
 * Create a foreign key from `fromTableId` to `toTableId`.
 *
 * - The referenced column is `toColumn` if it is a primary key or unique,
 *   otherwise the target table's single primary key.
 * - The FK column is `fromColumn` if given and usable; otherwise a new
 *   `<target>_<column>` column is added with a matching type.
 */
export function addRelationship(
  erd: ERD,
  args: { fromTableId: string; toTableId: string; fromColumn?: string | null; toColumn?: string | null }
): EditResult<{ relationshipId: string }> {
  const from = findTable(erd, args.fromTableId);
  const to = findTable(erd, args.toTableId);
  if (!from || !to) return { ok: false, error: "Table not found." };

  const toCandidate = args.toColumn ? to.columns.find((c) => c.name === args.toColumn) : undefined;
  let referenced =
    toCandidate && (toCandidate.isPrimaryKey || isColumnUnique(to, toCandidate.name)) ? toCandidate : undefined;
  if (!referenced) {
    const pks = to.columns.filter((c) => c.isPrimaryKey);
    if (pks.length !== 1) {
      return {
        ok: false,
        error: pks.length === 0
          ? `"${to.name}" has no primary key to reference. Mark a column as PK first.`
          : `"${to.name}" has a composite primary key. Drop onto a unique column instead.`,
      };
    }
    referenced = pks[0];
  }

  const fkType = referencingType(referenced.dataType);
  let next = erd;
  let fromColumnName: string;

  const fromCandidate = args.fromColumn ? from.columns.find((c) => c.name === args.fromColumn) : undefined;
  const candidateUsable =
    fromCandidate &&
    !fromCandidate.isForeignKey &&
    !(fromCandidate.isPrimaryKey && from.columns.filter((c) => c.isPrimaryKey).length === 1 && /SERIAL/i.test(fromCandidate.dataType));

  if (candidateUsable && fromCandidate) {
    fromColumnName = fromCandidate.name;
    next = mapTable(next, from.id, (t) => ({
      ...t,
      columns: t.columns.map((c) => (c.name === fromColumnName ? { ...c, dataType: fkType } : c)),
    }));
  } else {
    fromColumnName = uniqueColumnName(from, `${singular(to.name)}_${referenced.name}`);
    const column: Column = {
      name: fromColumnName,
      dataType: fkType,
      nullable: false,
      defaultValue: null,
      isPrimaryKey: false,
      isForeignKey: false,
      referencesTable: null,
      referencesColumn: null,
    };
    // Insert after the primary key columns so FKs sit near the top.
    next = mapTable(next, from.id, (t) => {
      const lastPk = t.columns.reduce((acc, c, i) => (c.isPrimaryKey ? i : acc), -1);
      const columns = [...t.columns];
      columns.splice(lastPk + 1, 0, column);
      return { ...t, columns };
    });
  }

  const fromColumn = next.tables.find((t) => t.id === from.id)?.columns.find((c) => c.name === fromColumnName);
  const relationshipId = randomId("rel");
  const relationship: Relationship = {
    id: relationshipId,
    fromTable: from.name,
    toTable: to.name,
    fromColumn: fromColumnName,
    toColumn: referenced.name,
    cardinality: isColumnUnique(from, fromColumnName) ? "1:1" : "1:N",
    required: fromColumn ? !fromColumn.nullable : true,
    onDelete: "RESTRICT",
  };

  // Foreign keys are joined and checked on every parent delete: index them
  // unless the column already leads an index, a UNIQUE or the primary key.
  const owner = next.tables.find((t) => t.id === from.id);
  if (owner) {
    const pk = owner.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
    const covered =
      pk[0] === fromColumnName ||
      owner.indexes.some((i) => i.columns[0] === fromColumnName) ||
      owner.constraints.some((c) => c.type === "UNIQUE" && c.columns[0] === fromColumnName);
    if (!covered) {
      let name = `idx_${owner.name}_${fromColumnName}`.slice(0, 63);
      const taken = new Set(next.tables.flatMap((t) => t.indexes.map((i) => i.name)));
      for (let n = 2; taken.has(name); n += 1) name = `idx_${owner.name}_${fromColumnName}_${n}`.slice(0, 63);
      next = mapTable(next, owner.id, (t) => ({ ...t, indexes: [...t.indexes, { name, columns: [fromColumnName], unique: false }] }));
    }
  }

  return {
    ok: true,
    erd: normalizeErd({ ...next, relationships: [...next.relationships, relationship] }),
    relationshipId,
  };
}

export interface RelationshipPatch {
  cardinality?: Cardinality;
  required?: boolean;
  onDelete?: OnDeleteAction;
}

export function updateRelationship(erd: ERD, relationshipId: string, patch: RelationshipPatch): EditResult {
  const rel = erd.relationships.find((r) => r.id === relationshipId);
  if (!rel) return { ok: false, error: "Relationship not found." };
  const fromTable = erd.tables.find((t) => t.name === rel.fromTable);
  if (!fromTable) return { ok: false, error: "Table not found." };

  if (patch.onDelete === "SET_NULL" && (patch.required ?? rel.required)) {
    return { ok: false, error: "ON DELETE SET NULL needs an optional (nullable) foreign key. Make it optional first." };
  }

  let next: ERD = {
    ...erd,
    relationships: erd.relationships.map((r) =>
      r.id === relationshipId
        ? { ...r, cardinality: patch.cardinality ?? r.cardinality, onDelete: patch.onDelete ?? r.onDelete }
        : r
    ),
  };

  if (patch.required !== undefined) {
    next = mapTable(next, fromTable.id, (t) => ({
      ...t,
      columns: t.columns.map((c) => (c.name === rel.fromColumn ? { ...c, nullable: !patch.required } : c)),
    }));
  }

  if (patch.cardinality === "1:1" || patch.cardinality === "1:N") {
    const result = updateColumn(next, fromTable.id, rel.fromColumn, { unique: patch.cardinality === "1:1" });
    if (!result.ok) return result;
    next = result.erd;
  }

  return { ok: true, erd: normalizeErd(next) };
}

/** Remove the relationship. The column stays, as a plain (non-FK) column. */
export function deleteRelationship(erd: ERD, relationshipId: string): EditResult {
  return {
    ok: true,
    erd: normalizeErd({ ...erd, relationships: erd.relationships.filter((r) => r.id !== relationshipId) }),
  };
}

export function setTableColor(erd: ERD, tableIds: string[], color: TableColor | null): EditResult {
  const ids = new Set(tableIds);
  return {
    ok: true,
    erd: {
      ...erd,
      tables: erd.tables.map((t) => {
        if (!ids.has(t.id)) return t;
        const next = { ...t };
        if (color) next.color = color;
        else delete next.color;
        return next;
      }),
    },
  };
}

export interface TableClipboard {
  tables: Table[];
  relationships: Relationship[];
}

/** Tables plus the relationships among them, or out to tables that will still exist. */
export function copyTables(erd: ERD, tableIds: string[]): TableClipboard {
  const tables = erd.tables.filter((t) => tableIds.includes(t.id));
  const names = new Set(tables.map((t) => t.name));
  return {
    tables: JSON.parse(JSON.stringify(tables)),
    relationships: erd.relationships.filter((r) => names.has(r.fromTable)),
  };
}

/**
 * Paste copied tables as new tables with unique names ("orders_copy").
 * Relationships between pasted tables are re-pointed at the copies;
 * relationships to other tables are kept if those tables exist.
 */
export function pasteTables(erd: ERD, clip: TableClipboard): EditResult<{ idMap: Record<string, string> }> {
  const existing = new Set(erd.tables.map((t) => t.name));
  const nameMap = new Map<string, string>();
  const idMap: Record<string, string> = {};
  const newTables: Table[] = clip.tables.map((table) => {
    let name = `${table.name}_copy`.slice(0, 63);
    let n = 2;
    while (existing.has(name) || [...nameMap.values()].includes(name)) name = `${table.name}_copy${n++}`.slice(0, 63);
    nameMap.set(table.name, name);
    const id = randomId("tbl");
    idMap[table.id] = id;
    return { ...table, id, name, objectTypeId: id, indexes: table.indexes.map((i) => ({ ...i, name: `${i.name}_${name}`.slice(0, 60) })) };
  });
  const allNames = new Set([...existing, ...nameMap.values()]);
  const newRelationships: Relationship[] = clip.relationships
    .filter((r) => nameMap.has(r.fromTable))
    .map((r) => ({
      ...r,
      id: randomId("rel"),
      fromTable: nameMap.get(r.fromTable) as string,
      toTable: nameMap.get(r.toTable) ?? r.toTable,
    }))
    .filter((r) => allNames.has(r.toTable));
  return {
    ok: true,
    erd: normalizeErd({ ...erd, tables: [...erd.tables, ...newTables], relationships: [...erd.relationships, ...newRelationships] }),
    idMap,
  };
}

// ---------------------------------------------------------------------------
// Comments, enum types and views
// ---------------------------------------------------------------------------

export function setTableComment(erd: ERD, tableId: string, comment: string | null): EditResult {
  if (!findTable(erd, tableId)) return { ok: false, error: "Table not found." };
  return { ok: true, erd: mapTable(erd, tableId, (t) => ({ ...t, comment: comment?.trim() || null })) };
}

// Type names an enum can't take because Postgres already uses them.
const BUILTIN_TYPES = new Set([
  "bigint", "bigserial", "bit", "bool", "boolean", "box", "bytea", "char", "character", "cidr", "circle", "date",
  "decimal", "double", "float", "float4", "float8", "inet", "int", "int2", "int4", "int8", "integer", "interval",
  "json", "jsonb", "line", "lseg", "macaddr", "money", "numeric", "path", "point", "polygon", "real", "serial",
  "serial4", "serial8", "smallint", "smallserial", "text", "time", "timestamp", "timestamptz", "timetz", "tsquery",
  "tsvector", "uuid", "varchar", "xml",
]);

export function enumOf(erd: ERD, dataType: string): EnumType | undefined {
  const name = dataType.trim().toLowerCase();
  return erd.enums?.find((e) => e.name === name);
}

/**
 * Create or update an enum type. Renaming it (`previousName`) updates every
 * column that uses it.
 */
export function upsertEnum(erd: ERD, rawName: string, rawValues: string[], previousName?: string): EditResult {
  const name = rawName.trim();
  const invalid = validateIdentifier(name, "column");
  if (invalid) return { ok: false, error: invalid.replace("Column name", "Type name") };
  if (BUILTIN_TYPES.has(name)) return { ok: false, error: `"${name}" is a built-in type. Try "${name}_kind".` };
  if (erd.tables.some((t) => t.name === name) || erd.views?.some((v) => v.name === name)) {
    return { ok: false, error: `"${name}" is already used by a table or view.` };
  }
  const enums = erd.enums ?? [];
  if (name !== previousName && enums.some((e) => e.name === name)) return { ok: false, error: `An enum named "${name}" already exists.` };

  const values = rawValues.map((v) => v.trim()).filter(Boolean);
  if (values.length === 0) return { ok: false, error: "An enum needs at least one value." };
  if (new Set(values).size !== values.length) return { ok: false, error: "Enum values must be unique." };
  const tooLong = values.find((v) => v.length > 63);
  if (tooLong) return { ok: false, error: `"${tooLong.slice(0, 20)}…" is longer than 63 characters.` };

  const next = previousName && enums.some((e) => e.name === previousName)
    ? enums.map((e) => (e.name === previousName ? { name, values } : e))
    : [...enums, { name, values }];
  const tables =
    previousName && previousName !== name
      ? erd.tables.map((t) => ({
          ...t,
          columns: t.columns.map((c) => (c.dataType.toLowerCase() === previousName ? { ...c, dataType: name } : c)),
        }))
      : erd.tables;
  return { ok: true, erd: { ...erd, tables, enums: next } };
}

/** Remove an enum type; columns that used it become TEXT. */
export function deleteEnum(erd: ERD, name: string): EditResult {
  if (!erd.enums?.some((e) => e.name === name)) return { ok: false, error: `Enum "${name}" not found.` };
  return {
    ok: true,
    erd: {
      ...erd,
      enums: erd.enums.filter((e) => e.name !== name),
      tables: erd.tables.map((t) => ({
        ...t,
        columns: t.columns.map((c) => (c.dataType.toLowerCase() === name ? { ...c, dataType: "TEXT" } : c)),
      })),
    },
  };
}

/** Normalise a view body: no trailing semicolon, no blank lines. */
export function cleanViewSql(sql: string): string {
  return sql
    .trim()
    .replace(/;+\s*$/, "")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim() !== "")
    .join("\n");
}

export function upsertView(erd: ERD, view: { id?: string; name: string; sql: string }): EditResult<{ viewId: string }> {
  const name = view.name.trim();
  const invalid = validateIdentifier(name, "table");
  if (invalid) return { ok: false, error: invalid.replace("Table name", "View name") };
  const views = erd.views ?? [];
  if (erd.tables.some((t) => t.name === name) || views.some((v) => v.name === name && v.id !== view.id)) {
    return { ok: false, error: `"${name}" is already used by a table or view.` };
  }
  const sql = cleanViewSql(view.sql);
  if (!/^(select|with)\b/i.test(sql)) return { ok: false, error: "A view must be a SELECT (or WITH … SELECT) query." };
  if (sql.includes(";")) return { ok: false, error: "A view is a single query: remove the semicolons." };
  const viewId = view.id && views.some((v) => v.id === view.id) ? view.id : randomId("view");
  const nextViews = views.some((v) => v.id === viewId)
    ? views.map((v) => (v.id === viewId ? { id: viewId, name, sql } : v))
    : [...views, { id: viewId, name, sql }];
  return { ok: true, erd: { ...erd, views: nextViews }, viewId };
}

export function deleteView(erd: ERD, viewId: string): EditResult {
  if (!erd.views?.some((v) => v.id === viewId)) return { ok: false, error: "View not found." };
  return { ok: true, erd: { ...erd, views: erd.views.filter((v) => v.id !== viewId) } };
}

export const EMPTY_ERD: ERD = { tables: [], relationships: [] };
