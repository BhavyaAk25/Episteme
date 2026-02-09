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

export interface Table {
  id: string;
  name: string;
  objectTypeId: string;
  columns: Column[];
  constraints: TableConstraint[];
  indexes: TableIndex[];
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
}

export type EdgeSource = "generated" | "user";

export interface ERDEdgeData extends Record<string, unknown> {
  cardinality: Cardinality;
  required: boolean;
  onDelete: OnDeleteAction;
  fromColumn: string;
  toColumn: string;
  edgeSource: EdgeSource;
}
