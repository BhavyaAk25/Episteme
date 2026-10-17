import { NextResponse } from "next/server";
import { callGemini, getGeminiConfigStatus, getGeminiErrorInfo } from "@/lib/gemini/client";
import { createFallbackGeneration, buildScriptFromErd } from "@/lib/gemini/fallbackGeneration";
import { GENERATION_SYSTEM_PROMPT, generationUserContent } from "@/lib/gemini/prompts";
import { checkRateLimit, clientKey } from "@/lib/server/rateLimit";
import { MAX_PROMPT_LENGTH } from "@/lib/limits";
import { GenerationResponseSchema } from "@/lib/gemini/schemas";
import type { GenerationResponse as GeminiGenerationResponse } from "@/lib/gemini/schemas";
import type { Ontology } from "@/types/ontology";
import { reconcileOntologyWithErd } from "@/lib/ontology/reconcile";
import type { ERD } from "@/types/erd";
import type { Plan } from "@/types/gemini";

type TemplateId = "inventory" | "ecommerce" | "saas";

const GENERATE_RATE_LIMIT = 10; // requests per window per client
const GENERATE_RATE_WINDOW_MS = 60_000;
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
    warning: `${args.warning.replace(/ Showing local fallback schema.*$/, "")} Showing the built-in ${args.templateId ?? "starter"} template you selected.`,
    source: "fallback",
    generationMode: "fallback",
    quotaState: args.quotaState,
    providerErrorCode: args.providerErrorCode,
    retryAfterSec: args.retryAfterSec,
  });
}

/**
 * Called whenever Gemini could not produce a schema.
 *
 * If the user explicitly picked a template, we return that template (they
 * asked for it, so it is not misleading). Otherwise we return an honest
 * error instead of guessing a hardcoded schema for an unrelated domain.
 */
function respondWithoutGemini(args: Parameters<typeof buildFallbackResponse>[0]) {
  if (args.templateId) {
    return buildFallbackResponse(args);
  }

  const message =
    args.reason === "config_error"
      ? "The AI model isn't configured on this deployment (GEMINI_API_KEY is missing), so a schema can't be generated from your description."
      : args.reason === "quota"
        ? "The AI model's free-tier quota is used up right now, so your schema couldn't be generated."
        : args.reason === "parse_error" || args.reason === "validation_error"
          ? "The AI model returned a response that wasn't a valid schema. Trying again usually works."
          : args.providerErrorCode && ["INVALID_API_KEY", "UNAUTHENTICATED", "PERMISSION_DENIED"].includes(args.providerErrorCode)
            ? "The AI key on this deployment was rejected (invalid or revoked). Update GEMINI_API_KEY and redeploy."
            : args.providerErrorCode && ["MODEL_NOT_FOUND", "NOT_FOUND"].includes(args.providerErrorCode)
              ? "The configured AI model isn't available. Check GEMINI_MODEL."
              : "The AI model couldn't be reached.";

  return NextResponse.json(
    {
      error: message,
      errorCode: "GENERATION_UNAVAILABLE",
      reason: args.reason,
      providerErrorCode: args.providerErrorCode,
      retryAfterSec: args.retryAfterSec,
      quotaState: args.quotaState,
    },
    { status: 503 }
  );
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

    if (prompt.length > MAX_PROMPT_LENGTH) {
      return NextResponse.json(
        { error: `Description is too long (${prompt.length} characters). Keep it under ${MAX_PROMPT_LENGTH}.` },
        { status: 400 }
      );
    }

    const limit = checkRateLimit(clientKey(request, "generate"), GENERATE_RATE_LIMIT, GENERATE_RATE_WINDOW_MS);
    if (!limit.allowed) {
      return NextResponse.json(
        {
          error: "Too many generation requests. Please wait a moment and try again.",
          errorCode: "RATE_LIMITED",
          retryAfterSec: limit.retryAfterSec,
        },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
      );
    }

    const configStatus = getGeminiConfigStatus();
    if (!configStatus.ready) {
      return respondWithoutGemini({
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
      rawResponse = await callGemini(generationUserContent(prompt), {
        operation: "generate",
        systemInstruction: GENERATION_SYSTEM_PROMPT,
      });
    } catch (error) {
      const info = getGeminiErrorInfo(error);
      const isQuotaPath = info.isQuotaOrRateLimited || info.isCooldown;
      return respondWithoutGemini({
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
      return respondWithoutGemini({
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
      return respondWithoutGemini({
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
      return respondWithoutGemini({
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

    const cleanErd = sanitizeERD(erd);
    const reconciledOntology = reconcileOntologyWithErd(ontology, cleanErd);

    // Derive the replay script deterministically from the sanitized ERD rather
    // than trusting Gemini's build_steps, whose `data` payload is frequently
    // empty and would make the build animation render nothing.
    const buildScript = buildScriptFromErd(cleanErd);

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
      return respondWithoutGemini({
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
