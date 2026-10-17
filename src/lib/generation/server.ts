/**
 * Server-side generation pipeline shared by the streaming and plain JSON
 * paths of /api/generate: parse + validate model output, convert it to the
 * app's types, and build honest error / template responses.
 */
import { createFallbackGeneration, buildScriptFromErd } from "@/lib/gemini/fallbackGeneration";
import { extractJSON } from "@/lib/gemini/client";
import { GenerationResponseSchema, type GenerationResponse as ModelResponse } from "@/lib/gemini/schemas";
import { reconcileOntologyWithErd } from "@/lib/ontology/reconcile";
import type { ERD } from "@/types/erd";
import type { Ontology } from "@/types/ontology";
import type { Plan } from "@/types/gemini";

export type TemplateId = "inventory" | "ecommerce" | "saas";
export type FailureReason = "quota" | "parse_error" | "validation_error" | "provider_error" | "config_error";

export interface Outcome {
  status: number;
  body: Record<string, unknown>;
}

export function sanitizeERD(erd: ERD): ERD {
  const tableNames = new Set(erd.tables.map((t) => t.name));
  return {
    tables: erd.tables.map((table) => ({
      ...table,
      columns: table.columns.map((col) =>
        col.isForeignKey && col.referencesTable && !tableNames.has(col.referencesTable)
          ? { ...col, isForeignKey: false, referencesTable: null, referencesColumn: null }
          : col
      ),
      constraints: table.constraints.filter((c) => {
        if (c.type !== "FOREIGN_KEY") return true;
        const fkCol = table.columns.find((col) => c.columns.includes(col.name));
        return !fkCol?.referencesTable || tableNames.has(fkCol.referencesTable);
      }),
    })),
    relationships: erd.relationships.filter((r) => tableNames.has(r.fromTable) && tableNames.has(r.toTable)),
  };
}

function toFrontend(data: ModelResponse): { plan: Plan; ontology: Ontology; erd: ERD } {
  const plan: Plan = {
    domain: data.plan.domain,
    entities: data.plan.entities.map((e) => ({ name: e.name, description: e.description, category: e.category })),
    relationships: data.plan.relationships.map((r) => ({ from: r.from, to: r.to, cardinality: r.cardinality, description: r.description })),
    actions: data.plan.actions.map((a) => ({ name: a.name, description: a.description, entitiesAffected: a.entities_affected })),
    interfaces: data.plan.interfaces.map((i) => ({ name: i.name, properties: i.properties, implementingEntities: i.implementing_entities })),
  };

  const ontology: Ontology = {
    objectTypes: data.ontology.object_types.map((o) => ({
      id: o.id,
      name: o.name,
      description: o.description,
      status: o.status,
      confidence: o.confidence,
      implementsInterfaces: o.implements_interfaces,
      properties: o.properties.map((p) => ({ name: p.name, dataType: p.data_type, required: p.required, description: p.description })),
    })),
    linkTypes: data.ontology.link_types.map((l) => ({
      id: l.id,
      name: l.name,
      fromObject: l.from_object,
      toObject: l.to_object,
      cardinality: l.cardinality,
      required: l.required,
      description: l.description,
    })),
    actionTypes: data.ontology.action_types.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      status: a.status,
      inputContract: a.input_contract.map((i) => ({ name: i.name, type: i.type, required: i.required })),
      preconditions: a.preconditions,
      affectedObjects: a.affected_objects,
      sideEffects: a.side_effects.map((s) => ({ type: s.type, description: s.description })),
    })),
    interfaces: data.ontology.interfaces.map((i) => ({
      id: i.id,
      name: i.name,
      description: i.description,
      properties: i.properties.map((p) => ({ name: p.name, dataType: p.data_type })),
    })),
  };

  const erd: ERD = {
    tables: data.erd.tables.map((t) => ({
      id: t.id,
      name: t.name,
      objectTypeId: t.object_type_id,
      columns: t.columns.map((c) => ({
        name: c.name,
        dataType: c.data_type,
        nullable: c.nullable,
        defaultValue: c.default_value,
        isPrimaryKey: c.is_primary_key,
        isForeignKey: c.is_foreign_key,
        referencesTable: c.references_table,
        referencesColumn: c.references_column,
      })),
      constraints: t.constraints.map((c) => ({ type: c.type, columns: c.columns, expression: c.expression, onDelete: c.on_delete })),
      indexes: t.indexes.map((i) => ({ name: i.name, columns: i.columns, unique: i.unique })),
    })),
    relationships: data.erd.relationships.map((r) => ({
      id: r.id,
      fromTable: r.from_table,
      toTable: r.to_table,
      fromColumn: r.from_column,
      toColumn: r.to_column,
      cardinality: r.cardinality,
      required: r.required,
      onDelete: r.on_delete,
    })),
  };

  return { plan, ontology, erd };
}

/** Parse and validate the model's full text. */
export function finalizeModelOutput(
  raw: string,
  providerId: string
): { ok: true; body: Record<string, unknown> } | { ok: false; reason: FailureReason; code: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJSON(raw));
  } catch {
    console.error("[generate] Model returned malformed JSON:", raw.slice(0, 500));
    return { ok: false, reason: "parse_error", code: "INVALID_JSON_RESPONSE" };
  }

  const validation = GenerationResponseSchema.safeParse(parsed);
  if (!validation.success) {
    console.error("[generate] Validation errors:", validation.error.issues.slice(0, 10));
    return { ok: false, reason: "validation_error", code: "SCHEMA_VALIDATION_FAILED" };
  }

  const { plan, ontology, erd } = toFrontend(validation.data);
  const cleanErd = sanitizeERD(erd);
  return {
    ok: true,
    body: {
      plan,
      ontology: reconcileOntologyWithErd(ontology, cleanErd),
      erd: cleanErd,
      buildScript: buildScriptFromErd(cleanErd),
      source: "gemini",
      generationMode: "gemini",
      provider: providerId,
      geminiAttempted: true,
      fallbackReason: null,
      domainDecisionSource: "gemini",
      quotaState: "ok",
      providerErrorCode: null,
      retryAfterSec: null,
    },
  };
}

export interface FailureArgs {
  prompt: string;
  templateId?: TemplateId;
  reason: FailureReason;
  providerErrorCode: string | null;
  retryAfterSec: number | null;
  quotaState?: "ok" | "cooldown" | "quota_exhausted";
}

function failureMessage(args: FailureArgs): string {
  const code = args.providerErrorCode ?? "";
  if (args.reason === "config_error") {
    return "The AI model isn't configured on this deployment (no API key), so a schema can't be generated from your description.";
  }
  if (args.reason === "quota") return "The AI model's free-tier quota is used up right now, so your schema couldn't be generated.";
  if (args.reason === "parse_error" || args.reason === "validation_error") {
    return "The AI model returned a response that wasn't a valid schema. Trying again usually works.";
  }
  if (code === "MAX_TOKENS") return "The AI's answer was cut off before it finished. Try again, or describe a smaller system.";
  if (["INVALID_API_KEY", "UNAUTHENTICATED", "PERMISSION_DENIED"].includes(code)) {
    return "The AI key on this deployment was rejected (invalid or revoked). Update the key and redeploy.";
  }
  if (["MODEL_NOT_FOUND", "NOT_FOUND"].includes(code)) return "The configured AI model isn't available. Check the model setting.";
  if (["UNAVAILABLE", "INTERNAL"].includes(code)) return "The AI model is busy right now. Try again in a few seconds.";
  return "The AI model couldn't be reached.";
}

/**
 * When the AI couldn't produce a schema: return the template the user
 * explicitly picked, or an honest error. Never a guessed schema.
 */
export function outcomeWithoutAi(args: FailureArgs): Outcome {
  if (args.templateId) {
    const fallback = createFallbackGeneration(args.prompt, {
      templateId: args.templateId,
      geminiAttempted: args.reason !== "config_error",
      fallbackReason: args.reason,
    });
    const erd = sanitizeERD(fallback.erd);
    return {
      status: 200,
      body: {
        ...fallback,
        ontology: reconcileOntologyWithErd(fallback.ontology, erd),
        erd,
        warning: `${failureMessage(args)} Showing the built-in ${args.templateId} template you selected.`,
        source: "fallback",
        generationMode: "fallback",
        quotaState: args.quotaState ?? "ok",
        providerErrorCode: args.providerErrorCode,
        retryAfterSec: args.retryAfterSec,
      },
    };
  }

  return {
    status: 503,
    body: {
      error: failureMessage(args),
      errorCode: "GENERATION_UNAVAILABLE",
      reason: args.reason,
      providerErrorCode: args.providerErrorCode,
      retryAfterSec: args.retryAfterSec,
      quotaState: args.quotaState ?? "ok",
    },
  };
}

export type GenerationPhase = "plan" | "ontology" | "erd" | "relationships";

/**
 * Best-effort progress from partial model JSON: which section the model is
 * writing, and which tables have appeared so far. The final result is
 * always parsed from the complete text.
 */
export function detectProgress(text: string): { phase: GenerationPhase; tables: string[] } {
  const erdAt = text.search(/"erd"\s*:/);
  const relAt = erdAt >= 0 ? text.slice(erdAt).search(/"relationships"\s*:/) : -1;
  const phase: GenerationPhase =
    relAt >= 0 ? "relationships" : erdAt >= 0 ? "erd" : /"ontology"\s*:/.test(text) ? "ontology" : "plan";

  const tables: string[] = [];
  if (erdAt >= 0) {
    const erdText = relAt >= 0 ? text.slice(erdAt, erdAt + relAt) : text.slice(erdAt);
    // Table objects look like {"id": ..., "name": "orders", "object_type_id": ...}
    const pattern = /"name"\s*:\s*"([A-Za-z0-9_]+)"\s*,\s*"object_type_id"/g;
    for (const match of erdText.matchAll(pattern)) {
      if (!tables.includes(match[1])) tables.push(match[1]);
    }
  }
  return { phase, tables };
}
