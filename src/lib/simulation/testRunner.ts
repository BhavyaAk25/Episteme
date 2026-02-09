import type { TestResult, Incident, SimulationResults, TestCase } from "@/types/simulation";
import {
  createSandbox,
  closeSandbox,
  runQuery,
  testSqlThrows,
  createSavepoint,
  rollbackToSavepoint,
  releaseSavepoint,
  type Database,
} from "./sandbox";
import { generateChaosTests } from "./chaosTests";
import type { ERD } from "@/types/erd";
import { erdToSql } from "@/lib/ontology/transformer";
import { erdToSqliteSql } from "./sqlGenerator";
import { seedDatabase } from "./seedGenerator";

function buildSeedPreview(db: Database, erd: ERD): SimulationResults["seedPreview"] {
  const preview: SimulationResults["seedPreview"] = [];

  for (const table of erd.tables) {
    const countResult = runQuery(db, `SELECT COUNT(*) AS count FROM ${table.name};`);
    const totalRows = Number(countResult?.values?.[0]?.[0] ?? 0);

    const sampleResult = runQuery(db, `SELECT * FROM ${table.name} LIMIT 8;`);
    preview.push({
      table: table.name,
      columns: sampleResult?.columns ?? [],
      rows: sampleResult?.values ?? [],
      totalRows,
    });
  }

  return preview;
}

function createTestResult(
  testId: string,
  testName: string,
  category: TestResult["category"],
  passed: boolean,
  sql: string,
  durationMs: number,
  error: string | null
): TestResult {
  return {
    testId,
    testName,
    category,
    passed,
    error,
    sql,
    durationMs,
  };
}

/**
 * Run a single test case using savepoint isolation.
 */
function runSingleTest(db: Database, test: TestCase): TestResult {
  const startedAt = performance.now();
  const savepointName = `sp_${test.id}`;
  let savepointCreated = false;

  try {
    createSavepoint(db, savepointName);
    savepointCreated = true;

    if (test.setupSql.trim()) {
      const setupResult = testSqlThrows(db, test.setupSql);
      if (setupResult.throws) {
        return createTestResult(
          test.id,
          test.name,
          test.category,
          false,
          test.setupSql,
          performance.now() - startedAt,
          `Setup failed: ${setupResult.error ?? "unknown setup error"}`
        );
      }
    }

    const actionResult = testSqlThrows(db, test.actionSql);
    const expectedSuccess = test.expectedResult === "success";
    const passed = expectedSuccess ? !actionResult.throws : actionResult.throws;

    if (!passed) {
      const errorMessage = expectedSuccess
        ? actionResult.error ?? "Expected statement to succeed"
        : "Expected statement to fail but it succeeded";
      return createTestResult(
        test.id,
        test.name,
        test.category,
        false,
        test.actionSql,
        performance.now() - startedAt,
        errorMessage
      );
    }

    if (!expectedSuccess && test.expectedError && !actionResult.error?.includes(test.expectedError)) {
      return createTestResult(
        test.id,
        test.name,
        test.category,
        false,
        test.actionSql,
        performance.now() - startedAt,
        `Expected "${test.expectedError}" but got "${actionResult.error ?? "no error"}"`
      );
    }

    return createTestResult(
      test.id,
      test.name,
      test.category,
      true,
      test.actionSql,
      performance.now() - startedAt,
      null
    );
  } catch (error) {
    return createTestResult(
      test.id,
      test.name,
      test.category,
      false,
      test.actionSql,
      performance.now() - startedAt,
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    if (savepointCreated) {
      try {
        rollbackToSavepoint(db, savepointName);
      } catch {
        // Ignore cleanup failures.
      }
      try {
        releaseSavepoint(db, savepointName);
      } catch {
        // Ignore cleanup failures.
      }
    }
  }
}

/**
 * Run all chaos tests against an ERD.
 */
export async function runSimulation(
  erd: ERD,
  onProgress?: (result: TestResult) => void
): Promise<SimulationResults> {
  const startedAt = Date.now();
  const schemaSql = erdToSql(erd);
  const sqliteSchemaSql = erdToSqliteSql(erd);
  const tests = generateChaosTests(erd);

  if (tests.length === 0) {
    return {
      totalTests: 0,
      passedCount: 0,
      failedCount: 0,
      testResults: [],
      incidents: [],
      seedPreview: [],
      schemaSql,
      startedAt,
      completedAt: Date.now(),
    };
  }

  const db = await createSandbox(sqliteSchemaSql);

  try {
    seedDatabase(db, erd);
    const seedPreview = buildSeedPreview(db, erd);

    const testResults: TestResult[] = [];
    const incidents: Incident[] = [];
    let passedCount = 0;
    let failedCount = 0;

    for (const test of tests) {
      const result = runSingleTest(db, test);
      testResults.push(result);

      if (result.passed) {
        passedCount += 1;
      } else {
        failedCount += 1;
        incidents.push({
          id: `incident_${test.id}`,
          testResult: result,
          status: "open",
          rootCause: null,
          suggestedFix: null,
          patch: null,
          createdAt: Date.now(),
          fixedAt: null,
        });
      }

      onProgress?.(result);
    }

    return {
      totalTests: tests.length,
      passedCount,
      failedCount,
      testResults,
      incidents,
      seedPreview,
      schemaSql,
      startedAt,
      completedAt: Date.now(),
    };
  } finally {
    closeSandbox(db);
  }
}
