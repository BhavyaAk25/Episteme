import type { Column, Table } from "@/types/erd";

/**
 * Realistic Postgres literals for seed rows and tests. Picks values that
 * satisfy the column's type and, where it can tell, its CHECK constraints.
 */

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

const FIRST = ["Ada", "Grace", "Alan", "Linus", "Maya", "Noah", "Iris", "Omar", "Lena", "Ravi"];
const LAST = ["Lovelace", "Hopper", "Turing", "Torvalds", "Patel", "Kim", "Garcia", "Okafor", "Novak", "Silva"];
const WORDS = ["Aurora", "Summit", "Harbor", "Cedar", "Atlas", "Nova", "Willow", "Orion", "Maple", "Vertex"];

export function isAutoIncrement(column: Column): boolean {
  return /SERIAL/i.test(column.dataType) || /nextval|identity/i.test(column.defaultValue ?? "");
}

function varcharLimit(dataType: string): number | null {
  const match = dataType.match(/(?:VAR)?CHAR(?:ACTER)?(?:\s+VARYING)?\s*\((\d+)\)/i);
  return match ? Number(match[1]) : null;
}

/** Values allowed by a CHECK like `status IN ('a', 'b')` on this column. */
function allowedValues(table: Table, column: Column): string[] | null {
  for (const constraint of table.constraints) {
    if (constraint.type !== "CHECK" || !constraint.expression) continue;
    const match = constraint.expression.match(new RegExp(`\\b${column.name}\\b\\s+IN\\s*\\(([^)]*)\\)`, "i"));
    if (match) {
      const values = [...match[1].matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
      if (values.length > 0) return values;
    }
  }
  return null;
}

/** Numeric bounds from CHECKs like `price >= 0`, `rating BETWEEN 1 AND 5`. */
function numericBounds(table: Table, column: Column): { min: number; max: number } {
  let min = Number.NEGATIVE_INFINITY;
  let max = Number.POSITIVE_INFINITY;
  for (const constraint of table.constraints) {
    if (constraint.type !== "CHECK" || !constraint.expression) continue;
    const expr = constraint.expression;
    const between = expr.match(new RegExp(`\\b${column.name}\\b\\s+BETWEEN\\s+(-?[\\d.]+)\\s+AND\\s+(-?[\\d.]+)`, "i"));
    if (between) {
      min = Math.max(min, Number(between[1]));
      max = Math.min(max, Number(between[2]));
    }
    for (const m of expr.matchAll(new RegExp(`\\b${column.name}\\b\\s*(>=|<=|>|<)\\s*(-?[\\d.]+)`, "gi"))) {
      const bound = Number(m[2]);
      if (m[1] === ">=") min = Math.max(min, bound);
      if (m[1] === ">") min = Math.max(min, bound + 1);
      if (m[1] === "<=") max = Math.min(max, bound);
      if (m[1] === "<") max = Math.min(max, bound - 1);
    }
  }
  return { min, max };
}

function numberInRange(table: Table, column: Column, preferred: number): number {
  const { min, max } = numericBounds(table, column);
  let value = preferred;
  if (value < min) value = min;
  if (value > max) value = max;
  if (!Number.isFinite(value)) value = Number.isFinite(min) ? min : Number.isFinite(max) ? max : preferred;
  return value;
}

const LATER_NAME = /(^|_)(end|ends|ended|finish|finished|until|due|expires?|expired|expiry|closed?|returned|check_?out|completed|to)(_|$)/;

/**
 * How many steps "later" a column must be than others in the same row, from
 * CHECKs like `end_time > start_time` (or `start < end`) and from names such
 * as ends_at / due_date. Used to space out timestamps, dates and numbers so
 * seed rows satisfy ordering rules.
 */
function orderRank(table: Table, column: Column): number {
  const names = new Set(table.columns.map((c) => c.name));
  const after = new Map<string, Set<string>>(); // column -> columns it must exceed
  const link = (big: string, small: string) => {
    if (!names.has(big) || !names.has(small) || big === small) return;
    if (!after.has(big)) after.set(big, new Set());
    after.get(big)!.add(small);
  };
  for (const constraint of table.constraints) {
    if (constraint.type !== "CHECK" || !constraint.expression) continue;
    for (const m of constraint.expression.matchAll(/\b([a-z_][a-z0-9_]*)\s*(>=|<=|>|<)\s*([a-z_][a-z0-9_]*)\b/gi)) {
      if (m[2].startsWith(">")) link(m[1], m[3]);
      else link(m[3], m[1]);
    }
  }
  const rank = (name: string, seen: Set<string>): number => {
    if (seen.has(name)) return 0;
    seen.add(name);
    const lower = [...(after.get(name) ?? [])];
    return lower.length ? 1 + Math.max(...lower.map((l) => rank(l, new Set(seen)))) : 0;
  };
  const fromChecks = rank(column.name, new Set());
  return fromChecks || (LATER_NAME.test(column.name.toLowerCase()) ? 1 : 0);
}

/**
 * A valid literal for `column` in row number `row` (0-based). Pass the
 * values of the column's enum type when it has one.
 */
export function validLiteral(table: Table, column: Column, row: number, enumValues?: string[]): string {
  const name = column.name.toLowerCase();
  const type = column.dataType.toUpperCase();

  if (enumValues?.length) return quote(enumValues[row % enumValues.length]);

  const allowed = allowedValues(table, column);
  if (allowed) return quote(allowed[row % allowed.length]);

  if (/BOOL/.test(type)) return row % 2 === 0 ? "true" : "false";
  if (/UUID/.test(type)) return "gen_random_uuid()";
  if (/JSON/.test(type)) return `'{"seed": ${row + 1}}'`;
  const later = orderRank(table, column);
  if (/TIMESTAMP|DATETIME/.test(type)) return `now() - interval '${row * 3 + 1} days'${later ? ` + interval '${later} hours'` : ""}`;
  if (/^DATE/.test(type)) return `current_date - ${row * 3 + 1}${later ? ` + ${later}` : ""}`;
  if (/^TIME/.test(type)) return quote(`${String(9 + (row % 8)).padStart(2, "0")}:30:00`);
  if (/INTERVAL/.test(type)) return `interval '${row + 1} hours'`;
  if (/BYTEA/.test(type)) return `'\\x00${row.toString(16).padStart(2, "0")}'`;

  if (/INT|SERIAL/.test(type)) {
    const preferred = /qty|quantity|stock|count|capacity|seats/.test(name)
      ? 10 + row * 5
      : /rating|score|stars/.test(name)
        ? (row % 5) + 1
        : /year/.test(name)
          ? 2020 + (row % 6)
          : row + 1;
    return String(Math.round(numberInRange(table, column, preferred + later * 10)));
  }
  if (/NUMERIC|DECIMAL|REAL|FLOAT|DOUBLE|MONEY/.test(type)) {
    const preferred = /price|amount|cost|total|fee|balance|salary/.test(name) ? 19.99 + row * 10 : 1.5 + row;
    return String(numberInRange(table, column, Math.round((preferred + later * 10) * 100) / 100));
  }

  // Text-like
  const unique = table.constraints.some((c) => c.type === "UNIQUE" && c.columns.includes(column.name)) ||
    table.indexes.some((i) => i.unique && i.columns.includes(column.name));
  const limit = varcharLimit(column.dataType);
  const fit = (value: string) => quote(limit ? value.slice(0, Math.max(1, limit)) : value);
  // Cycle through sample names; add the row number once they'd repeat, so
  // UNIQUE columns never collide (tests insert extra rows at 50, 300+…).
  const person = `${FIRST[row % FIRST.length]} ${LAST[(row * 3) % LAST.length]}${row >= FIRST.length ? ` ${row}` : ""}`;
  if (/email/.test(name)) return fit(`${person.toLowerCase().replace(" ", ".")}${row}@example.com`);
  if (/phone/.test(name)) return fit(`+1-555-01${String(row).padStart(2, "0")}`);
  if (/url|website|link/.test(name)) return fit(`https://example.com/${table.name}/${row + 1}`);
  if (/slug|username|handle|login/.test(name)) return fit(`${WORDS[row % WORDS.length].toLowerCase()}-${row + 1}`);
  if (/sku|code|number|ref/.test(name)) return fit(`${table.name.slice(0, 3).toUpperCase()}-${1000 + row}`);
  const suffix = row >= FIRST.length ? ` ${row}` : "";
  if (/first_name/.test(name)) return fit(`${FIRST[row % FIRST.length]}${suffix}`);
  if (/last_name|surname/.test(name)) return fit(`${LAST[(row * 3) % LAST.length]}${suffix}`);
  if (/name|title/.test(name)) return fit(/^(full_)?name$/.test(name) && /user|member|customer|person|guest|patient|employee|attendee|author|student/.test(table.name) ? person : `${WORDS[row % WORDS.length]} ${table.name.replace(/_/g, " ").replace(/s$/, "")} ${row + 1}`);
  if (/status|state/.test(name)) return fit(`${["active", "pending", "completed"][row % 3]}${row >= 3 && unique ? `_${row}` : ""}`);
  if (/currency/.test(name)) return fit(unique ? `C${String(row).padStart(2, "0")}` : "USD");
  if (/country/.test(name)) return fit(`${["US", "GB", "IN", "DE"][row % 4]}${row >= 4 && unique ? row : ""}`);
  if (/city/.test(name)) return fit(`${["Austin", "London", "Pune", "Berlin"][row % 4]}${row >= 4 && unique ? ` ${row}` : ""}`);
  if (/address|street/.test(name)) return fit(`${100 + row} Market Street`);
  if (/color|colour/.test(name)) return fit(`${["red", "green", "blue"][row % 3]}${row >= 3 && unique ? `_${row}` : ""}`);
  if (/description|notes|comment|body|content|bio|reason/.test(name)) return fit(`Sample ${column.name.replace(/_/g, " ")} ${row + 1}`);
  return fit(`${column.name}_${row + 1}`);
}

/**
 * A literal that violates this column's CHECK constraint, if one can be
 * derived confidently. Returns null when unsure (the test is skipped).
 */
export function checkViolation(table: Table, column: Column): string | null {
  if (allowedValues(table, column)) return quote("__not_allowed__");
  const { min, max } = numericBounds(table, column);
  if (Number.isFinite(min)) return String(min - 1);
  if (Number.isFinite(max)) return String(max + 1);
  return null;
}
