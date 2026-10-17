/**
 * SVG marker definitions for crow's-foot notation. Each marker is drawn with
 * its tip (x = 24) at the table edge, so the same shape works at both ends
 * of an edge (`orient="auto-start-reverse"`).
 *
 *   one-mandatory  ||     one-optional  o|
 *   many-mandatory |<     many-optional o<
 */
export type EndKind = "one-mandatory" | "one-optional" | "many-mandatory" | "many-optional";

export const MARKER_COLORS = {
  default: "#A88A5C",
  selected: "#2f6eb8",
} as const;

export function markerId(kind: EndKind, tone: keyof typeof MARKER_COLORS): string {
  return `erd-${kind}-${tone}`;
}

function Shape({ kind, color }: { kind: EndKind; color: string }) {
  const stroke = { stroke: color, strokeWidth: 1.5, fill: "none" } as const;
  const circle = (cx: number) => (
    <circle cx={cx} cy={10} r={3.5} stroke={color} strokeWidth={1.5} style={{ fill: "var(--bg-canvas)" }} />
  );
  const crow = <path d="M13 10 L24 3 M13 10 L24 17 M13 10 L24 10" {...stroke} />;

  switch (kind) {
    case "one-mandatory":
      return <path d="M13 4 V16 M18 4 V16" {...stroke} />;
    case "one-optional":
      return (
        <>
          {circle(8)}
          <path d="M17 4 V16" {...stroke} />
        </>
      );
    case "many-mandatory":
      return (
        <>
          <path d="M9 4 V16" {...stroke} />
          {crow}
        </>
      );
    case "many-optional":
      return (
        <>
          {circle(6)}
          {crow}
        </>
      );
  }
}

const KINDS: EndKind[] = ["one-mandatory", "one-optional", "many-mandatory", "many-optional"];

export function CrowsFootMarkers() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {KINDS.flatMap((kind) =>
          (Object.keys(MARKER_COLORS) as Array<keyof typeof MARKER_COLORS>).map((tone) => (
            <marker
              key={markerId(kind, tone)}
              id={markerId(kind, tone)}
              viewBox="0 0 24 20"
              refX={24}
              refY={10}
              markerWidth={24}
              markerHeight={20}
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
