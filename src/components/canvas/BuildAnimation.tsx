"use client";

import { useEffect } from "react";
import { useProjectStore } from "@/store/useProjectStore";
import { useUIStore } from "@/store/useUIStore";
import { getStepDuration } from "@/lib/utils/animation";
import { useReplayView } from "@/lib/erd/useReplayView";

/**
 * Drives the build replay clock. The canvas draws whatever part of the ERD
 * the current step has reached (see useReplayView); this only advances it.
 */
export function BuildAnimation() {
  const { steps, total, isPlaying, currentBuildStep } = useReplayView();
  const playbackSpeed = useUIStore((state) => state.playbackSpeed);

  useEffect(() => {
    if (!isPlaying) return;
    const { setCurrentBuildStep, setIsPlaying } = useProjectStore.getState();

    if (currentBuildStep >= total) {
      // Finished: leave replay mode and show the full schema.
      setIsPlaying(false);
      setCurrentBuildStep(0);
      return;
    }

    const timer = window.setTimeout(
      () => setCurrentBuildStep(currentBuildStep + 1),
      getStepDuration(steps[currentBuildStep], playbackSpeed)
    );
    return () => window.clearTimeout(timer);
  }, [isPlaying, currentBuildStep, total, steps, playbackSpeed]);

  return null;
}
