import { create } from "zustand";
import { type Node, type Viewport, applyNodeChanges, type NodeChange } from "@xyflow/react";
import type { ERDNodeData } from "@/types/erd";

type ERDNode = Node<ERDNodeData>;

/**
 * View state for the diagram. The schema itself lives in useErdStore;
 * `nodes` here is React Flow's working copy (drag positions, measured sizes,
 * selection), rebuilt from the ERD whenever it changes.
 */
interface CanvasState {
  nodes: ERDNode[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  viewport: Viewport;
  /** Bumped when the whole diagram should be re-fitted (new schema, tidy up). */
  fitRequest: number;
  /** Set when one table should be brought into view. */
  focusRequest: { nodeId: string; seq: number } | null;

  onNodesChange: (changes: NodeChange<ERDNode>[]) => void;
  setNodes: (nodes: ERDNode[]) => void;
  selectNode: (nodeId: string | null) => void;
  selectEdge: (edgeId: string | null) => void;
  setViewport: (viewport: Viewport) => void;
  requestFit: () => void;
  requestFocus: (nodeId: string) => void;
  reset: () => void;
}

const initialState = {
  nodes: [] as ERDNode[],
  selectedNodeId: null,
  selectedEdgeId: null,
  viewport: { x: 0, y: 0, zoom: 1 },
  fitRequest: 0,
  focusRequest: null as { nodeId: string; seq: number } | null,
};

export const useCanvasStore = create<CanvasState>((set, get) => ({
  ...initialState,

  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
  setNodes: (nodes) => set({ nodes }),
  selectNode: (nodeId) => set({ selectedNodeId: nodeId, selectedEdgeId: null }),
  selectEdge: (edgeId) => set({ selectedEdgeId: edgeId, selectedNodeId: null }),
  setViewport: (viewport) => set({ viewport }),
  requestFit: () => set({ fitRequest: get().fitRequest + 1 }),
  requestFocus: (nodeId) => set({ focusRequest: { nodeId, seq: (get().focusRequest?.seq ?? 0) + 1 } }),
  reset: () => set(initialState),
}));
