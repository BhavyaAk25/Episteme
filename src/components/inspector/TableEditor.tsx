"use client";

import { useState } from "react";
import { useErdStore } from "@/store/useErdStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useCanvasStore } from "@/store/useCanvasStore";
import { isColumnUnique } from "@/lib/erd/model";
import { TABLE_COLORS, TABLE_COLOR_NAMES } from "@/lib/erd/colors";
import type { Table } from "@/types/erd";
import { CommitInput, FlagToggle, SectionHeader, SmallButton, TypeOptions } from "./fields";

function ColumnRow({ table, index }: { table: Table; index: number }) {
  const column = table.columns[index];
  const { updateColumn, deleteColumn, moveColumn } = useErdStore.getState();
  const unique = isColumnUnique(table, column.name);

  return (
    <div className="group rounded-lg border border-transparent hover:border-border/70 hover:bg-elevated/60 px-1.5 py-1.5 transition-colors">
      <div className="flex items-center gap-1">
        <CommitInput
          value={column.name}
          ariaLabel={`Column name ${column.name}`}
          className="flex-1 font-mono text-[12px] text-foreground"
          onCommit={(name) => updateColumn(table.id, column.name, { name })}
        />
        <CommitInput
          value={column.dataType}
          list="erd-column-types"
          ariaLabel={`Type of ${column.name}`}
          className="w-[118px] font-mono text-[11px] text-muted text-right"
          onCommit={(dataType) => updateColumn(table.id, column.name, { dataType })}
        />
        <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => moveColumn(table.id, column.name, -1)}
            disabled={index === 0}
            aria-label={`Move ${column.name} up`}
            className="w-6 h-6 rounded text-muted hover:text-foreground disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => moveColumn(table.id, column.name, 1)}
            disabled={index === table.columns.length - 1}
            aria-label={`Move ${column.name} down`}
            className="w-6 h-6 rounded text-muted hover:text-foreground disabled:opacity-30"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => deleteColumn(table.id, column.name)}
            aria-label={`Delete column ${column.name}`}
            title="Delete column"
            className="w-6 h-6 rounded text-muted hover:text-error"
          >
            ×
          </button>
        </div>
      </div>

      <div className="mt-1 pl-2 flex flex-wrap items-center gap-1">
        <FlagToggle
          label="PK"
          title="Primary key"
          tone="key"
          active={column.isPrimaryKey}
          onChange={(isPrimaryKey) => updateColumn(table.id, column.name, { isPrimaryKey })}
        />
        <FlagToggle
          label="NOT NULL"
          title={column.isPrimaryKey ? "Primary keys are always NOT NULL" : "Value is required"}
          active={!column.nullable}
          disabled={column.isPrimaryKey}
          onChange={(notNull) => updateColumn(table.id, column.name, { nullable: !notNull })}
        />
        <FlagToggle
          label="UNIQUE"
          title="No two rows may share this value"
          tone="unique"
          active={unique}
          disabled={column.isPrimaryKey}
          onChange={(next) => updateColumn(table.id, column.name, { unique: next })}
        />
        {column.isForeignKey && (
          <span
            className="h-6 px-2 rounded-md bg-accent/10 text-accent text-[10px] font-mono font-semibold inline-flex items-center"
            title="Foreign key — edit it by selecting the relationship line"
          >
            → {column.referencesTable}.{column.referencesColumn}
          </span>
        )}
        <CommitInput
          value={column.defaultValue ?? ""}
          placeholder="default"
          ariaLabel={`Default value of ${column.name}`}
          className="ml-auto w-[96px] h-6 font-mono text-[10px] text-muted"
          onCommit={(defaultValue) => updateColumn(table.id, column.name, { defaultValue })}
        />
      </div>
    </div>
  );
}

function IndexForm({ table }: { table: Table }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [unique, setUnique] = useState(false);

  const toggle = (name: string) =>
    setSelected((current) => (current.includes(name) ? current.filter((c) => c !== name) : [...current, name]));

  return (
    <div className="mt-2 rounded-lg border border-dashed border-border p-2">
      <p className="text-[11px] text-muted mb-1.5">New index — pick columns in order:</p>
      <div className="flex flex-wrap gap-1">
        {table.columns.map((column) => {
          const position = selected.indexOf(column.name);
          return (
            <button
              key={column.name}
              type="button"
              onClick={() => toggle(column.name)}
              className={`h-6 px-2 rounded-md border text-[10px] font-mono transition-colors ${
                position >= 0 ? "bg-accent/10 border-accent/40 text-accent" : "border-border/70 text-muted hover:text-foreground"
              }`}
            >
              {position >= 0 ? `${position + 1}. ` : ""}
              {column.name}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-[11px] text-muted">
          <input type="checkbox" checked={unique} onChange={(e) => setUnique(e.target.checked)} />
          Unique
        </label>
        <SmallButton
          tone="primary"
          disabled={selected.length === 0}
          onClick={() => {
            if (useErdStore.getState().addIndex(table.id, selected, unique)) {
              setSelected([]);
              setUnique(false);
            }
          }}
        >
          Add index
        </SmallButton>
      </div>
    </div>
  );
}

export function TableEditor({ table }: { table: Table }) {
  const { renameTable, addColumn, deleteTable, addCheckConstraint, removeConstraint, removeIndex } =
    useErdStore.getState();
  const ontology = useProjectStore((state) => state.ontology);
  const description = ontology?.objectTypes.find((o) => o.id === table.objectTypeId)?.description;
  const [checkDraft, setCheckDraft] = useState("");

  const extraConstraints = table.constraints
    .map((constraint, index) => ({ constraint, index }))
    .filter(({ constraint }) => constraint.type === "CHECK" || (constraint.type === "UNIQUE" && constraint.columns.length > 1));

  return (
    <div>
      <TypeOptions />
      <CommitInput
        value={table.name}
        ariaLabel="Table name"
        className="w-full -ml-2 h-9 font-mono text-[16px] font-semibold text-foreground"
        onCommit={(name) => renameTable(table.id, name)}
      />
      {description && <p className="mt-1 text-[12px] text-muted leading-snug">{description}</p>}
      <div className="mt-3 flex items-center gap-1.5" role="radiogroup" aria-label="Table color">
        <span className="text-[11px] text-muted mr-1">Color</span>
        {TABLE_COLOR_NAMES.map((color) => (
          <button
            key={color}
            role="radio"
            aria-checked={table.color === color}
            aria-label={color}
            title={color}
            onClick={() => useErdStore.getState().setTableColor([table.id], table.color === color ? null : color)}
            className={`w-5 h-5 rounded-full border-2 transition-transform ${table.color === color ? "border-foreground scale-110" : "border-transparent"}`}
            style={{ background: TABLE_COLORS[color] }}
          />
        ))}
      </div>

      <SectionHeader
        title={`Columns (${table.columns.length})`}
        action={<SmallButton onClick={() => addColumn(table.id)}>+ Column</SmallButton>}
      />
      <div className="-mx-1.5 space-y-0.5">
        {table.columns.map((column, index) => (
          <ColumnRow key={column.name} table={table} index={index} />
        ))}
      </div>

      <SectionHeader title={`Constraints (${extraConstraints.length})`} />
      <div className="space-y-1">
        {extraConstraints.map(({ constraint, index }) => (
          <div key={index} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-foreground/[0.025]">
            <span className={`text-[10px] font-mono font-semibold ${constraint.type === "CHECK" ? "text-warning" : "text-teal"}`}>
              {constraint.type}
            </span>
            <span className="flex-1 min-w-0 truncate font-mono text-[11px] text-foreground">
              {constraint.type === "CHECK" ? constraint.expression : `(${constraint.columns.join(", ")})`}
            </span>
            <button
              type="button"
              onClick={() => removeConstraint(table.id, index)}
              aria-label="Remove constraint"
              className="text-muted hover:text-error"
            >
              ×
            </button>
          </div>
        ))}
        <form
          className="flex items-center gap-1.5 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (addCheckConstraint(table.id, checkDraft)) setCheckDraft("");
          }}
        >
          <input
            value={checkDraft}
            onChange={(e) => setCheckDraft(e.target.value)}
            placeholder="CHECK, e.g. price >= 0"
            aria-label="New CHECK constraint"
            spellCheck={false}
            className="flex-1 min-w-0 h-7 px-2 rounded-md border border-border bg-elevated/70 font-mono text-[11px] focus:outline-none focus:border-accent"
          />
          <SmallButton type="submit" tone="primary" disabled={!checkDraft.trim()}>
            Add
          </SmallButton>
        </form>
      </div>

      <SectionHeader title={`Indexes (${table.indexes.length})`} />
      <div className="space-y-1">
        {table.indexes.map((index) => (
          <div key={index.name} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-foreground/[0.025]">
            <span className="flex-1 min-w-0 truncate font-mono text-[11px] text-foreground" title={index.name}>
              ({index.columns.join(", ")})
            </span>
            {index.unique && <span className="text-[10px] font-mono font-semibold text-teal">UNIQUE</span>}
            <button
              type="button"
              onClick={() => removeIndex(table.id, index.name)}
              aria-label={`Remove index ${index.name}`}
              className="text-muted hover:text-error"
            >
              ×
            </button>
          </div>
        ))}
        <IndexForm table={table} />
      </div>

      <div className="mt-8 -mx-5 px-5 pt-4 border-t border-border/70">
        <SmallButton
          tone="danger"
          onClick={() => {
            deleteTable(table.id);
            useCanvasStore.getState().selectNode(null);
          }}
        >
          Delete table
        </SmallButton>
        <p className="mt-1.5 text-[11px] text-muted">Relationships to and from this table are removed too. You can undo.</p>
      </div>
    </div>
  );
}
