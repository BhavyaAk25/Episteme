"use client";

import { useErdStore } from "@/store/useErdStore";

import { useRef, useState } from "react";

/**
 * Text input that edits a committed value: changes apply on Enter or blur,
 * Escape reverts. If `onCommit` rejects the value it snaps back.
 */
export function CommitInput({
  value,
  onCommit,
  className = "",
  placeholder,
  list,
  ariaLabel,
  autoFocus,
}: {
  value: string;
  onCommit: (next: string) => boolean | void;
  className?: string;
  placeholder?: string;
  list?: string;
  ariaLabel: string;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [syncedValue, setSyncedValue] = useState(value);
  const skipCommit = useRef(false);

  // Follow outside changes (undo, rename elsewhere) without an effect.
  if (value !== syncedValue) {
    setSyncedValue(value);
    setDraft(value);
  }

  const commit = () => {
    if (skipCommit.current) {
      skipCommit.current = false;
      return;
    }
    if (draft !== value && onCommit(draft) === false) setDraft(value);
  };

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          // Blurring commits (via onBlur), so Enter never commits twice.
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          skipCommit.current = true;
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder={placeholder}
      list={list}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      spellCheck={false}
      className={`min-w-0 h-8 px-2 rounded-md border border-transparent bg-transparent hover:border-border focus:border-accent focus:bg-elevated focus:outline-none focus:ring-2 focus:ring-accent/15 transition-colors ${className}`}
    />
  );
}

/** Small pill toggle used for PK / NOT NULL / UNIQUE. */
export function FlagToggle({
  label,
  title,
  active,
  disabled,
  onChange,
  tone = "neutral",
}: {
  label: string;
  title: string;
  active: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  tone?: "neutral" | "key" | "unique" | "danger";
}) {
  const activeTone = {
    neutral: "bg-pill text-foreground border-border-hover",
    key: "bg-warning/15 text-warning border-warning/40",
    unique: "bg-teal/15 text-teal border-teal/40",
    danger: "bg-error/10 text-error border-error/30",
  }[tone];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!active)}
      className={`h-6 px-2 rounded-md border text-[10px] font-mono font-semibold transition-colors disabled:opacity-40 ${
        active ? activeTone : "border-border/70 text-muted hover:text-foreground hover:border-border"
      }`}
    >
      {label}
    </button>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mt-6 mb-2 -mx-5 px-5 pt-4 border-t border-border/70 flex items-center justify-between">
      <h4 className="ui-section-title">{title}</h4>
      {action}
    </div>
  );
}

export function SmallButton({
  onClick,
  children,
  title,
  disabled,
  tone = "neutral",
  type = "button",
}: {
  onClick?: () => void;
  children: React.ReactNode;
  title?: string;
  disabled?: boolean;
  tone?: "neutral" | "danger" | "primary";
  type?: "button" | "submit";
}) {
  const toneClass = {
    neutral: "text-foreground border-border hover:bg-foreground/[0.04]",
    danger: "text-error border-error/30 hover:bg-error/10",
    primary: "text-accent border-accent/30 hover:bg-accent/10",
  }[tone];
  return (
    <button
      type={type}
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`h-7 px-2.5 rounded-md border text-[12px] font-medium transition-colors disabled:opacity-40 ${toneClass}`}
    >
      {children}
    </button>
  );
}

export const COMMON_TYPES = [
  "SERIAL",
  "BIGSERIAL",
  "INTEGER",
  "BIGINT",
  "SMALLINT",
  "NUMERIC(12,2)",
  "REAL",
  "DOUBLE PRECISION",
  "BOOLEAN",
  "TEXT",
  "VARCHAR(255)",
  "CHAR(3)",
  "UUID",
  "DATE",
  "TIME",
  "TIMESTAMP",
  "TIMESTAMPTZ",
  "JSONB",
  "BYTEA",
];

export function TypeOptions() {
  const enumNames = useErdStore((state) => state.erd?.enums?.map((e) => e.name).join(",") ?? "");
  return (
    <datalist id="erd-column-types">
      {enumNames.split(",").filter(Boolean).map((name) => (
        <option key={`enum-${name}`} value={name} label={`enum ${name}`} />
      ))}
      {COMMON_TYPES.map((type) => (
        <option key={type} value={type} />
      ))}
    </datalist>
  );
}
