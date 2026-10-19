/**
 * Design checks for the schema. Each issue explains the problem and, where
 * the fix is unambiguous, carries edit operations that apply it (through
 * the same validated functions as manual edits). Otherwise it offers an
 * "Ask AI" request.
 */
import type { ERD, Table } from "@/types/erd";
import type { EditOp } from "@/lib/erd/applyOps";
import { isColumnUnique, referencingType } from "@/lib/erd/model";

export type Severity = "error" | "warning" | "info";

export interface Issue {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  table: string | null;
  fix?: { label: string; ops: EditOp[] };
  askAi?: string;
  /** Extra facts for an AI fix, e.g. the SQL that failed. */
  context?: string;
  /** For failed Postgres tests: the test's title, to check the fix. */
  testTitle?: string;
}

const MONEY = /(^|_)(price|amount|cost|total|subtotal|balance|fee|fees|salary|tax|discount_amount|payment|revenue)($|_)/;
const NATURAL_KEY = /^(email|username|user_name|slug|sku|handle|isbn|ean|upc|code)$/;
const FLOATING = /^(REAL|FLOAT\d*|DOUBLE PRECISION|DOUBLE)$/i;

/** Is `columns` covered by the leading columns of an index, unique, or the PK? */
function hasLeadingIndex(table: Table, column: string): boolean {
  const pk = table.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
  return (
    pk[0] === column ||
    table.indexes.some((i) => i.columns[0] === column) ||
    table.constraints.some((c) => c.type === "UNIQUE" && c.columns[0] === column)
  );
}

export function lintErd(erd: ERD): Issue[] {
  const issues: Issue[] = [];
  const add = (issue: Omit<Issue, "id">) => issues.push({ ...issue, id: `${issue.table ?? "schema"}:${issue.title}` });
  const tableByName = new Map(erd.tables.map((t) => [t.name, t]));

  for (const table of erd.tables) {
    const pkColumns = table.columns.filter((c) => c.isPrimaryKey);
    const fkRels = erd.relationships.filter((r) => r.fromTable === table.name);

    // Primary key
    if (pkColumns.length === 0) {
      const hasId = table.columns.some((c) => c.name === "id");
      add({
        severity: "error",
        table: table.name,
        title: `${table.name} has no primary key`,
        detail: "Without a primary key, rows can't be identified reliably and other tables can't reference this one.",
        fix: hasId
          ? { label: "Make id the primary key", ops: [{ op: "alter_column", table: table.name, column: "id", primary_key: true }] }
          : {
              label: "Add id SERIAL primary key",
              ops: [{ op: "add_column", table: table.name, column: { name: "id", type: "SERIAL", primary_key: true, nullable: false } }],
            },
      });
    }

    if (table.columns.length <= 1) {
      add({
        severity: "warning",
        table: table.name,
        title: `${table.name} has no data columns`,
        detail: "A table with only a key stores nothing useful yet.",
        askAi: `Add the columns a "${table.name}" table typically needs.`,
      });
    }

    for (const rel of fkRels) {
      const column = table.columns.find((c) => c.name === rel.fromColumn);
      const target = tableByName.get(rel.toTable)?.columns.find((c) => c.name === rel.toColumn);
      if (!column) continue;

      // FK type must match what it references.
      if (target && referencingType(target.dataType).toUpperCase() !== referencingType(column.dataType).toUpperCase()) {
        add({
          severity: "error",
          table: table.name,
          title: `${table.name}.${column.name} type doesn't match ${rel.toTable}.${rel.toColumn}`,
          detail: `It is ${column.dataType} but references a ${target.dataType} column, so the foreign key can fail or compare wrongly.`,
          fix: {
            label: `Change type to ${referencingType(target.dataType)}`,
            ops: [{ op: "alter_column", table: table.name, column: column.name, type: referencingType(target.dataType) }],
          },
        });
      }

      // FK should be indexed (joins and ON DELETE checks scan it).
      if (!hasLeadingIndex(table, column.name)) {
        add({
          severity: "warning",
          table: table.name,
          title: `${table.name}.${column.name} has no index`,
          detail: `Postgres doesn't index foreign keys automatically. Joins to ${rel.toTable} and deletes from it will scan the whole table.`,
          fix: { label: "Add index", ops: [{ op: "add_index", table: table.name, columns: [column.name], unique: false }] },
        });
      }
    }

    for (const column of table.columns) {
      // Money in floating point
      if (MONEY.test(column.name) && FLOATING.test(column.dataType.trim())) {
        add({
          severity: "warning",
          table: table.name,
          title: `${table.name}.${column.name} stores money as ${column.dataType}`,
          detail: "Floating-point types round (0.1 + 0.2 ≠ 0.3). Use NUMERIC for currency.",
          fix: { label: "Use NUMERIC(12,2)", ops: [{ op: "alter_column", table: table.name, column: column.name, type: "NUMERIC(12,2)" }] },
        });
      }

      // Natural keys should be unique
      if (NATURAL_KEY.test(column.name) && !column.isPrimaryKey && !column.isForeignKey && !isColumnUnique(table, column.name)) {
        add({
          severity: "warning",
          table: table.name,
          title: `${table.name}.${column.name} isn't unique`,
          detail: `Two rows could share the same ${column.name}, which usually causes login, lookup or URL bugs.`,
          fix: { label: "Make UNIQUE", ops: [{ op: "alter_column", table: table.name, column: column.name, unique: true }] },
        });
      }

      // Booleans should not be three-valued
      if (/^BOOL/i.test(column.dataType) && column.nullable) {
        add({
          severity: "info",
          table: table.name,
          title: `${table.name}.${column.name} can be NULL`,
          detail: "A nullable boolean has three states (true/false/unknown). Usually you want NOT NULL with a default.",
          fix: {
            label: "NOT NULL DEFAULT false",
            ops: [{ op: "alter_column", table: table.name, column: column.name, nullable: false, default: column.defaultValue ?? "false" }],
          },
        });
      }
    }

    // Repeating groups (phone1, phone2, …) break first normal form.
    const groups = new Map<string, string[]>();
    for (const column of table.columns) {
      const match = column.name.match(/^(.*?)_?(\d+)$/);
      if (match && match[1]) groups.set(match[1], [...(groups.get(match[1]) ?? []), column.name]);
    }
    for (const [base, names] of groups) {
      if (names.length < 2) continue;
      add({
        severity: "warning",
        table: table.name,
        title: `${table.name} repeats ${base} (${names.join(", ")})`,
        detail: "Numbered columns are a repeating group: you can't store a third one without changing the schema. A child table is more flexible.",
        askAi: `Move the repeated ${names.join(", ")} columns of ${table.name} into a separate child table.`,
      });
    }

    // Junction tables: the pair of foreign keys should be unique.
    const dataColumns = table.columns.filter((c) => !c.isPrimaryKey && !/^(created|updated)_at$/.test(c.name));
    if (fkRels.length === 2 && dataColumns.length === 2) {
      const pair = fkRels.map((r) => r.fromColumn);
      const covered =
        table.constraints.some((c) => c.type === "UNIQUE" && c.columns.length === 2 && pair.every((p) => c.columns.includes(p))) ||
        table.indexes.some((i) => i.unique && i.columns.length === 2 && pair.every((p) => i.columns.includes(p))) ||
        (pkColumns.length === 2 && pair.every((p) => pkColumns.some((c) => c.name === p)));
      if (!covered) {
        add({
          severity: "warning",
          table: table.name,
          title: `${table.name} allows duplicate links`,
          detail: `As a link table between ${fkRels[0].toTable} and ${fkRels[1].toTable}, the same pair could be stored twice.`,
          fix: { label: "Add unique (pair)", ops: [{ op: "add_index", table: table.name, columns: pair, unique: true }] },
        });
      }
    }

    // Created timestamp
    if (!table.columns.some((c) => /^(created_at|created_on|inserted_at)$/.test(c.name)) && erd.tables.length > 1) {
      add({
        severity: "info",
        table: table.name,
        title: `${table.name} has no created_at`,
        detail: "Knowing when a row was created helps with debugging, auditing and sorting.",
        fix: {
          label: "Add created_at",
          ops: [{ op: "add_column", table: table.name, column: { name: "created_at", type: "TIMESTAMP", nullable: false, default: "NOW()" } }],
        },
      });
    }
  }

  // Circular required references: no table in the loop can get its first row.
  const requiredEdges = new Map<string, string[]>();
  for (const rel of erd.relationships) {
    if (!rel.required || rel.fromTable === rel.toTable) continue;
    requiredEdges.set(rel.fromTable, [...(requiredEdges.get(rel.fromTable) ?? []), rel.toTable]);
  }
  const reported = new Set<string>();
  for (const start of requiredEdges.keys()) {
    const stack: Array<{ table: string; path: string[] }> = [{ table: start, path: [start] }];
    while (stack.length) {
      const { table, path } = stack.pop()!;
      for (const next of requiredEdges.get(table) ?? []) {
        if (next === start && path.length > 1) {
          const key = [...path].sort().join(",");
          if (reported.has(key)) continue;
          reported.add(key);
          const loop = [...path, start].join(" → ");
          const rels = path.map((from, i) => erd.relationships.find((r) => r.fromTable === from && r.toTable === (path[i + 1] ?? start) && r.required));
          const isPkFk = (r: (typeof rels)[number]) =>
            Boolean(r && tableByName.get(r.fromTable)?.columns.find((c) => c.name === r.fromColumn)?.isPrimaryKey);
          // A foreign key on a primary key is usually a 1:1 drawn backwards: drop it.
          const backwards = rels.find((r) => r && isPkFk(r));
          const breakable = rels.find((r) => r && !isPkFk(r));
          add({
            severity: "error",
            table: start,
            title: `Circular required references: ${loop}`,
            detail: "Each table needs a row in the next before it can be inserted, so none of them can ever get their first row.",
            fix: backwards
              ? {
                  label: `Remove FK on ${backwards.fromTable}.${backwards.fromColumn}`,
                  ops: [{ op: "drop_foreign_key", from_table: backwards.fromTable, from_column: backwards.fromColumn }],
                }
              : breakable
                ? {
                    label: `Make ${breakable.fromTable}.${breakable.fromColumn} optional`,
                    ops: [{ op: "alter_column", table: breakable.fromTable, column: breakable.fromColumn, nullable: true }],
                  }
                : undefined,
            askAi: `Break the circular required foreign keys ${loop}: usually only the child side of a 1:1 relationship should hold the foreign key.`,
          });
        } else if (!path.includes(next) && path.length < 6) {
          stack.push({ table: next, path: [...path, next] });
        }
      }
    }
  }

  // Disconnected tables in a multi-table schema
  if (erd.tables.length >= 3) {
    for (const table of erd.tables) {
      const linked = erd.relationships.some((r) => r.fromTable === table.name || r.toTable === table.name);
      if (!linked) {
        add({
          severity: "info",
          table: table.name,
          title: `${table.name} isn't related to any table`,
          detail: "Isolated tables are fine for settings or lookups, but often mean a missing foreign key.",
          askAi: `Connect ${table.name} to the tables it belongs with, using foreign keys.`,
        });
      }
    }
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}

/**
 * Fixes safe to apply without asking: they never remove data or change
 * meaning, only tighten types, add indexes and fill obvious gaps.
 */
const SAFE_FIX = /^(Add index|Use NUMERIC\(12,2\)|NOT NULL DEFAULT false|Make id the primary key|Change type to )/;

/** Apply every safe fix (a couple of passes, since fixes can unlock others). */
export function autoFixErd(erd: ERD, apply: (erd: ERD, ops: EditOp[]) => ERD): { erd: ERD; fixed: string[] } {
  let current = erd;
  const fixed: string[] = [];
  for (let pass = 0; pass < 2; pass += 1) {
    const safe = lintErd(current).filter((i) => i.fix && SAFE_FIX.test(i.fix.label));
    if (safe.length === 0) break;
    current = apply(current, safe.flatMap((i) => i.fix!.ops));
    fixed.push(...safe.map((i) => i.fix!.label));
  }
  return { erd: current, fixed };
}
