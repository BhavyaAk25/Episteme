"use client";

import { useProjectStore } from "@/store/useProjectStore";
import { useUIStore } from "@/store/useUIStore";
import { useCanvasStore } from "@/store/useCanvasStore";
import type { PlaybackSpeed } from "@/lib/utils/animation";
import type { ERDEdgeData } from "@/types/erd";

const SPEEDS: PlaybackSpeed[] = [0.5, 1, 2, 5];

function getUserEdges() {
  return useCanvasStore.getState().edges.filter((e) => (e.data as ERDEdgeData | undefined)?.edgeSource === "user");
}

export function CanvasControls() {
  const { buildScript, isPlaying, setIsPlaying, currentBuildStep, setCurrentBuildStep } = useProjectStore();
  const { playbackSpeed, setPlaybackSpeed } = useUIStore();
  const { nodes, edges, setNodes, setEdges } = useCanvasStore();

  const totalSteps = buildScript?.steps.length || 0;
  const progress = totalSteps > 0 ? (currentBuildStep / totalSteps) * 100 : 0;

  const clearGenerated = () => {
    const userEdges = getUserEdges();
    setNodes([]);
    setEdges(userEdges);
  };

  const clearAll = () => {
    setNodes([]);
    setEdges([]);
  };

  const handlePlayPause = () => {
    if (!buildScript) return;

    if (isPlaying) {
      setIsPlaying(false);
    } else {
      if (currentBuildStep >= totalSteps) {
        setCurrentBuildStep(0);
        clearGenerated();
      } else if (currentBuildStep === 0 && (nodes.length > 0 || edges.length > 0)) {
        clearGenerated();
      }
      setIsPlaying(true);
    }
  };

  const handleRestart = () => {
    setCurrentBuildStep(0);
    setIsPlaying(false);
    clearGenerated();
  };

  const handleResetAll = () => {
    setCurrentBuildStep(0);
    setIsPlaying(false);
    clearAll();
  };

  if (!buildScript || totalSteps === 0) {
    return null;
  }

  return (
    <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10">
      <div className="bg-[rgba(255,252,247,0.95)] backdrop-blur-[8px] rounded-xl px-4 py-2 flex items-center gap-3 shadow-md border border-[rgba(0,0,0,0.08)]">
        {/* Play/Pause — 40px circle, warm accent */}
        <button
          onClick={handlePlayPause}
          className="w-10 h-10 rounded-full bg-[#B8976A] flex items-center justify-center hover:brightness-90 transition-all shadow-sm"
        >
          {isPlaying ? (
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </button>

        {/* Restart — 32px circle, transparent */}
        <button
          onClick={handleRestart}
          title="Restart replay (keeps your links)"
          className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[rgba(0,0,0,0.05)] transition-colors"
        >
          <svg className="w-4 h-4 text-[#8B7355]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>

        {/* Reset All — 32px circle, transparent with error hint */}
        <button
          onClick={handleResetAll}
          title="Reset all (clears everything)"
          className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-error/10 transition-colors"
        >
          <svg className="w-4 h-4 text-error/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>

        {/* Progress bar */}
        <div className="flex-1 min-w-[210px]">
          <div className="h-2 bg-canvas rounded-full overflow-hidden">
            <div
              className="h-full bg-[#B8976A] transition-all duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[12px] text-[#8B7355]">
              Step {currentBuildStep} / {totalSteps}
            </span>
            <span className="text-[12px] text-[#8B7355]">
              {Math.round(progress)}%
            </span>
          </div>
        </div>

        {/* Speed selector */}
        <div className="flex items-center gap-1">
          <span className="text-[12px] text-[#8B7355] mr-1">Speed</span>
          {SPEEDS.map((speed) => (
            <button
              key={speed}
              onClick={() => setPlaybackSpeed(speed)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                playbackSpeed === speed
                  ? "bg-[rgba(184,151,106,0.15)] text-[#B8976A] font-semibold"
                  : "text-[#8B7355] hover:bg-[rgba(0,0,0,0.05)]"
              }`}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
