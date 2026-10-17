import { z } from "zod";

/*
 * Schemas for the model's JSON. They are deliberately forgiving: a missing
 * description or a null id on one table must not throw away an otherwise
 * good schema. Non-essential fields get defaults, enums are normalised, and
 * individual items that are unusable are dropped instead of failing the
 * whole response. The ERD is cleaned up further by sanitizeERD/importErd.
 */

const text = (fallback = "") =>
  z.string().nullish().transform((value) => value ?? fallback);

const flag = (fallback: boolean) =>
  z.boolean().nullish().transform((value) => value ?? fallback);

const strings = () =>
  z.array(z.string().nullish()).nullish().transform((items) => (items ?? []).filter((v): v is string => Boolean(v)));

/** Array whose unusable items are dropped rather than failing validation. */
function list<T extends z.ZodTypeAny>(item: T) {
  return z
    .array(item.nullable().catch(null))
    .nullish()
    .transform((items) => (items ?? []).filter((v): v is z.output<T> => v !== null));
}

/** Enum that accepts case/spacing variants and falls back to a default. */
function choice<const T extends readonly string[]>(values: T, fallback: T[number], aliases: Record<string, T[number]> = {}) {
  return z
    .string()
    .nullish()
    .transform((raw): T[number] => {
      if (!raw) return fallback;
      const key = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
      const direct = values.find((v) => v.toUpperCase() === key);
      return direct ?? aliases[key] ?? fallback;
    });
}

const CARDINALITY = ["1:1", "1:N", "M:N"] as const;
const cardinality = choice(CARDINALITY, "1:N", {
  ONE_TO_ONE: "1:1",
  ONE_TO_MANY: "1:N",
  MANY_TO_ONE: "1:N",
  "N:1": "1:N",
  MANY_TO_MANY: "M:N",
  "N:M": "M:N",
});
const ON_DELETE = ["CASCADE", "SET_NULL", "RESTRICT", "NO_ACTION"] as const;

// Phase 1: Plan Schema
export const PlanSchema = z.object({
  domain: text("Database system"),
  entities: list(z.object({
    name: z.string(),
    description: text(),
    category: choice(["core", "junction", "audit", "config"] as const, "core"),
  })),
  relationships: list(z.object({
    from: z.string(),
    to: z.string(),
    cardinality,
    description: text(),
  })),
  actions: list(z.object({
    name: z.string(),
    description: text(),
    entities_affected: strings(),
  })),
  interfaces: list(z.object({
    name: z.string(),
    properties: strings(),
    implementing_entities: strings(),
  })),
});

// Phase 2: Ontology Schema
export const OntologySchema = z.object({
  object_types: list(z.object({
    id: z.string(),
    name: z.string(),
    description: text(),
    status: choice(["active", "experimental", "deprecated"] as const, "active"),
    confidence: choice(["high", "medium", "low"] as const, "medium"),
    implements_interfaces: strings(),
    properties: list(z.object({
      name: z.string(),
      data_type: text("TEXT"),
      required: flag(false),
      description: text(),
    })),
  })),
  link_types: list(z.object({
    id: z.string(),
    name: text(),
    from_object: z.string(),
    to_object: z.string(),
    cardinality,
    required: flag(false),
    description: text(),
  })),
  action_types: list(z.object({
    id: z.string(),
    name: z.string(),
    description: text(),
    status: choice(["active", "experimental"] as const, "active"),
    input_contract: list(z.object({
      name: z.string(),
      type: text("TEXT"),
      required: flag(false),
    })),
    preconditions: strings(),
    affected_objects: strings(),
    side_effects: list(z.object({
      type: choice(["audit_log", "notification", "cascade_update"] as const, "audit_log"),
      description: text(),
    })),
  })),
  interfaces: list(z.object({
    id: z.string(),
    name: z.string(),
    description: text(),
    properties: list(z.object({
      name: z.string(),
      data_type: text("TEXT"),
    })),
  })),
});

const EMPTY_PLAN = { domain: "Database system", entities: [], relationships: [], actions: [], interfaces: [] };
const EMPTY_ONTOLOGY = { object_types: [], link_types: [], action_types: [], interfaces: [] };

// Phase 3: ERD Schema — table/column names and relationship endpoints are
// the only hard requirements.
export const ColumnSchema = z.object({
  name: z.string().min(1),
  data_type: text("TEXT"),
  nullable: flag(true),
  default_value: z.union([z.string(), z.number(), z.boolean()]).nullish().transform((v) => (v === null || v === undefined ? null : String(v))),
  is_primary_key: flag(false),
  is_foreign_key: flag(false),
  references_table: z.string().nullish().transform((v) => v ?? null),
  references_column: z.string().nullish().transform((v) => v ?? null),
});

export const TableConstraintSchema = z.object({
  type: choice(["PRIMARY_KEY", "FOREIGN_KEY", "UNIQUE", "CHECK", "NOT_NULL"] as const, "CHECK", { PK: "PRIMARY_KEY", FK: "FOREIGN_KEY" }),
  columns: strings(),
  expression: z.string().nullish().transform((v) => v ?? null),
  on_delete: z
    .string()
    .nullish()
    .transform((raw) => {
      if (!raw) return null;
      const key = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
      return (ON_DELETE as readonly string[]).includes(key) ? (key as (typeof ON_DELETE)[number]) : null;
    }),
});

export const TableIndexSchema = z.object({
  name: z.string().min(1),
  columns: strings(),
  unique: flag(false),
});

export const TableSchema = z
  .object({
    id: z.string().nullish(),
    name: z.string().min(1),
    object_type_id: z.string().nullish(),
    columns: list(ColumnSchema),
    constraints: list(TableConstraintSchema),
    indexes: list(TableIndexSchema),
  })
  .transform((table) => ({
    ...table,
    id: table.id || `tbl_${table.name}`,
    object_type_id: table.object_type_id || table.id || `obj_${table.name}`,
  }));

export const RelationshipSchema = z.object({
  id: z.string().nullish(),
  from_table: z.string().min(1),
  to_table: z.string().min(1),
  from_column: z.string().min(1),
  to_column: text("id"),
  cardinality,
  required: flag(false),
  on_delete: choice(ON_DELETE, "RESTRICT"),
}).transform((rel) => ({ ...rel, id: rel.id || `rel_${rel.from_table}_${rel.from_column}` }));

export const ERDSchema = z.object({
  tables: list(TableSchema),
  relationships: list(RelationshipSchema),
});

// Combined generation response. Only the ERD is essential; the replay
// script is derived from it, so the model's build_steps are ignored.
export const GenerationResponseSchema = z.object({
  plan: PlanSchema.nullish().transform((plan) => plan ?? EMPTY_PLAN).catch(EMPTY_PLAN),
  ontology: OntologySchema.nullish().transform((ontology) => ontology ?? EMPTY_ONTOLOGY).catch(EMPTY_ONTOLOGY),
  erd: ERDSchema.refine((erd) => erd.tables.length > 0, "ERD has no usable tables"),
  build_steps: z.unknown().optional(),
});

// Export type inferences
export type Plan = z.infer<typeof PlanSchema>;
export type Ontology = z.infer<typeof OntologySchema>;
export type ERD = z.infer<typeof ERDSchema>;
export type GenerationResponse = z.infer<typeof GenerationResponseSchema>;

// AI edit operations. Unknown or malformed operations are dropped.
const optionalText = z.string().nullish().transform((v) => (v === null || v === undefined || v === "" ? undefined : v));
const optionalFlag = z
  .union([z.boolean(), z.string()])
  .nullish()
  .transform((v) => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : undefined));
const columnSpec = z.object({
  name: z.string().min(1),
  type: optionalText,
  nullable: optionalFlag,
  primary_key: optionalFlag,
  unique: optionalFlag,
  default: z.union([z.string(), z.number(), z.boolean()]).nullish().transform((v) => (v === null || v === undefined ? null : String(v))),
});
const onDeleteValue = z
  .string()
  .nullish()
  .transform((raw) => {
    const key = raw?.trim().toUpperCase().replace(/[\s-]+/g, "_");
    return key === "CASCADE" || key === "SET_NULL" || key === "RESTRICT" || key === "NO_ACTION" ? key : undefined;
  });

const EditOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_table"), table: z.string().min(1), columns: z.array(columnSpec.nullable().catch(null)).transform((cols) => cols.filter((c): c is z.output<typeof columnSpec> => c !== null)) }),
  z.object({ op: z.literal("drop_table"), table: z.string().min(1) }),
  z.object({ op: z.literal("rename_table"), table: z.string().min(1), new_name: z.string().min(1) }),
  z.object({ op: z.literal("add_column"), table: z.string().min(1), column: columnSpec }),
  z.object({ op: z.literal("drop_column"), table: z.string().min(1), column: z.string().min(1) }),
  z.object({
    op: z.literal("alter_column"),
    table: z.string().min(1),
    column: z.string().min(1),
    new_name: optionalText,
    type: optionalText,
    nullable: optionalFlag,
    unique: optionalFlag,
    primary_key: optionalFlag,
    default: z.union([z.string(), z.number(), z.boolean()]).nullish().transform((v) => (v === undefined ? undefined : v === null ? null : String(v))),
  }),
  z.object({
    op: z.literal("add_foreign_key"),
    from_table: z.string().min(1),
    from_column: optionalText,
    to_table: z.string().min(1),
    to_column: optionalText,
    required: optionalFlag,
    on_delete: onDeleteValue,
    one_to_one: optionalFlag,
  }),
  z.object({ op: z.literal("drop_foreign_key"), from_table: z.string().min(1), from_column: z.string().min(1) }),
  z.object({ op: z.literal("add_index"), table: z.string().min(1), columns: z.array(z.string()).min(1), unique: optionalFlag }),
  z.object({ op: z.literal("add_check"), table: z.string().min(1), expression: z.string().min(1) }),
]);

export const EditResponseSchema = z.object({
  summary: z.string().nullish().transform((v) => v ?? ""),
  operations: z
    .array(EditOpSchema.nullable().catch(null))
    .nullish()
    .transform((ops) => (ops ?? []).filter((op): op is z.output<typeof EditOpSchema> => op !== null)),
});
