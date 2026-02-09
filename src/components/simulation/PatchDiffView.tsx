"use client";

import { diffLines } from "diff";

interface PatchDiffViewProps {
  beforeSql: string;
  afterSql: string;
}

export function PatchDiffView({ beforeSql, afterSql }: PatchDiffViewProps) {
  const parts = diffLines(beforeSql, afterSql);

  return (
    <pre className="mt-2 rounded bg-canvas p-2 text-xs font-mono overflow-x-auto border border-border">
      {parts.map((part, index) => {
        const className = part.added
          ? "text-success"
          : part.removed
            ? "text-error"
            : "text-muted";
        const prefix = part.added ? "+ " : part.removed ? "- " : "  ";

        return (
          <span key={`${index}-${prefix}`} className={className}>
            {part.value
              .split("\n")
              .filter((line) => line.length > 0)
              .map((line, lineIndex) => (
                <span key={`${index}-${lineIndex}`} className="block">
                  {prefix}
                  {line}
                </span>
              ))}
          </span>
        );
      })}
    </pre>
  );
}
