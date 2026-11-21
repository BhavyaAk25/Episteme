/**
 * SVG marker definitions for crow's-foot notation. Each marker is drawn with
 * its tip (x = 20) at the table edge, so the same shape works at both ends
 * of an edge (`orient="auto-start-reverse"`).
 *
 *   one-mandatory  ||     one-optional  o|
 *   many-mandatory |<     many-optional o<
 */
export type EndKind = "one-mandatory" | "one-optional" | "many-mandatory" | "many-optional";

export const MARKER_COLORS = {
  default: "var(--edge)",
  selected: "var(--edge-selected)",
} as const;

export function markerId(kind: EndKind, tone: keyof typeof MARKER_COLORS): string {
  return `erd-${kind}-${tone}`;
}

function Shape({ kind, color }: { kind: EndKind; color: string }) {
  // Colors come from CSS variables, so they're set via style (not attributes).
  // Drawn on a 20x16 grid with the tip at x = 20 (the table edge).
  const line = { style: { stroke: color, fill: "none" }, strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  const ring = (cx: number) => (
    <circle cx={cx} cy={8} r={2.75} strokeWidth={1.4} style={{ stroke: color, fill: "var(--bg-canvas)" }} />
  );
  // The crow's foot: three prongs meeting 8px from the table.
  const crow = <path d="M12 8 L20 2.5 M12 8 L20 13.5 M12 8 L20 8" {...line} />;

  switch (kind) {
    case "one-mandatory":
      return <path d="M12.5 3.5 V12.5 M16 3.5 V12.5" {...line} />;
    case "one-optional":
      return (
        <>
          {ring(8)}
          <path d="M15.5 3.5 V12.5" {...line} />
        </>
      );
    case "many-mandatory":
      return (
        <>
          <path d="M9 3.5 V12.5" {...line} />
          {crow}
        </>
      );
    case "many-optional":
      return (
        <>
          {ring(7)}
          {crow}
        </>
      );
  }
}

const KINDS: EndKind[] = ["one-mandatory", "one-optional", "many-mandatory", "many-optional"];

export function CrowsFootMarkers() {
  return (
    <svg id="erd-marker-defs" width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {KINDS.flatMap((kind) =>
          (Object.keys(MARKER_COLORS) as Array<keyof typeof MARKER_COLORS>).map((tone) => (
            <marker
              key={markerId(kind, tone)}
              id={markerId(kind, tone)}
              viewBox="0 0 20 16"
              refX={20}
              refY={8}
              markerWidth={20}
              markerHeight={16}
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <Shape kind={kind} color={MARKER_COLORS[tone]} />
            </marker>
          ))
        )}
      </defs>
    </svg>
  );
}
