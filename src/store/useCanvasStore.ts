import { create } from "zustand";
import {
  type Node,
  type Edge,
  type Viewport,
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import type { ERDNodeData, ERDEdgeData } from "@/types/erd";

type ERDNode = Node<ERDNodeData>;
type ERDEdge = Edge<ERDEdgeData>;

interface CanvasState {
  nodes: ERDNode[];
  edges: ERDEdge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  viewport: Viewport;

  // Node/edge changes (for React Flow callbacks)
  onNodesChange: (changes: NodeChange<ERDNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<ERDEdge>[]) => void;

  // Selection
  selectNode: (nodeId: string | null) => void;
  selectEdge: (edgeId: string | null) => void;

  // Set state
  setNodes: (nodes: ERDNode[]) => void;
  setEdges: (edges: ERDEdge[]) => void;
  setViewport: (viewport: Viewport) => void;

  // Add incrementally (for animation)
  addNode: (node: ERDNode) => void;
  addEdge: (edge: ERDEdge) => void;
  updateNodeData: (nodeId: string, data: Partial<ERDNodeData>) => void;

  // Reset
  reset: () => void;
}

const initialState = {
  nodes: [] as ERDNode[],
  edges: [] as ERDEdge[],
  selectedNodeId: null,
  selectedEdgeId: null,
  viewport: { x: 0, y: 0, zoom: 1 },
};

export const useCanvasStore = create<CanvasState>((set, get) => ({
  ...initialState,

  onNodesChange: (changes) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
    });
  },

  onEdgesChange: (changes) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
    });
  },

  selectNode: (nodeId) => set({
    selectedNodeId: nodeId,
    selectedEdgeId: null,
  }),

  selectEdge: (edgeId) => set({
    selectedEdgeId: edgeId,
    selectedNodeId: null,
  }),

  setNodes: (nodes) => set({ nodes }),

  setEdges: (edges) => set({ edges }),

  setViewport: (viewport) => set({ viewport }),

  addNode: (node) => set((state) => ({
    nodes: state.nodes.some((existing) => existing.id === node.id)
      ? state.nodes.map((existing) => (existing.id === node.id ? { ...existing, ...node } : existing))
      : [...state.nodes, node],
  })),

  addEdge: (edge) => set((state) => ({
    edges: state.edges.some((existing) => existing.id === edge.id)
      ? state.edges.map((existing) => (existing.id === edge.id ? { ...existing, ...edge } : existing))
      : [...state.edges, edge],
  })),

  updateNodeData: (nodeId, data) => set((state) => ({
    nodes: state.nodes.map((node) =>
      node.id === nodeId
        ? { ...node, data: { ...node.data, ...data } }
        : node
    ),
  })),

  reset: () => set(initialState),
}));
