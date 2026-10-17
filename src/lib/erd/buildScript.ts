import type { ERD } from "@/types/erd";
import type { BuildScript } from "@/types/gemini";

function buildSteps(erd: ERD): BuildScript {
  const steps: BuildScript["steps"] = [];
  let order = 1;

  for (const table of erd.tables) {
    steps.push({
      order: order++,
      type: "add_table",
      targetTable: table.name,
      data: { table_name: table.name },
      phase: "erd",
    });

    for (const column of table.columns) {
      steps.push({
        order: order++,
        type: "add_column",
        targetTable: table.name,
        data: {
          table_name: table.name,
          column: {
            name: column.name,
            data_type: column.dataType,
            nullable: column.nullable,
            default_value: column.defaultValue,
            is_primary_key: column.isPrimaryKey,
            is_foreign_key: column.isForeignKey,
            references_table: column.referencesTable,
            references_column: column.referencesColumn,
          },
        },
        phase: "erd",
      });
    }

    for (const constraint of table.constraints) {
      steps.push({
        order: order++,
        type: "add_constraint",
        targetTable: table.name,
        data: {
          table_name: table.name,
          constraint: {
            type: constraint.type,
            columns: constraint.columns,
            expression: constraint.expression,
            on_delete: constraint.onDelete,
          },
        },
        phase: "constraints",
      });
    }

    for (const index of table.indexes) {
      steps.push({
        order: order++,
        type: "add_index",
        targetTable: table.name,
        data: {
          table_name: table.name,
          index: {
            name: index.name,
            columns: index.columns,
            unique: index.unique,
          },
        },
        phase: "constraints",
      });
    }
  }

  for (const relationship of erd.relationships) {
    steps.push({
      order: order++,
      type: "add_relationship",
      targetTable: relationship.fromTable,
      data: {
        id: relationship.id,
        from_table: relationship.fromTable,
        to_table: relationship.toTable,
        from_column: relationship.fromColumn,
        to_column: relationship.toColumn,
        cardinality: relationship.cardinality,
        required: relationship.required,
        on_delete: relationship.onDelete,
      },
      phase: "erd",
    });
  }

  return { steps };
}

/**
 * Build a deterministic replay script from an ERD.
 *
 * Used for every generation — including live Gemini results — because the model's
 * own `build_steps` payload is unreliable (the prompt leaves `data` unspecified,
 * so steps often arrive empty and the animation renders nothing). Deriving the
 * script from the final ERD guarantees the replay always has correct data.
 */
export function buildScriptFromErd(erd: ERD): BuildScript {
  return buildSteps(erd);
}
