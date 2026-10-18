"use client";

import { useProjectStore } from "@/store/useProjectStore";
import { useUIStore } from "@/store/useUIStore";
import { useReplayView } from "@/lib/erd/useReplayView";
import type { PlaybackSpeed } from "@/lib/utils/animation";

const SPEEDS: PlaybackSpeed[] = [0.5, 1, 2, 5];

/** Replay of how the current schema is built, step by step. Never edits the schema. */
export function CanvasControls() {
  const { total: totalSteps, active, isPlaying, currentBuildStep, previewing } = useReplayView();
  const { setIsPlaying, setCurrentBuildStep } = useProjectStore();
  const { playbackSpeed, setPlaybackSpeed } = useUIStore();

  const progress = totalSteps > 0 ? (currentBuildStep / totalSteps) * 100 : 0;

  const handlePlayPause = () => {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (!active) setCurrentBuildStep(0);
    setIsPlaying(true);
  };

  const handleRestart = () => {
    setCurrentBuildStep(0);
    setIsPlaying(true);
  };

  // Leave replay and show the full schema again.
  const handleStop = () => {
    setIsPlaying(false);
    setCurrentBuildStep(0);
  };

  // Only visible during a replay; start it from the toolbar's Replay button.
  if (totalSteps === 0 || previewing || !active) {
    return null;
  }

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
      <div className="bg-surface/95 backdrop-blur-[8px] rounded-xl px-4 py-2 flex items-center gap-3 shadow-md border border-foreground/[0.08]">
        {/* Play/Pause — 40px circle, warm accent */}
        <button
          onClick={handlePlayPause}
          aria-label={isPlaying ? "Pause replay" : "Replay how this schema is built"}
          title={isPlaying ? "Pause" : "Replay build"}
          className="w-10 h-10 rounded-full bg-brand flex items-center justify-center hover:brightness-90 transition-all shadow-sm"
        >
          {isPlaying ? (
            <svg className="w-5 h-5 text-brand-ink" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-brand-ink ml-0.5" fill="currentColor" viewBox="0 0 20 20">
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
          title="Restart replay"
          aria-label="Restart replay"
          className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-foreground/[0.05] transition-colors"
        >
          <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>

        {/* Stop — back to the full, editable schema */}
        <button
          onClick={handleStop}
          disabled={!active}
          title="Stop replay"
          aria-label="Stop replay"
          className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-foreground/[0.05] disabled:opacity-30 transition-colors"
        >
          <svg className="w-3.5 h-3.5 text-muted" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <rect x="4" y="4" width="12" height="12" rx="2" />
          </svg>
        </button>

        {/* Progress bar */}
        <div className="flex-1 min-w-[210px]">
          <div className="h-2 bg-canvas rounded-full overflow-hidden">
            <div
              className="h-full bg-brand transition-all duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[12px] text-muted">
              {active ? `Step ${currentBuildStep} / ${totalSteps}` : "Replay build"}
            </span>
            <span className="text-[12px] text-muted">
              {active ? `${Math.round(progress)}% · editing paused` : `${totalSteps} steps`}
            </span>
          </div>
        </div>

        {/* Speed selector */}
        <div className="flex items-center gap-1">
          <span className="text-[12px] text-muted mr-1">Speed</span>
          {SPEEDS.map((speed) => (
            <button
              key={speed}
              onClick={() => setPlaybackSpeed(speed)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                playbackSpeed === speed
                  ? "bg-brand/15 text-brand font-semibold"
                  : "text-muted hover:bg-foreground/[0.05]"
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
