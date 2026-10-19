/**
 * Migrations between two versions of a schema: compares the ERDs and writes
 * the PostgreSQL ALTER statements that turn the old database into the new
 * one, plus warnings for steps that can lose data or fail on existing rows.
 *
 * Tables are matched by id (so renames are detected), columns by name.
 * Constraint names follow what Episteme's own DDL creates (erdToSql).
 */
import type { Column, ERD, Relationship, Table } from "@/types/erd";

export interface Migration {
  sql: string;
  warnings: string[];
  /** Number of schema changes found (0 = nothing to migrate). */
  changes: number;
}

const sqlString = (text: string) => `'${text.replace(/\s+/g, " ").trim().replace(/'/g, "''")}'`;
const onDelete = (rel: Relationship) => rel.onDelete.replace("_", " ");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fkName = (table: string, column: string) => `fk_${table}_${column}`;
const pgName = (name: string) => name.slice(0, 63);

function columnDef(column: Column): string {
  let def = `${column.name} ${column.dataType}`;
  if (column.generated) def += ` GENERATED ALWAYS AS (${column.generated}) STORED`;
  if (!column.nullable) def += " NOT NULL";
  if (column.defaultValue && !column.generated) def += ` DEFAULT ${column.defaultValue}`;
  return def;
}

function createTableSql(table: Table): string {
  const lines = table.columns.map((c) => `  ${columnDef(c)}`);
  const pk = table.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
  if (pk.length) lines.push(`  PRIMARY KEY (${pk.join(", ")})`);
  for (const c of table.constraints) {
    if (c.type === "UNIQUE") lines.push(`  UNIQUE (${c.columns.join(", ")})`);
    if (c.type === "CHECK" && c.expression) lines.push(`  CHECK (${c.expression})`);
  }
  return `CREATE TABLE ${table.name} (\n${lines.join(",\n")}\n);`;
}

const uniqueKey = (columns: string[]) => columns.join(",");
const uniquesOf = (t: Table) => t.constraints.filter((c) => c.type === "UNIQUE").map((c) => c.columns);
const checksOf = (t: Table) => t.constraints.filter((c) => c.type === "CHECK" && c.expression).map((c) => c.expression as string);
const pkOf = (t: Table) => t.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);

export function migrationSql(from: ERD, to: ERD): Migration {
  const pre: string[] = []; // enum value additions (can't share a transaction with their use)
  const out: string[] = [];
  const warnings: string[] = [];
  let changes = 0;
  const step = (sql: string) => {
    out.push(sql);
    changes += 1;
  };

  // --- Match tables: by id, then by name. -----------------------------------
  const toById = new Map(to.tables.map((t) => [t.id, t]));
  const toByName = new Map(to.tables.map((t) => [t.name, t]));
  const pairs: Array<{ before: Table; after: Table }> = [];
  const dropped: Table[] = [];
  const matchedAfter = new Set<string>();
  for (const before of from.tables) {
    const after = toById.get(before.id) ?? (toByName.get(before.name) && !from.tables.some((t) => t.id === toByName.get(before.name)?.id) ? toByName.get(before.name) : undefined);
    if (after && !matchedAfter.has(after.id)) {
      pairs.push({ before, after });
      matchedAfter.add(after.id);
    } else dropped.push(before);
  }
  const created = to.tables.filter((t) => !matchedAfter.has(t.id));
  // Old table name -> new table name, for relationship comparison.
  const renamedTo = new Map(pairs.map((p) => [p.before.name, p.after.name]));

  // Column renames, detected per table: a removed column whose position is
  // now held by a new column of the same type.
  const columnRenames = new Map<string, Map<string, string>>(); // after.id -> old -> new
  for (const { before, after } of pairs) {
    const renames = new Map<string, string>();
    before.columns.forEach((old, index) => {
      if (after.columns.some((a) => a.name === old.name)) return;
      const candidate = after.columns[index];
      if (!candidate || before.columns.some((b) => b.name === candidate.name)) return;
      if (candidate.dataType.toUpperCase() !== old.dataType.toUpperCase()) return;
      if ([...renames.values()].includes(candidate.name)) return;
      renames.set(old.name, candidate.name);
    });
    if (renames.size) columnRenames.set(after.id, renames);
  }
  const newColumnName = (tableId: string, name: string) => columnRenames.get(tableId)?.get(name) ?? name;
  const relKeyAfterRenames = (r: Relationship) => {
    const pair = pairs.find((p) => p.before.name === r.fromTable);
    return pair ? `${pair.after.name}.${newColumnName(pair.after.id, r.fromColumn)}` : `-${r.fromTable}.${r.fromColumn}`;
  };

  // --- Views depending on old tables: drop changed/removed ones first. -------
  const toViews = new Map((to.views ?? []).map((v) => [v.name, v]));
  const fromViews = new Map((from.views ?? []).map((v) => [v.name, v]));
  const viewsToCreate = (to.views ?? []).filter((v) => fromViews.get(v.name)?.sql !== v.sql);
  for (const view of from.views ?? []) {
    if (toViews.get(view.name)?.sql !== view.sql) step(`DROP VIEW IF EXISTS ${view.name};`);
  }

  // --- Foreign keys that go away or change. -----------------------------------
  const toRels = new Map(to.relationships.map((r) => [`${r.fromTable}.${r.fromColumn}`, r]));
  const fromRels = new Map(from.relationships.map((r) => [relKeyAfterRenames(r), r]));
  const relChanged = (before: Relationship, after: Relationship | undefined) =>
    !after ||
    after.toTable !== (renamedTo.get(before.toTable) ?? before.toTable) ||
    after.toColumn !== before.toColumn ||
    after.onDelete !== before.onDelete;
  for (const [key, before] of fromRels) {
    if (!relChanged(before, toRels.get(key))) continue;
    const table = renamedTo.get(before.fromTable);
    if (table) step(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${pgName(fkName(before.fromTable, before.fromColumn))};`);
  }

  // --- Enum types. -----------------------------------------------------------
  const fromEnums = new Map((from.enums ?? []).map((e) => [e.name, e]));
  const toEnums = new Map((to.enums ?? []).map((e) => [e.name, e]));
  for (const type of to.enums ?? []) {
    const before = fromEnums.get(type.name);
    if (!before) {
      step(`CREATE TYPE ${type.name} AS ENUM (${type.values.map(sqlString).join(", ")});`);
      continue;
    }
    for (const value of type.values.filter((v) => !before.values.includes(v))) {
      pre.push(`ALTER TYPE ${type.name} ADD VALUE IF NOT EXISTS ${sqlString(value)};`);
      changes += 1;
    }
    const removedValues = before.values.filter((v) => !type.values.includes(v));
    if (removedValues.length) {
      warnings.push(
        `Postgres can't remove values from an enum: ${type.name} still allows ${removedValues.join(", ")}. Recreate the type if that matters.`
      );
    }
  }

  // --- Renamed tables. -------------------------------------------------------
  for (const { before, after } of pairs) {
    if (before.name !== after.name) step(`ALTER TABLE ${before.name} RENAME TO ${after.name};`);
  }

  // --- New tables (foreign keys come later). ---------------------------------
  for (const table of created) step(createTableSql(table));

  // --- Changed tables. -------------------------------------------------------
  for (const { before, after } of pairs) {
    const t = after.name;
    const renames = columnRenames.get(after.id);
    for (const [oldName, newName] of renames ?? []) {
      step(`ALTER TABLE ${t} RENAME COLUMN ${oldName} TO ${newName};`);
      warnings.push(`${t}.${newName} is treated as a rename of ${oldName}. If it's a new column, edit the SQL.`);
    }
    const beforeCols = new Map(before.columns.map((c) => [newColumnName(after.id, c.name), c]));

    // Primary key changes need the old key dropped before columns change.
    const pkChanged = !same(pkOf(before).map((n) => newColumnName(after.id, n)), pkOf(after));
    if (pkChanged && pkOf(before).length) {
      step(`ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS ${pgName(`${before.name}_pkey`)};`);
    }

    // Unique and check constraints that go away.
    const afterUniques = new Set(uniquesOf(after).map(uniqueKey));
    for (const cols of uniquesOf(before)) {
      const renamed = cols.map((c) => newColumnName(after.id, c));
      if (afterUniques.has(uniqueKey(renamed))) continue;
      step(`ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS ${pgName(`${before.name}_${cols.join("_")}_key`)};`);
    }
    const afterChecks = new Set(checksOf(after));
    for (const expression of checksOf(before)) {
      if (afterChecks.has(expression)) continue;
      const constraint = before.constraints.find((c) => c.type === "CHECK" && c.expression === expression);
      const guess = constraint?.columns.length === 1 ? `${before.name}_${constraint.columns[0]}_check` : `${before.name}_check`;
      step(`ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS ${pgName(guess)}; -- was CHECK (${expression})`);
      warnings.push(`Check the constraint name for the removed CHECK on ${t} (${expression}): Postgres named it when the table was created.`);
    }

    // Removed indexes.
    const afterIndexes = new Map(after.indexes.map((i) => [i.name, i]));
    for (const index of before.indexes) {
      const next = afterIndexes.get(index.name);
      const renamedCols = index.columns.map((c) => newColumnName(after.id, c));
      if (!next || !same(renamedCols, next.columns) || next.unique !== index.unique) step(`DROP INDEX IF EXISTS ${index.name};`);
    }

    // Dropped columns.
    for (const column of before.columns) {
      if (after.columns.some((c) => c.name === newColumnName(after.id, column.name))) continue;
      step(`ALTER TABLE ${t} DROP COLUMN ${column.name};`);
      warnings.push(`Dropping ${t}.${column.name} deletes its data.`);
    }

    // Added and altered columns.
    for (const column of after.columns) {
      const old = beforeCols.get(column.name);
      if (!old) {
        step(`ALTER TABLE ${t} ADD COLUMN ${columnDef(column)};`);
        if (!column.nullable && !column.defaultValue && !column.generated && !/SERIAL/i.test(column.dataType)) {
          warnings.push(`${t}.${column.name} is NOT NULL without a default: adding it fails if ${t} already has rows. Add a default or backfill first.`);
        }
        continue;
      }
      if ((old.generated ?? null) !== (column.generated ?? null)) {
        step(`ALTER TABLE ${t} DROP COLUMN ${column.name};`);
        step(`ALTER TABLE ${t} ADD COLUMN ${columnDef(column)};`);
        warnings.push(`${t}.${column.name} changes how it's generated, so it's dropped and re-added (its stored values are recomputed or lost).`);
        continue;
      }
      if (old.dataType.toUpperCase() !== column.dataType.toUpperCase()) {
        const target = /SERIAL/i.test(column.dataType) ? column.dataType.toUpperCase().replace("BIGSERIAL", "BIGINT").replace("SMALLSERIAL", "SMALLINT").replace("SERIAL", "INTEGER") : column.dataType;
        if (old.defaultValue && !column.generated) step(`ALTER TABLE ${t} ALTER COLUMN ${column.name} DROP DEFAULT;`);
        step(`ALTER TABLE ${t} ALTER COLUMN ${column.name} TYPE ${target} USING ${column.name}::${target};`);
        warnings.push(`Changing ${t}.${column.name} from ${old.dataType} to ${column.dataType} fails if existing values can't be converted.`);
        if (column.defaultValue && !column.generated) step(`ALTER TABLE ${t} ALTER COLUMN ${column.name} SET DEFAULT ${column.defaultValue};`);
      } else if ((old.defaultValue ?? null) !== (column.defaultValue ?? null) && !column.generated) {
        step(
          column.defaultValue
            ? `ALTER TABLE ${t} ALTER COLUMN ${column.name} SET DEFAULT ${column.defaultValue};`
            : `ALTER TABLE ${t} ALTER COLUMN ${column.name} DROP DEFAULT;`
        );
      }
      if (old.nullable !== column.nullable && !column.isPrimaryKey) {
        step(`ALTER TABLE ${t} ALTER COLUMN ${column.name} ${column.nullable ? "DROP" : "SET"} NOT NULL;`);
        if (!column.nullable) warnings.push(`Making ${t}.${column.name} NOT NULL fails if any row has it empty. Backfill it first.`);
      }
    }

    if (pkChanged && pkOf(after).length) step(`ALTER TABLE ${t} ADD PRIMARY KEY (${pkOf(after).join(", ")});`);

    // New unique and check constraints.
    const beforeUniques = new Set(uniquesOf(before).map((cols) => uniqueKey(cols.map((c) => newColumnName(after.id, c)))));
    for (const cols of uniquesOf(after)) {
      if (!beforeUniques.has(uniqueKey(cols))) step(`ALTER TABLE ${t} ADD UNIQUE (${cols.join(", ")});`);
    }
    const beforeChecks = new Set(checksOf(before));
    for (const expression of checksOf(after)) {
      if (!beforeChecks.has(expression)) step(`ALTER TABLE ${t} ADD CHECK (${expression});`);
    }

    // New or changed indexes.
    const beforeIndexes = new Map(before.indexes.map((i) => [i.name, i]));
    for (const index of after.indexes) {
      const old = beforeIndexes.get(index.name);
      if (old && same(old.columns.map((c) => newColumnName(after.id, c)), index.columns) && old.unique === index.unique) continue;
      step(`CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${index.name} ON ${t} (${index.columns.join(", ")});`);
    }
  }

  // --- Dropped tables and enum types. ---------------------------------------
  for (const table of dropped) {
    step(`DROP TABLE ${table.name};`);
    warnings.push(`Dropping ${table.name} deletes all of its rows.`);
  }
  for (const type of from.enums ?? []) {
    if (!toEnums.has(type.name)) step(`DROP TYPE ${type.name};`);
  }

  // --- Indexes on new tables, then foreign keys. -----------------------------
  for (const table of created) {
    for (const index of table.indexes) step(`CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${index.name} ON ${table.name} (${index.columns.join(", ")});`);
  }
  for (const rel of to.relationships) {
    const key = `${rel.fromTable}.${rel.fromColumn}`;
    const before = fromRels.get(key);
    if (before && !relChanged(before, rel)) continue;
    step(
      `ALTER TABLE ${rel.fromTable} ADD CONSTRAINT ${pgName(fkName(rel.fromTable, rel.fromColumn))} ` +
        `FOREIGN KEY (${rel.fromColumn}) REFERENCES ${rel.toTable}(${rel.toColumn}) ON DELETE ${onDelete(rel)};`
    );
  }

  // --- Comments. -------------------------------------------------------------
  const beforeById = new Map(pairs.map((p) => [p.after.id, p.before]));
  for (const table of to.tables) {
    const before = beforeById.get(table.id);
    if ((before?.comment ?? null) !== (table.comment ?? null) && (before || table.comment)) {
      step(`COMMENT ON TABLE ${table.name} IS ${table.comment ? sqlString(table.comment) : "NULL"};`);
    }
    for (const column of table.columns) {
      const old = before?.columns.find((c) => newColumnName(table.id, c.name) === column.name);
      if ((old?.comment ?? null) !== (column.comment ?? null) && (old || column.comment)) {
        step(`COMMENT ON COLUMN ${table.name}.${column.name} IS ${column.comment ? sqlString(column.comment) : "NULL"};`);
      }
    }
  }

  // --- Views last. -----------------------------------------------------------
  for (const view of viewsToCreate) step(`CREATE VIEW ${view.name} AS\n${view.sql};`);

  if (changes === 0) return { sql: "-- No changes: the two versions have the same schema.\n", warnings: [], changes: 0 };
  const body = [...(pre.length ? [...pre, ""] : []), "BEGIN;", "", ...out, "", "COMMIT;"].join("\n");
  return { sql: `-- Migration generated by Episteme\n${body}\n`, warnings: [...new Set(warnings)], changes };
}

/** The parts of a database's shape a migration must reproduce. */
function shapeOf(erd: ERD) {
  return {
    tables: erd.tables
      .map((t) => ({
        name: t.name,
        columns: t.columns.map((c) => [c.name, c.dataType.toUpperCase(), c.nullable, c.defaultValue, c.generated ?? null, c.comment ?? null]),
        pk: pkOf(t),
        unique: uniquesOf(t).map(uniqueKey).sort(),
        checks: checksOf(t).length,
        indexes: t.indexes.map((i) => `${i.name}:${i.columns.join(",")}:${i.unique}`).sort(),
        comment: t.comment ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    relationships: erd.relationships.map((r) => `${r.fromTable}.${r.fromColumn}->${r.toTable}.${r.toColumn}:${r.onDelete}`).sort(),
    enums: (erd.enums ?? []).map((e) => `${e.name}:${e.values.join(",")}`).sort(),
    views: (erd.views ?? []).map((v) => v.name).sort(),
  };
}

/**
 * Check a migration in real Postgres (PGlite): build the old schema, apply
 * the migration, and compare the result with the new schema built directly.
 */
export async function verifyMigration(from: ERD, to: ERD, migration: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const [{ importSql }, { erdToSql }] = await Promise.all([import("@/lib/import/fromSql"), import("@/lib/ontology/transformer")]);
  let migrated: ERD;
  try {
    migrated = (await importSql(`${erdToSql(from)}\n\n${migration}`)).erd;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const target = (await importSql(erdToSql(to))).erd;
  const a = shapeOf(migrated);
  const b = shapeOf(target);
  if (same(a, b)) return { ok: true };
  const differing = b.tables.filter((t) => !same(t, a.tables.find((m) => m.name === t.name))).map((t) => t.name);
  const missing = a.tables.filter((t) => !b.tables.some((x) => x.name === t.name)).map((t) => t.name);
  const parts = [
    differing.length && `tables differ: ${differing.join(", ")}`,
    missing.length && `left over: ${missing.join(", ")}`,
    !same(a.relationships, b.relationships) && "foreign keys differ",
    !same(a.enums, b.enums) && "enum types differ",
    !same(a.views, b.views) && "views differ",
  ].filter(Boolean);
  return { ok: false, error: `The result doesn't match the new schema (${parts.join("; ") || "details differ"}).` };
}
