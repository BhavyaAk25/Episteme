import { useEffect, useRef } from "react";

/** Call `onEscape` when Escape is pressed anywhere while the component is mounted. */
export function useEscape(onEscape: () => void, active = true) {
  const handler = useRef(onEscape);
  useEffect(() => {
    handler.current = onEscape;
  });
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handler.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);
}
