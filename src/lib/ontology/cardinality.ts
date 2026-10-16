import type { Cardinality } from "@/types/ontology";

/**
 * Labels for the two ends of a relationship edge.
 *
 * Relationships are stored from the table that holds the foreign key
 * (`fromTable`, the edge source) to the table it references (`toTable`,
 * the edge target). For a 1:N relationship the referenced table is the
 * "one" side and the FK-holding table is the "many" side, so the source
 * end reads "N" and the target end reads "1".
 */
export function edgeEndLabels(cardinality: Cardinality): { source: string; target: string } {
  switch (cardinality) {
    case "1:1":
      return { source: "1", target: "1" };
    case "1:N":
      return { source: "N", target: "1" };
    case "M:N":
      return { source: "M", target: "N" };
  }
}
