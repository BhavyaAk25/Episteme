import type { PGlite } from "@electric-sql/pglite";

/**
 * A fresh in-memory Postgres (PGlite, Postgres compiled to WebAssembly) for
 * one verification run. Loaded on demand so the main bundle stays small.
 */
export async function createPostgres(): Promise<PGlite> {
  const { PGlite } = await import("@electric-sql/pglite");
  return PGlite.create();
}

export interface PgError {
  message: string;
  code: string | null;
}

export function toPgError(error: unknown): PgError {
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; code?: unknown };
    return {
      message: typeof record.message === "string" ? record.message : String(error),
      code: typeof record.code === "string" ? record.code : null,
    };
  }
  return { message: String(error), code: null };
}

/** Postgres SQLSTATE codes the tests rely on. */
export const SQLSTATE = {
  notNull: "23502",
  foreignKey: "23503",
  unique: "23505",
  check: "23514",
  invalidText: "22P02",
} as const;
