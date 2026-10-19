/**
 * Offline helpers that read a schema without AI: example queries for the
 * playground and a plain-English description of each table.
 */
import type { ERD, Relationship, Table } from "@/types/erd";
import type { ExplainAnswer } from "@/lib/gemini/schemas";

export interface ExampleQuery {
  label: string;
  sql: string;
}

const singular = (name: string) =>
  name.endsWith("ies") ? `${name.slice(0, -3)}y` : /(ss|x|ch|sh)es$/.test(name) ? name.slice(0, -2) : name.endsWith("s") && !name.endsWith("ss") ? name.slice(0, -1) : name;
const words = (name: string) => name.replace(/_/g, " ");

/** The column that best names a row: name, title, email… or the key. */
function labelColumn(table: Table): string | null {
  const text = table.columns.filter((c) => !c.isPrimaryKey && !c.isForeignKey);
  return (
    text.find((c) => /^(name|title|full_name|display_name|username|email|label|slug|code|sku)$/.test(c.name))?.name ??
    text.find((c) => /name|title/.test(c.name))?.name ??
    text.find((c) => /CHAR|TEXT/i.test(c.dataType))?.name ??
    null
  );
}

const pkOf = (table: Table) => table.columns.find((c) => c.isPrimaryKey)?.name ?? null;

export function exampleQueries(erd: ERD, max = 8): ExampleQuery[] {
  const byName = new Map(erd.tables.map((t) => [t.name, t]));
  const queries: ExampleQuery[] = [];
  const rels = erd.relationships.filter((r) => r.fromTable !== r.toTable);

  // Rows with their parent's label, along the busiest relationships first.
  for (const rel of rels.slice(0, 3)) {
    const parent = byName.get(rel.toTable);
    if (!parent) continue;
    const label = labelColumn(parent);
    queries.push({
      label: `${words(rel.fromTable)} with their ${words(singular(rel.toTable))}`,
      sql: `SELECT c.*, p.${label ?? rel.toColumn} AS ${singular(rel.toTable)}_${label ?? rel.toColumn}\nFROM ${rel.fromTable} c\nJOIN ${rel.toTable} p ON p.${rel.toColumn} = c.${rel.fromColumn}\nLIMIT 20;`,
    });
  }

  // Parents ranked by how many children they have.
  const seen = new Set<string>();
  for (const rel of rels) {
    const parent = byName.get(rel.toTable);
    const pk = parent ? pkOf(parent) : null;
    if (!parent || !pk || seen.has(rel.toTable)) continue;
    seen.add(rel.toTable);
    const label = labelColumn(parent);
    queries.push({
      label: `${words(rel.toTable)} by number of ${words(rel.fromTable)}`,
      sql: `SELECT p.${pk}${label ? `, p.${label}` : ""}, count(c.${rel.fromColumn}) AS ${rel.fromTable}_count\nFROM ${rel.toTable} p\nLEFT JOIN ${rel.fromTable} c ON c.${rel.fromColumn} = p.${rel.toColumn}\nGROUP BY p.${pk}${label ? `, p.${label}` : ""}\nORDER BY ${rel.fromTable}_count DESC;`,
    });
    if (seen.size >= 2) break;
  }

  // Most recent rows of a timestamped table.
  const timed = erd.tables.find((t) => t.columns.some((c) => c.name === "created_at"));
  if (timed) queries.push({ label: `latest ${words(timed.name)}`, sql: `SELECT *\nFROM ${timed.name}\nORDER BY created_at DESC\nLIMIT 10;` });

  for (const view of erd.views ?? []) queries.push({ label: `view ${view.name}`, sql: `SELECT * FROM ${view.name} LIMIT 20;` });

  if (queries.length === 0 && erd.tables[0]) queries.push({ label: `all ${words(erd.tables[0].name)}`, sql: `SELECT * FROM ${erd.tables[0].name} LIMIT 20;` });
  return queries.slice(0, max);
}

function relationSentence(rel: Relationship, from: "child" | "parent"): string {
  const child = words(singular(rel.fromTable));
  const parent = words(singular(rel.toTable));
  if (from === "child") {
    if (rel.fromTable === rel.toTable) return `can point to another ${child} (${rel.fromColumn})`;
    return `${rel.required ? "belongs to" : "may belong to"} one ${parent}`;
  }
  return rel.cardinality === "1:1" ? `has at most one ${child}` : `has many ${words(rel.fromTable)}`;
}

/** A plain-English explanation built from the structure alone. */
export function describeSchemaOffline(erd: ERD): ExplainAnswer {
  const degree = (t: Table) => erd.relationships.filter((r) => r.fromTable === t.name || r.toTable === t.name).length;
  const ordered = [...erd.tables].sort((a, b) => degree(b) - degree(a));
  const hubs = ordered.slice(0, 3).filter((t) => degree(t) > 0).map((t) => t.name);

  const tables = ordered.map((table) => {
    const parts = [
      ...erd.relationships.filter((r) => r.fromTable === table.name).map((r) => relationSentence(r, "child")),
      ...erd.relationships.filter((r) => r.toTable === table.name && r.fromTable !== table.name).map((r) => relationSentence(r, "parent")),
    ];
    // A pure link table: two or more foreign keys and nothing else but keys and timestamps.
    const isJunction =
      table.columns.filter((c) => c.isForeignKey).length >= 2 &&
      table.columns.every((c) => c.isForeignKey || c.isPrimaryKey || /^(created_at|updated_at)$/.test(c.name));
    const base = table.comment
      ? table.comment
      : isJunction
        ? `Links ${erd.relationships.filter((r) => r.fromTable === table.name).map((r) => words(r.toTable)).join(" and ")} (many-to-many).`
        : `Each row is a ${words(singular(table.name))}.`;
    return { name: table.name, purpose: parts.length ? `${base} A ${words(singular(table.name))} ${parts.join(", ")}.` : base };
  });

  const overview =
    erd.tables.length === 0
      ? "The schema is empty."
      : `${erd.tables.length} table${erd.tables.length === 1 ? "" : "s"} and ${erd.relationships.length} relationship${erd.relationships.length === 1 ? "" : "s"}.` +
        (hubs.length ? ` The most connected tables are ${hubs.join(", ")}.` : "") +
        (erd.enums?.length ? ` ${erd.enums.length} enum type${erd.enums.length === 1 ? "" : "s"} define fixed value lists.` : "") +
        (erd.views?.length ? ` ${erd.views.length} view${erd.views.length === 1 ? "" : "s"} provide saved queries.` : "");

  const notes = [
    ...erd.relationships.filter((r) => r.onDelete === "CASCADE").slice(0, 2).map((r) => `Deleting a ${words(singular(r.toTable))} also deletes its ${words(r.fromTable)} (ON DELETE CASCADE).`),
  ];
  return { overview, tables, flows: [], notes };
}
