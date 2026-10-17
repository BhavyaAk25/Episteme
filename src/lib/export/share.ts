import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import type { ERD } from "@/types/erd";

/**
 * Share links carry the whole schema in the URL fragment (#share=…), which
 * browsers never send to the server: no storage, no account, free.
 */
export interface SharedSchema {
  v: 1;
  name: string;
  prompt: string;
  erd: ERD;
  positions: Record<string, { x: number; y: number }>;
}

const PREFIX = "#share=";

export function buildShareUrl(payload: Omit<SharedSchema, "v">): string {
  const encoded = compressToEncodedURIComponent(JSON.stringify({ v: 1, ...payload }));
  return `${window.location.origin}${window.location.pathname}${PREFIX}${encoded}`;
}

export function readShareFromLocation(): SharedSchema | null {
  if (typeof window === "undefined" || !window.location.hash.startsWith(PREFIX)) return null;
  try {
    const json = decompressFromEncodedURIComponent(window.location.hash.slice(PREFIX.length));
    const parsed = json ? (JSON.parse(json) as SharedSchema) : null;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.erd?.tables)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearShareFromLocation(): void {
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}
