"use client";

import { useEffect } from "react";
import { useUIStore } from "@/store/useUIStore";
import { FEEDBACK_URL } from "@/lib/feedback";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["input", "textarea", "select"].includes(target.tagName.toLowerCase()));

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl";

const SHORTCUTS: Array<[string, string]> = [
  [`${mod} + Enter`, "Generate from the description"],
  ["/", "Focus the description box"],
  [`${mod} + K`, "Search tables and commands"],
  [`${mod} + Z`, "Undo"],
  [isMac ? "⌘ + ⇧ + Z" : "Ctrl + Y", "Redo"],
  ["Delete / Backspace", "Delete the selected tables or relationship"],
  ["Shift + drag", "Select several tables"],
  [`${mod} + A`, "Select all tables"],
  [`${mod} + C / V`, "Copy / paste tables"],
  [`${mod} + D`, "Duplicate selected tables"],
  ["Double-click a name", "Rename a table or column"],
  ["Esc", "Close dialogs and menus"],
  ["?", "Show this list"],
];

/** Global shortcuts that don't override browser defaults, plus a "?" help dialog. */
export function ShortcutsDialog() {
  const { shortcutsOpen, setShortcutsOpen } = useUIStore();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShortcutsOpen(false);
        return;
      }
      const mod = event.metaKey || event.ctrlKey;
      if (isTyping(event.target) || mod || event.altKey) return;
      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
      } else if (event.key === "/") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('input[aria-label="System description"]')?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setShortcutsOpen]);

  if (!shortcutsOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => setShortcutsOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="w-[420px] max-w-full rounded-xl border border-border bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-foreground">Keyboard shortcuts</h2>
          <button onClick={() => setShortcutsOpen(false)} aria-label="Close" className="w-8 h-8 rounded-lg text-muted hover:text-foreground hover:bg-foreground/5">×</button>
        </div>
        <ul className="p-3 max-h-[60vh] overflow-y-auto">
          {SHORTCUTS.map(([keys, action]) => (
            <li key={keys} className="flex items-center justify-between gap-4 px-2 py-1.5 text-[13px]">
              <span className="text-foreground">{action}</span>
              <kbd className="px-2 py-0.5 rounded-md border border-border bg-canvas font-mono text-[11px] text-muted whitespace-nowrap">{keys}</kbd>
            </li>
          ))}
        </ul>
        <div className="px-5 py-3 border-t border-border">
          <button
            onClick={() => {
              setShortcutsOpen(false);
              useUIStore.getState().setTourOpen(true);
            }}
            className="text-[12px] text-accent hover:underline"
          >
            Take the 4-step tour
          </button>
          <a href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer" className="text-[12px] text-accent hover:underline">Send feedback</a>
        </div>
      </div>
    </div>
  );
}
