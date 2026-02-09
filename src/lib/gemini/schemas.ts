import { z } from "zod";

// Phase 1: Plan Schema
export const PlanEntitySchema = z.object({
  name: z.string(),
  description: z.string(),
  category: z.enum(["core", "junction", "audit", "config"]),
});

export const PlanRelationshipSchema = z.object({
  from: z.string(),
  to: z.string(),
  cardinality: z.enum(["1:1", "1:N", "M:N"]),
  description: z.string(),
});

export const PlanActionSchema = z.object({
  name: z.string(),
  description: z.string(),
  entities_affected: z.array(z.string()),
});

export const PlanInterfaceSchema = z.object({
  name: z.string(),
  properties: z.array(z.string()),
  implementing_entities: z.array(z.string()),
});

export const PlanSchema = z.object({
  domain: z.string(),
  entities: z.array(PlanEntitySchema),
  relationships: z.array(PlanRelationshipSchema),
  actions: z.array(PlanActionSchema),
  interfaces: z.array(PlanInterfaceSchema),
});

// Phase 2: Ontology Schema
export const PropertySchema = z.object({
  name: z.string(),
  data_type: z.string(),
  required: z.boolean(),
  description: z.string(),
});

export const ObjectTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.enum(["active", "experimental", "deprecated"]),
  confidence: z.enum(["high", "medium", "low"]),
  implements_interfaces: z.array(z.string()),
  properties: z.array(PropertySchema),
});

export const LinkTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  from_object: z.string(),
  to_object: z.string(),
  cardinality: z.enum(["1:1", "1:N", "M:N"]),
  required: z.boolean(),
  description: z.string(),
});

export const InputParamSchema = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean(),
});

export const SideEffectSchema = z.object({
  type: z.enum(["audit_log", "notification", "cascade_update"]),
  description: z.string(),
});

export const ActionTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.enum(["active", "experimental"]),
  input_contract: z.array(InputParamSchema),
  preconditions: z.array(z.string()),
  affected_objects: z.array(z.string()),
  side_effects: z.array(SideEffectSchema),
});

export const InterfaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  properties: z.array(z.object({
    name: z.string(),
    data_type: z.string(),
  })),
});

export const OntologySchema = z.object({
  object_types: z.array(ObjectTypeSchema),
  link_types: z.array(LinkTypeSchema),
  action_types: z.array(ActionTypeSchema),
  interfaces: z.array(InterfaceSchema),
});

// Phase 3: ERD Schema
export const ColumnSchema = z.object({
  name: z.string(),
  data_type: z.string(),
  nullable: z.boolean(),
  default_value: z.string().nullable(),
  is_primary_key: z.boolean(),
  is_foreign_key: z.boolean(),
  references_table: z.string().nullable(),
  references_column: z.string().nullable(),
});

export const TableConstraintSchema = z.object({
  type: z.enum(["PRIMARY_KEY", "FOREIGN_KEY", "UNIQUE", "CHECK", "NOT_NULL"]),
  columns: z.array(z.string()),
  expression: z.string().nullable(),
  on_delete: z.enum(["CASCADE", "SET_NULL", "RESTRICT", "NO_ACTION"]).nullable(),
});

export const TableIndexSchema = z.object({
  name: z.string(),
  columns: z.array(z.string()),
  unique: z.boolean(),
});

export const TableSchema = z.object({
  id: z.string(),
  name: z.string(),
  object_type_id: z.string(),
  columns: z.array(ColumnSchema),
  constraints: z.array(TableConstraintSchema),
  indexes: z.array(TableIndexSchema),
});

export const RelationshipSchema = z.object({
  id: z.string(),
  from_table: z.string(),
  to_table: z.string(),
  from_column: z.string(),
  to_column: z.string(),
  cardinality: z.enum(["1:1", "1:N", "M:N"]),
  required: z.boolean(),
  on_delete: z.enum(["CASCADE", "SET_NULL", "RESTRICT"]),
});

export const ERDSchema = z.object({
  tables: z.array(TableSchema),
  relationships: z.array(RelationshipSchema),
});

// Build Script Schema
export const BuildStepSchema = z.object({
  order: z.number(),
  type: z.enum([
    "add_table",
    "add_column",
    "add_relationship",
    "add_constraint",
    "add_index",
    "add_action",
  ]),
  target_table: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  phase: z.enum(["ontology", "erd", "constraints", "actions"]),
});

export const BuildScriptSchema = z.object({
  steps: z.array(BuildStepSchema),
});

// Combined generation response
export const GenerationResponseSchema = z.object({
  plan: PlanSchema,
  ontology: OntologySchema,
  erd: ERDSchema,
  build_steps: z.array(BuildStepSchema),
});

// Auto-fix schema
export const PatchSchema = z.object({
  incident_id: z.string(),
  root_cause: z.string(),
  fix_category: z.string(),
  migration_sql: z.string(),
  explanation: z.string(),
  expected_after_fix: z.string(),
});

export const AutoFixResponseSchema = z.object({
  patches: z.array(PatchSchema),
});

// Export type inferences
export type Plan = z.infer<typeof PlanSchema>;
export type Ontology = z.infer<typeof OntologySchema>;
export type ERD = z.infer<typeof ERDSchema>;
export type BuildStep = z.infer<typeof BuildStepSchema>;
export type GenerationResponse = z.infer<typeof GenerationResponseSchema>;
export type AutoFixResponse = z.infer<typeof AutoFixResponseSchema>;
