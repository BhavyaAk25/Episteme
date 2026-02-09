// Simulation & Verification Types

export type TestCategory = "happy_path" | "edge_case" | "adversarial" | "concurrency";
export type IncidentStatus = "open" | "fixing" | "fixed" | "wont_fix";

export interface TestCase {
  id: string;
  name: string;
  category: TestCategory;
  setupSql: string;
  actionSql: string;
  expectedResult: "success" | "failure";
  expectedError: string | null;
}

export interface TestResult {
  testId: string;
  testName: string;
  category: TestCategory;
  passed: boolean;
  error: string | null;
  sql: string;
  durationMs: number;
}

export interface Incident {
  id: string;
  testResult: TestResult;
  status: IncidentStatus;
  rootCause: string | null;
  suggestedFix: string | null;
  patch: Patch | null;
  createdAt: number;
  fixedAt: number | null;
}

export interface Patch {
  incidentId: string;
  rootCause: string;
  fixCategory: string;
  migrationSql: string;
  explanation: string;
  expectedAfterFix: string;
  beforeSchemaSql?: string;
  afterSchemaSql?: string;
  verified?: boolean;
  verificationError?: string | null;
}

export interface SeedPreviewTable {
  table: string;
  columns: string[];
  rows: unknown[][];
  totalRows: number;
}

export interface SimulationResults {
  totalTests: number;
  passedCount: number;
  failedCount: number;
  testResults: TestResult[];
  incidents: Incident[];
  seedPreview: SeedPreviewTable[];
  schemaSql: string;
  startedAt: number;
  completedAt: number | null;
}
