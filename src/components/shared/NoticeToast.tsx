"use client";

import { useEffect } from "react";
import { useUIStore } from "@/store/useUIStore";

/** Short, neutral confirmation messages (share link opened, SQL imported…). */
export function NoticeToast() {
  const notice = useUIStore((state) => state.notice);
  const showNotice = useUIStore((state) => state.showNotice);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => showNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice, showNotice]);

  if (!notice) return null;
  return (
    <div role="status" className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2.5 shadow-lg">
      <span className="w-2 h-2 rounded-full bg-success shrink-0" />
      <p className="text-[13px] text-foreground">{notice}</p>
      <button onClick={() => showNotice(null)} aria-label="Dismiss" className="text-muted hover:text-foreground leading-none">×</button>
    </div>
  );
}
