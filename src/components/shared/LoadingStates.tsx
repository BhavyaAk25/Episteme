"use client";

interface SkeletonBlockProps {
  className?: string;
}

export function SkeletonBlock({ className = "" }: SkeletonBlockProps) {
  return <div className={`animate-pulse rounded bg-node-header/70 ${className}`} />;
}

export function SidebarLoadingSkeleton() {
  return (
    <div className="p-3 space-y-3">
      <SkeletonBlock className="h-4 w-28" />
      <div className="space-y-2">
        <SkeletonBlock className="h-16 w-full" />
        <SkeletonBlock className="h-16 w-full" />
        <SkeletonBlock className="h-16 w-full" />
      </div>
      <SkeletonBlock className="h-4 w-24" />
      <div className="space-y-2">
        <SkeletonBlock className="h-12 w-full" />
        <SkeletonBlock className="h-12 w-full" />
      </div>
    </div>
  );
}

export function CanvasLoadingSkeleton() {
  return (
    <div className="w-[420px] max-w-[92vw] rounded-xl border border-border bg-surface p-4 shadow-xl">
      <SkeletonBlock className="h-5 w-44" />
      <div className="mt-4 space-y-3">
        <SkeletonBlock className="h-14 w-full" />
        <SkeletonBlock className="h-14 w-full" />
        <SkeletonBlock className="h-14 w-full" />
      </div>
      <p className="mt-4 text-xs text-muted">Building ontology and ERD...</p>
    </div>
  );
}
