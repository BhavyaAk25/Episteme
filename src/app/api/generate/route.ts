import { NextResponse } from "next/server";
import { callGemini, getGeminiConfigStatus, getGeminiErrorInfo } from "@/lib/gemini/client";
import { createFallbackGeneration } from "@/lib/gemini/fallbackGeneration";
import { GENERATION_PROMPT } from "@/lib/gemini/prompts";
import { GenerationResponseSchema } from "@/lib/gemini/schemas";
import type { GenerationResponse as GeminiGenerationResponse } from "@/lib/gemini/schemas";
import type { Ontology } from "@/types/ontology";
import type { ERD } from "@/types/erd";
import type { Plan, BuildScript, BuildStep } from "@/types/gemini";

type TemplateId = "inventory" | "ecommerce" | "saas";
type FallbackReason = "quota" | "parse_error" | "validation_error" | "provider_error" | "config_error";

function sanitizeERD(erd: ERD): ERD {
  const tableNames = new Set(erd.tables.map(t => t.name));

  const relationships = erd.relationships.filter(
    r => tableNames.has(r.fromTable) && tableNames.has(r.toTable)
  );

  const tables = erd.tables.map(table => ({
    ...table,
    columns: table.columns.map(col => {
      if (col.isForeignKey && col.referencesTable && !tableNames.has(col.referencesTable)) {
        return { ...col, isForeignKey: false, referencesTable: null, referencesColumn: null };
      }
      return col;
    }),
    constraints: table.constraints.filter(c => {
      if (c.type !== "FOREIGN_KEY") return true;
      const fkCol = table.columns.find(col => c.columns.includes(col.name));
      return !fkCol?.referencesTable || tableNames.has(fkCol.referencesTable);
    }),
  }));

  return { tables, relationships };
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenVariants(value: string): string[] {
  const normalized = normalizeToken(value);
  if (!normalized) return [];

  const variants = new Set<string>([normalized]);

  if (normalized.endsWith("ies") && normalized.length > 3) {
    variants.add(`${normalized.slice(0, -3)}y`);
  } else if (normalized.endsWith("s") && normalized.length > 3) {
    variants.add(normalized.slice(0, -1));
  }

  return Array.from(variants);
}

function humanizeTableName(name: string): string {
  return name
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function deriveObjectProperties(table: ERD["tables"][number]): Ontology["objectTypes"][number]["properties"] {
  return table.columns.map((column) => ({
    name: column.name,
    dataType: column.dataType,
    required: !column.nullable,
    description: `Column ${column.name} from table ${table.name}.`,
  }));
}

function reconcileOntologyWithErd(ontology: Ontology, erd: ERD): Ontology {
  const objectTypes = ontology.objectTypes;
  const idRemap = new Map<string, string>();
  const usedObjectIds = new Set<string>();
  const objectIdByTableName = new Map<string, string>();

  const reconciledObjectTypes = erd.tables.map((table) => {
    const tableKeySet = new Set<string>([
      ...tokenVariants(table.name),
      ...tokenVariants(table.objectTypeId),
      ...tokenVariants(humanizeTableName(table.name)),
    ]);

    const matched =
      objectTypes.find((objectType) => objectType.id === table.objectTypeId) ??
      objectTypes.find((objectType) => {
        const objectKeys = new Set<string>([
          ...tokenVariants(objectType.id),
          ...tokenVariants(objectType.name),
        ]);
        for (const key of tableKeySet) {
          if (objectKeys.has(key)) return true;
        }
        return false;
      });

    let nextId = table.objectTypeId || matched?.id || `obj_${table.id}`;
    if (usedObjectIds.has(nextId)) {
      nextId = `${nextId}_${table.id}`;
    }
    usedObjectIds.add(nextId);
    objectIdByTableName.set(table.name, nextId);

    if (matched?.id && matched.id !== nextId) {
      idRemap.set(matched.id, nextId);
    }

    return {
      id: nextId,
      name: matched?.name?.trim() ? matched.name : humanizeTableName(table.name),
      description:
        matched?.description?.trim() ? matched.description : `Derived from ERD table "${table.name}".`,
      status: matched?.status ?? "active",
      confidence: matched?.confidence ?? "medium",
      implementsInterfaces: matched?.implementsInterfaces ?? [],
      properties:
        matched?.properties && matched.properties.length > 0
          ? matched.properties
          : deriveObjectProperties(table),
    };
  });

  const remapObjectId = (objectId: string): string => idRemap.get(objectId) ?? objectId;

  const existingLinkById = new Map(
    ontology.linkTypes.map((linkType) => [linkType.id, {
      ...linkType,
      fromObject: remapObjectId(linkType.fromObject),
      toObject: remapObjectId(linkType.toObject),
    }])
  );

  const existingLinkBySignature = new Map(
    ontology.linkTypes.map((linkType) => {
      const fromObject = remapObjectId(linkType.fromObject);
      const toObject = remapObjectId(linkType.toObject);
      return [`${fromObject}|${toObject}|${linkType.cardinality}`, {
        ...linkType,
        fromObject,
        toObject,
      }];
    })
  );

  const reconciledLinkTypes = erd.relationships
    .map((relationship) => {
      const fromObject = objectIdByTableName.get(relationship.fromTable);
      const toObject = objectIdByTableName.get(relationship.toTable);

      if (!fromObject || !toObject) {
        return null;
      }

      const signature = `${fromObject}|${toObject}|${relationship.cardinality}`;
      const matched = existingLinkById.get(relationship.id) ?? existingLinkBySignature.get(signature);

      return {
        id: relationship.id,
        name: matched?.name ?? `${relationship.fromTable}_to_${relationship.toTable}`,
        fromObject,
        toObject,
        cardinality: relationship.cardinality,
        required: relationship.required,
        description:
          matched?.description ??
          `${relationship.fromTable} references ${relationship.toTable}.`,
      };
    })
    .filter((linkType): linkType is Ontology["linkTypes"][number] => linkType !== null);

  const reconciledActionTypes = ontology.actionTypes.map((actionType) => ({
    ...actionType,
    affectedObjects: actionType.affectedObjects.map((objectId) => remapObjectId(objectId)),
  }));

  return {
    ...ontology,
    objectTypes: reconciledObjectTypes,
    linkTypes: reconciledLinkTypes,
    actionTypes: reconciledActionTypes,
  };
}

function sanitizeErrorMessage(message: string): string {
  if (!message) {
    return "Generation failed";
  }

  const lower = message.toLowerCase();
  if (lower.includes("resource_exhausted") || lower.includes("quota") || lower.includes("429")) {
    return "Gemini free-tier quota is exhausted right now. Try again shortly.";
  }

  const trimmed = message.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return "AI provider returned an unreadable error payload. Please retry in a moment.";
  }

  if (trimmed.length > 280) {
    return `${trimmed.slice(0, 277)}...`;
  }

  return trimmed;
}

function buildFallbackResponse(args: {
  prompt: string;
  templateId?: TemplateId;
  reason: FallbackReason;
  geminiAttempted: boolean;
  warning: string;
  quotaState: "ok" | "cooldown" | "quota_exhausted";
  providerErrorCode: string | null;
  retryAfterSec: number | null;
}) {
  const fallback = createFallbackGeneration(args.prompt, {
    templateId: args.templateId,
    geminiAttempted: args.geminiAttempted,
    fallbackReason: args.reason,
  });
  const cleanFallbackErd = sanitizeERD(fallback.erd);
  const reconciledFallbackOntology = reconcileOntologyWithErd(fallback.ontology, cleanFallbackErd);

  return NextResponse.json({
    ...fallback,
    ontology: reconciledFallbackOntology,
    erd: cleanFallbackErd,
    warning: args.warning,
    source: "fallback",
    generationMode: "fallback",
    quotaState: args.quotaState,
    providerErrorCode: args.providerErrorCode,
    retryAfterSec: args.retryAfterSec,
  });
}

export async function POST(request: Request) {
  let prompt = "";
  let templateId: TemplateId | undefined;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const rawPrompt = typeof body === "object" && body !== null
      ? (body as { prompt?: unknown }).prompt
      : undefined;
    const rawTemplateId = typeof body === "object" && body !== null
      ? (body as { templateId?: unknown }).templateId
      : undefined;

    if (rawTemplateId === "inventory" || rawTemplateId === "ecommerce" || rawTemplateId === "saas") {
      templateId = rawTemplateId;
    }

    prompt = typeof rawPrompt === "string" ? rawPrompt.trim() : "";

    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    const configStatus = getGeminiConfigStatus();
    if (!configStatus.ready) {
      return buildFallbackResponse({
        prompt,
        templateId,
        reason: "config_error",
        geminiAttempted: false,
        warning: "Gemini is not configured in the deployment. Showing local fallback schema so the flow stays usable.",
        quotaState: "ok",
        providerErrorCode: configStatus.reasonCode,
        retryAfterSec: null,
      });
    }

    let rawResponse: string;
    try {
      rawResponse = await callGemini(GENERATION_PROMPT(prompt), { operation: "generate" });
    } catch (error) {
      const info = getGeminiErrorInfo(error);
      const isQuotaPath = info.isQuotaOrRateLimited || info.isCooldown;
      return buildFallbackResponse({
        prompt,
        templateId,
        reason: isQuotaPath ? "quota" : "provider_error",
        geminiAttempted: true,
        warning: isQuotaPath
          ? (
            info.isCooldown
              ? "Gemini is on cooldown after rate limiting. Showing local fallback schema so the flow remains demoable."
              : "Gemini quota is exhausted. Showing local fallback schema so the flow remains demoable."
          )
          : "Gemini request failed. Showing local fallback schema so the flow stays usable.",
        quotaState: info.isCooldown ? "cooldown" : (info.isQuotaOrRateLimited ? "quota_exhausted" : "ok"),
        providerErrorCode: info.providerCode,
        retryAfterSec: info.retryAfterMs ? Math.ceil(info.retryAfterMs / 1000) : null,
      });
    }

    // Parse the JSON response
    let parsedResponse: unknown;
    try {
      parsedResponse = JSON.parse(rawResponse);
    } catch {
      console.error("Failed to parse Gemini response:", rawResponse);
      return buildFallbackResponse({
        prompt,
        templateId,
        reason: "parse_error",
        geminiAttempted: true,
        warning: "Gemini returned malformed JSON. Showing local fallback schema so the flow stays usable.",
        quotaState: "ok",
        providerErrorCode: "INVALID_JSON_RESPONSE",
        retryAfterSec: null,
      });
    }

    // Validate with Zod
    const validationResult = GenerationResponseSchema.safeParse(parsedResponse);

    if (!validationResult.success) {
      console.error("Validation errors:", validationResult.error.issues);
      return buildFallbackResponse({
        prompt,
        templateId,
        reason: "validation_error",
        geminiAttempted: true,
        warning: "Gemini returned an unexpected schema shape. Showing local fallback schema so the flow stays usable.",
        quotaState: "ok",
        providerErrorCode: "SCHEMA_VALIDATION_FAILED",
        retryAfterSec: null,
      });
    }

    const data = validationResult.data as GeminiGenerationResponse;

    if (!data?.plan || !data?.ontology || !data?.erd) {
      return buildFallbackResponse({
        prompt,
        templateId,
        reason: "validation_error",
        geminiAttempted: true,
        warning: "Gemini omitted required sections. Showing local fallback schema so the flow stays usable.",
        quotaState: "ok",
        providerErrorCode: "MISSING_REQUIRED_SECTIONS",
        retryAfterSec: null,
      });
    }

    const typedData = data as GeminiGenerationResponse;

    // Transform to frontend types
    const plan: Plan = {
      domain: typedData.plan.domain,
      entities: typedData.plan.entities.map((e: { name: string; description: string; category: string }) => ({
        name: e.name,
        description: e.description,
        category: e.category as "core" | "junction" | "audit" | "config",
      })),
      relationships: typedData.plan.relationships.map((r: { from: string; to: string; cardinality: string; description: string }) => ({
        from: r.from,
        to: r.to,
        cardinality: r.cardinality as "1:1" | "1:N" | "M:N",
        description: r.description,
      })),
      actions: typedData.plan.actions.map((a: { name: string; description: string; entities_affected: string[] }) => ({
        name: a.name,
        description: a.description,
        entitiesAffected: a.entities_affected,
      })),
      interfaces: typedData.plan.interfaces.map((i: { name: string; properties: string[]; implementing_entities: string[] }) => ({
        name: i.name,
        properties: i.properties,
        implementingEntities: i.implementing_entities,
      })),
    };

    const ontology: Ontology = {
      objectTypes: typedData.ontology.object_types.map((o: {
        id: string;
        name: string;
        description: string;
        status: string;
        confidence: string;
        implements_interfaces: string[];
        properties: Array<{ name: string; data_type: string; required: boolean; description: string }>;
      }) => ({
        id: o.id,
        name: o.name,
        description: o.description,
        status: o.status as "active" | "experimental" | "deprecated",
        confidence: o.confidence as "high" | "medium" | "low",
        implementsInterfaces: o.implements_interfaces,
        properties: o.properties.map((p) => ({
          name: p.name,
          dataType: p.data_type,
          required: p.required,
          description: p.description,
        })),
      })),
      linkTypes: typedData.ontology.link_types.map((l: {
        id: string;
        name: string;
        from_object: string;
        to_object: string;
        cardinality: string;
        required: boolean;
        description: string;
      }) => ({
        id: l.id,
        name: l.name,
        fromObject: l.from_object,
        toObject: l.to_object,
        cardinality: l.cardinality as "1:1" | "1:N" | "M:N",
        required: l.required,
        description: l.description,
      })),
      actionTypes: typedData.ontology.action_types.map((a: {
        id: string;
        name: string;
        description: string;
        status: string;
        input_contract: Array<{ name: string; type: string; required: boolean }>;
        preconditions: string[];
        affected_objects: string[];
        side_effects: Array<{ type: string; description: string }>;
      }) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        status: a.status as "active" | "experimental",
        inputContract: a.input_contract.map((i) => ({
          name: i.name,
          type: i.type,
          required: i.required,
        })),
        preconditions: a.preconditions,
        affectedObjects: a.affected_objects,
        sideEffects: a.side_effects.map((s) => ({
          type: s.type as "audit_log" | "notification" | "cascade_update",
          description: s.description,
        })),
      })),
      interfaces: typedData.ontology.interfaces.map((i: {
        id: string;
        name: string;
        description: string;
        properties: Array<{ name: string; data_type: string }>;
      }) => ({
        id: i.id,
        name: i.name,
        description: i.description,
        properties: i.properties.map((p) => ({
          name: p.name,
          dataType: p.data_type,
        })),
      })),
    };

    const erd: ERD = {
      tables: typedData.erd.tables.map((t: {
        id: string;
        name: string;
        object_type_id: string;
        columns: Array<{
          name: string;
          data_type: string;
          nullable: boolean;
          default_value: string | null;
          is_primary_key: boolean;
          is_foreign_key: boolean;
          references_table: string | null;
          references_column: string | null;
        }>;
        constraints: Array<{
          type: string;
          columns: string[];
          expression: string | null;
          on_delete: string | null;
        }>;
        indexes: Array<{ name: string; columns: string[]; unique: boolean }>;
      }) => ({
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
        constraints: t.constraints.map((c) => ({
          type: c.type as "PRIMARY_KEY" | "FOREIGN_KEY" | "UNIQUE" | "CHECK" | "NOT_NULL",
          columns: c.columns,
          expression: c.expression,
          onDelete: c.on_delete as "CASCADE" | "SET_NULL" | "RESTRICT" | "NO_ACTION" | null,
        })),
        indexes: t.indexes.map((i) => ({
          name: i.name,
          columns: i.columns,
          unique: i.unique,
        })),
      })),
      relationships: typedData.erd.relationships.map((r: {
        id: string;
        from_table: string;
        to_table: string;
        from_column: string;
        to_column: string;
        cardinality: string;
        required: boolean;
        on_delete: string;
      }) => ({
        id: r.id,
        fromTable: r.from_table,
        toTable: r.to_table,
        fromColumn: r.from_column,
        toColumn: r.to_column,
        cardinality: r.cardinality as "1:1" | "1:N" | "M:N",
        required: r.required,
        onDelete: r.on_delete as "CASCADE" | "SET_NULL" | "RESTRICT",
      })),
    };

    const buildScript: BuildScript = {
      steps: (typedData.build_steps || []).map((s: {
        order: number;
        type: string;
        target_table: string | null;
        data: Record<string, unknown>;
        phase: string;
      }) => ({
        order: s.order,
        type: s.type as BuildStep["type"],
        targetTable: s.target_table,
        data: s.data,
        phase: s.phase as BuildStep["phase"],
      })),
    };

    const cleanErd = sanitizeERD(erd);
    const reconciledOntology = reconcileOntologyWithErd(ontology, cleanErd);

    return NextResponse.json({
      plan,
      ontology: reconciledOntology,
      erd: cleanErd,
      buildScript,
      source: "gemini",
      generationMode: "gemini",
      geminiAttempted: true,
      fallbackReason: null,
      domainDecisionSource: "gemini",
      quotaState: "ok",
      providerErrorCode: null,
      retryAfterSec: null,
    });
  } catch (error) {
    console.error("Generation error:", error);
    if (prompt) {
      return buildFallbackResponse({
        prompt,
        templateId,
        reason: "provider_error",
        geminiAttempted: true,
        warning: "Unexpected generation error. Showing local fallback schema so the flow stays usable.",
        quotaState: "ok",
        providerErrorCode: "UNEXPECTED_ROUTE_ERROR",
        retryAfterSec: null,
      });
    }

    return NextResponse.json({
      error: sanitizeErrorMessage(
        error instanceof Error ? error.message : "Generation failed"
      ),
    }, { status: 500 });
  }
}
