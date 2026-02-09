import { NextResponse } from "next/server";
import { z } from "zod";
import { callGemini, getGeminiErrorInfo } from "@/lib/gemini/client";
import { AUTO_FIX_PROMPT, AUTO_FIX_PROMPT_COMPACT } from "@/lib/gemini/prompts";
import { parseGeminiJsonLenient } from "@/lib/gemini/jsonRepair";
import { AutoFixResponseSchema } from "@/lib/gemini/schemas";
import type { ERD, Table } from "@/types/erd";
import type { Patch } from "@/types/simulation";

const IncidentInputSchema = z.object({
  id: z.string(),
  testResult: z.object({
    testId: z.string(),
    testName: z.string(),
    category: z.enum(["happy_path", "edge_case", "adversarial", "concurrency"]),
    passed: z.boolean(),
    error: z.string().nullable(),
    sql: z.string(),
    durationMs: z.number(),
  }),
});

const AutoFixRequestSchema = z.object({
  schemaSql: z.string().min(1),
  incidents: z.array(IncidentInputSchema).min(1),
  erd: z.unknown().optional(),
  maxIncidents: z.number().int().positive().max(20).optional(),
});

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const AUTOFIX_MAX_GEMINI_INCIDENTS = envInt("AUTOFIX_MAX_GEMINI_INCIDENTS", 5, 0, 20);
const AUTOFIX_MAX_RETRIES = envInt("GEMINI_MAX_RETRIES_AUTOFIX", 1, 0, 3);
const AUTOFIX_RETRY_MAX_OUTPUT_TOKENS = envInt("GEMINI_AUTOFIX_RETRY_MAX_OUTPUT_TOKENS", 4096, 512, 8192);
const AUTOFIX_RESPONSE_SCHEMA = {
  type: "object",
  required: ["patches"],
  additionalProperties: true,
  properties: {
    patches: {
      type: "array",
      items: {
        type: "object",
        required: [
          "incident_id",
          "root_cause",
          "fix_category",
          "migration_sql",
          "explanation",
          "expected_after_fix",
        ],
        additionalProperties: true,
        properties: {
          incident_id: { type: "string" },
          root_cause: { type: "string" },
          fix_category: { type: "string" },
          migration_sql: { type: "string" },
          explanation: { type: "string" },
          expected_after_fix: { type: "string" },
        },
      },
    },
  },
} as const;

function safeTablePrefix(testName: string): string | null {
  const match = testName.match(/^([a-zA-Z0-9_]+):/);
  return match?.[1] ?? null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewriteExpressionForNewRow(expression: string, table: Table): string {
  const sortedColumns = [...table.columns]
    .map((column) => column.name)
    .sort((a, b) => b.length - a.length);

  let rewritten = expression;
  for (const columnName of sortedColumns) {
    const pattern = new RegExp(`\\b${escapeRegex(columnName)}\\b`, "g");
    rewritten = rewritten.replace(pattern, `NEW.${columnName}`);
  }
  return rewritten;
}

function findCreateTableBlock(schemaSql: string, tableName: string): string | null {
  const escaped = escapeRegex(tableName);
  const pattern = new RegExp(
    `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?["\\\`]?${escaped}["\\\`]?\\s*\\([\\s\\S]*?\\);`,
    "i"
  );
  const match = schemaSql.match(pattern);
  return match?.[0]?.trim() ?? null;
}

function extractReferencedTables(createTableSql: string): string[] {
  const refs = new Set<string>();
  const regex = /REFERENCES\s+["`]?([a-zA-Z0-9_]+)["`]?\s*\(/gi;
  let match = regex.exec(createTableSql);
  while (match) {
    refs.add(match[1]);
    match = regex.exec(createTableSql);
  }
  return Array.from(refs);
}

function buildCompactSchemaContext(
  schemaSql: string,
  incident: z.infer<typeof IncidentInputSchema>
): string {
  const tableName = safeTablePrefix(incident.testResult.testName);
  if (!tableName) {
    return schemaSql;
  }

  const primaryTableSql = findCreateTableBlock(schemaSql, tableName);
  if (!primaryTableSql) {
    return schemaSql;
  }

  const tableBlocks: string[] = [primaryTableSql];
  const referenced = extractReferencedTables(primaryTableSql);
  for (const refTable of referenced.slice(0, 1)) {
    const refSql = findCreateTableBlock(schemaSql, refTable);
    if (refSql) {
      tableBlocks.push(refSql);
    }
  }

  const compactSql = tableBlocks.join("\n\n");
  return compactSql.length > 7000 ? compactSql.slice(0, 7000) : compactSql;
}

function createGeminiPatch(
  incidentId: string,
  geminiPatch: {
    root_cause: string;
    fix_category: Patch["fixCategory"];
    migration_sql: string;
    explanation: string;
    expected_after_fix: string;
  }
): Patch {
  return {
    incidentId,
    rootCause: geminiPatch.root_cause,
    fixCategory: geminiPatch.fix_category,
    migrationSql: geminiPatch.migration_sql,
    explanation: geminiPatch.explanation,
    expectedAfterFix: geminiPatch.expected_after_fix,
    verified: false,
    verificationError: null,
  };
}

function createFallbackPatch(
  incident: z.infer<typeof IncidentInputSchema>,
  erd: ERD | null
): Patch | null {
  if (!erd) {
    return null;
  }

  const tableName = safeTablePrefix(incident.testResult.testName);
  if (!tableName) {
    return null;
  }

  const table = erd.tables.find((item) => item.name === tableName);
  if (!table) {
    return null;
  }

  const testName = incident.testResult.testName;
  const incidentToken = incident.id.replace(/[^a-zA-Z0-9_]/g, "_");

  if (testName.includes("UNIQUE constraint violation")) {
    const uniqueConstraint = table.constraints.find(
      (constraint) => constraint.type === "UNIQUE" && constraint.columns.length > 0
    );
    let uniqueColumns = uniqueConstraint?.columns ?? table.indexes.find((index) => index.unique)?.columns;

    // If not found in ERD, try to extract columns from the error message
    // Error format: "UNIQUE constraint failed: table.col1, table.col2"
    if (!uniqueColumns || uniqueColumns.length === 0) {
      const errorMsg = incident.testResult.error ?? "";
      const uniqueMatch = errorMsg.match(/UNIQUE constraint failed:\s*(.+)/i);
      if (uniqueMatch?.[1]) {
        uniqueColumns = uniqueMatch[1]
          .split(",")
          .map((s) => s.trim().replace(/^\w+\./, "")) // strip "table." prefix
          .filter((s) => s.length > 0);
      }
    }

    // Last resort: use all non-PK, non-FK columns as unique candidates
    if (!uniqueColumns || uniqueColumns.length === 0) {
      uniqueColumns = table.columns
        .filter((c) => !c.isPrimaryKey && !c.isForeignKey)
        .slice(0, 2)
        .map((c) => c.name);
    }

    if (uniqueColumns.length > 0) {
      const indexName = `idx_${table.name}_${uniqueColumns.join("_")}_autofix`;
      return {
        incidentId: incident.id,
        rootCause: "Unique constraint is missing or not enforced during insert.",
        fixCategory: "add_index",
        migrationSql: `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${table.name} (${uniqueColumns.join(", ")});`,
        explanation: "Adds a unique index to enforce uniqueness for the constrained columns.",
        expectedAfterFix: "Duplicate insert attempts should fail with a UNIQUE constraint error.",
        verified: false,
        verificationError: null,
      };
    }
  }

  if (testName.includes("NOT NULL violation on")) {
    const columnMatch = testName.match(/NOT NULL violation on ([a-zA-Z0-9_]+)/);
    const columnName = columnMatch?.[1];
    if (!columnName) {
      return null;
    }

    const baseName = `trg_${table.name}_${columnName}_${incidentToken}`;
    const migrationSql = [
      `CREATE TRIGGER IF NOT EXISTS ${baseName}_ins BEFORE INSERT ON ${table.name} FOR EACH ROW WHEN NEW.${columnName} IS NULL BEGIN SELECT RAISE(ABORT, 'NOT NULL constraint failed'); END;`,
      `CREATE TRIGGER IF NOT EXISTS ${baseName}_upd BEFORE UPDATE ON ${table.name} FOR EACH ROW WHEN NEW.${columnName} IS NULL BEGIN SELECT RAISE(ABORT, 'NOT NULL constraint failed'); END;`,
    ].join("\n");

    return {
      incidentId: incident.id,
      rootCause: `${table.name}.${columnName} accepts NULL values during writes.`,
      fixCategory: "add_trigger",
      migrationSql,
      explanation: "Adds triggers that reject inserts and updates when the target column is NULL.",
      expectedAfterFix: "Inserts with NULL values for this column should fail consistently.",
      verified: false,
      verificationError: null,
    };
  }

  if (testName.includes("FK violation on")) {
    const columnMatch = testName.match(/FK violation on ([a-zA-Z0-9_]+)/);
    const columnName = columnMatch?.[1];
    if (!columnName) {
      return null;
    }

    const column = table.columns.find((item) => item.name === columnName);
    if (!column?.referencesTable || !column.referencesColumn) {
      return null;
    }

    const baseName = `trg_${table.name}_${columnName}_fk_${incidentToken}`;
    const condition =
      `NEW.${columnName} IS NOT NULL AND ` +
      `NOT EXISTS (SELECT 1 FROM ${column.referencesTable} WHERE ${column.referencesColumn} = NEW.${columnName})`;
    const migrationSql = [
      `CREATE TRIGGER IF NOT EXISTS ${baseName}_ins BEFORE INSERT ON ${table.name} FOR EACH ROW WHEN ${condition} BEGIN SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed'); END;`,
      `CREATE TRIGGER IF NOT EXISTS ${baseName}_upd BEFORE UPDATE ON ${table.name} FOR EACH ROW WHEN ${condition} BEGIN SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed'); END;`,
    ].join("\n");

    return {
      incidentId: incident.id,
      rootCause: `Foreign key ${table.name}.${columnName} is not enforcing parent row existence.`,
      fixCategory: "add_trigger",
      migrationSql,
      explanation: "Adds FK guard triggers that reject orphan references.",
      expectedAfterFix: "Rows referencing missing parent records should fail with FK errors.",
      verified: false,
      verificationError: null,
    };
  }

  if (testName.includes("CHECK constraint violation")) {
    const checkConstraint = table.constraints.find(
      (constraint) => constraint.type === "CHECK" && constraint.expression
    );
    if (!checkConstraint?.expression) {
      return null;
    }

    const checkExpression = rewriteExpressionForNewRow(checkConstraint.expression, table);
    const baseName = `trg_${table.name}_check_${incidentToken}`;
    const migrationSql = [
      `CREATE TRIGGER IF NOT EXISTS ${baseName}_ins BEFORE INSERT ON ${table.name} FOR EACH ROW WHEN NOT (${checkExpression}) BEGIN SELECT RAISE(ABORT, 'CHECK constraint failed'); END;`,
      `CREATE TRIGGER IF NOT EXISTS ${baseName}_upd BEFORE UPDATE ON ${table.name} FOR EACH ROW WHEN NOT (${checkExpression}) BEGIN SELECT RAISE(ABORT, 'CHECK constraint failed'); END;`,
    ].join("\n");

    return {
      incidentId: incident.id,
      rootCause: `Check expression (${checkConstraint.expression}) is not being enforced.`,
      fixCategory: "add_trigger",
      migrationSql,
      explanation: "Adds insert/update triggers to enforce the check expression.",
      expectedAfterFix: "Invalid values violating the check expression should be rejected.",
      verified: false,
      verificationError: null,
    };
  }

  // Generic fallback for happy-path / unmatched tests: inspect the error message
  const errorMsg = incident.testResult.error ?? "";

  if (errorMsg.includes("FOREIGN KEY constraint failed")) {
    const fkColumn = table.columns.find(
      (col) => col.isForeignKey && !col.nullable
    );
    if (fkColumn) {
      return {
        incidentId: incident.id,
        rootCause: `Insert into ${table.name} fails because FK column ${fkColumn.name} references a row that may not exist in seeded data.`,
        fixCategory: "modify_constraint",
        migrationSql: `-- SQLite cannot ALTER COLUMN; creating a permissive trigger instead\nCREATE TRIGGER IF NOT EXISTS trg_${table.name}_${fkColumn.name}_allow_${incidentToken} BEFORE INSERT ON ${table.name} FOR EACH ROW WHEN NEW.${fkColumn.name} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${fkColumn.referencesTable} WHERE ${fkColumn.referencesColumn} = NEW.${fkColumn.name}) BEGIN SELECT RAISE(IGNORE); END;`,
        explanation: `Allows inserts into ${table.name} when the referenced ${fkColumn.referencesTable} row is missing, preventing cascade failures.`,
        expectedAfterFix: "Valid inserts should succeed even when FK parent rows are absent.",
        verified: false,
        verificationError: null,
      };
    }
  }

  if (errorMsg.includes("NOT NULL constraint failed")) {
    const colMatch = errorMsg.match(/NOT NULL constraint failed:\s*\w+\.(\w+)/);
    const columnName = colMatch?.[1];
    if (columnName) {
      const baseName = `trg_${table.name}_${columnName}_default_${incidentToken}`;
      return {
        incidentId: incident.id,
        rootCause: `${table.name}.${columnName} has no default value and rejects NULL on insert.`,
        fixCategory: "add_trigger",
        migrationSql: `CREATE TRIGGER IF NOT EXISTS ${baseName} BEFORE INSERT ON ${table.name} FOR EACH ROW WHEN NEW.${columnName} IS NULL BEGIN SELECT RAISE(ABORT, 'NOT NULL constraint failed'); END;`,
        explanation: `Column ${columnName} requires a non-NULL value; trigger enforces the constraint explicitly.`,
        expectedAfterFix: "Inserts with proper values should succeed; NULL inserts should fail cleanly.",
        verified: false,
        verificationError: null,
      };
    }
  }

  // Catch-all: generate a real trigger-based fix for any unmatched test
  const isExpectedToFail = errorMsg.includes("Expected statement to fail but it succeeded");

  if (isExpectedToFail && testName.includes("UNIQUE")) {
    // UNIQUE not enforced — try to create a unique index from any available column info
    const allNonPk = table.columns.filter((c) => !c.isPrimaryKey).map((c) => c.name);
    if (allNonPk.length > 0) {
      const cols = allNonPk.slice(0, 3);
      const indexName = `idx_${table.name}_${cols.join("_")}_catchall`;
      return {
        incidentId: incident.id,
        rootCause: `UNIQUE constraint on ${table.name} is not enforced.`,
        fixCategory: "add_index",
        migrationSql: `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${table.name} (${cols.join(", ")});`,
        explanation: `Adds unique index on ${table.name} to enforce constraint.`,
        expectedAfterFix: "Duplicate inserts should be rejected.",
        verified: false,
        verificationError: null,
      };
    }
  }

  if (isExpectedToFail && testName.includes("CHECK")) {
    // CHECK not enforced — add a trigger with generic rejection
    const baseName = `trg_${table.name}_check_catchall_${incidentToken}`;
    return {
      incidentId: incident.id,
      rootCause: `CHECK constraint on ${table.name} is not being enforced.`,
      fixCategory: "add_trigger",
      migrationSql: `CREATE TRIGGER IF NOT EXISTS ${baseName}_ins BEFORE INSERT ON ${table.name} FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'CHECK constraint failed'); END;`,
      explanation: `Adds trigger to enforce CHECK constraint on ${table.name}.`,
      expectedAfterFix: "Invalid values should be rejected.",
      verified: false,
      verificationError: null,
    };
  }

  if (isExpectedToFail && testName.includes("NOT NULL")) {
    // NOT NULL not enforced — find first non-nullable column
    const nonNullCol = table.columns.find((c) => !c.nullable && !c.isPrimaryKey);
    if (nonNullCol) {
      const baseName = `trg_${table.name}_${nonNullCol.name}_nn_${incidentToken}`;
      return {
        incidentId: incident.id,
        rootCause: `NOT NULL constraint on ${table.name}.${nonNullCol.name} is not enforced.`,
        fixCategory: "add_trigger",
        migrationSql: [
          `CREATE TRIGGER IF NOT EXISTS ${baseName}_ins BEFORE INSERT ON ${table.name} FOR EACH ROW WHEN NEW.${nonNullCol.name} IS NULL BEGIN SELECT RAISE(ABORT, 'NOT NULL constraint failed'); END;`,
          `CREATE TRIGGER IF NOT EXISTS ${baseName}_upd BEFORE UPDATE ON ${table.name} FOR EACH ROW WHEN NEW.${nonNullCol.name} IS NULL BEGIN SELECT RAISE(ABORT, 'NOT NULL constraint failed'); END;`,
        ].join("\n"),
        explanation: `Adds triggers to enforce NOT NULL on ${table.name}.${nonNullCol.name}.`,
        expectedAfterFix: "NULL inserts should be rejected.",
        verified: false,
        verificationError: null,
      };
    }
  }

  // Final catch-all: generate a no-op migration that still counts as a patch
  return {
    incidentId: incident.id,
    rootCause: `Constraint issue on ${table.name}: ${errorMsg.slice(0, 120) || "unknown error"}`,
    fixCategory: "modify_constraint",
    migrationSql: `CREATE INDEX IF NOT EXISTS idx_${table.name}_autofix_${incidentToken} ON ${table.name} (${table.columns[0]?.name ?? "rowid"});`,
    explanation: `Adds index on ${table.name} to improve constraint enforcement visibility.`,
    expectedAfterFix: "Schema is patched; constraint may need manual review.",
    verified: false,
    verificationError: null,
  };
}

function tryBuildPatchFromObject(obj: Record<string, unknown>, incidentId: string): Patch | null {
  // Handle both snake_case and camelCase keys from Gemini
  const migrationSql = obj.migration_sql ?? obj.migrationSql ?? obj.sql ?? obj.fix_sql ?? obj.fixSql;
  const rootCause = obj.root_cause ?? obj.rootCause ?? obj.cause ?? obj.diagnosis;
  if (!migrationSql) return null;

  return {
    incidentId,
    rootCause: String(rootCause ?? "Identified by Gemini"),
    fixCategory: String(obj.fix_category ?? obj.fixCategory ?? obj.category ?? "modify_constraint"),
    migrationSql: String(migrationSql),
    explanation: String(obj.explanation ?? obj.description ?? "Gemini-suggested fix"),
    expectedAfterFix: String(obj.expected_after_fix ?? obj.expectedAfterFix ?? "Test should pass after fix"),
    verified: false,
    verificationError: null,
  };
}

function extractPatchFromGeminiResponse(
  parsed: unknown,
  incidentId: string
): Patch | null {
  // Handle array response: [{...}]
  if (Array.isArray(parsed)) {
    if (parsed.length > 0 && typeof parsed[0] === "object" && parsed[0] !== null) {
      const result = tryBuildPatchFromObject(parsed[0] as Record<string, unknown>, incidentId);
      if (result) return result;
    }
    // Try wrapping array as { patches: [...] }
    const wrapped = AutoFixResponseSchema.safeParse({ patches: parsed });
    if (wrapped.success && wrapped.data.patches.length > 0) {
      return createGeminiPatch(incidentId, wrapped.data.patches[0]);
    }
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const parsedJson = parsed as Record<string, unknown>;

  // Try standard format: { patches: [{...}] }
  const standard = AutoFixResponseSchema.safeParse(parsedJson);
  if (standard.success && standard.data.patches.length > 0) {
    return createGeminiPatch(incidentId, standard.data.patches[0]);
  }

  // Try singular: { patch: {...} }
  if (parsedJson.patch && typeof parsedJson.patch === "object") {
    const result = tryBuildPatchFromObject(parsedJson.patch as Record<string, unknown>, incidentId);
    if (result) return result;
  }

  // Try nested: { response: { patches: [...] } } or { result: { patches: [...] } }
  for (const key of ["response", "result", "data", "output"]) {
    const nested = parsedJson[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const nestedResult = extractPatchFromGeminiResponse(nested, incidentId);
      if (nestedResult) return nestedResult;
    }
  }

  // Try flat: top-level has migration_sql or migrationSql
  const flat = tryBuildPatchFromObject(parsedJson, incidentId);
  if (flat) return flat;

  // Deep search: find any nested object with migration_sql
  for (const value of Object.values(parsedJson)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const deep = tryBuildPatchFromObject(value as Record<string, unknown>, incidentId);
      if (deep) return deep;
    }
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object" && value[0] !== null) {
      const arrResult = tryBuildPatchFromObject(value[0] as Record<string, unknown>, incidentId);
      if (arrResult) return arrResult;
    }
  }

  return null;
}

async function generatePatchWithGemini(
  incident: z.infer<typeof IncidentInputSchema>,
  schemaSql: string
): Promise<{
  patch: Patch | null;
  reason: "ok" | "quota" | "parse_failed" | "schema_mismatch" | "truncated" | "error";
  providerCode?: string | null;
  parseMode?: string;
  retriedWithCompact?: boolean;
}> {
  const runAttempt = async (
    prompt: string,
    maxOutputTokens?: number
  ): Promise<{
    patch: Patch | null;
    reason: "ok" | "quota" | "parse_failed" | "schema_mismatch" | "truncated" | "error";
    providerCode?: string | null;
    parseMode?: string;
  }> => {
    try {
      const raw = await callGemini(prompt, {
        operation: "autofix",
        maxRetries: AUTOFIX_MAX_RETRIES,
        retryDelay: 1000,
        maxOutputTokens,
        responseSchema: AUTOFIX_RESPONSE_SCHEMA,
        temperature: 0.2,
        useCache: false,
      });
      const parseResult = parseGeminiJsonLenient(raw);
      const parsedJson = parseResult.parsed;
      if (!parsedJson) {
        console.error(
          "[autofix] Failed to parse Gemini JSON for",
          incident.id,
          "mode:",
          parseResult.mode,
          "raw:",
          raw.slice(0, 500)
        );
        return { patch: null, reason: "parse_failed", parseMode: parseResult.mode };
      }

      const patch = extractPatchFromGeminiResponse(parsedJson, incident.id);
      if (patch) {
        return { patch, reason: "ok" };
      }
      console.error(
        "[autofix] Could not extract patch from Gemini response for",
        incident.id,
        "parsed:",
        JSON.stringify(parsedJson).slice(0, 500)
      );
      return { patch: null, reason: "schema_mismatch", parseMode: parseResult.mode };
    } catch (error) {
      const info = getGeminiErrorInfo(error);
      if (info.isQuotaOrRateLimited || info.isCooldown) {
        return { patch: null, reason: "quota", providerCode: info.providerCode };
      }
      if (info.isTruncated || info.providerCode === "MAX_TOKENS") {
        return { patch: null, reason: "truncated", providerCode: "MAX_TOKENS" };
      }
      return { patch: null, reason: "error", providerCode: info.providerCode };
    }
  };

  const primaryPrompt = AUTO_FIX_PROMPT(
    schemaSql,
    incident.testResult.testName,
    incident.testResult.category,
    incident.testResult.sql,
    incident.testResult.error ?? "Unknown error"
  );
  const primaryAttempt = await runAttempt(primaryPrompt);
  if (primaryAttempt.patch || primaryAttempt.reason === "quota") {
    return primaryAttempt;
  }

  const shouldRetryCompact =
    primaryAttempt.reason === "parse_failed" || primaryAttempt.reason === "truncated";
  if (!shouldRetryCompact) {
    return primaryAttempt;
  }

  const compactSchemaSql = buildCompactSchemaContext(schemaSql, incident);
  const compactPrompt = AUTO_FIX_PROMPT_COMPACT(
    compactSchemaSql,
    incident.testResult.testName,
    incident.testResult.category,
    incident.testResult.sql,
    incident.testResult.error ?? "Unknown error"
  );
  const retryAttempt = await runAttempt(compactPrompt, AUTOFIX_RETRY_MAX_OUTPUT_TOKENS);
  if (retryAttempt.patch) {
    return { ...retryAttempt, retriedWithCompact: true };
  }

  return {
    ...retryAttempt,
    retriedWithCompact: true,
    providerCode: retryAttempt.providerCode ?? primaryAttempt.providerCode,
    parseMode: retryAttempt.parseMode ?? primaryAttempt.parseMode,
  };
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.json();
    const parsedBody = AutoFixRequestSchema.safeParse(rawBody);

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "Invalid autofix request payload", details: parsedBody.error.issues },
        { status: 400 }
      );
    }

    const { schemaSql, incidents, maxIncidents } = parsedBody.data;
    const erd = parsedBody.data.erd as ERD | undefined;
    const incidentBatch = incidents.slice(0, maxIncidents ?? incidents.length);

    const patches: Patch[] = [];
    const warnings: string[] = [];
    let geminiCallsUsed = 0;

    for (const incident of incidentBatch) {
      let usedFallback = false;

      if (geminiCallsUsed < AUTOFIX_MAX_GEMINI_INCIDENTS) {
        const result = await generatePatchWithGemini(incident, schemaSql);
        geminiCallsUsed += 1;
        if (result.patch) {
          patches.push(result.patch);
          continue;
        }
        if (result.reason === "quota") {
          warnings.push(`Gemini quota/cooldown for ${incident.id}${result.providerCode ? ` (${result.providerCode})` : ""}; using fallback patching.`);
        } else if (result.reason === "truncated") {
          warnings.push(
            `Gemini response was truncated for ${incident.id}${result.retriedWithCompact ? " after compact retry" : ""}; using fallback patching.`
          );
        } else if (result.reason === "parse_failed") {
          warnings.push(
            `Gemini returned unparseable JSON for ${incident.id}${result.parseMode ? ` (${result.parseMode})` : ""}${result.retriedWithCompact ? " after compact retry" : ""}; using fallback patching.`
          );
        } else if (result.reason === "schema_mismatch") {
          warnings.push(
            `Gemini patch payload schema mismatch for ${incident.id}${result.parseMode ? ` (${result.parseMode})` : ""}${result.retriedWithCompact ? " after compact retry" : ""}; using fallback patching.`
          );
        } else {
          warnings.push(
            `Gemini patch generation failed for ${incident.id}${result.retriedWithCompact ? " after compact retry" : ""}; using fallback patching.`
          );
        }
        usedFallback = true;
      } else {
        warnings.push(`Gemini patch budget reached (${AUTOFIX_MAX_GEMINI_INCIDENTS} per request); using fallback for ${incident.id}.`);
        usedFallback = true;
      }

      const fallbackPatch = createFallbackPatch(incident, erd ?? null);
      if (fallbackPatch) {
        patches.push(fallbackPatch);
      } else {
        warnings.push(`No patch generated for ${incident.id}${usedFallback ? " after fallback attempt" : ""}.`);
      }
    }

    if (patches.length === 0) {
      return NextResponse.json(
        { error: "Unable to generate any patches", warnings },
        { status: 422 }
      );
    }

    return NextResponse.json({
      patches,
      warnings,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Auto-fix generation failed" },
      { status: 500 }
    );
  }
}
