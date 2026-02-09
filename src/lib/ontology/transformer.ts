import type { Node, Edge } from "@xyflow/react";
import type { ERD, ERDNodeData, ERDEdgeData } from "@/types/erd";
import type { Ontology } from "@/types/ontology";

const HORIZONTAL_SPACING = 340;
const VERTICAL_SPACING = 210;

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

/**
 * Transform ERD to React Flow nodes
 */
export function erdToNodes(erd: ERD, ontology: Ontology): Node<ERDNodeData>[] {
  const layers = buildTableLayers(erd);
  const dependencyLookup = buildForeignKeyDependencyMap(erd);
  const tablePosition = new Map<string, { x: number; y: number }>();
  const rowLookup = new Map<string, number>();

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = [...layers[layerIndex]];

    if (layerIndex > 0) {
      layer.sort((tableA, tableB) => {
        const dependenciesA = dependencyLookup.get(tableA) ?? [];
        const dependenciesB = dependencyLookup.get(tableB) ?? [];

        const averageRowA =
          dependenciesA.length > 0
            ? dependenciesA.reduce((sum, dependency) => sum + (rowLookup.get(dependency) ?? 0), 0) /
              dependenciesA.length
            : Number.POSITIVE_INFINITY;
        const averageRowB =
          dependenciesB.length > 0
            ? dependenciesB.reduce((sum, dependency) => sum + (rowLookup.get(dependency) ?? 0), 0) /
              dependenciesB.length
            : Number.POSITIVE_INFINITY;

        if (averageRowA === averageRowB) {
          return tableA.localeCompare(tableB);
        }

        return averageRowA - averageRowB;
      });
    }

    const layerHeight = (layer.length - 1) * VERTICAL_SPACING;

    for (let rowIndex = 0; rowIndex < layer.length; rowIndex += 1) {
      const tableName = layer[rowIndex];
      const x = layerIndex * HORIZONTAL_SPACING;
      const y = rowIndex * VERTICAL_SPACING - layerHeight / 2;
      tablePosition.set(tableName, { x, y });
      rowLookup.set(tableName, rowIndex);
    }
  }

  return erd.tables.map((table, index) => {
    // Find the corresponding object type for status/confidence
    const objectType = ontology.objectTypes.find(
      (o) => o.id === table.objectTypeId || o.name === table.name.replace(/_/g, " ")
    );
    const position = tablePosition.get(table.name) ?? {
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
      },
    };
  });
}

/**
 * Transform ERD relationships to React Flow edges
 */
export function erdToEdges(erd: ERD): Edge<ERDEdgeData>[] {
  return erd.relationships.map((rel) => {
    const fromTable = erd.tables.find((t) => t.name === rel.fromTable);
    const hasFkHandle = Boolean(
      fromTable?.columns.some(
        (column) => column.name === rel.fromColumn && column.isForeignKey
      )
    );

    return {
      id: rel.id,
      type: "erdRelation",
      source: fromTable?.id || rel.fromTable,
      target: erd.tables.find((t) => t.name === rel.toTable)?.id || rel.toTable,
      sourceHandle: hasFkHandle ? `${rel.fromColumn}-source` : undefined,
      data: {
        cardinality: rel.cardinality,
        required: rel.required,
        onDelete: rel.onDelete,
        fromColumn: rel.fromColumn,
        toColumn: rel.toColumn,
        edgeSource: "generated",
      },
    };
  });
}

/**
 * Generate SQL CREATE TABLE statements from ERD
 */
export function erdToSql(erd: ERD): string {
  const statements: string[] = [];

  for (const table of erd.tables) {
    const columns = table.columns.map((col) => {
      let def = `  ${col.name} ${col.dataType}`;
      if (!col.nullable) def += " NOT NULL";
      if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`;
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
        const onDelete = fk?.onDelete || "RESTRICT";
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

  return statements.join("\n\n");
}
