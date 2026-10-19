"use client";

import { useState } from "react";

const SOURCES = [
  {
    id: "postgres",
    label: "Postgres",
    hint: "Also Supabase, Neon, RDS. Use your connection string.",
    command: 'pg_dump --schema-only --no-owner --no-privileges "$DATABASE_URL" > schema.sql',
  },
  { id: "mysql", label: "MySQL", hint: "Exports table definitions only, no data.", command: "mysqldump --no-data --skip-comments -u USER -p DATABASE > schema.sql" },
  { id: "sqlite", label: "SQLite", hint: "Point it at your database file.", command: "sqlite3 app.db .schema > schema.sql" },
  {
    id: "prisma",
    label: "Prisma",
    hint: "Turns schema.prisma into SQL without touching a database.",
    command: "npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > schema.sql",
  },
  { id: "drizzle", label: "Drizzle", hint: "Prints the SQL for your Drizzle schema.", command: "npx drizzle-kit export > schema.sql" },
] as const;

/**
 * How to bring an existing database in: one command per stack that writes
 * schema.sql (structure only, never data), which is then uploaded here.
 * Episteme never connects to your database.
 */
export function FromDatabase() {
  const [source, setSource] = useState<(typeof SOURCES)[number]["id"]>("postgres");
  const [copied, setCopied] = useState(false);
  const current = SOURCES.find((s) => s.id === source)!;

  return (
    <details className="rounded-lg border border-border bg-canvas/60 group">
      <summary className="px-3 py-2 cursor-pointer text-[12px] font-medium text-foreground select-none">
        Import from an existing database <span className="text-muted font-normal">· structure only, nothing leaves your machine except the file you choose</span>
      </summary>
      <div className="px-3 pb-3">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Database type">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={s.id === source}
              onClick={() => {
                setSource(s.id);
                setCopied(false);
              }}
              className={`h-7 px-2.5 rounded-md text-[12px] ${s.id === source ? "bg-pill text-foreground font-medium" : "text-muted hover:text-foreground"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted">1. Run this in your terminal. {current.hint}</p>
        <div className="mt-1 flex items-stretch gap-1.5">
          <code className="flex-1 min-w-0 px-2.5 py-2 rounded-md border border-border bg-surface font-mono text-[11.5px] text-foreground overflow-x-auto whitespace-nowrap">
            {current.command}
          </code>
          <button
            onClick={() =>
              void navigator.clipboard.writeText(current.command).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              })
            }
            className="shrink-0 px-2.5 rounded-md border border-border text-[12px] text-foreground hover:bg-foreground/[0.04]"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted">2. Click <span className="text-foreground">Upload .sql</span> below and pick schema.sql.</p>
      </div>
    </details>
  );
}
