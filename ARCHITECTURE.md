# Architecture

Episteme is a Next.js app where almost everything runs in the browser. The server only proxies AI calls.

## Data flow

```
              ┌────────────── useErdStore (zustand + zundo) ──────────────┐
              │  erd: tables + relationships   positions   undo/redo     │
              └──────┬──────────────┬───────────────┬──────────────┬─────┘
                     │              │               │              │
              ERD canvas      erdToSql()      verify/runner    export/*
           (React Flow,       PostgreSQL      (PGlite tests)   MySQL · SQLite ·
            crow's feet)      DDL                              Prisma · Drizzle ·
                                                               PNG/SVG · share link
```

- **`src/lib/erd/model.ts`**: pure, validated edit operations (add/rename/delete tables and columns, foreign keys, constraints, indexes). `normalizeErd` keeps the invariants: relationships own foreign keys, "required" mirrors NOT NULL, and nothing references a missing table or column.
- **`src/lib/erd/applyOps.ts`**: applies a list of edit operations (from the AI, the linter's fixes, or tests) through the model functions, reporting each result.
- **`src/store/useErdStore.ts`**: the single source of truth, with undo history (zundo) and localStorage persistence of the working copy.
- **`src/store/useProjectsStore.ts`** + **`src/lib/storage/idb.ts`**: projects and version history in IndexedDB.

## AI

- **`/api/generate`**: one call produces plan, ontology and ERD as JSON. With `stream: true` the route streams NDJSON `progress` events (phase plus table names parsed from the partial JSON), then a `result` or `error`. Output is validated with forgiving Zod schemas (`src/lib/gemini/schemas.ts`) and normalised (`src/lib/generation/server.ts`). If the AI fails, the route returns an honest error, or the built-in template the user picked; never a guessed schema.
- **`/api/edit`**: given a compact text form of the schema and a request, returns edit operations for the preview/apply flow.
- **`src/lib/ai/provider.ts`**: Gemini by default (`@google/genai`, `thinkingLevel: low`), or any OpenAI-compatible free backend (Groq, OpenRouter, Ollama) via `AI_PROVIDER`.
- Both routes are rate-limited per client (`src/lib/server/rateLimit.ts`) and size-limited. User text is delimited and kept out of the system instructions.

## Verification (`src/lib/verify`)

- **`runner.ts`**: starts a fresh PGlite instance, runs `erdToSql` statement by statement, and seeds realistic rows parents-first (`values.ts`). It then tests NOT NULL, UNIQUE, FK and CHECK by expected SQLSTATE, each inside a savepoint. ON DELETE behaviour is tested with a fresh parent and child per relationship.
- **`linter.ts`**: design rules with explanations and fixes expressed as edit operations.
- **`coverage.ts`**: entities named in the prompt that no table or column matches.
- **`useIssues.ts`**: merges linter, coverage, SQL errors and failed tests; applies fixes or sends issues to "Ask AI to change".

## Import (`src/lib/import/fromSql.ts`)

Runs pasted DDL in PGlite (with a light MySQL→Postgres adaptation as a fallback), then reads `pg_class`, `pg_attribute`, `pg_constraint` and `pg_index` back into an ERD.

## UI

- `components/canvas`: React Flow canvas, table nodes with per-column handles, crow's-foot edges, toolbar, AI edit bar, replay controls, generation status.
- `components/inspector`: table and relationship editors.
- `components/verify/VerifyPanel.tsx`: issues, Postgres tests and sample data.
- `components/export`, `components/import`, `components/projects`, `components/shared`: dialogs, project switcher, history, theme toggle, shortcuts and notices.
- Themes: CSS variables in `app/globals.css`, with light/dark by system preference or the toggle.
