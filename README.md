# Episteme — AI-Powered Database Schema Builder

> Turn plain-English requirements into verified, production-grade database systems. Powered by Gemini 3.

**[Live Demo](https://episteme-one.vercel.app)** | [Architecture](./ARCHITECTURE.md) | [Gemini Prompts](./GEMINI_PROMPTS.md) | 

---

## What It Does

Episteme transforms natural language descriptions into complete database schemas — not just diagrams. Type "build an inventory management system for a sneaker brand" and watch as Gemini 3 constructs an ontology, generates tables, draws relationships, stress-tests with chaos scenarios, and self-heals failures. All rendered live with build animations on an interactive canvas.

**This is not a chat interface.** Gemini 3 is embedded as the engine of a real tool.

---

## Key Features

- **7-Phase AI Pipeline**: Plan → Ontology → ERD → Constraints → Actions → Verify → Auto-Fix
- **Live Build Animation**: Watch tables, columns, and relationships construct in real time on a Lucidchart-style canvas
- **Palantir-Inspired Ontology**: Object types, link types, action types with preconditions, transaction plans, and side effects
- **Chaos Testing**: Automated adversarial tests — duplicate keys, null violations, orphaned records, negative values — all run in an in-browser SQLite sandbox
- **Self-Healing Schema**: Gemini diagnoses failures and generates migration patches, verified in-sandbox with proof
- **Interactive ERD Canvas**: Drag, zoom, pan, select, inspect — full interactive editing with React Flow
- **One-Click Export**: SQL migrations, ontology JSON, and verification report as a downloadable bundle

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | Next.js 16 (App Router) | SSR, API routes, Vercel-native deployment |
| AI Engine | Gemini 3 Flash (`@google/genai` SDK) | Structured outputs, multi-step orchestration |
| Canvas | React Flow (`@xyflow/react` v12) | Interactive ERD visualization with custom nodes/edges |
| State | Zustand | Lightweight state management |
| DB Sandbox | sql.js (SQLite WASM) | In-browser schema testing, no server needed |
| Validation | Zod | Type-safe structured output schemas |
| Animation | Framer Motion | Build playback choreography |
| Styling | Tailwind CSS v4 | Dark theme, responsive design |
| Deployment | Vercel (free tier) | Zero-config HTTPS deployment |

All technologies are free and open source. No paid APIs or hosting required.

---

## Gemini 3 API Integration

Episteme uses Gemini 3 Flash as the core intelligence engine across every phase of schema design:

### Structured Outputs
Every Gemini call returns JSON constrained by Zod schemas via `response_json_schema`. No free-form text parsing — type-safe, deterministic outputs.

### Multi-Step Orchestration
A 7-phase pipeline where each phase's structured output feeds directly into the next phase's prompt context:

```
User Prompt → Plan → Ontology → ERD → Constraints → Actions → Verify → Auto-Fix
```

### Thinking Levels
- `HIGH` for generation phases (deep reasoning for schema design decisions)
- `LOW` for validation phases (fast, focused fixes)

### Self-Healing Loop
Failed chaos tests are sent back to Gemini with full context (test SQL, error message, expected vs actual). Gemini diagnoses root causes and generates minimal migration SQL. Patches are applied in the sql.js sandbox and tests rerun for proof.

### Graceful Degradation
Quota-aware fallback system with local deterministic schema generation when rate limits (429s) are hit — ensures the demo never breaks.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         EPISTEME UI                               │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                     TOP BAR                                │   │
│  │  [Prompt Input] [Generate] [Simulate] [Auto-Fix] [Export] │   │
│  │  [════════════Phase Progress Bar════════════]              │   │
│  └───────────────────────────────────────────────────────────┘   │
│  ┌──────────┐ ┌──────────────────────────────┐ ┌─────────────┐  │
│  │ ONTOLOGY │ │      ERD CANVAS              │ │  INSPECTOR  │  │
│  │ SIDEBAR  │ │      (React Flow)            │ │  PANEL      │  │
│  │          │ │                              │ │             │  │
│  │ Objects  │ │  ┌──────┐    ┌──────┐        │ │ Table info  │  │
│  │ Links    │ │  │Table │───>│Table │        │ │ Columns     │  │
│  │ Actions  │ │  └──────┘    └──────┘        │ │ Constraints │  │
│  │          │ │       \       /               │ │ Actions     │  │
│  │          │ │       ┌──────┐               │ │ Confidence  │  │
│  │          │ │       │Table │               │ │             │  │
│  │          │ │       └──────┘               │ │             │  │
│  └──────────┘ └──────────────────────────────┘ └─────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │               SIMULATION DRAWER                            │   │
│  │  Passed: 24  Failed: 3  │ Incident Timeline...            │   │
│  └───────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
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
 │  Structured  │   │   In-Browser │   │  Patch       │
 │  Output      │   │   SQLite     │   │  Generation  │
 └──────────────┘   └──────────────┘   └──────────────┘
```

For detailed architecture documentation, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Ontology Model

Inspired by [Palantir Foundry's Ontology](https://www.palantir.com/platforms/foundry/) architecture:

| Concept | Description |
|---------|-------------|
| **Object Types** | Real-world entities mapped to database tables |
| **Link Types** | Semantic relationships with explicit cardinalities |
| **Action Types** | First-class operations with preconditions, transaction plans, and side effects |
| **Interfaces** | Shared behaviors across entities (Auditable, Transferable, Addressable) |

---

## Local Development

### Prerequisites
- Node.js 18+
- npm

### Setup

```bash
git clone https://github.com/BhavyaAk25/Episteme.git
cd Episteme
npm install
```

### Environment Variables

Create a `.env.local` file in the project root:

```
GEMINI_API_KEY=your_gemini_api_key_here
```

Get a free Gemini API key at [Google AI Studio](https://aistudio.google.com/apikey). The free tier provides access to `gemini-3-flash-preview` (30 requests/min, 1M tokens/min).

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Deployment

This is a standard Next.js project. Deploy to Vercel:

1. Import the GitHub repo at [vercel.com/new](https://vercel.com/new)
2. Set `GEMINI_API_KEY` in Environment Variables
3. Deploy — Vercel auto-detects Next.js

The `sql-wasm.js` and `sql-wasm.wasm` files in `public/` are served as static assets automatically.

---

## Project Structure

```
episteme/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── page.tsx            # Main application page
│   │   ├── layout.tsx          # Root layout
│   │   └── api/                # Server-side API routes
│   │       ├── generate/       # Gemini schema generation
│   │       ├── simulate/       # Chaos test execution
│   │       ├── autofix/        # Self-healing patches
│   │       └── export/         # Schema export bundle
│   ├── components/
│   │   ├── canvas/             # ERD visualization (React Flow)
│   │   ├── sidebar/            # Ontology explorer
│   │   ├── inspector/          # Entity detail panel
│   │   ├── topbar/             # Controls and prompt input
│   │   ├── simulation/         # Chaos test results drawer
│   │   └── export/             # Export modal
│   ├── lib/
│   │   ├── gemini/             # Gemini API client, prompts, schemas
│   │   ├── ontology/           # Data model and transformers
│   │   ├── simulation/         # sql.js sandbox and test logic
│   │   ├── autofix/            # Patch generation and verification
│   │   └── export/             # SQL, JSON, and report exporters
│   ├── store/                  # Zustand state management
│   └── types/                  # TypeScript type definitions
├── public/
│   ├── brand/                  # Logo assets
│   ├── sql-wasm.js             # SQLite WASM runtime
│   └── sql-wasm.wasm           # SQLite WASM binary
├── docs/                       # Additional documentation
├── ARCHITECTURE.md             # System architecture
├── GEMINI_PROMPTS.md           # All Gemini system prompts
├── DEMO_SCRIPT.md              # 3-minute demo walkthrough
└── SETUP_GUIDE.md              # Development setup guide
```

---

## Hackathon

Built for the [Gemini 3 Devpost Hackathon](https://gemini3.devpost.com).

**Evaluation Criteria:**
- **Technical Execution (40%)** — Multi-step Gemini orchestration, structured outputs, verified pipeline
- **Innovation / Wow Factor (30%)** — Live build animation, self-healing schema loop, Palantir-grade ontology
- **Potential Impact (20%)** — Prevents data corruption from poorly designed schemas
- **Presentation / Demo (10%)** — 3-minute demo, architecture docs, clean codebase

---

## License

MIT
