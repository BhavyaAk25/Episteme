# UI + Reliability Implementation Plan (Step 1 Documentation)

## Status
- **All steps (1-8) completed** by Claude Opus 4.6 on 2026-02-05.
- `npm run lint` pass (0 errors, 0 warnings)
- `npm run build` pass (Next.js 16.1.6 Turbopack)
- Fallback API validated: inventory, saas, ecommerce all route correctly via template_hint and classifier.

## Goal
Stabilize Episteme for demo reliability first, then execute a high-quality UI refinement pass while preserving clear Gemini hackathon value even during quota exhaustion.

## Why this plan exists
User-reported gaps to address in order:
1. Wrong fallback domain routing (inventory prompts sometimes produce e-commerce fallback).
2. Connector/editability issues (manual links do not behave like Lucidchart expectations).
3. Replay/graph consistency issues.
4. Gemini visibility is weak under quota exhaustion.
5. UI still feels cramped/uneven despite prior fixes.

## Problems observed (UI + UX audit)

### Top bar
- Overcrowded hierarchy: prompt, fallback badge, phase strip, and actions compete for attention.
- Primary/secondary actions not clearly differentiated enough.
- Fallback status feels bolted-on instead of integrated with generation state.

### Sidebar
- Sidebar density and width consume too much canvas for the information shown.
- Typography rhythm is inconsistent across headers, object rows, template cards, and meta text.
- Template cards feel repetitive/heavy.

### Canvas / ERD
- Node readability is still dense (headers/rows/constraints all visually noisy).
- Edge labels (cardinality + ON DELETE) can crowd lines/tables.
- Generated vs user-created relationships are not clearly distinguished.
- Replay and current graph state can still create perception of inconsistency.

### Controls / result surfaces
- Replay controls, zoom controls, and verification drawer feel like separate systems.
- Empty state and next action path can be clearer.
- Simulation and auto-fix UX needs clearer state transitions in all no-incident/incident cases.

## Reliability-first execution order (decision complete)

### Step 1 (this pass): Documentation and handoff
- Update `NEXTAGENT.md` with explicit scope and link to this plan.
- Create this file with all planned work and acceptance criteria.

### Step 2: Domain classification and fallback routing correctness
- Replace first-match keyword classifier with weighted classifier + tie-breaking rules.
- Add template hint priority (`templateId`) so template-driven prompts route deterministically.
- Add metadata: `domainDecisionSource`.

### Step 3: Curated fallback packs by domain
- Expand and harden inventory/e-commerce/saas packs so each is distinct and structurally coherent.
- Add integrity validation: every relationship maps to valid FK columns and no orphan edges/tables.

### Step 4: Editable connectors (Lucidchart-style)
- Add reliable `onConnect`, reconnect, delete edge flows.
- Persist user-created links.
- Mark edge provenance (`generated` vs `user`).

### Step 5: Replay + edit coexistence
- Replay rebuilds generated layer.
- User links persist across replay.
- Add clear reset semantics: `Reset Generated` vs `Reset All`.

### Step 6: Gemini visibility under quota
- Explicit status in topbar: Gemini attempted, quota exhausted, fallback active.
- Include fallback reason and retry CTA.
- Keep transparent fallback behavior.

### Step 7: Focused UI refinement pass
- Top bar hierarchy and spacing cleanup.
- Sidebar typography and spacing system.
- Node/edge readability tuning.
- Control cluster coherence improvements.

### Step 8: Validation + handoff update
- `npm run lint`
- `npm run build`
- Manual flow: Generate -> Play -> Simulate -> Auto-Fix -> Export
- Update `NEXTAGENT.md` completion state.

## Planned API/type/interface updates
- `GenerationResponse` add/confirm:
  - `geminiAttempted: boolean`
  - `fallbackReason: "quota" | "parse_error" | "validation_error" | null`
  - `domainDecisionSource: "template_hint" | "classifier" | "gemini"`
- Generate request payload:
  - `templateId?: "inventory" | "ecommerce" | "saas"`
- Edge metadata:
  - `edgeSource: "generated" | "user"`
  - `isOverride?: boolean`

## Acceptance criteria

### Reliability
- Inventory template always returns inventory domain fallback.
- E-commerce template always returns e-commerce domain fallback.
- SaaS template always returns SaaS domain fallback.
- Manual connectors can be created/edited/deleted reliably.
- Replay does not erase user connectors unless full reset.

### Gemini transparency
- User can clearly see Gemini attempt status and fallback reason when quota hits.
- App remains demoable with curated fallback output.

### UI quality
- Top bar has clear visual hierarchy and no crowding at laptop width.
- Sidebar is easier to scan and less cramped.
- ERD nodes/edges are readable with reduced label clutter.
- Control surfaces feel cohesive.

## Constraints
- Keep beige/light visual direction.
- Do not regress existing working paths (simulate/autofix/export).
- Make reliability changes before large visual changes.

## Implementation Notes (Session 8 - Claude Opus 4.6)

### Step 2 Implementation
- Replaced first-match keyword classifier with weighted scorer (`domainKeywords` with per-keyword weights).
- Added tie-breaking order: inventory > ecommerce > saas.
- `templateId` flows from `TemplateSelector` -> `useProjectStore` -> `TopBar.handleGenerate()` -> `/api/generate` -> `createFallbackGeneration(prompt, { templateId })`.
- `domainDecisionSource` returned as `"template_hint"`, `"classifier"`, or `"gemini"`.

### Step 3 Implementation
- Added `validateFallbackIntegrity(erd)` function that runs before every fallback return.
- Validates: all relationship fromTable/toTable exist, FK columns exist and are marked isForeignKey, referencesTable matches relationship target.

### Step 4 Implementation
- Added `EdgeSource` type (`"generated"` | `"user"`) to `ERDEdgeData`.
- ERDCanvas now has `onConnect` handler creating user edges with purple dashed styling.
- Backspace/Delete key deletes selected edges.
- User edges visually distinguished: purple color, 8/4 dash pattern.

### Step 5 Implementation
- `CanvasControls` now has `clearGenerated()` (preserves user edges) vs `clearAll()`.
- Play/Restart only clear generated edges; Reset All clears everything.
- Added separate "Reset All" button with trash icon and error-tinted border.

### Step 6 Implementation
- Topbar now shows rich Gemini status: quota exhausted badge, domain/source info pill, retry CTA button.
- Gemini success shows green checkmark badge.
- All metadata (`geminiAttempted`, `fallbackReason`, `domainDecisionSource`) flows through store and UI.

### Step 7 Implementation
- TopBar: Reduced from 82px to 72px height, added dividers, more compact inputs/buttons.
- Sidebar: Tighter typography (10px section headers, sm body text), horizontal template cards.
- ERD Nodes: Better header padding, cleaner constraint labels (UQ/CK/FK abbreviations).
- Controls: More compact bar, consistent 9x9 button sizes.
- Removed global CSS edge stroke override that was blocking custom edge colors.

### Files Modified
- `src/lib/gemini/fallbackGeneration.ts` (weighted classifier, integrity validation, metadata)
- `src/app/api/generate/route.ts` (templateId pass-through, metadata in response)
- `src/types/erd.ts` (EdgeSource type)
- `src/types/gemini.ts` (GenerationResponse metadata fields)
- `src/store/useProjectStore.ts` (templateId, geminiAttempted, fallbackReason, domainDecisionSource)
- `src/store/useCanvasStore.ts` (no changes needed)
- `src/components/canvas/ERDCanvas.tsx` (onConnect, edge deletion)
- `src/components/canvas/ERDRelationEdge.tsx` (user edge styling)
- `src/components/canvas/ERDTableNode.tsx` (readability refinements)
- `src/components/canvas/BuildAnimation.tsx` (edgeSource: "generated")
- `src/components/canvas/CanvasControls.tsx` (clearGenerated vs clearAll, Reset All button)
- `src/components/topbar/TopBar.tsx` (Gemini status, compact layout)
- `src/components/sidebar/OntologySidebar.tsx` (typography refinements)
- `src/components/sidebar/TemplateSelector.tsx` (horizontal cards, templateId pass)
- `src/lib/ontology/transformer.ts` (edgeSource: "generated" on edges)
- `src/app/globals.css` (removed edge stroke override)
