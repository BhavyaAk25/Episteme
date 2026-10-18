"use client";

import { useEffect, useState } from "react";

const KEY = "episteme-small-screen-hint";

/** One-time note on phones: viewing and light edits work, heavy editing is nicer on a larger screen. */
export function SmallScreenHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = Boolean(window.localStorage.getItem(KEY));
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- depends on window size and browser storage
    if (!seen && window.innerWidth < 768) setShow(true);
  }, []);

  if (!show) return null;
  const dismiss = () => {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  };
  return (
    <div role="status" className="fixed bottom-14 inset-x-3 z-50 rounded-xl border border-border bg-surface p-3 shadow-xl flex items-start gap-3">
      <p className="text-[13px] text-foreground leading-snug">
        You can view, test, export and make small edits here. For heavy editing, a larger screen works best.
      </p>
      <button onClick={dismiss} className="ui-ghost-btn !min-h-8 !py-1 !px-3 shrink-0">Got it</button>
    </div>
  );
}
