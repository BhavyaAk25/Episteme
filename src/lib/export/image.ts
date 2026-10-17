import { getNodesBounds, getViewportForBounds, type Node } from "@xyflow/react";

/**
 * Render the whole diagram (not just the visible part) to PNG or SVG,
 * using html-to-image the way React Flow recommends.
 */
export async function exportDiagramImage(nodes: Node[], format: "png" | "svg", fileName: string): Promise<void> {
  const viewportEl = document.querySelector<HTMLElement>(".react-flow__viewport");
  if (!viewportEl || nodes.length === 0) throw new Error("Nothing to export yet.");
  const { toPng, toSvg } = await import("html-to-image");

  const padding = 48;
  const bounds = getNodesBounds(nodes);
  const width = Math.min(8000, Math.ceil(bounds.width + padding * 2));
  const height = Math.min(8000, Math.ceil(bounds.height + padding * 2));
  // Padding is in pixels (a bare number would be read as a fraction of the size).
  const viewport = getViewportForBounds(bounds, width, height, 0.1, 2, `${padding}px`);
  const background = getComputedStyle(document.body).getPropertyValue("--bg-canvas").trim() || "#f6efe5";

  const options = {
    backgroundColor: background,
    width,
    height,
    pixelRatio: format === "png" ? 2 : 1,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
    },
    // Leave out connection dots; they're editing affordances.
    filter: (node: HTMLElement) => !(node.classList && node.classList.contains("react-flow__handle")),
  };

  // Edge markers (crow's feet) are defined outside the viewport; copy them in
  // for the capture so the image keeps the notation.
  const markerDefs = document.getElementById("erd-marker-defs")?.cloneNode(true) as HTMLElement | undefined;
  if (markerDefs) {
    markerDefs.removeAttribute("id");
    viewportEl.appendChild(markerDefs);
  }
  let dataUrl: string;
  try {
    dataUrl = format === "png" ? await toPng(viewportEl, options) : await toSvg(viewportEl, options);
  } finally {
    markerDefs?.remove();
  }
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = `${fileName}.${format}`;
  link.click();
}
