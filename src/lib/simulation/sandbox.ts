"use client";

interface SqlJsExecResult {
  columns: string[];
  values: unknown[][];
}

export interface Database {
  run(sql: string): void;
  exec(sql: string): SqlJsExecResult[];
  close(): void;
  export(): Uint8Array;
}

interface SqlJsStatic {
  Database: new () => Database;
}

type InitSqlJs = (config?: {
  locateFile?: (file: string) => string;
}) => Promise<SqlJsStatic>;

declare global {
  interface Window {
    initSqlJs?: InitSqlJs;
  }
}

const SQL_JS_SCRIPT_PATH = "/sql-wasm.js";
const SQL_JS_WASM_PATH = "/sql-wasm.wasm";

let sqlInstance: SqlJsStatic | null = null;
let sqlInitPromise: Promise<SqlJsStatic> | null = null;
let sqlScriptLoadPromise: Promise<void> | null = null;

async function ensureSqlJsScriptLoaded(): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("sql.js can only run in the browser.");
  }

  if (window.initSqlJs) {
    return;
  }

  if (!sqlScriptLoadPromise) {
    sqlScriptLoadPromise = new Promise<void>((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>(
        `script[data-sqljs-loader="true"]`
      );
      if (existingScript) {
        existingScript.addEventListener("load", () => resolve(), { once: true });
        existingScript.addEventListener("error", () => reject(new Error("Failed to load sql.js script.")), {
          once: true,
        });
        return;
      }

      const script = document.createElement("script");
      script.src = SQL_JS_SCRIPT_PATH;
      script.async = true;
      script.dataset.sqljsLoader = "true";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load sql.js script."));
      document.head.appendChild(script);
    });
  }

  await sqlScriptLoadPromise;
}

/**
 * Initialize sql.js WASM module (client-side only)
 */
export async function initSqlJS(): Promise<SqlJsStatic> {
  if (sqlInstance) {
    return sqlInstance;
  }

  if (!sqlInitPromise) {
    sqlInitPromise = (async () => {
      await ensureSqlJsScriptLoaded();

      if (!window.initSqlJs) {
        throw new Error("sql.js loader is missing. Ensure /public/sql-wasm.js exists.");
      }

      const initialized = await window.initSqlJs({
        locateFile: () => SQL_JS_WASM_PATH,
      });
      sqlInstance = initialized;
      return initialized;
    })();
  }

  return sqlInitPromise;
}

/**
 * Create a new in-memory database and run schema SQL
 */
export async function createSandbox(schemaSql: string): Promise<Database> {
  const sql = await initSqlJS();
  const db = new sql.Database();

  try {
    db.run("PRAGMA foreign_keys = ON;");
    const statements = schemaSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    for (const stmt of statements) {
      try {
        db.exec(stmt + ';');
      } catch {
        // Skip bad statements — missing tables become test failures, not crashes
      }
    }
  } catch (error) {
    db.close();
    throw error;
  }

  return db;
}

/**
 * Run a SQL statement and return results
 */
export function runQuery(
  db: Database,
  sql: string
): { columns: string[]; values: unknown[][] } | null {
  const result = db.exec(sql);
  if (result.length === 0) {
    return null;
  }

  return {
    columns: result[0].columns,
    values: result[0].values,
  };
}

/**
 * Run a SQL statement expecting it to succeed (no return value)
 */
export function runStatement(db: Database, sql: string): void {
  db.run(sql);
}

/**
 * Check if a SQL statement throws an error
 */
export function testSqlThrows(db: Database, sql: string): { throws: boolean; error?: string } {
  try {
    db.run(sql);
    return { throws: false };
  } catch (error) {
    return {
      throws: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function testSqlScriptThrows(db: Database, sql: string): { throws: boolean; error?: string } {
  try {
    db.exec(sql);
    return { throws: false };
  } catch (error) {
    return {
      throws: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Close the database
 */
export function closeSandbox(db: Database): void {
  db.close();
}

/**
 * Export database to binary
 */
export function exportDatabase(db: Database): Uint8Array {
  return db.export();
}

/**
 * Create a backup/savepoint
 */
export function createSavepoint(db: Database, name: string): void {
  db.run(`SAVEPOINT ${name}`);
}

/**
 * Rollback to savepoint
 */
export function rollbackToSavepoint(db: Database, name: string): void {
  db.run(`ROLLBACK TO SAVEPOINT ${name}`);
}

/**
 * Release savepoint
 */
export function releaseSavepoint(db: Database, name: string): void {
  db.run(`RELEASE SAVEPOINT ${name}`);
}
