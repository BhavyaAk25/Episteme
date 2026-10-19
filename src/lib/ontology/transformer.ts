import type { Node, Edge } from "@xyflow/react";
import type { ERD, ERDNodeData, ERDEdgeData } from "@/types/erd";
import type { Ontology } from "@/types/ontology";

const HORIZONTAL_SPACING = 400;
const VERTICAL_SPACING = 210;
const VERTICAL_GAP = 56;

/**
 * Rough rendered height of a table node, so the layout can stack tables
 * without overlapping. Mirrors ERDTableNode: header + column rows +
 * (optional) constraints footer showing at most 3 rows.
 */
export function estimateNodeHeight(table: ERD["tables"][number]): number {
  const HEADER = 42;
  const ROW = 27;
  const BODY_PADDING = 12;
  const visibleConstraints = Math.min(
    3,
    table.constraints.filter((c) => c.type !== "PRIMARY_KEY" && c.type !== "NOT_NULL").length
  );
  const footer = visibleConstraints > 0 ? 14 + visibleConstraints * 20 : 0;
  return HEADER + BODY_PADDING + table.columns.length * ROW + footer;
}

function buildTableLayers(erd: ERD): string[][] {
  const tableNames = erd.tables.map((table) => table.name);
  const dependencyMap = new Map<string, Set<string>>();
  const reverseDependencyMap = new Map<string, Set<string>>();

  for (const tableName of tableNames) {
    dependencyMap.set(tableName, new Set<string>());
    reverseDependencyMap.set(tableName, new Set<string>());
  }

  for (const table of erd.tables) {
    const dependencies = dependencyMap.get(table.name);
    if (!dependencies) continue;

    for (const column of table.columns) {
      if (!column.isForeignKey || !column.referencesTable) continue;
      if (column.referencesTable === table.name) continue;
      dependencies.add(column.referencesTable);
      reverseDependencyMap.get(column.referencesTable)?.add(table.name);
    }
  }

  const inDegree = new Map<string, number>();
  for (const tableName of tableNames) {
    inDegree.set(tableName, dependencyMap.get(tableName)?.size ?? 0);
  }

  const layers: string[][] = [];
  let frontier = tableNames.filter((tableName) => (inDegree.get(tableName) ?? 0) === 0);

  while (frontier.length > 0) {
    const currentLayer = [...frontier].sort((a, b) => a.localeCompare(b));
    layers.push(currentLayer);

    const nextFrontier = new Set<string>();
    for (const tableName of currentLayer) {
      const dependents = reverseDependencyMap.get(tableName) ?? new Set<string>();
      for (const dependent of dependents) {
        const currentDegree = inDegree.get(dependent) ?? 0;
        const nextDegree = Math.max(0, currentDegree - 1);
        inDegree.set(dependent, nextDegree);
        if (nextDegree === 0) {
          nextFrontier.add(dependent);
        }
      }
    }

    frontier = Array.from(nextFrontier);
  }

  const placed = new Set(layers.flat());
  const unplaced = tableNames.filter((tableName) => !placed.has(tableName)).sort((a, b) => a.localeCompare(b));
  if (unplaced.length > 0) {
    layers.push(unplaced);
  }

  return layers;
}

function buildForeignKeyDependencyMap(erd: ERD): Map<string, string[]> {
  const dependencyMap = new Map<string, string[]>();

  for (const table of erd.tables) {
    const dependencies = new Set<string>();
    for (const column of table.columns) {
      if (!column.isForeignKey || !column.referencesTable || column.referencesTable === table.name) {
        continue;
      }
      dependencies.add(column.referencesTable);
    }
    dependencyMap.set(table.name, Array.from(dependencies));
  }

  return dependencyMap;
}

/** Simple layered layout used when a table has no saved position. */
function layeredPositions(erd: ERD): Map<string, { x: number; y: number }> {
  const layers = buildTableLayers(erd);
  const dependencyLookup = buildForeignKeyDependencyMap(erd);
  const tablePosition = new Map<string, { x: number; y: number }>();
  const rowLookup = new Map<string, number>();

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = [...layers[layerIndex]];

    if (layerIndex > 0) {
      const averageRow = (table: string) => {
        const deps = dependencyLookup.get(table) ?? [];
        return deps.length > 0
          ? deps.reduce((sum, dep) => sum + (rowLookup.get(dep) ?? 0), 0) / deps.length
          : Number.POSITIVE_INFINITY;
      };
      layer.sort((a, b) => {
        const rowA = averageRow(a);
        const rowB = averageRow(b);
        return rowA === rowB ? a.localeCompare(b) : rowA - rowB;
      });
    }

    const heights = layer.map((tableName) => {
      const table = erd.tables.find((t) => t.name === tableName);
      return table ? estimateNodeHeight(table) : VERTICAL_SPACING;
    });
    const layerHeight =
      heights.reduce((sum, height) => sum + height, 0) + VERTICAL_GAP * Math.max(0, layer.length - 1);

    let cursorY = -layerHeight / 2;
    for (let rowIndex = 0; rowIndex < layer.length; rowIndex += 1) {
      const tableName = layer[rowIndex];
      tablePosition.set(tableName, { x: layerIndex * HORIZONTAL_SPACING, y: cursorY });
      rowLookup.set(tableName, rowIndex);
      cursorY += heights[rowIndex] + VERTICAL_GAP;
    }
  }

  return tablePosition;
}

/** Handle id for one side of a column row: "<column>-L" or "<column>-R". */
export function columnHandleId(column: string, side: "L" | "R"): string {
  return `${column}-${side}`;
}

export function parseColumnHandleId(handleId: string | null | undefined): string | null {
  if (!handleId) return null;
  const match = handleId.match(/^(.*)-(L|R)$/);
  return match && match[1] !== "__table" ? match[1] : null;
}

function uniqueColumnsOf(table: ERD["tables"][number]): string[] {
  const single = (cols: string[]) => cols.length === 1;
  return Array.from(
    new Set([
      ...table.constraints.filter((c) => c.type === "UNIQUE" && single(c.columns)).map((c) => c.columns[0]),
      ...table.indexes.filter((i) => i.unique && single(i.columns)).map((i) => i.columns[0]),
    ])
  );
}

/**
 * Transform ERD to React Flow nodes. Saved positions win; tables without one
 * get a simple layered position (parents left of the tables that reference them).
 */
export function erdToNodes(
  erd: ERD,
  ontology: Ontology | null,
  positions: Record<string, { x: number; y: number }> = {}
): Node<ERDNodeData>[] {
  const fallback = layeredPositions(erd);
  const enumNames = (erd.enums ?? []).map((e) => e.name);

  return erd.tables.map((table, index) => {
    const objectType = ontology?.objectTypes.find(
      (o) => o.id === table.objectTypeId || o.name === table.name.replace(/_/g, " ")
    );
    const position = positions[table.id] ??
      fallback.get(table.name) ?? {
        x: (index % 3) * HORIZONTAL_SPACING,
        y: Math.floor(index / 3) * VERTICAL_SPACING,
      };

    return {
      id: table.id,
      type: "erdTable",
      position,
      data: {
        tableName: table.name,
        columns: table.columns,
        constraints: table.constraints,
        indexes: table.indexes,
        status: objectType?.status || "active",
        confidence: objectType?.confidence || "high",
        objectTypeId: table.objectTypeId,
        uniqueColumns: uniqueColumnsOf(table),
        color: table.color,
        comment: table.comment ?? null,
        enumNames,
      },
    };
  });
}

/**
 * Transform ERD relationships to React Flow edges, column to column.
 * Each end attaches to the side of its table that faces the other table.
 */
export function erdToEdges(
  erd: ERD,
  positions: Record<string, { x: number; y: number }> = {},
  widths: Record<string, number> = {},
  /** In compact views some columns aren't drawn; their edges attach to the table instead. */
  isColumnVisible: (column: ERD["tables"][number]["columns"][number]) => boolean = () => true
): Edge<ERDEdgeData>[] {
  const tableByName = new Map(erd.tables.map((t) => [t.name, t]));

  return erd.relationships.flatMap((rel) => {
    const from = tableByName.get(rel.fromTable);
    const to = tableByName.get(rel.toTable);
    if (!from || !to) return [];

    let sourceSide: "L" | "R" = "L";
    let targetSide: "L" | "R" = "R";
    if (from.id === to.id) {
      sourceSide = "R";
      targetSide = "R";
    } else {
      const fromPos = positions[from.id];
      const toPos = positions[to.id];
      if (fromPos && toPos) {
        const fromWidth = widths[from.id] ?? 280;
        const toWidth = widths[to.id] ?? 280;
        const fromCenter = fromPos.x + fromWidth / 2;
        const toCenter = toPos.x + toWidth / 2;
        if (Math.abs(toCenter - fromCenter) < (fromWidth + toWidth) / 2) {
          // Stacked tables: attach both ends on the same side for a short bracket.
          sourceSide = "R";
          targetSide = "R";
        } else if (toCenter > fromCenter) {
          sourceSide = "R";
          targetSide = "L";
        }
      }
    }

    const fromColumn = from.columns.find((c) => c.name === rel.fromColumn);
    const toColumn = to.columns.find((c) => c.name === rel.toColumn);
    const sourceName = fromColumn && isColumnVisible(fromColumn) ? rel.fromColumn : "__table";
    const targetName = toColumn && isColumnVisible(toColumn) ? rel.toColumn : "__table";

    return [{
      id: rel.id,
      type: "erdRelation",
      source: from.id,
      target: to.id,
      sourceHandle: columnHandleId(sourceName, sourceSide),
      targetHandle: columnHandleId(targetName, targetSide),
      data: {
        cardinality: rel.cardinality,
        required: rel.required,
        onDelete: rel.onDelete,
        fromColumn: rel.fromColumn,
        toColumn: rel.toColumn,
      },
    }];
  });
}

const sqlString = (text: string) => `'${text.replace(/\s+/g, " ").trim().replace(/'/g, "''")}'`;

/**
 * Generate PostgreSQL DDL from the ERD: enum types, tables, foreign keys,
 * indexes, comments and views. Statements are separated by blank lines.
 */
export function erdToSql(erd: ERD): string {
  const statements: string[] = [];

  for (const type of erd.enums ?? []) {
    statements.push(`CREATE TYPE ${type.name} AS ENUM (${type.values.map(sqlString).join(", ")});`);
  }

  for (const table of erd.tables) {
    const columns = table.columns.map((col) => {
      let def = `  ${col.name} ${col.dataType}`;
      if (col.generated) def += ` GENERATED ALWAYS AS (${col.generated}) STORED`;
      if (!col.nullable) def += " NOT NULL";
      if (col.defaultValue && !col.generated) def += ` DEFAULT ${col.defaultValue}`;
      return def;
    });

    // Add primary key constraint
    const pkColumns = table.columns.filter((c) => c.isPrimaryKey);
    if (pkColumns.length > 0) {
      columns.push(`  PRIMARY KEY (${pkColumns.map((c) => c.name).join(", ")})`);
    }

    // Add unique constraints
    for (const constraint of table.constraints) {
      if (constraint.type === "UNIQUE") {
        columns.push(`  UNIQUE (${constraint.columns.join(", ")})`);
      }
      if (constraint.type === "CHECK" && constraint.expression) {
        columns.push(`  CHECK (${constraint.expression})`);
      }
    }

    statements.push(`CREATE TABLE ${table.name} (\n${columns.join(",\n")}\n);`);
  }

  // Add foreign key constraints as ALTER TABLE
  for (const table of erd.tables) {
    for (const col of table.columns) {
      if (col.isForeignKey && col.referencesTable && col.referencesColumn) {
        const fk = table.constraints.find(
          (c) => c.type === "FOREIGN_KEY" && c.columns.includes(col.name)
        );
        // SQL spells these with spaces: SET NULL / NO ACTION.
        const onDelete = (fk?.onDelete || "RESTRICT").replace("_", " ");
        statements.push(
          `ALTER TABLE ${table.name} ADD CONSTRAINT fk_${table.name}_${col.name} ` +
            `FOREIGN KEY (${col.name}) REFERENCES ${col.referencesTable}(${col.referencesColumn}) ` +
            `ON DELETE ${onDelete};`
        );
      }
    }
  }

  // Add indexes
  for (const table of erd.tables) {
    for (const index of table.indexes) {
      const unique = index.unique ? "UNIQUE " : "";
      statements.push(
        `CREATE ${unique}INDEX ${index.name} ON ${table.name} (${index.columns.join(", ")});`
      );
    }
  }

  // Comments
  for (const table of erd.tables) {
    if (table.comment) statements.push(`COMMENT ON TABLE ${table.name} IS ${sqlString(table.comment)};`);
    for (const col of table.columns) {
      if (col.comment) statements.push(`COMMENT ON COLUMN ${table.name}.${col.name} IS ${sqlString(col.comment)};`);
    }
  }

  // Views last: they read from the tables above.
  for (const view of erd.views ?? []) {
    statements.push(`CREATE VIEW ${view.name} AS\n${view.sql};`);
  }

  return statements.join("\n\n");
}
