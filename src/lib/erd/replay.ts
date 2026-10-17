import type { ERD } from "@/types/erd";
import type { BuildStep } from "@/types/gemini";

/**
 * The part of the ERD that has been "built" after the first `stepCount`
 * replay steps. The replay is a view over the current ERD, so it never
 * modifies the schema.
 */
export function visibleErdAtStep(erd: ERD, steps: BuildStep[], stepCount: number): ERD {
  const tables = new Set<string>();
  const columns = new Map<string, Set<string>>();
  const constraintCount = new Map<string, number>();
  const indexes = new Set<string>();
  const relationships = new Set<string>();

  for (const step of steps.slice(0, stepCount)) {
    const tableName = (step.data.table_name as string | undefined) ?? step.targetTable ?? "";
    switch (step.type) {
      case "add_table":
        tables.add(tableName);
        break;
      case "add_column": {
        const name = (step.data.column as { name?: string } | undefined)?.name;
        if (!name) break;
        if (!columns.has(tableName)) columns.set(tableName, new Set());
        columns.get(tableName)?.add(name);
        break;
      }
      case "add_constraint":
        constraintCount.set(tableName, (constraintCount.get(tableName) ?? 0) + 1);
        break;
      case "add_index": {
        const name = (step.data.index as { name?: string } | undefined)?.name;
        if (name) indexes.add(name);
        break;
      }
      case "add_relationship": {
        const id = step.data.id as string | undefined;
        if (id) relationships.add(id);
        break;
      }
      default:
        break;
    }
  }

  return {
    tables: erd.tables
      .filter((table) => tables.has(table.name))
      .map((table) => {
        const visibleColumns = columns.get(table.name) ?? new Set<string>();
        return {
          ...table,
          columns: table.columns.filter((c) => visibleColumns.has(c.name)),
          constraints: table.constraints.slice(0, constraintCount.get(table.name) ?? 0),
          indexes: table.indexes.filter((i) => indexes.has(i.name)),
        };
      }),
    relationships: erd.relationships.filter((r) => relationships.has(r.id)),
  };
}
