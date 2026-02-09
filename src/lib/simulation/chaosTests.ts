import type { Column, ERD, Table, TableConstraint } from "@/types/erd";
import type { TestCase } from "@/types/simulation";
import { columnTypeIsInteger, isColumnAutoPrimaryKey } from "./sqlGenerator";

function asSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function getInsertableColumns(table: Table): Column[] {
  return table.columns.filter((column) => !isColumnAutoPrimaryKey(table, column));
}

function inferValidLiteral(column: Column, tableName: string, variant: number): string {
  const name = column.name.toLowerCase();
  const upperType = column.dataType.toUpperCase();

  if (name.endsWith("_at") || name.includes("date") || upperType.includes("DATE") || upperType.includes("TIME")) {
    return "CURRENT_TIMESTAMP";
  }

  if (upperType.includes("BOOL") || name.startsWith("is_") || name.startsWith("has_")) {
    return variant % 2 === 0 ? "1" : "0";
  }

  if (columnTypeIsInteger(column.dataType)) {
    if (name.includes("quantity") || name.includes("stock") || name.includes("count")) {
      return `${variant + 100}`;
    }
    if (name.includes("price") || name.includes("cost") || name.includes("amount") || name.includes("total")) {
      return `${variant + 25}`;
    }
    return `${variant + 10}`;
  }

  if (upperType.includes("NUMERIC") || upperType.includes("DECIMAL") || upperType.includes("REAL") || upperType.includes("FLOAT")) {
    return `${(variant + 1) * 17.5}`;
  }

  if (name.includes("email")) {
    return asSqlString(`qa+${tableName}_${variant}@episteme.dev`);
  }
  if (name.includes("sku") || name.includes("code")) {
    return asSqlString(`${tableName.slice(0, 3).toUpperCase()}-${variant + 2000}`);
  }
  if (name.includes("status")) {
    return asSqlString("active");
  }
  if (name.includes("name")) {
    return asSqlString(`${tableName.replace(/_/g, " ")} test ${variant}`);
  }
  if (name.includes("description")) {
    return asSqlString(`Generated test payload ${variant}`);
  }

  return asSqlString(`${tableName}_${column.name}_${variant}`);
}

function inferInvalidForeignKeyLiteral(column: Column): string {
  if (columnTypeIsInteger(column.dataType)) {
    return "-999999";
  }
  return asSqlString("__missing_fk_reference__");
}

function inferCheckViolationLiteral(column: Column): string {
  const upperType = column.dataType.toUpperCase();

  if (columnTypeIsInteger(column.dataType) || upperType.includes("NUMERIC") || upperType.includes("DECIMAL")) {
    return "-1";
  }
  if (upperType.includes("BOOL")) {
    return "0";
  }
  return asSqlString("");
}

function valueForColumn(
  column: Column,
  tableName: string,
  variant: number,
  overrides: Record<string, string>
): string {
  const explicit = overrides[column.name];
  if (explicit !== undefined) {
    return explicit;
  }

  if (column.isForeignKey && column.referencesTable && column.referencesColumn) {
    return `(SELECT ${column.referencesColumn} FROM ${column.referencesTable} LIMIT 1)`;
  }

  return inferValidLiteral(column, tableName, variant);
}

function buildInsertStatement(
  table: Table,
  variant: number,
  overrides: Record<string, string>
): string {
  const columns = getInsertableColumns(table);
  if (columns.length === 0) {
    return `INSERT INTO ${table.name} DEFAULT VALUES;`;
  }

  const columnSql = columns.map((column) => column.name).join(", ");
  const valueSql = columns
    .map((column) => valueForColumn(column, table.name, variant, overrides))
    .join(", ");

  return `INSERT INTO ${table.name} (${columnSql}) VALUES (${valueSql});`;
}

function buildUniqueViolationSql(
  table: Table,
  constraint: TableConstraint,
  variant: number
): string {
  const overrides: Record<string, string> = {};
  for (const columnName of constraint.columns) {
    overrides[columnName] = `(SELECT ${columnName} FROM ${table.name} LIMIT 1)`;
  }
  return buildInsertStatement(table, variant, overrides);
}

function buildNotNullViolationSql(
  table: Table,
  targetColumn: Column,
  variant: number
): string {
  return buildInsertStatement(table, variant, {
    [targetColumn.name]: "NULL",
  });
}

function buildForeignKeyViolationSql(
  table: Table,
  targetColumn: Column,
  variant: number
): string {
  return buildInsertStatement(table, variant, {
    [targetColumn.name]: inferInvalidForeignKeyLiteral(targetColumn),
  });
}

function buildCheckViolationSql(
  table: Table,
  constraint: TableConstraint,
  variant: number
): string | null {
  const columns = getInsertableColumns(table);
  const targetColumnName = constraint.columns.find((columnName) =>
    columns.some((column) => column.name === columnName)
  );

  if (!targetColumnName) {
    return null;
  }

  const targetColumn = columns.find((column) => column.name === targetColumnName);
  if (!targetColumn) {
    return null;
  }

  return buildInsertStatement(table, variant, {
    [targetColumn.name]: inferCheckViolationLiteral(targetColumn),
  });
}

function shouldSkipValidInsert(table: Table): boolean {
  const foreignKeyColumnNames = new Set(
    table.columns.filter((column) => column.isForeignKey).map((column) => column.name)
  );

  return table.constraints.some((constraint) => {
    if (constraint.type !== "UNIQUE" || constraint.columns.length === 0) {
      return false;
    }
    return constraint.columns.every((columnName) => foreignKeyColumnNames.has(columnName));
  });
}

/**
 * Generate chaos test cases from an ERD.
 * Tests run against a pre-seeded database and are isolated via savepoints.
 */
export function generateChaosTests(erd: ERD): TestCase[] {
  const tests: TestCase[] = [];
  let testCounter = 1;

  for (const table of erd.tables) {
    const insertableColumns = getInsertableColumns(table);
    if (insertableColumns.length === 0) {
      tests.push({
        id: `test_${testCounter++}`,
        name: `${table.name}: default insert (happy path)`,
        category: "happy_path",
        setupSql: "",
        actionSql: `INSERT INTO ${table.name} DEFAULT VALUES;`,
        expectedResult: "success",
        expectedError: null,
      });
      continue;
    }

    const uniqueConstraints = table.constraints.filter((constraint) => constraint.type === "UNIQUE");
    for (const constraint of uniqueConstraints) {
      tests.push({
        id: `test_${testCounter++}`,
        name: `${table.name}: UNIQUE constraint violation`,
        category: "adversarial",
        setupSql: "",
        actionSql: buildUniqueViolationSql(table, constraint, testCounter),
        expectedResult: "failure",
        expectedError: "UNIQUE constraint failed",
      });
    }

    const notNullColumns = insertableColumns.filter(
      (column) => !column.nullable && !column.defaultValue
    );
    for (const column of notNullColumns) {
      tests.push({
        id: `test_${testCounter++}`,
        name: `${table.name}: NOT NULL violation on ${column.name}`,
        category: "adversarial",
        setupSql: "",
        actionSql: buildNotNullViolationSql(table, column, testCounter),
        expectedResult: "failure",
        expectedError: "NOT NULL constraint failed",
      });
    }

    const foreignKeyColumns = insertableColumns.filter((column) => column.isForeignKey);
    for (const column of foreignKeyColumns) {
      tests.push({
        id: `test_${testCounter++}`,
        name: `${table.name}: FK violation on ${column.name}`,
        category: "adversarial",
        setupSql: "",
        actionSql: buildForeignKeyViolationSql(table, column, testCounter),
        expectedResult: "failure",
        expectedError: "FOREIGN KEY constraint failed",
      });
    }

    const checkConstraints = table.constraints.filter(
      (constraint) => constraint.type === "CHECK" && constraint.expression
    );
    for (const constraint of checkConstraints) {
      const actionSql = buildCheckViolationSql(table, constraint, testCounter);
      if (!actionSql) continue;

      tests.push({
        id: `test_${testCounter++}`,
        name: `${table.name}: CHECK constraint violation`,
        category: "adversarial",
        setupSql: "",
        actionSql,
        expectedResult: "failure",
        expectedError: "CHECK constraint failed",
      });
    }

    if (!shouldSkipValidInsert(table)) {
      tests.push({
        id: `test_${testCounter++}`,
        name: `${table.name}: valid insert`,
        category: "happy_path",
        setupSql: "",
        actionSql: buildInsertStatement(table, testCounter + 1000, {}),
        expectedResult: "success",
        expectedError: null,
      });
    }
  }

  return tests;
}
