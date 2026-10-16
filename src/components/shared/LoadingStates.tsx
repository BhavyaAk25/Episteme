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
