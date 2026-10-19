// ERD Types - Physical Database Schema

import type { Cardinality, Confidence, Status } from "./ontology";

export type ConstraintType = "PRIMARY_KEY" | "FOREIGN_KEY" | "UNIQUE" | "CHECK" | "NOT_NULL";
export type OnDeleteAction = "CASCADE" | "SET_NULL" | "RESTRICT" | "NO_ACTION";

export interface Column {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  referencesTable: string | null;
  referencesColumn: string | null;
  /** Free-text description, exported as COMMENT ON COLUMN. */
  comment?: string | null;
  /** Expression for a stored generated column (GENERATED ALWAYS AS (...) STORED). */
  generated?: string | null;
}

export interface TableConstraint {
  type: ConstraintType;
  columns: string[];
  expression: string | null;
  onDelete: OnDeleteAction | null;
}

export interface TableIndex {
  name: string;
  columns: string[];
  unique: boolean;
}

export type TableColor = "slate" | "sky" | "teal" | "green" | "amber" | "rose";

export interface Table {
  id: string;
  name: string;
  objectTypeId: string;
  columns: Column[];
  constraints: TableConstraint[];
  indexes: TableIndex[];
  /** Optional color tag for visual grouping (diagram only). */
  color?: TableColor;
  /** Free-text description, exported as COMMENT ON TABLE. */
  comment?: string | null;
}

/** A Postgres ENUM type; a column uses it by setting dataType to its name. */
export interface EnumType {
  name: string;
  values: string[];
}

/** A SQL view: CREATE VIEW name AS <sql>. */
export interface View {
  id: string;
  name: string;
  sql: string;
}

export interface Relationship {
  id: string;
  fromTable: string;
  toTable: string;
  fromColumn: string;
  toColumn: string;
  cardinality: Cardinality;
  required: boolean;
  onDelete: OnDeleteAction;
}

export interface ERD {
  tables: Table[];
  relationships: Relationship[];
  enums?: EnumType[];
  views?: View[];
}

// React Flow node/edge data types
export interface ERDNodeData extends Record<string, unknown> {
  tableName: string;
  columns: Column[];
  constraints: TableConstraint[];
  indexes: TableIndex[];
  status: Status;
  confidence: Confidence;
  objectTypeId: string;
  /** Columns with a single-column UNIQUE constraint or unique index. */
  uniqueColumns: string[];
  /** Set while previewing an AI edit. */
  diff?: "added" | "changed";
  color?: TableColor;
  comment?: string | null;
  /** Enum type names in this schema, so nodes can mark enum columns. */
  enumNames?: string[];
}

export interface ERDEdgeData extends Record<string, unknown> {
  cardinality: Cardinality;
  required: boolean;
  onDelete: OnDeleteAction;
  fromColumn: string;
  toColumn: string;
}
