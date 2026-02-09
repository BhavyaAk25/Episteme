import type { Column, ERD, Table } from "@/types/erd";
import type { Database } from "./sandbox";
import { runQuery, runStatement } from "./sandbox";
import { columnTypeIsInteger, isColumnAutoPrimaryKey } from "./sqlGenerator";

const DEFAULT_ROWS_PER_TABLE = 6;

interface SeedOptions {
  rowsPerTable?: number;
}

interface SeededRowValues {
  [columnName: string]: string;
}

export interface SeedSummary {
  rowsPerTable: number;
  tablesSeeded: number;
  insertedRows: number;
  tableOrder: string[];
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function asSqlString(value: string): string {
  return `'${escapeSqlString(value)}'`;
}

function collectDependencyOrder(erd: ERD): string[] {
  const dependencies = new Map<string, Set<string>>();
  const tableNames = erd.tables.map((table) => table.name);

  for (const tableName of tableNames) {
    dependencies.set(tableName, new Set<string>());
  }

  for (const table of erd.tables) {
    const tableDependencies = dependencies.get(table.name);
    if (!tableDependencies) continue;

    for (const column of table.columns) {
      if (column.isForeignKey && column.referencesTable && column.referencesTable !== table.name) {
        tableDependencies.add(column.referencesTable);
      }
    }
  }

  const resolved: string[] = [];
  const pending = new Set(tableNames);

  while (pending.size > 0) {
    const nextBatch = Array.from(pending).filter((tableName) => {
      const tableDependencies = dependencies.get(tableName);
      if (!tableDependencies) return true;

      for (const dep of tableDependencies) {
        if (pending.has(dep)) return false;
      }
      return true;
    });

    if (nextBatch.length === 0) {
      resolved.push(...Array.from(pending).sort((a, b) => a.localeCompare(b)));
      break;
    }

    nextBatch.sort((a, b) => a.localeCompare(b));
    for (const tableName of nextBatch) {
      pending.delete(tableName);
      resolved.push(tableName);
    }
  }

  return resolved;
}

function collectUniqueColumns(table: Table): Set<string> {
  const uniqueColumns = new Set<string>();

  for (const constraint of table.constraints) {
    if (constraint.type === "UNIQUE") {
      for (const columnName of constraint.columns) {
        uniqueColumns.add(columnName);
      }
    }
  }

  for (const index of table.indexes) {
    if (index.unique) {
      for (const columnName of index.columns) {
        uniqueColumns.add(columnName);
      }
    }
  }

  return uniqueColumns;
}

function inferNumericValue(column: Column, rowIndex: number, unique: boolean): string {
  const name = column.name.toLowerCase();

  if (name.includes("price") || name.includes("cost") || name.includes("amount") || name.includes("total")) {
    return `${(rowIndex + 1) * 12.5}`;
  }
  if (name.includes("quantity") || name.includes("stock") || name.includes("count")) {
    return `${rowIndex + 10}`;
  }
  if (unique) {
    return `${1000 + rowIndex}`;
  }
  return `${rowIndex + 1}`;
}

function inferStringValue(tableName: string, column: Column, rowIndex: number, unique: boolean): string {
  const name = column.name.toLowerCase();

  if (name.includes("email")) {
    return asSqlString(`user${rowIndex + 1}@episteme.dev`);
  }
  if (name.includes("phone")) {
    return asSqlString(`+1-555-01${String(rowIndex + 10).padStart(2, "0")}`);
  }
  if (name.includes("sku") || name.includes("code")) {
    return asSqlString(`${tableName.slice(0, 3).toUpperCase()}-${rowIndex + 1000}`);
  }
  if (name.includes("status")) {
    const statuses = ["active", "pending", "archived"];
    return asSqlString(statuses[rowIndex % statuses.length]);
  }
  if (name.includes("description")) {
    return asSqlString(`Sample description ${rowIndex + 1} for ${tableName}`);
  }
  if (name.includes("name")) {
    return asSqlString(`${tableName.replace(/_/g, " ")} ${rowIndex + 1}`);
  }
  if (name.includes("uuid")) {
    return asSqlString(`00000000-0000-4000-8000-${String(100000000000 + rowIndex).padStart(12, "0")}`);
  }
  if (unique) {
    return asSqlString(`${tableName}_${column.name}_${rowIndex + 1}`);
  }
  return asSqlString(`sample_${column.name}_${rowIndex + 1}`);
}

function inferColumnValue(tableName: string, column: Column, rowIndex: number, uniqueColumns: Set<string>): string {
  const upperType = column.dataType.toUpperCase();
  const name = column.name.toLowerCase();
  const isUnique = uniqueColumns.has(column.name);

  if (name.endsWith("_at") || name.includes("date") || upperType.includes("DATE") || upperType.includes("TIME")) {
    return "CURRENT_TIMESTAMP";
  }

  if (upperType.includes("BOOL") || name.startsWith("is_") || name.startsWith("has_")) {
    return rowIndex % 2 === 0 ? "1" : "0";
  }

  if (columnTypeIsInteger(column.dataType) || upperType.includes("NUMERIC") || upperType.includes("DECIMAL")) {
    return inferNumericValue(column, rowIndex, isUnique);
  }

  if (upperType.includes("FLOAT") || upperType.includes("DOUBLE") || upperType.includes("REAL")) {
    return `${(rowIndex + 1) * 9.75}`;
  }

  return inferStringValue(tableName, column, rowIndex, isUnique);
}

function getInsertableColumns(table: Table): Column[] {
  return table.columns.filter((column) => !isColumnAutoPrimaryKey(table, column));
}

function getLastInsertedId(db: Database): string {
  const result = runQuery(db, "SELECT last_insert_rowid() AS id;");
  if (!result || result.values.length === 0) {
    return "1";
  }

  const rawValue = result.values[0][0];
  return typeof rawValue === "number" ? String(rawValue) : "1";
}

function extractPrimaryKeyLiterals(
  db: Database,
  table: Table,
  insertedValues: SeededRowValues
): SeededRowValues {
  const output: SeededRowValues = {};
  const primaryKeyColumns = table.columns.filter((column) => column.isPrimaryKey);

  for (const column of primaryKeyColumns) {
    if (isColumnAutoPrimaryKey(table, column)) {
      output[column.name] = getLastInsertedId(db);
      continue;
    }

    if (insertedValues[column.name]) {
      output[column.name] = insertedValues[column.name];
    }
  }

  return output;
}

export function seedDatabase(db: Database, erd: ERD, options?: SeedOptions): SeedSummary {
  const rowsPerTable = options?.rowsPerTable ?? DEFAULT_ROWS_PER_TABLE;
  const dependencyOrder = collectDependencyOrder(erd);
  const tableMap = new Map(erd.tables.map((table) => [table.name, table]));
  const seededPrimaryKeys = new Map<string, SeededRowValues[]>();

  let insertedRows = 0;

  for (const tableName of dependencyOrder) {
    const table = tableMap.get(tableName);
    if (!table) continue;

    const uniqueColumns = collectUniqueColumns(table);
    const insertableColumns = getInsertableColumns(table);
    const tablePkRows: SeededRowValues[] = [];

    for (let rowIndex = 0; rowIndex < rowsPerTable; rowIndex += 1) {
      const valueLiterals: SeededRowValues = {};

      for (const column of insertableColumns) {
        if (column.isForeignKey && column.referencesTable && column.referencesColumn) {
          const parentRows = seededPrimaryKeys.get(column.referencesTable) ?? [];
          const selectedParentRow = parentRows[rowIndex % Math.max(parentRows.length, 1)];
          const fkValue = selectedParentRow?.[column.referencesColumn];

          if (fkValue) {
            valueLiterals[column.name] = fkValue;
            continue;
          }

          if (column.nullable) {
            valueLiterals[column.name] = "NULL";
            continue;
          }
        }

        valueLiterals[column.name] = inferColumnValue(table.name, column, rowIndex, uniqueColumns);
      }

      if (insertableColumns.length > 0) {
        const columnsSql = insertableColumns.map((column) => column.name).join(", ");
        const valuesSql = insertableColumns.map((column) => valueLiterals[column.name] ?? "NULL").join(", ");
        runStatement(db, `INSERT INTO ${table.name} (${columnsSql}) VALUES (${valuesSql});`);
      } else {
        runStatement(db, `INSERT INTO ${table.name} DEFAULT VALUES;`);
      }

      const primaryKeyValues = extractPrimaryKeyLiterals(db, table, valueLiterals);
      tablePkRows.push(primaryKeyValues);
      insertedRows += 1;
    }

    seededPrimaryKeys.set(table.name, tablePkRows);
  }

  return {
    rowsPerTable,
    tablesSeeded: dependencyOrder.length,
    insertedRows,
    tableOrder: dependencyOrder,
  };
}
