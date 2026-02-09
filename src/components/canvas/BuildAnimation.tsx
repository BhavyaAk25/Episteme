"use client";

import { useEffect, useRef, useCallback } from "react";
import { useProjectStore } from "@/store/useProjectStore";
import { useCanvasStore } from "@/store/useCanvasStore";
import { useUIStore } from "@/store/useUIStore";
import { getStepDuration } from "@/lib/utils/animation";
import { erdToNodes } from "@/lib/ontology/transformer";
import type { BuildStep } from "@/types/gemini";
import type { ERDNodeData, Column, TableConstraint, TableIndex } from "@/types/erd";

/**
 * BuildAnimation component orchestrates the step-by-step build playback
 * It listens to the buildScript and plays animations based on playback state
 */
export function BuildAnimation() {
  const {
    buildScript,
    isPlaying,
    currentBuildStep,
    setCurrentBuildStep,
    setIsPlaying,
    setErrorWithTitle,
    erd,
    ontology,
  } = useProjectStore();
  const { addNode, updateNodeData, addEdge } = useCanvasStore();
  const { playbackSpeed } = useUIStore();

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Process a single build step
  const processStep = useCallback((step: BuildStep) => {
    if (!erd || !ontology) return;

    try {
      switch (step.type) {
        case "add_table": {
          const tableName = step.data.table_name as string;
          const table = erd.tables.find((t) => t.name === tableName);
          if (!table) break;

          const currentNodes = useCanvasStore.getState().nodes;
          if (currentNodes.some((node) => node.id === table.id)) {
            break;
          }

          const objectType = ontology.objectTypes.find(
            (o) => o.id === table.objectTypeId || o.name.toLowerCase().replace(/\s+/g, "_") === tableName.toLowerCase()
          );
          const layoutNode = erdToNodes(erd, ontology).find((node) => node.id === table.id);

          addNode({
            id: table.id,
            type: "erdTable",
            position: layoutNode?.position ?? { x: 80, y: 80 },
            data: {
              tableName: table.name,
              columns: [], // Start empty, columns added separately
              constraints: [],
              indexes: [],
              status: objectType?.status || "active",
              confidence: objectType?.confidence || "high",
              objectTypeId: table.objectTypeId,
            },
          });
          break;
        }

        case "add_column": {
          const tableName = step.data.table_name as string;
          const columnData = step.data.column as {
            name: string;
            data_type: string;
            nullable: boolean;
            default_value: string | null;
            is_primary_key: boolean;
            is_foreign_key: boolean;
            references_table: string | null;
            references_column: string | null;
          };

          const table = erd.tables.find((t) => t.name === tableName);
          const node = useCanvasStore
            .getState()
            .nodes.find((n) => (n.data as ERDNodeData).tableName === tableName);

          if (table && node && columnData) {
            const newColumn: Column = {
              name: columnData.name,
              dataType: columnData.data_type,
              nullable: columnData.nullable,
              defaultValue: columnData.default_value,
              isPrimaryKey: columnData.is_primary_key,
              isForeignKey: columnData.is_foreign_key,
              referencesTable: columnData.references_table,
              referencesColumn: columnData.references_column,
            };

            const currentData = node.data as ERDNodeData;
            if (currentData.columns.some((column) => column.name === newColumn.name)) {
              break;
            }
            updateNodeData(node.id, {
              columns: [...currentData.columns, newColumn],
            });
          }
          break;
        }

        case "add_relationship": {
          const relData = step.data as {
            id: string;
            from_table: string;
            to_table: string;
            from_column: string;
            to_column: string;
            cardinality: string;
            required: boolean;
            on_delete: string;
          };

          const currentNodes = useCanvasStore.getState().nodes;
          const sourceNode = currentNodes.find((n) => (n.data as ERDNodeData).tableName === relData.from_table);
          const targetNode = currentNodes.find((n) => (n.data as ERDNodeData).tableName === relData.to_table);

          if (sourceNode && targetNode) {
            const sourceNodeData = sourceNode.data as ERDNodeData;
            const sourceHandle = sourceNodeData.columns.some(
              (column) => column.name === relData.from_column && column.isForeignKey
            )
              ? `${relData.from_column}-source`
              : undefined;

            addEdge({
              id: relData.id || `edge-${relData.from_table}-${relData.to_table}`,
              type: "erdRelation",
              source: sourceNode.id,
              target: targetNode.id,
              sourceHandle,
              data: {
                cardinality: relData.cardinality as "1:1" | "1:N" | "M:N",
                required: relData.required,
                onDelete: relData.on_delete as "CASCADE" | "SET_NULL" | "RESTRICT",
                fromColumn: relData.from_column,
                toColumn: relData.to_column,
                edgeSource: "generated",
              },
            });
          }
          break;
        }

        case "add_constraint": {
          const tableName = step.data.table_name as string;
          const constraintData = step.data.constraint as {
            type: string;
            columns: string[];
            expression: string | null;
            on_delete: string | null;
          };

          const node = useCanvasStore
            .getState()
            .nodes.find((n) => (n.data as ERDNodeData).tableName === tableName);

          if (node && constraintData) {
            const newConstraint: TableConstraint = {
              type: constraintData.type as "PRIMARY_KEY" | "FOREIGN_KEY" | "UNIQUE" | "CHECK" | "NOT_NULL",
              columns: constraintData.columns,
              expression: constraintData.expression,
              onDelete: constraintData.on_delete as "CASCADE" | "SET_NULL" | "RESTRICT" | "NO_ACTION" | null,
            };

            const currentData = node.data as ERDNodeData;
            const constraintExists = currentData.constraints.some((constraint) => {
              return (
                constraint.type === newConstraint.type &&
                constraint.columns.join(",") === newConstraint.columns.join(",") &&
                (constraint.expression ?? "") === (newConstraint.expression ?? "")
              );
            });
            if (constraintExists) {
              break;
            }
            updateNodeData(node.id, {
              constraints: [...currentData.constraints, newConstraint],
            });
          }
          break;
        }

        case "add_index": {
          const tableName = step.data.table_name as string;
          const indexData = step.data.index as {
            name: string;
            columns: string[];
            unique: boolean;
          };

          const node = useCanvasStore
            .getState()
            .nodes.find((n) => (n.data as ERDNodeData).tableName === tableName);

          if (node && indexData) {
            const newIndex: TableIndex = {
              name: indexData.name,
              columns: indexData.columns,
              unique: indexData.unique,
            };

            const currentData = node.data as ERDNodeData;
            if (currentData.indexes.some((index) => index.name === newIndex.name)) {
              break;
            }
            updateNodeData(node.id, {
              indexes: [...currentData.indexes, newIndex],
            });
          }
          break;
        }

        default:
          break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorWithTitle("Build Playback Failed", message);
      setIsPlaying(false);
    }
  }, [erd, ontology, addNode, updateNodeData, addEdge, setErrorWithTitle, setIsPlaying]);

  // Play the next step
  const playNextStep = useCallback(() => {
    if (!buildScript || !isPlaying) return;

    const steps = buildScript.steps;
    if (currentBuildStep >= steps.length) {
      setIsPlaying(false);
      return;
    }

    const step = steps[currentBuildStep];
    processStep(step);

    // Schedule next step
    const duration = getStepDuration(step, playbackSpeed);

    timeoutRef.current = setTimeout(() => {
      setCurrentBuildStep(currentBuildStep + 1);
    }, duration);
  }, [buildScript, isPlaying, currentBuildStep, playbackSpeed, processStep, setCurrentBuildStep, setIsPlaying]);

  // Effect to drive the animation
  useEffect(() => {
    if (isPlaying && buildScript) {
      playNextStep();
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isPlaying, currentBuildStep, playNextStep, buildScript]);

  // Reset animation when build script changes
  useEffect(() => {
    if (buildScript) {
      setCurrentBuildStep(0);
      setIsPlaying(false);
    }
  }, [buildScript, setCurrentBuildStep, setIsPlaying]);

  return null; // This is a logic-only component
}
