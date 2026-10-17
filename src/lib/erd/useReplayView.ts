"use client";

import { useMemo } from "react";
import { useErdStore } from "@/store/useErdStore";
import { useProjectStore } from "@/store/useProjectStore";
import { buildScriptFromErd } from "./buildScript";
import { visibleErdAtStep } from "./replay";

/**
 * The ERD as it should currently be drawn: the full schema normally, or the
 * partially built schema while the build replay is running or paused.
 */
export function useReplayView() {
  const erd = useErdStore((state) => state.erd);
  const isPlaying = useProjectStore((state) => state.isPlaying);
  const currentBuildStep = useProjectStore((state) => state.currentBuildStep);

  const steps = useMemo(() => (erd ? buildScriptFromErd(erd).steps : []), [erd]);
  const total = steps.length;
  const active = isPlaying || (currentBuildStep > 0 && currentBuildStep < total);

  const viewErd = useMemo(() => {
    if (!erd) return null;
    return active ? visibleErdAtStep(erd, steps, currentBuildStep) : erd;
  }, [erd, active, steps, currentBuildStep]);

  return { erd, viewErd, steps, total, active, isPlaying, currentBuildStep };
}
