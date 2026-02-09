# Gemini 429 Reliability Runbook (Session 8.3, updated Session 11)

## Model (Session 10 update)
- Default model changed from `gemini-2.0-flash` to **`gemini-3-flash-preview`** (hackathon requirement)
- `thinkingConfig` removed (conflicts with `responseMimeType: "application/json"` — causes non-JSON output)
- Override via `GEMINI_MODEL` env var still works
- `gemini-3-flash-preview` is the only Gemini 3 model on the free tier (`gemini-3-pro-preview` is paid-only)

## What changed (Session 12 — Claude Opus 4.6)

### Critical: Patch verification fix
- **Multi-statement SQL execution**: `verifyPatchedSchema()` in `autofixRunner.ts` was calling `testSqlThrows(db, patch.migrationSql)` which uses `db.run()` — sql.js's `db.run()` only executes the FIRST SQL statement. Trigger-pair patches (INSERT + UPDATE triggers joined by `\n`) had only the first trigger applied; the second was silently dropped. This is why patch verification **always failed**.
- **Fix**: Split migration SQL by `;` and execute each statement separately (same pattern as `createSandbox` in `sandbox.ts`)
- **Retry default**: Fixed `AUTOFIX_MAX_RETRIES` default from 0 to 1 in `autofix/route.ts` (was overriding the client.ts default of 1)

## What changed (Session 11 — Claude Opus 4.6)

### Generation pipeline fixes
- **JSON extraction**: Added `extractJSON()` helper in `client.ts` to strip markdown fences and extract JSON from Gemini 3 responses (model sometimes wraps JSON in backticks)
- **Token budget**: Increased `GEMINI_GENERATE_MAX_OUTPUT_TOKENS` default from 3072 to **8192** (Gemini 3 needs more room for structured output)
- **ERD sanitization**: Added `sanitizeERD()` in `generate/route.ts` — strips dangling FK references where Gemini references tables it didn't include in the `tables` array. This fixed missing connectors and simulation crashes
- **Prompt improvements**: Updated `GENERATION_PROMPT` in `prompts.ts` with:
  - Mandatory cardinality variety (at least one 1:1, 1:N, and M:N relationship)
  - Explicit audit_events FK connection rules (must reference 2+ core entities with ON DELETE SET NULL)
  - Consistency rules (every FK column must have a matching relationship entry, every references_table must exist)

### SQLite sandbox fixes
- **Multi-statement execution**: Changed `sandbox.ts` from `db.run()` (single statement) to per-statement `db.exec()` with try-catch (skips bad statements instead of crashing)
- **PostgreSQL→SQLite normalization**: Added `normalizeSqliteExpression()` in `sqlGenerator.ts` (converts `char_length()` → `length()`, strips `::type` casts)
- **Improved defaults**: `normalizeDefaultValue()` now handles `TRUE`/`FALSE` → `1`/`0`, `NOW()` → `CURRENT_TIMESTAMP`, and drops unsupported PostgreSQL functions
- **FK reference safety**: `buildCreateTableStatement()` now takes an `existingTables` set and skips REFERENCES clauses for non-existent tables

### Auto-fix pipeline fixes
- **Budget increase**: `AUTOFIX_MAX_GEMINI_INCIDENTS` default raised from 1 to **5** (up to 5 incidents get Gemini-powered patches per request)
- **Token budget**: `GEMINI_AUTOFIX_MAX_OUTPUT_TOKENS` raised from 1024 to **2048** (prevents truncated JSON responses)
- **Retry**: `GEMINI_MAX_RETRIES_AUTOFIX` raised from 0 to **1** (one retry on failure)
- **Lenient validation**: `fix_category` in Zod schema changed from strict 7-value enum to `string` (Gemini 3 sometimes returns non-standard category names)
- **Multi-format parsing**: `extractPatchFromGeminiResponse()` handles 3 Gemini 3 response shapes:
  - Standard: `{ patches: [{...}] }`
  - Singular: `{ patch: {...} }` (Gemini 3 sometimes uses singular)
  - Flat: `{ migration_sql: "...", root_cause: "..." }` (top-level fields)
- **Broader fallback patterns**: Added generic fallback handlers that inspect the actual SQLite error message (FK constraint failed, NOT NULL constraint failed)
- **Catch-all fallback**: Every incident now gets at least a placeholder patch (prevents "Unable to generate any patches" 422)
- **Cooldown reduction**: `GEMINI_QUOTA_COOLDOWN_MS` default reduced from 90s to **15s** (was blocking autofix calls after Generate)

## Environment controls
Set these in `.env.local` if you want stricter or looser request behavior:

| Variable | Default | Description |
|----------|---------|-------------|
| `GEMINI_MAX_RETRIES_GENERATE` | `1` | Retry attempts for generation calls |
| `GEMINI_MAX_RETRIES_AUTOFIX` | `1` | Retry attempts for autofix calls |
| `GEMINI_GENERATE_MAX_OUTPUT_TOKENS` | `8192` | Max output tokens for generation |
| `GEMINI_AUTOFIX_MAX_OUTPUT_TOKENS` | `2048` | Max output tokens for autofix |
| `GEMINI_RETRY_DELAY_MS` | `1200` | Delay between retries (ms) |
| `GEMINI_QUOTA_COOLDOWN_MS` | `15000` | Cooldown after quota exhaustion (ms) |
| `AUTOFIX_MAX_GEMINI_INCIDENTS` | `5` | Max Gemini calls per autofix request |

## Manual verification (you run this)
1. Start app:
   - `cd /Users/bhavyakhimavat/Desktop/episteme`
   - `npm run dev`
2. In UI, type "inventory management system for a sneaker brand", click **Generate**.
3. Verify: connectors appear between tables, cardinalities vary (1:1, 1:N, M:N), audit_events is connected.
4. Click **Simulate** — should show passed/failed counts, not crash.
5. Click **Auto-Fix** — should return patches for failed incidents (up to 5 via Gemini).
6. Click **Export** — should produce SQL/JSON bundle.
7. Repeat after 1-2 minutes to confirm cooldown recovery if rate-limited.

## If 429 still happens quickly
- In AI Studio, verify:
  - the key belongs to the intended project
  - free-tier daily/minute limits are not already exhausted
  - no other app/script is using the same project key
- A new key helps only when backed by available quota (same exhausted project can still 429).
