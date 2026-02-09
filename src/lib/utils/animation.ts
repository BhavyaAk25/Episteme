import type { BuildStep } from "@/types/gemini";

// Animation timing in ms
const BASE_DURATION = {
  add_table: 300,
  add_column: 150,
  add_relationship: 400,
  add_constraint: 200,
  add_index: 150,
  add_action: 200,
};

// Playback speeds
export type PlaybackSpeed = 0.5 | 1 | 2 | 5;

/**
 * Get the duration for a build step at a given playback speed
 */
export function getStepDuration(step: BuildStep, speed: PlaybackSpeed): number {
  const baseDuration = BASE_DURATION[step.type] || 200;
  return baseDuration / speed;
}

/**
 * Calculate total animation duration for a build script
 */
export function getTotalDuration(steps: BuildStep[], speed: PlaybackSpeed): number {
  return steps.reduce((total, step) => total + getStepDuration(step, speed), 0);
}

/**
 * Get the cumulative time for each step
 */
export function getStepTimings(steps: BuildStep[], speed: PlaybackSpeed): number[] {
  const timings: number[] = [];
  let cumulative = 0;

  for (const step of steps) {
    timings.push(cumulative);
    cumulative += getStepDuration(step, speed);
  }

  return timings;
}

/**
 * Animation variants for Framer Motion
 */
export const nodeAnimationVariants = {
  hidden: {
    opacity: 0,
    scale: 0.8,
    y: 20,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: "spring",
      damping: 20,
      stiffness: 300,
    },
  },
};

export const columnAnimationVariants = {
  hidden: {
    opacity: 0,
    x: -20,
    height: 0,
  },
  visible: {
    opacity: 1,
    x: 0,
    height: "auto",
    transition: {
      type: "spring",
      damping: 25,
      stiffness: 400,
    },
  },
};

export const edgeAnimationVariants = {
  hidden: {
    pathLength: 0,
    opacity: 0,
  },
  visible: {
    pathLength: 1,
    opacity: 1,
    transition: {
      pathLength: { type: "spring", duration: 0.4 },
      opacity: { duration: 0.1 },
    },
  },
};

export const constraintAnimationVariants = {
  hidden: {
    opacity: 0,
    scale: 0,
  },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      type: "spring",
      damping: 15,
      stiffness: 400,
    },
  },
};
