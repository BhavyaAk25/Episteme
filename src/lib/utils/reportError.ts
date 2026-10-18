/** Send a browser error to /api/client-error (deduplicated, capped per page load). */
const sent = new Set<string>();
const MAX_REPORTS = 5;

export function reportError(kind: "error" | "unhandledrejection" | "react", error: unknown): void {
  if (typeof window === "undefined" || sent.size >= MAX_REPORTS) return;
  const message = (error instanceof Error ? error.message : String(error ?? "Unknown error")).slice(0, 500);
  if (!message || sent.has(message)) return;
  sent.add(message);
  const payload = JSON.stringify({
    kind,
    message,
    stack: error instanceof Error ? error.stack?.slice(0, 4000) : undefined,
    url: window.location.pathname,
  });
  try {
    if (!navigator.sendBeacon?.("/api/client-error", new Blob([payload], { type: "application/json" }))) {
      void fetch("/api/client-error", { method: "POST", body: payload, keepalive: true });
    }
  } catch {
    /* never let error reporting cause errors */
  }
}
