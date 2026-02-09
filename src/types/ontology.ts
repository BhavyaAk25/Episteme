// Ontology Types - Inspired by Palantir Foundry

export type Status = "active" | "experimental" | "deprecated";
export type Confidence = "high" | "medium" | "low";
export type Cardinality = "1:1" | "1:N" | "M:N";

export interface Property {
  name: string;
  dataType: string;
  required: boolean;
  description: string;
}

export interface ObjectType {
  id: string;
  name: string;
  description: string;
  status: Status;
  confidence: Confidence;
  implementsInterfaces: string[];
  properties: Property[];
}

export interface LinkType {
  id: string;
  name: string;
  fromObject: string;
  toObject: string;
  cardinality: Cardinality;
  required: boolean;
  description: string;
}

export interface InputParam {
  name: string;
  type: string;
  required: boolean;
}

export interface SideEffect {
  type: "audit_log" | "notification" | "cascade_update";
  description: string;
}

export interface ActionType {
  id: string;
  name: string;
  description: string;
  status: "active" | "experimental";
  inputContract: InputParam[];
  preconditions: string[];
  affectedObjects: string[];
  sideEffects: SideEffect[];
}

export interface InterfaceType {
  id: string;
  name: string;
  description: string;
  properties: Array<{
    name: string;
    dataType: string;
  }>;
}

export interface Ontology {
  objectTypes: ObjectType[];
  linkTypes: LinkType[];
  actionTypes: ActionType[];
  interfaces: InterfaceType[];
}
