"use client";

import { useMemo } from "react";
import { useErdStore } from "@/store/useErdStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useAiEditStore } from "@/store/useAiEditStore";
import { buildScriptFromErd } from "./buildScript";
import { visibleErdAtStep } from "./replay";

/**
 * The ERD as it should currently be drawn:
 * - an AI edit preview, when one is waiting for approval;
 * - the partially built schema while the build replay runs;
 * - otherwise the schema itself.
 * `locked` is true whenever the canvas shows something other than the
 * editable schema.
 */
export function useReplayView() {
  const erd = useErdStore((state) => state.erd);
  const isPlaying = useProjectStore((state) => state.isPlaying);
  const currentBuildStep = useProjectStore((state) => state.currentBuildStep);
  const previewErd = useAiEditStore((state) => state.previewErd);

  const steps = useMemo(() => (erd ? buildScriptFromErd(erd).steps : []), [erd]);
  const total = steps.length;
  const active = !previewErd && (isPlaying || (currentBuildStep > 0 && currentBuildStep < total));

  const viewErd = useMemo(() => {
    if (previewErd) return previewErd;
    if (!erd) return null;
    return active ? visibleErdAtStep(erd, steps, currentBuildStep) : erd;
  }, [erd, previewErd, active, steps, currentBuildStep]);

  return {
    erd,
    viewErd,
    steps,
    total,
    active,
    previewing: Boolean(previewErd),
    locked: active || Boolean(previewErd),
    isPlaying,
    currentBuildStep,
  };
}
