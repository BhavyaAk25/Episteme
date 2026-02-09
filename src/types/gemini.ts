// Gemini API Response Types

import type { Ontology } from "./ontology";
import type { ERD } from "./erd";

export type BuildPhase = "plan" | "ontology" | "erd" | "constraints" | "actions" | "verify";

export type BuildStepType =
  | "add_table"
  | "add_column"
  | "add_relationship"
  | "add_constraint"
  | "add_index"
  | "add_action";

export interface BuildStep {
  order: number;
  type: BuildStepType;
  targetTable: string | null;
  data: Record<string, unknown>;
  phase: BuildPhase;
}

export interface BuildScript {
  steps: BuildStep[];
}

// Plan response from Gemini
export interface PlanEntity {
  name: string;
  description: string;
  category: "core" | "junction" | "audit" | "config";
}

export interface PlanRelationship {
  from: string;
  to: string;
  cardinality: "1:1" | "1:N" | "M:N";
  description: string;
}

export interface PlanAction {
  name: string;
  description: string;
  entitiesAffected: string[];
}

export interface PlanInterface {
  name: string;
  properties: string[];
  implementingEntities: string[];
}

export interface Plan {
  domain: string;
  entities: PlanEntity[];
  relationships: PlanRelationship[];
  actions: PlanAction[];
  interfaces: PlanInterface[];
}

// Full generation response
export interface GenerationResponse {
  plan: Plan;
  ontology: Ontology;
  erd: ERD;
  buildScript: BuildScript;
  source?: "gemini" | "fallback";
  generationMode?: "gemini" | "fallback";
  fallbackDomain?: "inventory" | "saas" | "ecommerce" | "generic";
  warning?: string;
  geminiAttempted?: boolean;
  fallbackReason?: "quota" | "parse_error" | "validation_error" | "provider_error" | "config_error" | null;
  domainDecisionSource?: "template_hint" | "classifier" | "gemini";
  quotaState?: "ok" | "cooldown" | "quota_exhausted";
  providerErrorCode?: string | null;
  retryAfterSec?: number | null;
}

// Auto-fix response
export interface AutoFixResponse {
  patches: Array<{
    incidentId: string;
    rootCause: string;
    fixCategory: string;
    migrationSql: string;
    explanation: string;
    expectedAfterFix: string;
  }>;
}
