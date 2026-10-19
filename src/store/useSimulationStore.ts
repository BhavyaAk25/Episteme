import { create } from "zustand";
import type { PGlite } from "@electric-sql/pglite";
import type { VerifyRun } from "@/lib/verify/runner";
import { useErdStore } from "./useErdStore";

export interface QueryResult {
  columns: string[];
  rows: string[][];
  /** Rows returned before truncation, or rows affected for writes. */
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  error: string | null;
}

const MAX_ROWS = 200;

function cell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (value instanceof Date) return value.toISOString().replace("T", " ").slice(0, 19);
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/**
 * Results of running the schema in real Postgres (PGlite). Cleared whenever
 * the schema changes, since they describe one version of it. The seeded
 * database stays open for the query playground until then.
 */
interface SimulationState {
  isRunning: boolean;
  progress: string | null;
  run: VerifyRun | null;
  error: string | null;
  db: PGlite | null;
  runTests: () => Promise<void>;
  /** Run SQL against the seeded sample database (seeding it first if needed). */
  runQuery: (sql: string) => Promise<QueryResult>;
  reset: () => void;
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  isRunning: false,
  progress: null,
  run: null,
  error: null,
  db: null,

  runTests: async () => {
    const erd = useErdStore.getState().erd;
    if (!erd || erd.tables.length === 0 || get().isRunning) return;
    void get().db?.close().catch(() => undefined);
    set({ isRunning: true, progress: "Starting Postgres…", error: null, run: null, db: null });
    try {
      const { runVerification } = await import("@/lib/verify/runner");
      const { db, ...run } = await runVerification(erd, (progress) => set({ progress }), { keepOpen: true });
      // Ignore results if the schema changed while tests were running.
      if (useErdStore.getState().erd === erd) set({ run, db });
      else void db?.close().catch(() => undefined);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Couldn't run the database tests." });
    } finally {
      set({ isRunning: false, progress: null });
    }
  },

  runQuery: async (sql) => {
    const started = performance.now();
    if (!get().db) await get().runTests();
    const db = get().db;
    if (!db) {
      return { columns: [], rows: [], rowCount: 0, truncated: false, durationMs: 0, error: get().error ?? "The sample database isn't available." };
    }
    try {
      const results = await db.exec(sql);
      const last = results.at(-1);
      const columns = last?.fields.map((f) => f.name) ?? [];
      const all = (last?.rows ?? []) as Record<string, unknown>[];
      return {
        columns,
        rows: all.slice(0, MAX_ROWS).map((row) => columns.map((c) => cell(row[c]))),
        rowCount: columns.length ? all.length : last?.affectedRows ?? 0,
        truncated: all.length > MAX_ROWS,
        durationMs: performance.now() - started,
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { columns: [], rows: [], rowCount: 0, truncated: false, durationMs: performance.now() - started, error: message };
    }
  },

  reset: () => {
    void get().db?.close().catch(() => undefined);
    set({ run: null, error: null, progress: null, db: null });
  },
}));
