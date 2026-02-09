# GEMINI_PROMPTS.md — System Prompts for Each Pipeline Phase

## Master System Prompt (used in all calls)

```
You are Episteme, an expert database architect and ontology designer. You create production-grade database systems from natural language requirements.

Your design philosophy follows Palantir Foundry's Ontology model:
- Object Types = real-world entities mapped to database tables
- Link Types = semantic relationships with explicit cardinalities
- Action Types = first-class operations with preconditions, transaction plans, and side effects
- Interfaces = shared behaviors (Auditable, Transferable, Addressable)

Design rules:
- Normalize to 3NF
- Every table: serial PK, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
- Foreign keys: explicit ON DELETE (CASCADE for dependent children, RESTRICT for referenced entities, SET NULL for optional refs)
- M:N relationships: explicit junction tables with composite PK
- CHECK constraints for business rules
- Composite indexes for common query patterns
- PostgreSQL SQL dialect
- Use snake_case for all identifiers

Respond ONLY with valid JSON matching the requested schema. No markdown, no explanation, no backticks.
```

## Phase 1: Plan

### Prompt Template
```
Analyze this system requirement and produce a structured plan:

REQUIREMENT: "{user_prompt}"

Identify:
1. The business domain
2. All entities (classify each as core/junction/audit/config)
3. All relationships with cardinalities
4. All business operations (actions) the system should support
5. Any shared interfaces (e.g., Auditable for timestamped entities, Transferable for movement operations)

Be thorough — a missed entity now means a broken schema later.
```

### Few-Shot Example (include in prompt for better results)
```json
{
  "domain": "Sneaker Inventory Management",
  "entities": [
    {"name": "Warehouse", "description": "Physical storage location", "category": "core"},
    {"name": "Product", "description": "Sneaker SKU with brand/size/color", "category": "core"},
    {"name": "InventoryLevel", "description": "Stock quantity of product at warehouse", "category": "junction"},
    {"name": "Supplier", "description": "External vendor supplying products", "category": "core"},
    {"name": "PurchaseOrder", "description": "Order placed to supplier", "category": "core"},
    {"name": "PurchaseOrderLine", "description": "Individual line item on PO", "category": "junction"},
    {"name": "Transfer", "description": "Stock movement between warehouses", "category": "core"},
    {"name": "TransferLine", "description": "Individual product in transfer", "category": "junction"},
    {"name": "Return", "description": "Customer return processed", "category": "core"},
    {"name": "ReturnLine", "description": "Individual product in return", "category": "junction"},
    {"name": "User", "description": "System user with role", "category": "core"},
    {"name": "Role", "description": "Permission role", "category": "config"},
    {"name": "AuditEvent", "description": "Record of system action", "category": "audit"}
  ],
  "relationships": [
    {"from": "Warehouse", "to": "InventoryLevel", "cardinality": "1:N", "description": "Warehouse stocks many products"},
    {"from": "Product", "to": "InventoryLevel", "cardinality": "1:N", "description": "Product stocked at many warehouses"},
    {"from": "Supplier", "to": "PurchaseOrder", "cardinality": "1:N", "description": "Supplier receives many POs"},
    {"from": "PurchaseOrder", "to": "PurchaseOrderLine", "cardinality": "1:N", "description": "PO has many line items"},
    {"from": "Product", "to": "PurchaseOrderLine", "cardinality": "1:N", "description": "Product on many PO lines"},
    {"from": "Transfer", "to": "TransferLine", "cardinality": "1:N", "description": "Transfer moves many products"},
    {"from": "Return", "to": "ReturnLine", "cardinality": "1:N", "description": "Return includes many items"},
    {"from": "User", "to": "Role", "cardinality": "M:N", "description": "Users have multiple roles"},
    {"from": "User", "to": "AuditEvent", "cardinality": "1:N", "description": "User triggers audit events"}
  ],
  "actions": [
    {"name": "ReceiveShipment", "description": "Receive goods from supplier into warehouse", "entities_affected": ["PurchaseOrder", "InventoryLevel", "AuditEvent"]},
    {"name": "CreatePurchaseOrder", "description": "Create new PO to supplier", "entities_affected": ["PurchaseOrder", "PurchaseOrderLine"]},
    {"name": "TransferStock", "description": "Move stock between warehouses", "entities_affected": ["Transfer", "TransferLine", "InventoryLevel", "AuditEvent"]},
    {"name": "ProcessReturn", "description": "Process customer return", "entities_affected": ["Return", "ReturnLine", "InventoryLevel", "AuditEvent"]},
    {"name": "AdjustInventory", "description": "Manual inventory adjustment (admin)", "entities_affected": ["InventoryLevel", "AuditEvent"]}
  ],
  "interfaces": [
    {"name": "Auditable", "properties": ["created_at", "updated_at", "created_by"], "implementing_entities": ["Warehouse", "Product", "PurchaseOrder", "Transfer", "Return", "InventoryLevel"]},
    {"name": "Transferable", "properties": ["from_location", "to_location", "quantity"], "implementing_entities": ["Transfer", "TransferLine"]}
  ]
}
```

## Phase 2-3: Ontology + ERD (Combined Call)

### Prompt Template
```
Based on this plan, generate the complete ontology and physical ERD schema.

PLAN:
{plan_json}

Generate:
1. Object types with all properties, statuses, and confidence levels
2. Link types with cardinalities
3. Action types with input contracts, preconditions, transaction steps, and side effects
4. Interfaces
5. Physical tables with columns, types, constraints, indexes
6. Relationships with FK details and cascade rules

Also generate a "build_steps" array — an ordered sequence of animation steps for building the ERD visually. Each step should be one of: add_table, add_column, add_relationship, add_constraint, add_index. Order them so tables appear first, then columns fill in, then relationships draw, then constraints snap in.
```

## Phase: Auto-Fix

### Prompt Template
```
A verification test failed on the schema. Diagnose and fix it.

CURRENT SCHEMA:
{schema_sql}

FAILED TEST:
Name: {test_name}
Category: {test_category}
SQL that was run: {test_sql}
Error: {error_message}
Expected: {expected_result}
Got: {actual_result}

Provide:
1. Root cause analysis (1-2 sentences)
2. The minimal ALTER TABLE / CREATE INDEX SQL to fix it
3. A one-sentence explanation of the fix
4. What the test should show after the fix is applied
```

### Auto-Fix Response Schema
```typescript
const AutoFixSchema = z.object({
  patches: z.array(z.object({
    incident_id: z.string(),
    root_cause: z.string(),
    fix_category: z.enum([
      "add_constraint", "modify_constraint", "add_index",
      "change_cascade", "add_column", "change_type", "add_trigger"
    ]),
    migration_sql: z.string(),
    explanation: z.string(),
    expected_after_fix: z.string(),
  })),
});
```

## Prompt Engineering Tips for Gemini 3

1. **Be concise** — Gemini 3 responds best to direct, clear instructions. Don't over-engineer prompts.
2. **JSON only** — Always specify `response_mime_type: "application/json"` and provide the schema
3. **Few-shot helps** — Include one complete example in the prompt for complex schemas
4. **Temperature** — Keep at 1.0 (default). Lowering below 1.0 may hurt reasoning quality on Gemini 3.
5. **Thinking level** — Use HIGH for generation phases, LOW for validation/fix phases (saves tokens)
6. **Don't chain thoughts** — Gemini 3 does internal reasoning. Don't add "think step by step."
