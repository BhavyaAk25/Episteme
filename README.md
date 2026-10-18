# Episteme

**Design a database from plain English, then edit it, test it in real Postgres, and export it.**

**[Open the app →](https://episteme-erd.vercel.app)** · free · no account · your work stays in your browser

Describe your system, for example _"event ticketing with venues, events, ticket tiers, orders and attendees"_, and Episteme drafts a schema as an editable ER diagram. You refine it by hand or by asking the AI for changes. Then you check it in a real Postgres database running in your browser and export it as PostgreSQL, MySQL, SQLite, Prisma or Drizzle.

---

## What you can do

### Start
- **Describe it**: the AI writes the schema while you watch. Progress is streamed live, so you see each phase and each table name as it's designed.
- **Start from a template**: inventory, SaaS or e-commerce, editable like anything else.
- **Import SQL**: paste `CREATE TABLE` statements or upload a dump (`pg_dump --schema-only`; simple MySQL dumps work too). Episteme runs it in Postgres and reads the real catalog back, so types, defaults, CHECKs, indexes and every `ON DELETE` rule come through exactly.
- **Blank canvas**: build it yourself.

### Edit
- **A real ERD editor**: add, rename and delete tables and columns. Set types, primary key, NOT NULL, UNIQUE and defaults, and reorder columns. Add CHECK constraints and indexes.
- **Draw foreign keys**: drag from a column to another table's key. A correctly typed `<table>_id` column is created when needed. Set 1:1 or 1:N, required, and ON DELETE in plain language.
- **Crow's-foot notation**: lines connect column to column and show optionality and cardinality. **Tidy up** re-lays out the diagram (ELK).
- **Undo/redo everything** (⌘Z / ⌘⇧Z). Names are validated (snake_case, no reserved words), and renames update every reference.
- **Ask AI to change…**: "add product reviews with a 1–5 rating". The AI proposes small edit operations, applied with the same validation as manual edits. You preview them on the canvas (new tables green, changed tables amber), then apply or discard.

### Verify
- **Run tests in real Postgres**: PGlite (Postgres compiled to WebAssembly) runs the exact exported SQL in your browser and inserts realistic sample rows. It then checks that every NOT NULL, UNIQUE, foreign key, CHECK and ON DELETE (CASCADE / SET NULL / RESTRICT) rule actually holds.
- **Design checks with one-click fixes**:
  - missing primary keys
  - foreign keys without indexes
  - FK type mismatches
  - money stored as floats
  - emails, slugs or SKUs that aren't unique
  - nullable booleans
  - repeating groups
  - duplicate links in junction tables
  - circular required references
  - missing timestamps

  Issues without a safe automatic fix get **Ask AI to fix**.
- **Prompt coverage**: flags things you mentioned that no table stores.

### Keep and share
- **Projects and version history**: several projects, autosaved. Versions are recorded on every generation, AI change and restore, and on demand. Restoring can be undone.
- **Export**:
  - PostgreSQL, MySQL 8, SQLite, Prisma, Drizzle ORM, ontology JSON and an HTML checks report, as a .zip
  - the diagram as PNG or SVG
- **Share link**: the whole schema is packed into the link itself, so nothing is uploaded. Whoever opens it gets their own editable copy.
- **Light and dark themes**, plus keyboard shortcuts (press `?`).

---

## How it works

```
Browser (Next.js · React Flow · Zustand)
├─ ERD store (single source of truth, undo/redo) ──► diagram, SQL, tests, exports
├─ PGlite: Postgres in WASM for tests and SQL import (loaded on demand)
├─ IndexedDB: projects and version history
└─ calls ──► /api/generate  (streams NDJSON progress, then the schema)
             /api/edit      (returns edit operations for "Ask AI to change")
                  │
                  └─ AI provider: Gemini (default) or Groq / OpenRouter / Ollama
```

- **The ERD is the single source of truth.** Foreign-key flags and constraints are derived from relationships, so the diagram, SQL and every export always agree.
- **AI output is never trusted directly.** Generation is parsed with forgiving Zod schemas; one bad field doesn't sink the result. Edits are applied through validated model functions, one operation at a time.
- **Honest failures.** If the AI is unavailable or out of quota you get a clear message and your current schema stays. Templates and every non-AI feature keep working.
- **Free to run.** Gemini's free tier by default, with an optional free backup (Groq) when its quota runs out; brief outages are retried automatically; PGlite, IndexedDB and share links need no server or database. AI routes are rate-limited per client and size-limited.

More detail: [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Run it locally

Requirements: Node.js 18.18+ and npm.

```bash
git clone https://github.com/BhavyaAk25/Episteme.git
cd Episteme
npm install
cp .env.example .env.local   # add a free Gemini key from https://aistudio.google.com/apikey
npm run dev                  # http://localhost:3000
```

Without a key, everything except AI generation and AI edits works.

### Configuration (`.env.local`)

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | — | Gemini API key (free tier works) |
| `GEMINI_MODEL` | `gemini-3-flash-preview` | Model id (comma-separated list = fallbacks) |
| `GEMINI_THINKING_LEVEL` | `low` | `minimal` / `low` / `medium` / `high` / `off` |
| `GEMINI_GENERATE_MAX_OUTPUT_TOKENS` | `16384` | Output budget for generation |
| `AI_PROVIDER` | `gemini` | `groq`, `openrouter` or `ollama` for other free backends |
| `AI_API_KEY` / `AI_MODEL` / `AI_BASE_URL` | per provider | Settings for those backends |
| `AI_FALLBACK_PROVIDER` + `AI_FALLBACK_API_KEY` | none | Backup used when the main provider is out of quota or down (e.g. Groq's free tier) |

### Scripts

```bash
npm run dev        # development server
npm run build      # production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm test           # vitest
```

### Deploy

Import the repo on [Vercel](https://vercel.com/new) and set `GEMINI_API_KEY`. Pushes to `main` deploy automatically.

---

## Tech

Next.js 16 · React 19 · React Flow (`@xyflow/react`) · Zustand + zundo · PGlite · ELK.js · Zod · Tailwind CSS v4 · Framer Motion · html-to-image · JSZip · lz-string · Gemini (`@google/genai`). All free and open source.

## License

MIT
