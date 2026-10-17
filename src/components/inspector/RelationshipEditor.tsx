"use client";

import { useErdStore } from "@/store/useErdStore";
import { useCanvasStore } from "@/store/useCanvasStore";
import type { OnDeleteAction, Relationship } from "@/types/erd";
import type { Cardinality } from "@/types/ontology";
import { SectionHeader, SmallButton } from "./fields";

const ON_DELETE: Array<{ value: OnDeleteAction; label: string; help: (parent: string, child: string) => string }> = [
  { value: "RESTRICT", label: "Restrict", help: (p, c) => `A ${p} row can't be deleted while ${c} rows point to it.` },
  { value: "CASCADE", label: "Cascade", help: (p, c) => `Deleting a ${p} row also deletes its ${c} rows.` },
  { value: "SET_NULL", label: "Set null", help: (p, c) => `Deleting a ${p} row clears the reference in its ${c} rows.` },
  { value: "NO_ACTION", label: "No action", help: () => "Like Restrict, but checked at the end of the transaction (deferrable)." },
];

function describe(rel: Relationship): string[] {
  const child = rel.fromTable;
  const parent = rel.toTable;
  const many = rel.cardinality === "1:1" ? "at most one" : "many";
  return [
    `Each ${parent} row can have ${many} ${child} row${many === "many" ? "s" : ""}.`,
    rel.required
      ? `Each ${child} row must belong to exactly one ${parent} row.`
      : `A ${child} row may belong to one ${parent} row, or none.`,
  ];
}

export function RelationshipEditor({ relationship: rel }: { relationship: Relationship }) {
  const { updateRelationship, deleteRelationship } = useErdStore.getState();
  const cardinalities: Cardinality[] = rel.cardinality === "M:N" ? ["1:1", "1:N", "M:N"] : ["1:1", "1:N"];

  return (
    <div>
      <p className="font-mono text-[13px] text-foreground break-words">
        <span className="font-semibold">{rel.fromTable}</span>.{rel.fromColumn}
        <span className="text-muted"> → </span>
        <span className="font-semibold">{rel.toTable}</span>.{rel.toColumn}
      </p>
      <div className="mt-2 space-y-0.5">
        {describe(rel).map((line) => (
          <p key={line} className="text-[12px] text-muted leading-snug">
            {line}
          </p>
        ))}
      </div>

      <SectionHeader title="Cardinality" />
      <div className="inline-flex rounded-lg border border-border p-0.5 bg-white/60" role="radiogroup" aria-label="Cardinality">
        {cardinalities.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rel.cardinality === value}
            onClick={() => updateRelationship(rel.id, { cardinality: value })}
            className={`h-7 px-3 rounded-md text-[12px] font-mono transition-colors ${
              rel.cardinality === value ? "bg-[#EDE3D3] text-foreground font-semibold" : "text-muted hover:text-foreground"
            }`}
          >
            {value}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-muted">
        1:1 makes <span className="font-mono">{rel.fromColumn}</span> UNIQUE; 1:N allows repeats.
      </p>

      <SectionHeader title="Required" />
      <label className="flex items-start gap-2 text-[12px] text-foreground">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={rel.required}
          onChange={(e) => updateRelationship(rel.id, { required: e.target.checked })}
        />
        <span>
          Every <span className="font-mono">{rel.fromTable}</span> row must reference a{" "}
          <span className="font-mono">{rel.toTable}</span> row
          <span className="block text-[11px] text-muted">Sets {rel.fromColumn} to NOT NULL.</span>
        </span>
      </label>

      <SectionHeader title="On delete" />
      <div className="space-y-1">
        {ON_DELETE.map((option) => {
          const disabled = option.value === "SET_NULL" && rel.required;
          return (
            <label
              key={option.value}
              className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-[12px] ${
                rel.onDelete === option.value ? "bg-[rgba(0,0,0,0.035)]" : ""
              } ${disabled ? "opacity-45" : "cursor-pointer"}`}
              title={disabled ? "Make the relationship optional to use SET NULL" : undefined}
            >
              <input
                type="radio"
                name={`on-delete-${rel.id}`}
                className="mt-0.5"
                checked={rel.onDelete === option.value}
                disabled={disabled}
                onChange={() => updateRelationship(rel.id, { onDelete: option.value })}
              />
              <span>
                <span className="font-medium text-foreground">{option.label}</span>
                <span className="block text-[11px] text-muted">{option.help(rel.toTable, rel.fromTable)}</span>
              </span>
            </label>
          );
        })}
      </div>

      <div className="mt-8 -mx-5 px-5 pt-4 border-t border-border/70">
        <SmallButton
          tone="danger"
          onClick={() => {
            deleteRelationship(rel.id);
            useCanvasStore.getState().selectEdge(null);
          }}
        >
          Delete relationship
        </SmallButton>
        <p className="mt-1.5 text-[11px] text-muted">
          The <span className="font-mono">{rel.fromColumn}</span> column stays as a plain column. You can undo.
        </p>
      </div>
    </div>
  );
}
