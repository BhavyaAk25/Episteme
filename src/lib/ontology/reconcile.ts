import type { ERD } from "@/types/erd";
import type { Ontology } from "@/types/ontology";

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

/**
 * Make the ontology match the ERD: one object type per table and one link
 * type per relationship, reusing names/descriptions from the existing
 * ontology where they match.
 */
export function reconcileOntologyWithErd(ontology: Ontology, erd: ERD): Ontology {
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

export const EMPTY_ONTOLOGY: Ontology = { objectTypes: [], linkTypes: [], actionTypes: [], interfaces: [] };
