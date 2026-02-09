export interface GeminiJsonParseResult {
  parsed: unknown | null;
  mode: string;
}

function tryParseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractFencedJson(raw: string): string | null {
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/i);
  return fenceMatch?.[1]?.trim() ?? null;
}

function extractBalancedJson(raw: string): string | null {
  const objectStart = raw.indexOf("{");
  const arrayStart = raw.indexOf("[");

  let start = -1;
  if (objectStart === -1) {
    start = arrayStart;
  } else if (arrayStart === -1) {
    start = objectStart;
  } else {
    start = Math.min(objectStart, arrayStart);
  }

  if (start === -1) return null;

  const rootOpen = raw[start];
  const rootClose = rootOpen === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === rootOpen) {
      depth += 1;
      continue;
    }

    if (char === rootClose) {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1).trim();
      }
    }
  }

  return null;
}

function escapeControlCharactersInStrings(raw: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (!inString) {
      if (char === "\"") {
        inString = true;
      }
      result += char;
      continue;
    }

    if (escaped) {
      escaped = false;
      result += char;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      result += char;
      continue;
    }

    if (char === "\"") {
      inString = false;
      result += char;
      continue;
    }

    if (char === "\n") {
      result += "\\n";
      continue;
    }

    if (char === "\r") {
      result += "\\r";
      continue;
    }

    if (char === "\t") {
      result += "\\t";
      continue;
    }

    result += char;
  }

  return result;
}

function repairCandidate(raw: string): string {
  let repaired = raw.trim().replace(/^\uFEFF/, "");
  repaired = repaired.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'");
  repaired = escapeControlCharactersInStrings(repaired);
  repaired = repaired.replace(/,\s*([}\]])/g, "$1");
  return repaired;
}

function pushCandidate(
  candidates: Array<{ mode: string; raw: string }>,
  seen: Set<string>,
  mode: string,
  raw: string | null
): void {
  if (!raw) return;
  const trimmed = raw.trim();
  if (!trimmed || seen.has(trimmed)) return;
  seen.add(trimmed);
  candidates.push({ mode, raw: trimmed });
}

export function parseGeminiJsonLenient(raw: string): GeminiJsonParseResult {
  const seen = new Set<string>();
  const candidates: Array<{ mode: string; raw: string }> = [];

  const trimmed = raw.trim();
  pushCandidate(candidates, seen, "direct", trimmed);
  pushCandidate(candidates, seen, "fenced", extractFencedJson(trimmed));
  pushCandidate(candidates, seen, "balanced", extractBalancedJson(trimmed));

  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate.raw);
    if (parsed !== null) {
      return { parsed, mode: candidate.mode };
    }
  }

  for (const candidate of candidates) {
    const repaired = repairCandidate(candidate.raw);
    const parsed = tryParseJson(repaired);
    if (parsed !== null) {
      return { parsed, mode: `repaired_${candidate.mode}` };
    }
  }

  return { parsed: null, mode: "failed" };
}
