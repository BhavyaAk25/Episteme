import type { ERD } from "@/types/erd";
import type { Issue } from "./linter";

const STOP = new Set([
  "a", "an", "the", "and", "or", "with", "for", "of", "to", "in", "on", "by", "my", "our", "their", "its",
  "system", "app", "application", "platform", "database", "schema", "service", "tool", "website", "site",
  "management", "manager", "tracking", "tracker", "build", "create", "design", "make", "simple", "basic",
  "support", "supports", "that", "which", "where", "who", "also", "etc", "plus", "including", "like",
]);

function singular(word: string): string {
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(ss|x|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) return word.slice(0, -1);
  return word;
}

/**
 * Entities the user listed ("with venues, events, ticket tiers and
 * attendees") that have no table or column. Conservative: only looks at
 * comma/and-separated lists after "with", "including", "for", ":".
 */
export function promptCoverage(prompt: string, erd: ERD): Issue[] {
  const lower = prompt.toLowerCase();
  const listStart = lower.search(/\b(with|including|includes|tracks?|for|has|have)\b|:/);
  if (listStart < 0 || erd.tables.length === 0) return [];

  const phrases = lower
    .slice(listStart)
    .replace(/^(with|including|includes|tracks?|for|has|have|:)\s*/, "")
    .split(/,|;|\band\b|\bor\b|\bplus\b|\n/)
    .map((p) => p.replace(/[^a-z0-9\s-]/g, " ").trim())
    .filter(Boolean);

  const names = [
    ...erd.tables.map((t) => t.name),
    ...erd.tables.flatMap((t) => t.columns.map((c) => c.name)),
  ].map((n) => n.toLowerCase());

  const issues: Issue[] = [];
  for (const phrase of phrases) {
    const words = phrase.split(/[\s-]+/).filter((w) => w && !STOP.has(w));
    if (words.length === 0 || words.length > 3) continue;
    const key = words.map(singular).join("_");
    if (key.length < 3) continue;
    const head = singular(words[words.length - 1]);
    const found = names.some(
      (name) =>
        name.includes(key) ||
        singular(name).includes(key) ||
        key.includes(singular(name)) ||
        (head.length >= 4 && name.split("_").map(singular).includes(head))
    );
    if (found) continue;
    const label = words.join(" ");
    issues.push({
      id: `coverage:${key}`,
      severity: "info",
      table: null,
      title: `“${label}” from your description may be missing`,
      detail: "You mentioned it, but no table or column name matches it. Ignore this if it's stored under another name.",
      askAi: `Add support for ${label} (from the original requirement: "${prompt.slice(0, 300)}").`,
    });
  }
  return issues;
}
