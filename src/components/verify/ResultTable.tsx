"use client";

/** A compact, scrollable table of query results (values already stringified). */
export function ResultTable({ columns, rows, maxHeight = 260 }: { columns: string[]; rows: string[][]; maxHeight?: number }) {
  if (columns.length === 0) return null;
  return (
    <div className="overflow-auto rounded-md border border-border" style={{ maxHeight }}>
      <table className="text-[11px] font-mono w-full">
        <thead className="bg-node-header sticky top-0">
          <tr>
            {columns.map((c, i) => (
              <th key={`${c}-${i}`} className="px-2 py-1 text-left font-semibold whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="px-2 py-1 text-muted" colSpan={columns.length}>
                No rows
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i} className="border-t border-border/60">
                {row.map((cell, j) => (
                  <td key={j} className={`px-2 py-1 whitespace-nowrap max-w-[240px] truncate ${cell === "NULL" ? "text-muted" : ""}`} title={cell}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
