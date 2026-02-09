import type { ERD } from "@/types/erd";
import type { Patch, TestCase, TestResult } from "@/types/simulation";
import {
  createSandbox,
  closeSandbox,
  testSqlThrows,
  testSqlScriptThrows,
  createSavepoint,
  rollbackToSavepoint,
  releaseSavepoint,
  type Database,
} from "./sandbox";
import { erdToSqliteSql } from "./sqlGenerator";
import { generateChaosTests } from "./chaosTests";
import { seedDatabase } from "./seedGenerator";

function runSingleTest(db: Database, test: TestCase): TestResult {
  const startedAt = performance.now();
  const savepointName = `verify_${test.id}`;
  let savepointCreated = false;

  try {
    createSavepoint(db, savepointName);
    savepointCreated = true;

    if (test.setupSql.trim()) {
      const setupResult = testSqlThrows(db, test.setupSql);
      if (setupResult.throws) {
        return {
          testId: test.id,
          testName: test.name,
          category: test.category,
          passed: false,
          error: `Setup failed: ${setupResult.error ?? "unknown setup error"}`,
          sql: test.setupSql,
          durationMs: performance.now() - startedAt,
        };
      }
    }

    const actionResult = testSqlThrows(db, test.actionSql);
    const expectedSuccess = test.expectedResult === "success";
    const passed = expectedSuccess ? !actionResult.throws : actionResult.throws;

    if (!passed) {
      return {
        testId: test.id,
        testName: test.name,
        category: test.category,
        passed: false,
        error: expectedSuccess
          ? actionResult.error ?? "Expected statement to succeed"
          : "Expected statement to fail but it succeeded",
        sql: test.actionSql,
        durationMs: performance.now() - startedAt,
      };
    }

    if (!expectedSuccess && test.expectedError && !actionResult.error?.includes(test.expectedError)) {
      return {
        testId: test.id,
        testName: test.name,
        category: test.category,
        passed: false,
        error: `Expected "${test.expectedError}" but got "${actionResult.error ?? "no error"}"`,
        sql: test.actionSql,
        durationMs: performance.now() - startedAt,
      };
    }

    return {
      testId: test.id,
      testName: test.name,
      category: test.category,
      passed: true,
      error: null,
      sql: test.actionSql,
      durationMs: performance.now() - startedAt,
    };
  } catch (error) {
    return {
      testId: test.id,
      testName: test.name,
      category: test.category,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
      sql: test.actionSql,
      durationMs: performance.now() - startedAt,
    };
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

export interface PatchVerification {
  patch: Patch;
  applied: boolean;
  error: string | null;
}

export interface AutoFixVerificationSummary {
  testResults: TestResult[];
  passedCount: number;
  failedCount: number;
  totalTests: number;
  patchVerifications: PatchVerification[];
  testResultById: Record<string, TestResult>;
}

export async function verifyPatchedSchema(
  erd: ERD,
  patches: Patch[]
): Promise<AutoFixVerificationSummary> {
  const sqliteSchemaSql = erdToSqliteSql(erd);
  const db = await createSandbox(sqliteSchemaSql);

  try {
    seedDatabase(db, erd);

    const patchVerifications: PatchVerification[] = [];
    for (const patch of patches) {
      const result = testSqlScriptThrows(db, patch.migrationSql);
      const patchError = result.throws ? (result.error ?? null) : null;

      patchVerifications.push({
        patch,
        applied: !patchError,
        error: patchError,
      });
    }

    const tests = generateChaosTests(erd);
    const testResults: TestResult[] = [];
    const testResultById: Record<string, TestResult> = {};
    let passedCount = 0;
    let failedCount = 0;

    for (const test of tests) {
      const result = runSingleTest(db, test);
      testResults.push(result);
      testResultById[test.id] = result;

      if (result.passed) {
        passedCount += 1;
      } else {
        failedCount += 1;
      }
    }

    return {
      testResults,
      passedCount,
      failedCount,
      totalTests: tests.length,
      patchVerifications,
      testResultById,
    };
  } finally {
    closeSandbox(db);
  }
}
