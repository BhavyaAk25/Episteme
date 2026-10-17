"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useUIStore } from "@/store/useUIStore";
import { useErdStore } from "@/store/useErdStore";
import { useReplayView } from "@/lib/erd/useReplayView";
import { TableEditor } from "./TableEditor";
import { RelationshipEditor } from "./RelationshipEditor";

/** Right-hand panel: edit the selected table or relationship. */
export function RightInspector() {
  const { selectedNodeId, selectedEdgeId } = useCanvasStore();
  const { inspectorOpen, closeInspector, inspectorWidth } = useUIStore();
  const erd = useErdStore((state) => state.erd);
  const { locked: replaying } = useReplayView();

  const table = selectedNodeId ? erd?.tables.find((t) => t.id === selectedNodeId) : undefined;
  const relationship = selectedEdgeId ? erd?.relationships.find((r) => r.id === selectedEdgeId) : undefined;
  const visible = inspectorOpen && !replaying && Boolean(table || relationship);

  return (
    <AnimatePresence>
      {visible && (
        <motion.aside
          initial={{ x: inspectorWidth, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: inspectorWidth, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="h-full bg-surface border-l border-border flex flex-col overflow-hidden shadow-sm shrink-0"
          style={{ width: inspectorWidth }}
          aria-label={table ? "Table editor" : "Relationship editor"}
        >
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">
              {table ? "Table" : "Relationship"}
            </h2>
            <button
              onClick={closeInspector}
              aria-label="Close inspector"
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-foreground/[0.05] transition-colors"
            >
              <svg className="w-5 h-5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 pt-4 pb-8">
            {table && <TableEditor key={table.id} table={table} />}
            {!table && relationship && <RelationshipEditor key={relationship.id} relationship={relationship} />}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
