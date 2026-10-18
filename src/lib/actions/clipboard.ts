import { useCanvasStore } from "@/store/useCanvasStore";
import { useErdStore } from "@/store/useErdStore";
import { copyTables } from "@/lib/erd/model";

/** Select newly pasted/duplicated tables once they're on the canvas. */
export function selectPasted(ids: string[]) {
  if (ids.length === 0) return;
  setTimeout(() => {
    const wanted = new Set(ids);
    useCanvasStore.getState().setNodes(useCanvasStore.getState().nodes.map((n) => ({ ...n, selected: wanted.has(n.id) })));
  }, 60);
}

export function duplicateTables(ids: string[]) {
  const erd = useErdStore.getState().erd;
  if (!erd || ids.length === 0) return;
  selectPasted(useErdStore.getState().pasteTables(copyTables(erd, ids), { x: 48, y: 48 }));
}

