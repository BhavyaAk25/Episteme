import { create } from "zustand";
import type { ERD } from "@/types/erd";
import { useErdStore, type XY } from "./useErdStore";
import { applyOps, describeErdForAi, type EditOp, type OpResult } from "@/lib/erd/applyOps";
import { EMPTY_ERD } from "@/lib/erd/model";
import { estimateNodeHeight } from "@/lib/ontology/transformer";

export interface EditDiff {
  addedTableIds: string[];
  changedTableIds: string[];
  removedTableNames: string[];
}

/**
 * "Ask AI to change…": request edit operations, preview the result on the
 * canvas (read-only, with changes highlighted), then apply or discard.
 */
interface AiEditState {
  status: "idle" | "loading" | "preview" | "error";
  instruction: string;
  summary: string;
  results: OpResult[];
  previewErd: ERD | null;
  previewPositions: Record<string, XY>;
  diff: EditDiff;
  error: string | null;

  request: (instruction: string) => Promise<void>;
  accept: () => void;
  discard: () => void;
}

const EMPTY_DIFF: EditDiff = { addedTableIds: [], changedTableIds: [], removedTableNames: [] };

function computeDiff(before: ERD, after: ERD): EditDiff {
  const beforeById = new Map(before.tables.map((t) => [t.id, t]));
  const afterIds = new Set(after.tables.map((t) => t.id));
  const relSignature = (erd: ERD, tableName: string) =>
    JSON.stringify(erd.relationships.filter((r) => r.fromTable === tableName).map((r) => [r.fromColumn, r.toTable, r.toColumn, r.cardinality, r.required, r.onDelete]));

  return {
    addedTableIds: after.tables.filter((t) => !beforeById.has(t.id)).map((t) => t.id),
    changedTableIds: after.tables
      .filter((t) => {
        const previous = beforeById.get(t.id);
        if (!previous) return false;
        return (
          JSON.stringify(previous) !== JSON.stringify(t) ||
          relSignature(before, previous.name) !== relSignature(after, t.name)
        );
      })
      .map((t) => t.id),
    removedTableNames: before.tables.filter((t) => !afterIds.has(t.id)).map((t) => t.name),
  };
}

/** Put new tables in a column to the right of the existing diagram. */
function placeNewTables(after: ERD, addedIds: string[], positions: Record<string, XY>): Record<string, XY> {
  const placed = Object.values(positions);
  const startX = placed.length ? Math.max(...placed.map((p) => p.x)) + 420 : 0;
  let y = placed.length ? Math.min(...placed.map((p) => p.y)) : 0;
  const result: Record<string, XY> = {};
  for (const id of addedIds) {
    const table = after.tables.find((t) => t.id === id);
    if (!table) continue;
    result[id] = { x: startX, y };
    y += estimateNodeHeight(table) + 56;
  }
  return result;
}

export const useAiEditStore = create<AiEditState>((set, get) => ({
  status: "idle",
  instruction: "",
  summary: "",
  results: [],
  previewErd: null,
  previewPositions: {},
  diff: EMPTY_DIFF,
  error: null,

  request: async (instruction) => {
    const trimmed = instruction.trim();
    if (!trimmed || get().status === "loading") return;
    const base = useErdStore.getState().erd ?? EMPTY_ERD;
    set({ status: "loading", instruction: trimmed, error: null, summary: "", results: [], previewErd: null, diff: EMPTY_DIFF });

    let payload: { summary?: string; operations?: EditOp[]; error?: string };
    try {
      const response = await fetch("/api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: trimmed, schemaText: describeErdForAi(base) }),
      });
      payload = await response.json();
      if (!response.ok) {
        set({ status: "error", error: payload.error ?? `AI edit failed (HTTP ${response.status}).` });
        return;
      }
    } catch {
      set({ status: "error", error: "Couldn't reach the server. Check your connection and try again." });
      return;
    }

    // The schema may have changed while we waited; apply to the latest.
    const latest = useErdStore.getState().erd ?? EMPTY_ERD;
    const operations = payload.operations ?? [];
    const { erd: previewErd, results } = applyOps(latest, operations);
    const diff = computeDiff(latest, previewErd);

    set({
      status: "preview",
      summary: payload.summary || (operations.length === 0 ? "The AI didn't propose any changes." : ""),
      results,
      previewErd,
      diff,
      previewPositions: placeNewTables(previewErd, diff.addedTableIds, useErdStore.getState().positions),
    });
  },

  accept: () => {
    const { previewErd, previewPositions } = get();
    if (!previewErd) return;
    const { positions, erd } = useErdStore.getState();
    if (!erd) useErdStore.getState().startBlank();
    useErdStore.getState().loadErd(previewErd, { ...positions, ...previewPositions });
    set({ status: "idle", previewErd: null, previewPositions: {}, results: [], summary: "", diff: EMPTY_DIFF, instruction: "" });
  },

  discard: () =>
    set({ status: "idle", previewErd: null, previewPositions: {}, results: [], summary: "", diff: EMPTY_DIFF, error: null }),
}));
