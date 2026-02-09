import type { Column, ERD, OnDeleteAction, Table } from "@/types/erd";

function isSerialType(dataType: string): boolean {
  const upper = dataType.toUpperCase();
  return upper.includes("SERIAL");
}

function isIntegerType(dataType: string): boolean {
  const upper = dataType.toUpperCase();
  return upper.includes("INT") || upper.includes("SERIAL");
}

function mapToSqliteType(dataType: string): string {
  const upper = dataType.toUpperCase();

  if (upper.includes("INT") || upper.includes("SERIAL")) return "INTEGER";
  if (upper.includes("DECIMAL") || upper.includes("NUMERIC") || upper.includes("FLOAT") || upper.includes("DOUBLE")) {
    return "REAL";
  }
  if (upper.includes("BOOL")) return "INTEGER";
  if (upper.includes("DATE") || upper.includes("TIME")) return "TEXT";
  if (upper.includes("UUID")) return "TEXT";
  if (upper.includes("JSON")) return "TEXT";
  if (upper.includes("CHAR") || upper.includes("TEXT")) return "TEXT";

  return "TEXT";
}

function normalizeSqliteExpression(expr: string): string {
  let normalized = expr;
  normalized = normalized.replace(/\bchar(?:acter)?_length\s*\(/gi, 'length(');
  normalized = normalized.replace(/::\w+/g, '');
  return normalized;
}

function normalizeDefaultValue(defaultValue: string | null): string | null {
  if (!defaultValue) return null;

  const value = defaultValue.trim();
  const upper = value.toUpperCase();

  if (upper === "TRUE") return "1";
  if (upper === "FALSE") return "0";
  if (upper.includes("NOW()")) return "CURRENT_TIMESTAMP";
  if (upper === "CURRENT_TIMESTAMP()") return "CURRENT_TIMESTAMP";
  if (upper.includes("(") && !upper.startsWith("(")) return null;

  return value;
}

function normalizeOnDeleteAction(action: OnDeleteAction | null): string {
  if (!action) return "NO ACTION";
  if (action === "NO_ACTION") return "NO ACTION";
  if (action === "SET_NULL") return "SET NULL";
  return action;
}

function isAutoPrimaryKey(table: Table, column: Column): boolean {
  const pkColumns = table.columns.filter((item) => item.isPrimaryKey);
  return pkColumns.length === 1 && pkColumns[0].name === column.name && isSerialType(column.dataType);
}

function buildCreateTableStatement(table: Table, existingTables: Set<string>): string {
  const definitions: string[] = [];
  const tableConstraints: string[] = [];
  const seenForeignKeys = new Set<string>();
  const primaryKeyColumns = table.columns.filter((column) => column.isPrimaryKey);

  for (const column of table.columns) {
    if (isAutoPrimaryKey(table, column)) {
      definitions.push(`  ${column.name} INTEGER PRIMARY KEY AUTOINCREMENT`);
      continue;
    }

    let definition = `  ${column.name} ${mapToSqliteType(column.dataType)}`;
    if (!column.nullable) {
      definition += " NOT NULL";
    }

    const defaultValue = normalizeDefaultValue(column.defaultValue);
    if (defaultValue) {
      definition += ` DEFAULT ${defaultValue}`;
    }

    if (column.isForeignKey && column.referencesTable && column.referencesColumn && existingTables.has(column.referencesTable)) {
      const fkConstraint = table.constraints.find(
        (constraint) => constraint.type === "FOREIGN_KEY" && constraint.columns.includes(column.name)
      );
      definition +=
        ` REFERENCES ${column.referencesTable}(${column.referencesColumn})` +
        ` ON DELETE ${normalizeOnDeleteAction(fkConstraint?.onDelete ?? null)}`;
      seenForeignKeys.add(column.name);
    }

    definitions.push(definition);
  }

  const hasInlineAutoPk = primaryKeyColumns.some((column) => isAutoPrimaryKey(table, column));
  if (!hasInlineAutoPk && primaryKeyColumns.length > 0) {
    tableConstraints.push(`  PRIMARY KEY (${primaryKeyColumns.map((column) => column.name).join(", ")})`);
  }

  for (const constraint of table.constraints) {
    if (constraint.type === "UNIQUE" && constraint.columns.length > 0) {
      tableConstraints.push(`  UNIQUE (${constraint.columns.join(", ")})`);
    }

    if (constraint.type === "CHECK" && constraint.expression) {
      tableConstraints.push(`  CHECK (${normalizeSqliteExpression(constraint.expression)})`);
    }

    if (constraint.type === "FOREIGN_KEY" && constraint.columns.length > 0) {
      const columnName = constraint.columns[0];
      if (seenForeignKeys.has(columnName)) {
        continue;
      }

      const column = table.columns.find((item) => item.name === columnName);
      if (column?.referencesTable && column.referencesColumn && existingTables.has(column.referencesTable)) {
        tableConstraints.push(
          `  FOREIGN KEY (${column.name}) REFERENCES ${column.referencesTable}(${column.referencesColumn}) ` +
            `ON DELETE ${normalizeOnDeleteAction(constraint.onDelete)}`
        );
      }
    }
  }

  const allDefinitions = [...definitions, ...tableConstraints].join(",\n");
  return `CREATE TABLE ${table.name} (\n${allDefinitions}\n);`;
}

export function erdToSqliteSql(erd: ERD): string {
  const statements: string[] = [];
  const tableNames = new Set(erd.tables.map(t => t.name));

  for (const table of erd.tables) {
    statements.push(buildCreateTableStatement(table, tableNames));
  }

  for (const table of erd.tables) {
    for (const index of table.indexes) {
      const uniqueKeyword = index.unique ? "UNIQUE " : "";
      statements.push(
        `CREATE ${uniqueKeyword}INDEX IF NOT EXISTS ${index.name} ON ${table.name} (${index.columns.join(", ")});`
      );
    }
  }

  return statements.join("\n\n");
}

export function isColumnAutoPrimaryKey(table: Table, column: Column): boolean {
  return isAutoPrimaryKey(table, column);
}

export function columnTypeIsInteger(dataType: string): boolean {
  return isIntegerType(dataType);
}
