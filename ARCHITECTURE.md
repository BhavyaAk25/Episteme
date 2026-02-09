# Architecture — Episteme

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        EPISTEME UI                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    TOP BAR                                │   │
│  │  [Prompt Input] [Generate] [Simulate] [Auto-Fix] [Export]│   │
│  │  [═══════════Phase Progress Bar═══════════]               │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌─────────┐ ┌─────────────────────────────┐ ┌──────────────┐  │
│  │ ONTOLOGY│ │     ERD CANVAS              │ │  INSPECTOR   │  │
│  │ SIDEBAR │ │     (React Flow)            │ │  PANEL       │  │
│  │         │ │                             │ │              │  │
│  │ Objects │ │  ┌──────┐    ┌──────┐       │ │ Table details│  │
│  │ Links   │ │  │Table │───>│Table │       │ │ Columns      │  │
│  │ Actions │ │  └──────┘    └──────┘       │ │ Constraints  │  │
│  │         │ │       \      /              │ │ Actions      │  │
│  │         │ │      ┌──────┐               │ │ Confidence   │  │
│  │         │ │      │Table │               │ │              │  │
│  │         │ │      └──────┘               │ │              │  │
│  └─────────┘ └─────────────────────────────┘ └──────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              SIMULATION DRAWER                            │   │
│  │  ✅ Passed: 24  ❌ Failed: 3  │ Incident Timeline...     │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                    API Routes (Next.js)
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
    /api/generate        /api/simulate        /api/autofix
         │                    │                    │
         ▼                    ▼                    ▼
  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │  Gemini 3    │   │   sql.js     │   │  Gemini 3    │
  │  Flash API   │   │   (WASM)     │   │  Flash API   │
  │              │   │   In-Browser │   │              │
  │ Structured   │   │   SQLite     │   │ Patch        │
  │ Output       │   │   Sandbox    │   │ Generation   │
  └──────────────┘   └──────────────┘   └──────────────┘
```

## Gemini 3 Integration Points

### 1. Schema Generation (Structured Outputs)
Gemini 3 Flash generates the complete ontology + ERD using JSON-schema-constrained output.
We define Zod schemas that map directly to Gemini's `response_json_schema` parameter.

### 2. Multi-Step Orchestration (Function Calling)
The pipeline runs in phases: Plan → Ontology → ERD → Constraints → Actions.
Each phase's output feeds into the next, using Gemini 3's thought signatures to maintain reasoning context.

### 3. Streaming Build Animation
Gemini's streaming API drives the real-time canvas animation as the schema constructs itself.

### 4. Self-Healing Loop (Auto-Fix)
When chaos tests fail, Gemini receives the failure context and proposes minimal migration patches.
Patches are applied in the sql.js sandbox, tests rerun, creating a verified fix cycle.

### 5. Thinking Level Control
- Generation phases: `thinking_level: HIGH` for deep reasoning
- Validation phases: `thinking_level: LOW` for fast, focused fixes

## Data Flow

```
User Prompt
    │
    ▼
Phase 1: PLAN ──── Gemini 3 structured output
    │                 │
    ▼                 ▼
Phase 2: ONTOLOGY    Objects, Links, Actions, Interfaces
    │
    ▼
Phase 3: ERD ─────── Tables, Columns, Constraints, Indexes
    │
    ▼
Phase 4: BUILD SCRIPT ── Ordered animation steps
    │
    ▼
CANVAS ANIMATION ──── React Flow renders step-by-step
    │
    ▼
Phase 5: SIMULATE ──── sql.js runs chaos tests
    │
    ├─── All pass? ──► EXPORT (schema.sql, ontology.json, report)
    │
    └─── Failures? ──► Phase 6: AUTO-FIX
                            │
                            ▼
                       Gemini 3 generates patches
                            │
                            ▼
                       Apply in sandbox → Rerun tests
                            │
                            ▼
                       Show before/after + proof
```

## Palantir-Inspired Ontology Model

Inspired by Palantir Foundry's Ontology architecture:

| Palantir Concept | Episteme Equivalent | Purpose |
|-----------------|---------------------|---------|
| Object Type | Entity in ontology sidebar | Real-world entity definition |
| Property | Column in ERD table | Entity characteristic |
| Link Type | Relationship edge on canvas | Semantic connection |
| Action Type | Action in action catalog | First-class operation with preconditions |
| Interface | Shared behavior set | Common properties across entities (Auditable) |
| Function | Computed/derived value | Business logic on top of objects |

## Technology Choices

| Choice | Reasoning |
|--------|-----------|
| Next.js App Router | Vercel-native deployment, server-side API routes for secure Gemini calls |
| React Flow (@xyflow/react) | MIT license, proven for node-based UIs, custom nodes/edges, used by Stripe |
| sql.js (SQLite WASM) | Browser-native database sandbox, no server needed, instant schema testing |
| Zustand | Minimal state management that integrates naturally with React Flow |
| Framer Motion | Production-grade animations for build playback choreography |
| Zod | TypeScript-native schema validation, directly compatible with Gemini structured outputs |
| Tailwind CSS | Rapid dark-theme styling with design system consistency |
