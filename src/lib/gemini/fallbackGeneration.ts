import type { ERD } from "@/types/erd";
import type { GenerationResponse, BuildScript, Plan } from "@/types/gemini";
import type { Ontology, Confidence } from "@/types/ontology";

export type FallbackDomain = "inventory" | "saas" | "ecommerce" | "generic";
export type DomainDecisionSource = "template_hint" | "classifier" | "gemini";

interface FallbackGenerationPayload extends GenerationResponse {
  fallbackDomain: FallbackDomain;
  geminiAttempted: boolean;
  fallbackReason: "quota" | "parse_error" | "validation_error" | null;
  domainDecisionSource: DomainDecisionSource;
}

interface SimpleObjectConfig {
  id: string;
  name: string;
  description: string;
  confidence: Confidence;
  status?: "active" | "experimental";
  properties: Array<{
    name: string;
    dataType: string;
    required: boolean;
    description: string;
  }>;
}

function buildInterfaces(): Ontology["interfaces"] {
  return [
    {
      id: "iface_auditable",
      name: "Auditable",
      description: "Entity includes created_at timestamp",
      properties: [{ name: "created_at", dataType: "TIMESTAMP" }],
    },
  ];
}

function buildObjectTypes(config: SimpleObjectConfig[]): Ontology["objectTypes"] {
  return config.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    status: item.status ?? "active",
    confidence: item.confidence,
    implementsInterfaces: ["Auditable"],
    properties: item.properties,
  }));
}

interface WeightedKeyword {
  keyword: string;
  weight: number;
}

const domainKeywords: Record<Exclude<FallbackDomain, "generic">, WeightedKeyword[]> = {
  saas: [
    { keyword: "saas", weight: 5 },
    { keyword: "multi-tenant", weight: 4 },
    { keyword: "tenant", weight: 3 },
    { keyword: "subscription", weight: 3 },
    { keyword: "billing", weight: 3 },
    { keyword: "organization", weight: 2 },
    { keyword: "invoice", weight: 2 },
    { keyword: "plan", weight: 1 },
    { keyword: "usage", weight: 1 },
    { keyword: "metering", weight: 3 },
    { keyword: "role", weight: 1 },
  ],
  ecommerce: [
    { keyword: "e-commerce", weight: 5 },
    { keyword: "ecommerce", weight: 5 },
    { keyword: "shopping", weight: 4 },
    { keyword: "cart", weight: 4 },
    { keyword: "checkout", weight: 4 },
    { keyword: "order", weight: 2 },
    { keyword: "customer", weight: 2 },
    { keyword: "payment", weight: 2 },
    { keyword: "shipment", weight: 3 },
    { keyword: "return", weight: 1 },
    { keyword: "catalog", weight: 2 },
    { keyword: "variant", weight: 2 },
  ],
  inventory: [
    { keyword: "inventory", weight: 5 },
    { keyword: "warehouse", weight: 4 },
    { keyword: "sku", weight: 4 },
    { keyword: "stock", weight: 3 },
    { keyword: "supplier", weight: 3 },
    { keyword: "transfer", weight: 2 },
    { keyword: "reorder", weight: 3 },
    { keyword: "low-stock", weight: 3 },
    { keyword: "audit trail", weight: 2 },
    { keyword: "purchase order", weight: 3 },
  ],
};

function classifyPrompt(prompt: string): FallbackDomain {
  const lower = prompt.toLowerCase();

  const scores: Record<Exclude<FallbackDomain, "generic">, number> = {
    saas: 0,
    ecommerce: 0,
    inventory: 0,
  };

  for (const [domain, keywords] of Object.entries(domainKeywords) as [Exclude<FallbackDomain, "generic">, WeightedKeyword[]][]) {
    for (const { keyword, weight } of keywords) {
      if (lower.includes(keyword)) {
        scores[domain] += weight;
      }
    }
  }

  const maxScore = Math.max(scores.saas, scores.ecommerce, scores.inventory);
  if (maxScore === 0) return "generic";

  // Tie-breaking: prefer inventory > ecommerce > saas (most common demo order)
  const tieBreakOrder: Exclude<FallbackDomain, "generic">[] = ["inventory", "ecommerce", "saas"];
  for (const domain of tieBreakOrder) {
    if (scores[domain] === maxScore) return domain;
  }

  return "generic";
}

function buildFallbackScript(erd: ERD): BuildScript {
  const steps: BuildScript["steps"] = [];
  let order = 1;

  for (const table of erd.tables) {
    steps.push({
      order: order++,
      type: "add_table",
      targetTable: table.name,
      data: { table_name: table.name },
      phase: "erd",
    });

    for (const column of table.columns) {
      steps.push({
        order: order++,
        type: "add_column",
        targetTable: table.name,
        data: {
          table_name: table.name,
          column: {
            name: column.name,
            data_type: column.dataType,
            nullable: column.nullable,
            default_value: column.defaultValue,
            is_primary_key: column.isPrimaryKey,
            is_foreign_key: column.isForeignKey,
            references_table: column.referencesTable,
            references_column: column.referencesColumn,
          },
        },
        phase: "erd",
      });
    }

    for (const constraint of table.constraints) {
      steps.push({
        order: order++,
        type: "add_constraint",
        targetTable: table.name,
        data: {
          table_name: table.name,
          constraint: {
            type: constraint.type,
            columns: constraint.columns,
            expression: constraint.expression,
            on_delete: constraint.onDelete,
          },
        },
        phase: "constraints",
      });
    }

    for (const index of table.indexes) {
      steps.push({
        order: order++,
        type: "add_index",
        targetTable: table.name,
        data: {
          table_name: table.name,
          index: {
            name: index.name,
            columns: index.columns,
            unique: index.unique,
          },
        },
        phase: "constraints",
      });
    }
  }

  for (const relationship of erd.relationships) {
    steps.push({
      order: order++,
      type: "add_relationship",
      targetTable: relationship.fromTable,
      data: {
        id: relationship.id,
        from_table: relationship.fromTable,
        to_table: relationship.toTable,
        from_column: relationship.fromColumn,
        to_column: relationship.toColumn,
        cardinality: relationship.cardinality,
        required: relationship.required,
        on_delete: relationship.onDelete,
      },
      phase: "erd",
    });
  }

  return { steps };
}

/**
 * Validate fallback ERD integrity:
 * - Every relationship references existing tables and columns
 * - Every FK column has a valid referencesTable/referencesColumn
 * - No orphan tables (every non-root table is referenced by at least one relationship)
 */
function validateFallbackIntegrity(erd: ERD): void {
  const tableNames = new Set(erd.tables.map((t) => t.name));

  for (const rel of erd.relationships) {
    if (!tableNames.has(rel.fromTable)) {
      throw new Error(`Fallback integrity: relationship ${rel.id} references non-existent fromTable "${rel.fromTable}"`);
    }
    if (!tableNames.has(rel.toTable)) {
      throw new Error(`Fallback integrity: relationship ${rel.id} references non-existent toTable "${rel.toTable}"`);
    }
    const fromTable = erd.tables.find((t) => t.name === rel.fromTable);
    const fkColumn = fromTable?.columns.find((c) => c.name === rel.fromColumn);
    if (!fkColumn) {
      throw new Error(`Fallback integrity: relationship ${rel.id} references non-existent column "${rel.fromColumn}" in table "${rel.fromTable}"`);
    }
    if (!fkColumn.isForeignKey) {
      throw new Error(`Fallback integrity: column "${rel.fromColumn}" in "${rel.fromTable}" should be marked as FK`);
    }
    if (fkColumn.referencesTable !== rel.toTable) {
      throw new Error(`Fallback integrity: column "${rel.fromColumn}" references "${fkColumn.referencesTable}" but relationship points to "${rel.toTable}"`);
    }
  }
}

function buildInventoryFallback(prompt: string): FallbackGenerationPayload {
  const plan: Plan = {
    domain: prompt.trim() ? `${prompt.trim().slice(0, 60)} (fallback inventory)` : "Inventory Management",
    entities: [
      { name: "Warehouse", description: "Storage locations", category: "core" },
      { name: "Product", description: "Sellable SKU catalog", category: "core" },
      { name: "InventoryLevel", description: "Stock per product per warehouse", category: "junction" },
      { name: "StockMovement", description: "Ledger of quantity changes", category: "core" },
      { name: "AuditEvent", description: "Operational audit events", category: "audit" },
    ],
    relationships: [
      { from: "Warehouse", to: "InventoryLevel", cardinality: "1:N", description: "Warehouse holds many inventory rows" },
      { from: "Product", to: "InventoryLevel", cardinality: "1:N", description: "Product appears in many inventory rows" },
      { from: "InventoryLevel", to: "StockMovement", cardinality: "1:N", description: "Inventory row has many movement records" },
      { from: "StockMovement", to: "AuditEvent", cardinality: "1:N", description: "Movement emits audit events" },
    ],
    actions: [
      { name: "AdjustInventory", description: "Increase/decrease stock and log movement", entitiesAffected: ["InventoryLevel", "StockMovement", "AuditEvent"] },
      { name: "TransferStock", description: "Move stock between locations", entitiesAffected: ["InventoryLevel", "StockMovement", "AuditEvent"] },
    ],
    interfaces: [{ name: "Auditable", properties: ["created_at"], implementingEntities: ["Warehouse", "Product", "InventoryLevel", "StockMovement", "AuditEvent"] }],
  };

  const ontology: Ontology = {
    objectTypes: buildObjectTypes([
      {
        id: "obj_warehouse",
        name: "Warehouse",
        description: "Physical stock location",
        confidence: "high",
        properties: [
          { name: "name", dataType: "TEXT", required: true, description: "Warehouse name" },
          { name: "location", dataType: "TEXT", required: true, description: "City or address label" },
        ],
      },
      {
        id: "obj_product",
        name: "Product",
        description: "SKU master catalog",
        confidence: "high",
        properties: [
          { name: "sku", dataType: "TEXT", required: true, description: "Product SKU" },
          { name: "name", dataType: "TEXT", required: true, description: "Display name" },
          { name: "unit_price", dataType: "REAL", required: true, description: "Unit price" },
        ],
      },
      {
        id: "obj_inventory_level",
        name: "InventoryLevel",
        description: "Quantity by product and warehouse",
        confidence: "high",
        properties: [
          { name: "warehouse_id", dataType: "INTEGER", required: true, description: "Warehouse reference" },
          { name: "product_id", dataType: "INTEGER", required: true, description: "Product reference" },
          { name: "quantity", dataType: "INTEGER", required: true, description: "Current quantity" },
        ],
      },
      {
        id: "obj_stock_movement",
        name: "StockMovement",
        description: "Stock change record",
        confidence: "medium",
        status: "experimental",
        properties: [
          { name: "inventory_level_id", dataType: "INTEGER", required: true, description: "Inventory row reference" },
          { name: "change_qty", dataType: "INTEGER", required: true, description: "Quantity delta" },
          { name: "reason", dataType: "TEXT", required: false, description: "Reason code" },
        ],
      },
      {
        id: "obj_audit_event",
        name: "AuditEvent",
        description: "Audit trail event",
        confidence: "medium",
        properties: [
          { name: "stock_movement_id", dataType: "INTEGER", required: true, description: "Movement reference" },
          { name: "action", dataType: "TEXT", required: true, description: "Action description" },
        ],
      },
    ]),
    linkTypes: [
      { id: "lnk_inventory_warehouse", name: "inventory_in_warehouse", fromObject: "InventoryLevel", toObject: "Warehouse", cardinality: "1:N", required: true, description: "Inventory row belongs to warehouse" },
      { id: "lnk_inventory_product", name: "inventory_for_product", fromObject: "InventoryLevel", toObject: "Product", cardinality: "1:N", required: true, description: "Inventory row belongs to product" },
      { id: "lnk_movement_inventory", name: "movement_for_inventory", fromObject: "StockMovement", toObject: "InventoryLevel", cardinality: "1:N", required: true, description: "Movement references inventory row" },
      { id: "lnk_audit_movement", name: "audit_for_movement", fromObject: "AuditEvent", toObject: "StockMovement", cardinality: "1:N", required: true, description: "Audit record references movement" },
    ],
    actionTypes: [
      {
        id: "act_adjust_inventory",
        name: "AdjustInventory",
        description: "Update quantity and write movement/audit records",
        status: "active",
        inputContract: [
          { name: "inventory_level_id", type: "INTEGER", required: true },
          { name: "change_qty", type: "INTEGER", required: true },
          { name: "reason", type: "TEXT", required: false },
        ],
        preconditions: ["inventory_level exists"],
        affectedObjects: ["InventoryLevel", "StockMovement", "AuditEvent"],
        sideEffects: [{ type: "audit_log", description: "Create audit trail row" }],
      },
    ],
    interfaces: buildInterfaces(),
  };

  const erd: ERD = {
    tables: [
      {
        id: "tbl_warehouse",
        name: "warehouses",
        objectTypeId: "obj_warehouse",
        columns: [
          { name: "id", dataType: "SERIAL", nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "name", dataType: "TEXT", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "location", dataType: "TEXT", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "created_at", dataType: "TIMESTAMP", nullable: false, defaultValue: "CURRENT_TIMESTAMP", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
        ],
        constraints: [{ type: "PRIMARY_KEY", columns: ["id"], expression: null, onDelete: null }, { type: "UNIQUE", columns: ["name"], expression: null, onDelete: null }],
        indexes: [{ name: "idx_warehouses_name", columns: ["name"], unique: true }],
      },
      {
        id: "tbl_product",
        name: "products",
        objectTypeId: "obj_product",
        columns: [
          { name: "id", dataType: "SERIAL", nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "sku", dataType: "TEXT", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "name", dataType: "TEXT", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "unit_price", dataType: "REAL", nullable: false, defaultValue: "0", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "created_at", dataType: "TIMESTAMP", nullable: false, defaultValue: "CURRENT_TIMESTAMP", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
        ],
        constraints: [{ type: "PRIMARY_KEY", columns: ["id"], expression: null, onDelete: null }, { type: "UNIQUE", columns: ["sku"], expression: null, onDelete: null }, { type: "CHECK", columns: ["unit_price"], expression: "unit_price >= 0", onDelete: null }],
        indexes: [{ name: "idx_products_sku", columns: ["sku"], unique: true }],
      },
      {
        id: "tbl_inventory_level",
        name: "inventory_levels",
        objectTypeId: "obj_inventory_level",
        columns: [
          { name: "id", dataType: "SERIAL", nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "warehouse_id", dataType: "INTEGER", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: true, referencesTable: "warehouses", referencesColumn: "id" },
          { name: "product_id", dataType: "INTEGER", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: true, referencesTable: "products", referencesColumn: "id" },
          { name: "quantity", dataType: "INTEGER", nullable: false, defaultValue: "0", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "created_at", dataType: "TIMESTAMP", nullable: false, defaultValue: "CURRENT_TIMESTAMP", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
        ],
        constraints: [
          { type: "PRIMARY_KEY", columns: ["id"], expression: null, onDelete: null },
          { type: "FOREIGN_KEY", columns: ["warehouse_id"], expression: null, onDelete: "CASCADE" },
          { type: "FOREIGN_KEY", columns: ["product_id"], expression: null, onDelete: "CASCADE" },
          { type: "UNIQUE", columns: ["warehouse_id", "product_id"], expression: null, onDelete: null },
          { type: "CHECK", columns: ["quantity"], expression: "quantity >= 0", onDelete: null },
        ],
        indexes: [{ name: "idx_inventory_lookup", columns: ["warehouse_id", "product_id"], unique: true }],
      },
      {
        id: "tbl_stock_movement",
        name: "stock_movements",
        objectTypeId: "obj_stock_movement",
        columns: [
          { name: "id", dataType: "SERIAL", nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "inventory_level_id", dataType: "INTEGER", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: true, referencesTable: "inventory_levels", referencesColumn: "id" },
          { name: "change_qty", dataType: "INTEGER", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "reason", dataType: "TEXT", nullable: true, defaultValue: null, isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "created_at", dataType: "TIMESTAMP", nullable: false, defaultValue: "CURRENT_TIMESTAMP", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
        ],
        constraints: [{ type: "PRIMARY_KEY", columns: ["id"], expression: null, onDelete: null }, { type: "FOREIGN_KEY", columns: ["inventory_level_id"], expression: null, onDelete: "CASCADE" }],
        indexes: [{ name: "idx_stock_movement_inventory", columns: ["inventory_level_id"], unique: false }],
      },
      {
        id: "tbl_audit_event",
        name: "audit_events",
        objectTypeId: "obj_audit_event",
        columns: [
          { name: "id", dataType: "SERIAL", nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "stock_movement_id", dataType: "INTEGER", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: true, referencesTable: "stock_movements", referencesColumn: "id" },
          { name: "action", dataType: "TEXT", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "created_at", dataType: "TIMESTAMP", nullable: false, defaultValue: "CURRENT_TIMESTAMP", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
        ],
        constraints: [{ type: "PRIMARY_KEY", columns: ["id"], expression: null, onDelete: null }, { type: "FOREIGN_KEY", columns: ["stock_movement_id"], expression: null, onDelete: "CASCADE" }],
        indexes: [{ name: "idx_audit_events_movement", columns: ["stock_movement_id"], unique: false }],
      },
    ],
    relationships: [
      { id: "rel_inventory_warehouse", fromTable: "inventory_levels", toTable: "warehouses", fromColumn: "warehouse_id", toColumn: "id", cardinality: "1:N", required: true, onDelete: "CASCADE" },
      { id: "rel_inventory_product", fromTable: "inventory_levels", toTable: "products", fromColumn: "product_id", toColumn: "id", cardinality: "1:N", required: true, onDelete: "CASCADE" },
      { id: "rel_movement_inventory", fromTable: "stock_movements", toTable: "inventory_levels", fromColumn: "inventory_level_id", toColumn: "id", cardinality: "1:N", required: true, onDelete: "CASCADE" },
      { id: "rel_audit_movement", fromTable: "audit_events", toTable: "stock_movements", fromColumn: "stock_movement_id", toColumn: "id", cardinality: "1:N", required: true, onDelete: "CASCADE" },
    ],
  };

  validateFallbackIntegrity(erd);
  return { plan, ontology, erd, buildScript: buildFallbackScript(erd), fallbackDomain: "inventory", geminiAttempted: false, fallbackReason: null, domainDecisionSource: "classifier" };
}

function buildSaasFallback(prompt: string): FallbackGenerationPayload {
  const plan: Plan = {
    domain: prompt.trim() ? `${prompt.trim().slice(0, 60)} (fallback SaaS)` : "SaaS Billing",
    entities: [
      { name: "Organization", description: "Tenant account", category: "core" },
      { name: "User", description: "User identity inside organization", category: "core" },
      { name: "Plan", description: "Subscription plan catalog", category: "config" },
      { name: "Subscription", description: "Organization-plan binding", category: "core" },
      { name: "Invoice", description: "Billing statement for a subscription", category: "core" },
    ],
    relationships: [
      { from: "Organization", to: "User", cardinality: "1:N", description: "Organization has many users" },
      { from: "Organization", to: "Subscription", cardinality: "1:N", description: "Organization has subscriptions over time" },
      { from: "Plan", to: "Subscription", cardinality: "1:N", description: "Plan applies to many subscriptions" },
      { from: "Subscription", to: "Invoice", cardinality: "1:N", description: "Subscription emits invoices" },
    ],
    actions: [
      { name: "InviteUser", description: "Add user to organization", entitiesAffected: ["Organization", "User"] },
      { name: "ChangePlan", description: "Move subscription to new plan", entitiesAffected: ["Subscription", "Plan", "Invoice"] },
    ],
    interfaces: [{ name: "Auditable", properties: ["created_at"], implementingEntities: ["Organization", "User", "Plan", "Subscription", "Invoice"] }],
  };

  const ontology: Ontology = {
    objectTypes: buildObjectTypes([
      {
        id: "obj_organization",
        name: "Organization",
        description: "Tenant workspace",
        confidence: "high",
        properties: [
          { name: "name", dataType: "TEXT", required: true, description: "Organization name" },
          { name: "slug", dataType: "TEXT", required: true, description: "Public slug" },
        ],
      },
      {
        id: "obj_user",
        name: "User",
        description: "Organization member",
        confidence: "high",
        properties: [
          { name: "organization_id", dataType: "INTEGER", required: true, description: "Organization reference" },
          { name: "email", dataType: "TEXT", required: true, description: "User email" },
          { name: "role", dataType: "TEXT", required: true, description: "Role name" },
        ],
      },
      {
        id: "obj_plan",
        name: "Plan",
        description: "Subscription plan",
        confidence: "high",
        properties: [
          { name: "name", dataType: "TEXT", required: true, description: "Plan label" },
          { name: "price_monthly", dataType: "REAL", required: true, description: "Monthly price" },
        ],
      },
      {
        id: "obj_subscription",
        name: "Subscription",
        description: "Active plan assignment",
        confidence: "high",
        properties: [
          { name: "organization_id", dataType: "INTEGER", required: true, description: "Organization reference" },
          { name: "plan_id", dataType: "INTEGER", required: true, description: "Plan reference" },
          { name: "status", dataType: "TEXT", required: true, description: "Subscription status" },
        ],
      },
      {
        id: "obj_invoice",
        name: "Invoice",
        description: "Billing invoice",
        confidence: "medium",
        properties: [
          { name: "subscription_id", dataType: "INTEGER", required: true, description: "Subscription reference" },
          { name: "amount_due", dataType: "REAL", required: true, description: "Invoice total" },
        ],
      },
    ]),
    linkTypes: [
      { id: "lnk_user_org", name: "user_in_organization", fromObject: "User", toObject: "Organization", cardinality: "1:N", required: true, description: "User belongs to organization" },
      { id: "lnk_sub_org", name: "subscription_for_organization", fromObject: "Subscription", toObject: "Organization", cardinality: "1:N", required: true, description: "Subscription belongs to organization" },
      { id: "lnk_sub_plan", name: "subscription_uses_plan", fromObject: "Subscription", toObject: "Plan", cardinality: "1:N", required: true, description: "Subscription references plan" },
      { id: "lnk_invoice_sub", name: "invoice_for_subscription", fromObject: "Invoice", toObject: "Subscription", cardinality: "1:N", required: true, description: "Invoice references subscription" },
    ],
    actionTypes: [
      {
        id: "act_invite_user",
        name: "InviteUser",
        description: "Create user record in organization",
        status: "active",
        inputContract: [
          { name: "organization_id", type: "INTEGER", required: true },
          { name: "email", type: "TEXT", required: true },
        ],
        preconditions: ["organization exists", "email unique in organization"],
        affectedObjects: ["Organization", "User"],
        sideEffects: [{ type: "notification", description: "Send invite email" }],
      },
      {
        id: "act_change_plan",
        name: "ChangePlan",
        description: "Switch organization subscription plan",
        status: "active",
        inputContract: [
          { name: "subscription_id", type: "INTEGER", required: true },
          { name: "new_plan_id", type: "INTEGER", required: true },
        ],
        preconditions: ["subscription exists", "plan exists"],
        affectedObjects: ["Subscription", "Plan", "Invoice"],
        sideEffects: [{ type: "audit_log", description: "Track plan change in audit log" }],
      },
    ],
    interfaces: buildInterfaces(),
  };

  const erd: ERD = {
    tables: [
      {
        id: "tbl_organization",
        name: "organizations",
        objectTypeId: "obj_organization",
        columns: [
          { name: "id", dataType: "SERIAL", nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "name", dataType: "TEXT", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "slug", dataType: "TEXT", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "created_at", dataType: "TIMESTAMP", nullable: false, defaultValue: "CURRENT_TIMESTAMP", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
        ],
        constraints: [{ type: "PRIMARY_KEY", columns: ["id"], expression: null, onDelete: null }, { type: "UNIQUE", columns: ["slug"], expression: null, onDelete: null }],
        indexes: [{ name: "idx_org_slug", columns: ["slug"], unique: true }],
      },
      {
        id: "tbl_user",
        name: "users",
        objectTypeId: "obj_user",
        columns: [
          { name: "id", dataType: "SERIAL", nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "organization_id", dataType: "INTEGER", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: true, referencesTable: "organizations", referencesColumn: "id" },
          { name: "email", dataType: "TEXT", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "role", dataType: "TEXT", nullable: false, defaultValue: "'member'", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "created_at", dataType: "TIMESTAMP", nullable: false, defaultValue: "CURRENT_TIMESTAMP", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
        ],
        constraints: [{ type: "PRIMARY_KEY", columns: ["id"], expression: null, onDelete: null }, { type: "FOREIGN_KEY", columns: ["organization_id"], expression: null, onDelete: "CASCADE" }, { type: "UNIQUE", columns: ["organization_id", "email"], expression: null, onDelete: null }],
        indexes: [{ name: "idx_users_org_email", columns: ["organization_id", "email"], unique: true }],
      },
      {
        id: "tbl_plan",
        name: "plans",
        objectTypeId: "obj_plan",
        columns: [
          { name: "id", dataType: "SERIAL", nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "name", dataType: "TEXT", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "price_monthly", dataType: "REAL", nullable: false, defaultValue: "0", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "created_at", dataType: "TIMESTAMP", nullable: false, defaultValue: "CURRENT_TIMESTAMP", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
        ],
        constraints: [{ type: "PRIMARY_KEY", columns: ["id"], expression: null, onDelete: null }, { type: "UNIQUE", columns: ["name"], expression: null, onDelete: null }],
        indexes: [{ name: "idx_plans_name", columns: ["name"], unique: true }],
      },
      {
        id: "tbl_subscription",
        name: "subscriptions",
        objectTypeId: "obj_subscription",
        columns: [
          { name: "id", dataType: "SERIAL", nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "organization_id", dataType: "INTEGER", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: true, referencesTable: "organizations", referencesColumn: "id" },
          { name: "plan_id", dataType: "INTEGER", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: true, referencesTable: "plans", referencesColumn: "id" },
          { name: "status", dataType: "TEXT", nullable: false, defaultValue: "'active'", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "created_at", dataType: "TIMESTAMP", nullable: false, defaultValue: "CURRENT_TIMESTAMP", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
        ],
        constraints: [{ type: "PRIMARY_KEY", columns: ["id"], expression: null, onDelete: null }, { type: "FOREIGN_KEY", columns: ["organization_id"], expression: null, onDelete: "CASCADE" }, { type: "FOREIGN_KEY", columns: ["plan_id"], expression: null, onDelete: "RESTRICT" }],
        indexes: [{ name: "idx_subscriptions_org", columns: ["organization_id"], unique: false }],
      },
      {
        id: "tbl_invoice",
        name: "invoices",
        objectTypeId: "obj_invoice",
        columns: [
          { name: "id", dataType: "SERIAL", nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "subscription_id", dataType: "INTEGER", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: true, referencesTable: "subscriptions", referencesColumn: "id" },
          { name: "amount_due", dataType: "REAL", nullable: false, defaultValue: "0", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "status", dataType: "TEXT", nullable: false, defaultValue: "'open'", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "created_at", dataType: "TIMESTAMP", nullable: false, defaultValue: "CURRENT_TIMESTAMP", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
        ],
        constraints: [{ type: "PRIMARY_KEY", columns: ["id"], expression: null, onDelete: null }, { type: "FOREIGN_KEY", columns: ["subscription_id"], expression: null, onDelete: "CASCADE" }, { type: "CHECK", columns: ["amount_due"], expression: "amount_due >= 0", onDelete: null }],
        indexes: [{ name: "idx_invoices_subscription", columns: ["subscription_id"], unique: false }],
      },
    ],
    relationships: [
      { id: "rel_user_org", fromTable: "users", toTable: "organizations", fromColumn: "organization_id", toColumn: "id", cardinality: "1:N", required: true, onDelete: "CASCADE" },
      { id: "rel_subscription_org", fromTable: "subscriptions", toTable: "organizations", fromColumn: "organization_id", toColumn: "id", cardinality: "1:N", required: true, onDelete: "CASCADE" },
      { id: "rel_subscription_plan", fromTable: "subscriptions", toTable: "plans", fromColumn: "plan_id", toColumn: "id", cardinality: "1:N", required: true, onDelete: "RESTRICT" },
      { id: "rel_invoice_subscription", fromTable: "invoices", toTable: "subscriptions", fromColumn: "subscription_id", toColumn: "id", cardinality: "1:N", required: true, onDelete: "CASCADE" },
    ],
  };

  validateFallbackIntegrity(erd);
  return { plan, ontology, erd, buildScript: buildFallbackScript(erd), fallbackDomain: "saas", geminiAttempted: false, fallbackReason: null, domainDecisionSource: "classifier" };
}

function buildEcommerceFallback(prompt: string): FallbackGenerationPayload {
  const plan: Plan = {
    domain: prompt.trim() ? `${prompt.trim().slice(0, 60)} (fallback e-commerce)` : "E-Commerce",
    entities: [
      { name: "Customer", description: "Buyer profile", category: "core" },
      { name: "Product", description: "Catalog item", category: "core" },
      { name: "Order", description: "Customer order", category: "core" },
      { name: "OrderItem", description: "Product rows inside order", category: "junction" },
      { name: "Payment", description: "Payment transaction for order", category: "core" },
    ],
    relationships: [
      { from: "Customer", to: "Order", cardinality: "1:N", description: "Customer places many orders" },
      { from: "Order", to: "OrderItem", cardinality: "1:N", description: "Order has many line items" },
      { from: "Product", to: "OrderItem", cardinality: "1:N", description: "Product appears on many line items" },
      { from: "Order", to: "Payment", cardinality: "1:N", description: "Order may have payment attempts" },
    ],
    actions: [
      { name: "PlaceOrder", description: "Create order and order items", entitiesAffected: ["Order", "OrderItem"] },
      { name: "CapturePayment", description: "Capture payment for order", entitiesAffected: ["Payment", "Order"] },
    ],
    interfaces: [{ name: "Auditable", properties: ["created_at"], implementingEntities: ["Customer", "Product", "Order", "OrderItem", "Payment"] }],
  };

  const ontology: Ontology = {
    objectTypes: buildObjectTypes([
      {
        id: "obj_customer",
        name: "Customer",
        description: "Buyer profile",
        confidence: "high",
        properties: [
          { name: "email", dataType: "TEXT", required: true, description: "Customer email" },
          { name: "name", dataType: "TEXT", required: true, description: "Customer name" },
        ],
      },
      {
        id: "obj_product",
        name: "Product",
        description: "Catalog product",
        confidence: "high",
        properties: [
          { name: "sku", dataType: "TEXT", required: true, description: "SKU" },
          { name: "name", dataType: "TEXT", required: true, description: "Product name" },
          { name: "unit_price", dataType: "REAL", required: true, description: "Current price" },
        ],
      },
      {
        id: "obj_order",
        name: "Order",
        description: "Placed order",
        confidence: "high",
        properties: [
          { name: "customer_id", dataType: "INTEGER", required: true, description: "Customer reference" },
          { name: "status", dataType: "TEXT", required: true, description: "Order status" },
        ],
      },
      {
        id: "obj_order_item",
        name: "OrderItem",
        description: "Line item",
        confidence: "high",
        properties: [
          { name: "order_id", dataType: "INTEGER", required: true, description: "Order reference" },
          { name: "product_id", dataType: "INTEGER", required: true, description: "Product reference" },
          { name: "quantity", dataType: "INTEGER", required: true, description: "Quantity ordered" },
        ],
      },
      {
        id: "obj_payment",
        name: "Payment",
        description: "Order payment",
        confidence: "medium",
        properties: [
          { name: "order_id", dataType: "INTEGER", required: true, description: "Order reference" },
          { name: "amount", dataType: "REAL", required: true, description: "Payment amount" },
          { name: "status", dataType: "TEXT", required: true, description: "Payment status" },
        ],
      },
    ]),
    linkTypes: [
      { id: "lnk_order_customer", name: "order_for_customer", fromObject: "Order", toObject: "Customer", cardinality: "1:N", required: true, description: "Order belongs to customer" },
      { id: "lnk_item_order", name: "line_item_for_order", fromObject: "OrderItem", toObject: "Order", cardinality: "1:N", required: true, description: "Line item belongs to order" },
      { id: "lnk_item_product", name: "line_item_for_product", fromObject: "OrderItem", toObject: "Product", cardinality: "1:N", required: true, description: "Line item references product" },
      { id: "lnk_payment_order", name: "payment_for_order", fromObject: "Payment", toObject: "Order", cardinality: "1:N", required: true, description: "Payment references order" },
    ],
    actionTypes: [
      {
        id: "act_place_order",
        name: "PlaceOrder",
        description: "Create order and line items",
        status: "active",
        inputContract: [
          { name: "customer_id", type: "INTEGER", required: true },
          { name: "items", type: "JSON", required: true },
        ],
        preconditions: ["customer exists", "products exist"],
        affectedObjects: ["Order", "OrderItem"],
        sideEffects: [{ type: "audit_log", description: "Track order creation" }],
      },
      {
        id: "act_capture_payment",
        name: "CapturePayment",
        description: "Capture payment for order",
        status: "active",
        inputContract: [
          { name: "order_id", type: "INTEGER", required: true },
          { name: "amount", type: "REAL", required: true },
        ],
        preconditions: ["order exists", "amount > 0"],
        affectedObjects: ["Payment", "Order"],
        sideEffects: [{ type: "notification", description: "Send payment confirmation" }],
      },
    ],
    interfaces: buildInterfaces(),
  };

  const erd: ERD = {
    tables: [
      {
        id: "tbl_customer",
        name: "customers",
        objectTypeId: "obj_customer",
        columns: [
          { name: "id", dataType: "SERIAL", nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "email", dataType: "TEXT", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "name", dataType: "TEXT", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "created_at", dataType: "TIMESTAMP", nullable: false, defaultValue: "CURRENT_TIMESTAMP", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
        ],
        constraints: [{ type: "PRIMARY_KEY", columns: ["id"], expression: null, onDelete: null }, { type: "UNIQUE", columns: ["email"], expression: null, onDelete: null }],
        indexes: [{ name: "idx_customers_email", columns: ["email"], unique: true }],
      },
      {
        id: "tbl_product",
        name: "products",
        objectTypeId: "obj_product",
        columns: [
          { name: "id", dataType: "SERIAL", nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "sku", dataType: "TEXT", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "name", dataType: "TEXT", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "unit_price", dataType: "REAL", nullable: false, defaultValue: "0", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "created_at", dataType: "TIMESTAMP", nullable: false, defaultValue: "CURRENT_TIMESTAMP", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
        ],
        constraints: [{ type: "PRIMARY_KEY", columns: ["id"], expression: null, onDelete: null }, { type: "UNIQUE", columns: ["sku"], expression: null, onDelete: null }, { type: "CHECK", columns: ["unit_price"], expression: "unit_price >= 0", onDelete: null }],
        indexes: [{ name: "idx_products_sku", columns: ["sku"], unique: true }],
      },
      {
        id: "tbl_order",
        name: "orders",
        objectTypeId: "obj_order",
        columns: [
          { name: "id", dataType: "SERIAL", nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "customer_id", dataType: "INTEGER", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: true, referencesTable: "customers", referencesColumn: "id" },
          { name: "status", dataType: "TEXT", nullable: false, defaultValue: "'placed'", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "created_at", dataType: "TIMESTAMP", nullable: false, defaultValue: "CURRENT_TIMESTAMP", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
        ],
        constraints: [{ type: "PRIMARY_KEY", columns: ["id"], expression: null, onDelete: null }, { type: "FOREIGN_KEY", columns: ["customer_id"], expression: null, onDelete: "CASCADE" }],
        indexes: [{ name: "idx_orders_customer", columns: ["customer_id"], unique: false }],
      },
      {
        id: "tbl_order_item",
        name: "order_items",
        objectTypeId: "obj_order_item",
        columns: [
          { name: "id", dataType: "SERIAL", nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "order_id", dataType: "INTEGER", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: true, referencesTable: "orders", referencesColumn: "id" },
          { name: "product_id", dataType: "INTEGER", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: true, referencesTable: "products", referencesColumn: "id" },
          { name: "quantity", dataType: "INTEGER", nullable: false, defaultValue: "1", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "created_at", dataType: "TIMESTAMP", nullable: false, defaultValue: "CURRENT_TIMESTAMP", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
        ],
        constraints: [
          { type: "PRIMARY_KEY", columns: ["id"], expression: null, onDelete: null },
          { type: "FOREIGN_KEY", columns: ["order_id"], expression: null, onDelete: "CASCADE" },
          { type: "FOREIGN_KEY", columns: ["product_id"], expression: null, onDelete: "RESTRICT" },
          { type: "CHECK", columns: ["quantity"], expression: "quantity > 0", onDelete: null },
        ],
        indexes: [{ name: "idx_order_items_order", columns: ["order_id"], unique: false }],
      },
      {
        id: "tbl_payment",
        name: "payments",
        objectTypeId: "obj_payment",
        columns: [
          { name: "id", dataType: "SERIAL", nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "order_id", dataType: "INTEGER", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: true, referencesTable: "orders", referencesColumn: "id" },
          { name: "amount", dataType: "REAL", nullable: false, defaultValue: "0", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "status", dataType: "TEXT", nullable: false, defaultValue: "'captured'", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
          { name: "created_at", dataType: "TIMESTAMP", nullable: false, defaultValue: "CURRENT_TIMESTAMP", isPrimaryKey: false, isForeignKey: false, referencesTable: null, referencesColumn: null },
        ],
        constraints: [{ type: "PRIMARY_KEY", columns: ["id"], expression: null, onDelete: null }, { type: "FOREIGN_KEY", columns: ["order_id"], expression: null, onDelete: "CASCADE" }, { type: "CHECK", columns: ["amount"], expression: "amount >= 0", onDelete: null }],
        indexes: [{ name: "idx_payments_order", columns: ["order_id"], unique: false }],
      },
    ],
    relationships: [
      { id: "rel_order_customer", fromTable: "orders", toTable: "customers", fromColumn: "customer_id", toColumn: "id", cardinality: "1:N", required: true, onDelete: "CASCADE" },
      { id: "rel_item_order", fromTable: "order_items", toTable: "orders", fromColumn: "order_id", toColumn: "id", cardinality: "1:N", required: true, onDelete: "CASCADE" },
      { id: "rel_item_product", fromTable: "order_items", toTable: "products", fromColumn: "product_id", toColumn: "id", cardinality: "1:N", required: true, onDelete: "RESTRICT" },
      { id: "rel_payment_order", fromTable: "payments", toTable: "orders", fromColumn: "order_id", toColumn: "id", cardinality: "1:N", required: true, onDelete: "CASCADE" },
    ],
  };

  validateFallbackIntegrity(erd);
  return { plan, ontology, erd, buildScript: buildFallbackScript(erd), fallbackDomain: "ecommerce", geminiAttempted: false, fallbackReason: null, domainDecisionSource: "classifier" };
}

function buildGenericFallback(prompt: string): FallbackGenerationPayload {
  const inventoryBaseline = buildInventoryFallback(prompt);
  return {
    ...inventoryBaseline,
    plan: {
      ...inventoryBaseline.plan,
      domain: prompt.trim() ? `${prompt.trim().slice(0, 60)} (fallback generic)` : "Generic Business System",
    },
    fallbackDomain: "generic",
    geminiAttempted: false,
    fallbackReason: null,
    domainDecisionSource: "classifier",
  };
}

export interface FallbackOptions {
  templateId?: "inventory" | "ecommerce" | "saas";
  geminiAttempted?: boolean;
  fallbackReason?: "quota" | "parse_error" | "validation_error";
}

export function createFallbackGeneration(prompt: string, options?: FallbackOptions): FallbackGenerationPayload {
  const { templateId, geminiAttempted = true, fallbackReason = "quota" } = options ?? {};

  let domain: FallbackDomain;
  let domainDecisionSource: DomainDecisionSource;

  if (templateId) {
    domain = templateId;
    domainDecisionSource = "template_hint";
  } else {
    domain = classifyPrompt(prompt);
    domainDecisionSource = "classifier";
  }

  let payload: FallbackGenerationPayload;
  if (domain === "saas") {
    payload = buildSaasFallback(prompt);
  } else if (domain === "ecommerce") {
    payload = buildEcommerceFallback(prompt);
  } else if (domain === "inventory") {
    payload = buildInventoryFallback(prompt);
  } else {
    payload = buildGenericFallback(prompt);
  }

  payload.geminiAttempted = geminiAttempted;
  payload.fallbackReason = fallbackReason;
  payload.domainDecisionSource = domainDecisionSource;

  return payload;
}

export function detectFallbackDomain(prompt: string, templateId?: string): FallbackDomain {
  if (templateId === "inventory" || templateId === "saas" || templateId === "ecommerce") {
    return templateId;
  }
  return classifyPrompt(prompt);
}
