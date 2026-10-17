import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { temporal } from "zundo";
import type { ERD } from "@/types/erd";
import {
  EMPTY_ERD,
  importErd,
  addTable as addTableOp,
  renameTable as renameTableOp,
  deleteTable as deleteTableOp,
  addColumn as addColumnOp,
  updateColumn as updateColumnOp,
  deleteColumn as deleteColumnOp,
  moveColumn as moveColumnOp,
  addCheckConstraint as addCheckOp,
  removeConstraint as removeConstraintOp,
  addIndex as addIndexOp,
  removeIndex as removeIndexOp,
  addRelationship as addRelationshipOp,
  updateRelationship as updateRelationshipOp,
  deleteRelationship as deleteRelationshipOp,
  type ColumnPatch,
  type EditResult,
  type RelationshipPatch,
} from "@/lib/erd/model";

export interface XY {
  x: number;
  y: number;
}

/**
 * The ERD being edited: the single source of truth for the diagram, the
 * generated SQL, simulation and export. Every edit goes through here so it
 * can be undone.
 */
interface ErdState {
  erd: ERD | null;
  positions: Record<string, XY>;
  /** Last rejected edit, shown as a toast. Not part of undo history. */
  lastError: string | null;

  /** Replace the schema. Undoable unless `resetHistory` (used when restoring a saved session). */
  loadErd: (erd: ERD | null, positions?: Record<string, XY>, options?: { resetHistory?: boolean }) => void;
  startBlank: () => void;
  setPositions: (positions: Record<string, XY>) => void;
  clearError: () => void;

  addTable: (position: XY) => string | null;
  renameTable: (tableId: string, name: string) => boolean;
  deleteTable: (tableId: string) => void;
  addColumn: (tableId: string) => string | null;
  updateColumn: (tableId: string, columnName: string, patch: ColumnPatch) => boolean;
  deleteColumn: (tableId: string, columnName: string) => void;
  moveColumn: (tableId: string, columnName: string, direction: -1 | 1) => void;
  addCheckConstraint: (tableId: string, expression: string) => boolean;
  removeConstraint: (tableId: string, constraintIndex: number) => void;
  addIndex: (tableId: string, columns: string[], unique: boolean) => boolean;
  removeIndex: (tableId: string, indexName: string) => void;
  addRelationship: (args: { fromTableId: string; toTableId: string; fromColumn?: string | null; toColumn?: string | null }) => string | null;
  updateRelationship: (relationshipId: string, patch: RelationshipPatch) => boolean;
  deleteRelationship: (relationshipId: string) => void;
}

export const useErdStore = create<ErdState>()(
  persist(
    temporal(
      (set, get) => {
        /** Apply an edit result: commit on success, surface the error otherwise. */
        const commit = <T extends object>(result: EditResult<T>): (EditResult<T> & { ok: true }) | null => {
          if (!result.ok) {
            set({ lastError: result.error });
            return null;
          }
          set({ erd: result.erd, lastError: null });
          return result;
        };

        const current = () => get().erd ?? EMPTY_ERD;

        return {
          erd: null,
          positions: {},
          lastError: null,

          loadErd: (erd, positions = {}, options) => {
            set({ erd: erd ? importErd(erd) : null, positions, lastError: null });
            if (options?.resetHistory) useErdStore.temporal.getState().clear();
          },

          startBlank: () => {
            set({ erd: { ...EMPTY_ERD }, positions: {}, lastError: null });
          },

          setPositions: (positions) => set({ positions: { ...get().positions, ...positions } }),

          clearError: () => set({ lastError: null }),

          addTable: (position) => {
            const result = addTableOp(current());
            if (!result.ok) {
              set({ lastError: result.error });
              return null;
            }
            set({ erd: result.erd, positions: { ...get().positions, [result.tableId]: position }, lastError: null });
            return result.tableId;
          },

          renameTable: (tableId, name) => Boolean(commit(renameTableOp(current(), tableId, name))),

          deleteTable: (tableId) => {
            const result = deleteTableOp(current(), tableId);
            if (!result.ok) {
              set({ lastError: result.error });
              return;
            }
            const positions = { ...get().positions };
            delete positions[tableId];
            set({ erd: result.erd, positions, lastError: null });
          },

          addColumn: (tableId) => commit(addColumnOp(current(), tableId))?.columnName ?? null,
          updateColumn: (tableId, columnName, patch) => Boolean(commit(updateColumnOp(current(), tableId, columnName, patch))),
          deleteColumn: (tableId, columnName) => void commit(deleteColumnOp(current(), tableId, columnName)),
          moveColumn: (tableId, columnName, direction) => void commit(moveColumnOp(current(), tableId, columnName, direction)),
          addCheckConstraint: (tableId, expression) => Boolean(commit(addCheckOp(current(), tableId, expression))),
          removeConstraint: (tableId, index) => void commit(removeConstraintOp(current(), tableId, index)),
          addIndex: (tableId, columns, unique) => Boolean(commit(addIndexOp(current(), tableId, columns, unique))),
          removeIndex: (tableId, indexName) => void commit(removeIndexOp(current(), tableId, indexName)),
          addRelationship: (args) => commit(addRelationshipOp(current(), args))?.relationshipId ?? null,
          updateRelationship: (id, patch) => Boolean(commit(updateRelationshipOp(current(), id, patch))),
          deleteRelationship: (id) => void commit(deleteRelationshipOp(current(), id)),
        };
      },
      {
        // Only the schema and layout are undoable.
        partialize: (state) => ({ erd: state.erd, positions: state.positions }),
        equality: (past, next) => past.erd === next.erd && past.positions === next.positions,
        limit: 100,
      }
    ),
    {
      name: "episteme-erd",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (state) => ({ erd: state.erd, positions: state.positions }),
    }
  )
);

export const undoErd = () => useErdStore.temporal.getState().undo();
export const redoErd = () => useErdStore.temporal.getState().redo();
