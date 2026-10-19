/**
 * Apply AI-proposed edit operations to an ERD, one at a time, using the
 * same validated model functions as manual edits. Each operation reports
 * whether it applied, so the user can review before accepting.
 */
import type { ERD, OnDeleteAction } from "@/types/erd";
import {
  addCheckConstraint,
  addColumn,
  addIndex,
  addRelationship,
  createTable,
  deleteColumn,
  deleteRelationship,
  deleteTable,
  renameTable,
  setTableComment,
  updateColumn,
  updateRelationship,
  upsertEnum,
  upsertView,
  type EditResult,
  type NewColumnSpec,
} from "./model";

export interface ColumnOpSpec {
  name: string;
  type?: string;
  nullable?: boolean;
  primary_key?: boolean;
  unique?: boolean;
  default?: string | null;
}

export type EditOp =
  | { op: "add_table"; table: string; columns: ColumnOpSpec[] }
  | { op: "drop_table"; table: string }
  | { op: "rename_table"; table: string; new_name: string }
  | { op: "add_column"; table: string; column: ColumnOpSpec }
  | { op: "drop_column"; table: string; column: string }
  | {
      op: "alter_column";
      table: string;
      column: string;
      new_name?: string;
      type?: string;
      nullable?: boolean;
      unique?: boolean;
      primary_key?: boolean;
      default?: string | null;
    }
  | {
      op: "add_foreign_key";
      from_table: string;
      from_column?: string;
      to_table: string;
      to_column?: string;
      required?: boolean;
      on_delete?: OnDeleteAction;
      one_to_one?: boolean;
    }
  | { op: "drop_foreign_key"; from_table: string; from_column: string }
  | { op: "add_index"; table: string; columns: string[]; unique?: boolean }
  | { op: "add_check"; table: string; expression: string }
  | { op: "create_enum"; name: string; values: string[] }
  | { op: "set_comment"; table: string; column?: string; comment: string }
  | { op: "create_view"; name: string; sql: string };

export interface OpResult {
  label: string;
  ok: boolean;
  error?: string;
}

const tableId = (erd: ERD, name: string) => erd.tables.find((t) => t.name === name)?.id;

function describe(op: EditOp): string {
  switch (op.op) {
    case "add_table":
      return `Add table ${op.table} (${op.columns.length} column${op.columns.length === 1 ? "" : "s"})`;
    case "drop_table":
      return `Remove table ${op.table}`;
    case "rename_table":
      return `Rename ${op.table} → ${op.new_name}`;
    case "add_column":
      return `Add ${op.table}.${op.column.name}${op.column.type ? ` (${op.column.type})` : ""}`;
    case "drop_column":
      return `Remove ${op.table}.${op.column}`;
    case "alter_column": {
      const changes = [
        op.new_name && `rename to ${op.new_name}`,
        op.type && `type ${op.type}`,
        op.nullable !== undefined && (op.nullable ? "nullable" : "NOT NULL"),
        op.unique !== undefined && (op.unique ? "UNIQUE" : "not unique"),
        op.primary_key !== undefined && (op.primary_key ? "primary key" : "not primary key"),
        op.default !== undefined && `default ${op.default ?? "none"}`,
      ].filter(Boolean);
      return `Change ${op.table}.${op.column}: ${changes.join(", ") || "no changes"}`;
    }
    case "add_foreign_key":
      return `Link ${op.from_table}${op.from_column ? `.${op.from_column}` : ""} → ${op.to_table}${op.to_column ? `.${op.to_column}` : ""}`;
    case "drop_foreign_key":
      return `Unlink ${op.from_table}.${op.from_column}`;
    case "add_index":
      return `Index ${op.table} (${op.columns.join(", ")})${op.unique ? " UNIQUE" : ""}`;
    case "add_check":
      return `Check on ${op.table}: ${op.expression}`;
    case "create_enum":
      return `Enum type ${op.name} (${op.values.join(", ")})`;
    case "set_comment":
      return `Comment on ${op.table}${op.column ? `.${op.column}` : ""}`;
    case "create_view":
      return `View ${op.name}`;
  }
}

function missingTable(name: string): EditResult {
  return { ok: false, error: `Table "${name}" doesn't exist.` };
}

function applyOne(erd: ERD, op: EditOp): EditResult {
  switch (op.op) {
    case "add_table": {
      const specs: NewColumnSpec[] = op.columns.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable,
        primaryKey: c.primary_key,
        defaultValue: c.default ?? null,
      }));
      const created = createTable(erd, op.table, specs);
      if (!created.ok) return created;
      let next = created.erd;
      for (const column of op.columns.filter((c) => c.unique && !c.primary_key)) {
        const result = updateColumn(next, created.tableId, column.name, { unique: true });
        if (result.ok) next = result.erd;
      }
      return { ok: true, erd: next };
    }
    case "drop_table": {
      const id = tableId(erd, op.table);
      return id ? deleteTable(erd, id) : missingTable(op.table);
    }
    case "rename_table": {
      const id = tableId(erd, op.table);
      return id ? renameTable(erd, id, op.new_name) : missingTable(op.table);
    }
    case "add_column": {
      const id = tableId(erd, op.table);
      if (!id) return missingTable(op.table);
      const added = addColumn(erd, id);
      if (!added.ok) return added;
      return updateColumn(added.erd, id, added.columnName, {
        name: op.column.name,
        dataType: op.column.type,
        nullable: op.column.nullable,
        isPrimaryKey: op.column.primary_key,
        unique: op.column.unique,
        defaultValue: op.column.default ?? null,
      });
    }
    case "drop_column": {
      const id = tableId(erd, op.table);
      return id ? deleteColumn(erd, id, op.column) : missingTable(op.table);
    }
    case "alter_column": {
      const id = tableId(erd, op.table);
      if (!id) return missingTable(op.table);
      return updateColumn(erd, id, op.column, {
        name: op.new_name,
        dataType: op.type,
        nullable: op.nullable,
        unique: op.unique,
        isPrimaryKey: op.primary_key,
        defaultValue: op.default,
      });
    }
    case "add_foreign_key": {
      const fromId = tableId(erd, op.from_table);
      const toId = tableId(erd, op.to_table);
      if (!fromId) return missingTable(op.from_table);
      if (!toId) return missingTable(op.to_table);

      let next = erd;
      // A named FK column that doesn't exist yet is created first.
      const fromTable = next.tables.find((t) => t.id === fromId);
      if (op.from_column && !fromTable?.columns.some((c) => c.name === op.from_column)) {
        const added = addColumn(next, fromId);
        if (!added.ok) return added;
        const renamed = updateColumn(added.erd, fromId, added.columnName, { name: op.from_column, nullable: !(op.required ?? true) });
        if (!renamed.ok) return renamed;
        next = renamed.erd;
      }

      const linked = addRelationship(next, { fromTableId: fromId, toTableId: toId, fromColumn: op.from_column, toColumn: op.to_column });
      if (!linked.ok) return linked;
      return updateRelationship(linked.erd, linked.relationshipId, {
        required: op.required,
        cardinality: op.one_to_one ? "1:1" : undefined,
        onDelete: op.on_delete,
      });
    }
    case "drop_foreign_key": {
      const rel = erd.relationships.find((r) => r.fromTable === op.from_table && r.fromColumn === op.from_column);
      return rel ? deleteRelationship(erd, rel.id) : { ok: false, error: `${op.from_table}.${op.from_column} isn't a foreign key.` };
    }
    case "add_index": {
      const id = tableId(erd, op.table);
      return id ? addIndex(erd, id, op.columns, Boolean(op.unique)) : missingTable(op.table);
    }
    case "add_check": {
      const id = tableId(erd, op.table);
      return id ? addCheckConstraint(erd, id, op.expression) : missingTable(op.table);
    }
    case "create_enum":
      return upsertEnum(erd, op.name, op.values, erd.enums?.some((e) => e.name === op.name) ? op.name : undefined);
    case "set_comment": {
      const id = tableId(erd, op.table);
      if (!id) return missingTable(op.table);
      return op.column ? updateColumn(erd, id, op.column, { comment: op.comment }) : setTableComment(erd, id, op.comment);
    }
    case "create_view":
      return upsertView(erd, { id: erd.views?.find((v) => v.name === op.name)?.id, name: op.name, sql: op.sql });
  }
}

export function applyOps(erd: ERD, ops: EditOp[]): { erd: ERD; results: OpResult[] } {
  let current = erd;
  const results: OpResult[] = [];
  for (const op of ops) {
    const label = describe(op);
    try {
      const result = applyOne(current, op);
      if (result.ok) {
        current = result.erd;
        results.push({ label, ok: true });
      } else {
        results.push({ label, ok: false, error: result.error });
      }
    } catch (error) {
      results.push({ label, ok: false, error: error instanceof Error ? error.message : "Couldn't apply this change." });
    }
  }
  return { erd: current, results };
}

/** Compact text form of the schema for the AI (cheaper than JSON). */
export function describeErdForAi(erd: ERD): string {
  if (erd.tables.length === 0) return "(empty schema — no tables yet)";
  return erd.tables
    .map((table) => {
      const unique = new Set(
        table.constraints.filter((c) => c.type === "UNIQUE" && c.columns.length === 1).map((c) => c.columns[0])
      );
      const columns = table.columns
        .map((c) =>
          [
            c.name,
            c.dataType,
            c.isPrimaryKey && "PK",
            !c.nullable && !c.isPrimaryKey && "NOT NULL",
            unique.has(c.name) && "UNIQUE",
            c.defaultValue && `DEFAULT ${c.defaultValue}`,
            c.isForeignKey && `FK->${c.referencesTable}.${c.referencesColumn}`,
            c.generated && `GENERATED AS (${c.generated})`,
            c.comment && `-- ${c.comment.replace(/\s+/g, " ")}`,
          ]
            .filter(Boolean)
            .join(" ")
        )
        .join("; ");
      const extras = [
        ...table.constraints.filter((c) => c.type === "UNIQUE" && c.columns.length > 1).map((c) => `unique(${c.columns.join(", ")})`),
        ...table.constraints.filter((c) => c.type === "CHECK" && c.expression).map((c) => `check(${c.expression})`),
        ...table.indexes.map((i) => `${i.unique ? "unique " : ""}index(${i.columns.join(", ")})`),
      ];
      const comment = table.comment ? ` -- ${table.comment.replace(/\s+/g, " ")}` : "";
      return `table ${table.name}${comment}: ${columns}${extras.length ? `\n  ${extras.join("; ")}` : ""}`;
    })
    .concat((erd.enums ?? []).map((e) => `enum ${e.name}: ${e.values.join(", ")}`))
    .concat((erd.views ?? []).map((v) => `view ${v.name}: ${v.sql.replace(/\s+/g, " ")}`))
    .join("\n");
}
