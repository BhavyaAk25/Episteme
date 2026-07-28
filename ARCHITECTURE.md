# Architecture — Episteme

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          EPISTEME UI                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  TOP BAR: [Prompt] [Generate] [Simulate] [Auto-Fix] [Export] │
│  │  [═══════════ Phase Progress ═══════════]                  │  │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌─────────┐ ┌─────────────────────────────┐ ┌──────────────┐  │
│  │ ONTOLOGY│ │        ERD CANVAS           │ │  INSPECTOR   │  │
│  │ SIDEBAR │ │        (React Flow)         │ │  PANEL       │  │
│  └─────────┘ └─────────────────────────────┘ └──────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  SIMULATION DRAWER: ✅ Passed  ❌ Failed  · Incidents      │  │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                    Next.js API routes
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
   /api/generate        /api/autofix          /api/export
         │                    │                    │
         ▼                    ▼                    ▼
  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
  │  Gemini 3    │    │  Gemini 3    │    │  ZIP bundle  │
  │  Flash       │    │  Flash       │    │  SQL / JSON  │
  │  structured  │    │  migration   │    │  / report    │
  │  JSON output │    │  patches     │    │              │
  └──────────────┘    └──────────────┘    └──────────────┘

  Verification is client-side: sql.js (SQLite WASM) runs deterministic
  chaos tests in the browser — no verification server round-trip.
```

## Gemini 3 Integration Points

### 1. Schema generation — structured output
`/api/generate` sends the user prompt plus an explicit JSON instruction schema and asks Gemini 3 Flash for a **single** structured response containing `plan`, `ontology`, `erd`, and an ordered `build_steps` array. The call sets `responseMimeType: "application/json"`, and the payload is validated with **Zod** before reaching the UI. Malformed or unexpected responses trigger a deterministic local fallback rather than an error.

### 2. Self-healing — AI migration patches
`/api/autofix` receives failing chaos tests plus the current schema and asks Gemini for a **minimal, targeted migration** (SQLite-compatible `ALTER TABLE` / `CREATE INDEX` / `CREATE TRIGGER`). Each patch is applied in the sql.js sandbox and the failing test is re-run to prove the fix. When Gemini is unavailable, deterministic fallback patches are generated from the SQLite error messages.

### 3. Build animation (client-side)
The build animation is **not** token streaming. Gemini returns an ordered `build_steps` array once, and the frontend choreographs it locally with `requestAnimationFrame` + Framer Motion. This is more reliable and visually smoother than streaming partial tokens.

### 4. Deterministic client-side verification
Chaos tests are derived from the ERD's own constraints (UNIQUE / NOT NULL / FOREIGN KEY / CHECK) — not from the LLM — and executed in the browser via sql.js. This keeps verification fast, free, and reproducible across runs.

### 5. Quota resilience
The Gemini client normalizes provider errors, detects `429` / `RESOURCE_EXHAUSTED`, applies a short local cooldown window, and exposes quota metadata so both routes can fall back to local generation/patching without hard-failing.

## Data Flow

```
User Prompt
    │
    ▼
/api/generate ──► Gemini 3 structured output
    │                { plan, ontology, erd, build_steps }
    │                     │ validated with Zod
    ▼                     ▼
Zustand stores ◄── plan · ontology · ERD · build script
    │
    ▼
CANVAS ANIMATION ── React Flow renders the build script step-by-step
    │
    ▼
SIMULATE (client) ── sql.js seeds data + runs deterministic chaos tests
    │
    ├── all pass ──► EXPORT (schema.sql, ontology.json, report.html)
    │
    └── failures ──► /api/autofix
                          │
                          ▼
                     Gemini 3 proposes migration patches
                          │
                          ▼
                     apply in sandbox → re-run failing tests
                          │
                          ▼
                     show before/after diff + proof
```

## Palantir-Inspired Ontology Model

| Palantir Concept | Episteme Equivalent | Purpose |
|-----------------|---------------------|---------|
| Object Type | Entity in ontology sidebar | Real-world entity definition |
| Property | Column in ERD table | Entity characteristic |
| Link Type | Relationship edge on canvas | Semantic connection |
| Action Type | Action in action catalog | First-class operation with preconditions |
| Interface | Shared behavior set | Common properties across entities (Auditable) |

## Technology Choices

| Choice | Reasoning |
|--------|-----------|
| Next.js App Router | Vercel-native deployment; server-side API routes keep the Gemini key off the client |
| React Flow (@xyflow/react) | MIT-licensed, proven for node-based ERD UIs, custom nodes/edges |
| sql.js (SQLite WASM) | Browser-native database sandbox — instant, free schema testing with no server |
| Zustand | Minimal state management that integrates naturally with React Flow, with `persist` for session restore |
| Framer Motion | Production-grade animation for build-playback choreography |
| Zod | TypeScript-native validation, directly compatible with Gemini's structured JSON |
| Tailwind CSS | Rapid, consistent theming |
| Vitest | Fast unit tests for the deterministic generation/verification core |
