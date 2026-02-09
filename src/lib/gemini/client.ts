import { GoogleGenAI } from "@google/genai";

// Initialize the Gemini client
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn("GEMINI_API_KEY is not set. Gemini features will not work.");
}

export const genai = apiKey ? new GoogleGenAI({ apiKey }) : null;

// Model selection
export const MODEL_NAME = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview";

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const DEFAULT_GENERATE_MAX_RETRIES = envInt("GEMINI_MAX_RETRIES_GENERATE", 1, 0, 5);
const DEFAULT_AUTOFIX_MAX_RETRIES = envInt("GEMINI_MAX_RETRIES_AUTOFIX", 1, 0, 3);
const DEFAULT_GENERATE_MAX_OUTPUT_TOKENS = envInt("GEMINI_GENERATE_MAX_OUTPUT_TOKENS", 8192, 512, 16384);
const DEFAULT_AUTOFIX_MAX_OUTPUT_TOKENS = envInt("GEMINI_AUTOFIX_MAX_OUTPUT_TOKENS", 4096, 256, 8192);
const DEFAULT_RETRY_DELAY_MS = envInt("GEMINI_RETRY_DELAY_MS", 1200, 200, 15000);
const DEFAULT_COOLDOWN_MS = envInt("GEMINI_QUOTA_COOLDOWN_MS", 15000, 5000, 300000);

let quotaCooldownUntilMs = 0;

const responseCache = new Map<string, string>();

export interface GeminiErrorInfo {
  isQuotaOrRateLimited: boolean;
  isCooldown: boolean;
  isTruncated: boolean;
  providerCode: string | null;
  retryAfterMs: number | null;
  message: string;
}

export class GeminiApiError extends Error {
  info: GeminiErrorInfo;

  constructor(message: string, info: GeminiErrorInfo) {
    super(message);
    this.name = "GeminiApiError";
    this.info = info;
  }
}

function isQuotaOrRateLimitError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("resource_exhausted") ||
    lower.includes("quota") ||
    lower.includes("429") ||
    lower.includes("rate limit")
  );
}

function parseRetryAfterMs(message: string): number | null {
  const secondMatch = message.match(/(\d+)\s*s(?:ec(?:ond)?s?)?/i);
  if (secondMatch?.[1]) {
    return Math.max(1000, Number.parseInt(secondMatch[1], 10) * 1000);
  }

  const milliMatch = message.match(/(\d+)\s*ms/i);
  if (milliMatch?.[1]) {
    return Math.max(500, Number.parseInt(milliMatch[1], 10));
  }

  return null;
}

function parseProviderCode(message: string): string | null {
  const upper = message.toUpperCase();
  if (upper.includes("MAX_TOKENS")) return "MAX_TOKENS";
  if (upper.includes("RESOURCE_EXHAUSTED")) return "RESOURCE_EXHAUSTED";
  if (upper.includes("RATE_LIMIT_EXCEEDED")) return "RATE_LIMIT_EXCEEDED";
  if (upper.includes("TOO_MANY_REQUESTS")) return "TOO_MANY_REQUESTS";
  if (message.includes("429")) return "HTTP_429";
  return null;
}

export function getGeminiErrorInfo(error: unknown): GeminiErrorInfo {
  if (error instanceof GeminiApiError) {
    return error.info;
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    isQuotaOrRateLimited: isQuotaOrRateLimitError(message),
    isCooldown: false,
    isTruncated: false,
    providerCode: parseProviderCode(message),
    retryAfterMs: parseRetryAfterMs(message),
    message,
  };
}

function normalizeGeminiError(error: Error): Error {
  const message = error.message || "";
  const info: GeminiErrorInfo = {
    isQuotaOrRateLimited: isQuotaOrRateLimitError(message),
    isCooldown: false,
    isTruncated: false,
    providerCode: parseProviderCode(message),
    retryAfterMs: parseRetryAfterMs(message),
    message,
  };

  if (info.isQuotaOrRateLimited) {
    return new GeminiApiError(
      "Gemini quota/rate limit is currently exhausted. Falling back is recommended; retry after cooldown.",
      info
    );
  }

  return new GeminiApiError(message || "Gemini request failed", info);
}

function extractJSON(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

// Helper to call Gemini with retry logic
export async function callGemini(
  prompt: string,
  options: {
    operation?: "generate" | "autofix";
    maxRetries?: number;
    retryDelay?: number;
    maxOutputTokens?: number;
    responseMimeType?: string;
    responseSchema?: unknown;
    responseJsonSchema?: unknown;
    temperature?: number;
    useCache?: boolean;
  } = {}
): Promise<string> {
  if (!genai) {
    throw new Error("Gemini API key not configured");
  }

  const {
    operation = "generate",
    retryDelay = DEFAULT_RETRY_DELAY_MS,
    maxOutputTokens = operation === "autofix"
      ? DEFAULT_AUTOFIX_MAX_OUTPUT_TOKENS
      : DEFAULT_GENERATE_MAX_OUTPUT_TOKENS,
    responseMimeType = "application/json",
    responseSchema,
    responseJsonSchema,
    temperature = operation === "autofix" ? 0.2 : 1.0,
    useCache = operation === "generate",
  } = options;

  const maxRetries = options.maxRetries ?? (
    operation === "autofix" ? DEFAULT_AUTOFIX_MAX_RETRIES : DEFAULT_GENERATE_MAX_RETRIES
  );

  if (useCache) {
    const cached = responseCache.get(prompt);
    if (cached) {
      return cached;
    }
  }

  if (Date.now() < quotaCooldownUntilMs) {
    const remainingMs = quotaCooldownUntilMs - Date.now();
    throw new GeminiApiError(
      "Gemini quota cooldown is active. Skipping provider call for now.",
      {
        isQuotaOrRateLimited: true,
        isCooldown: true,
        isTruncated: false,
        providerCode: "LOCAL_COOLDOWN",
        retryAfterMs: remainingMs,
        message: "Gemini quota cooldown is active",
      }
    );
  }

  let lastError: Error | null = null;

  const totalAttempts = Math.max(1, maxRetries + 1);
  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    try {
      const config: {
        temperature: number;
        topK: number;
        topP: number;
        maxOutputTokens: number;
        responseMimeType: string;
        responseSchema?: unknown;
        responseJsonSchema?: unknown;
      } = {
        temperature,
        topK: 40,
        topP: 0.95,
        maxOutputTokens,
        responseMimeType,
      };

      if (responseSchema !== undefined) {
        config.responseSchema = responseSchema;
      }
      if (responseJsonSchema !== undefined) {
        config.responseJsonSchema = responseJsonSchema;
      }

      const response = await genai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config,
      });

      const text = response.text ? extractJSON(response.text) : null;
      if (!text) {
        throw new Error("Empty response from Gemini");
      }

      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason === "MAX_TOKENS") {
        const trimmed = text.trim();
        const looksIncomplete =
          !(trimmed.endsWith("}") || trimmed.endsWith("]"));
        if (looksIncomplete) {
          throw new GeminiApiError(
            "Gemini response was truncated before completing JSON.",
            {
              isQuotaOrRateLimited: false,
              isCooldown: false,
              isTruncated: true,
              providerCode: "MAX_TOKENS",
              retryAfterMs: null,
              message: response.candidates?.[0]?.finishMessage || "MAX_TOKENS",
            }
          );
        }
      }

      if (useCache) {
        responseCache.set(prompt, text);
      }
      return text;
    } catch (error) {
      if (error instanceof GeminiApiError) {
        throw error;
      }

      lastError = error instanceof Error ? error : new Error(String(error));

      if (isQuotaOrRateLimitError(lastError.message)) {
        const retryAfterMs = parseRetryAfterMs(lastError.message);
        const cooldownMs = retryAfterMs ?? DEFAULT_COOLDOWN_MS;
        quotaCooldownUntilMs = Date.now() + cooldownMs;

        if (attempt < totalAttempts - 1) {
          const backoff = retryDelay * (attempt + 1);
          console.warn(`Gemini rate-limited. Retry ${attempt + 1}/${totalAttempts - 1} in ${backoff}ms.`);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }
      }

      throw normalizeGeminiError(lastError);
    }
  }

  throw normalizeGeminiError(lastError || new Error("Failed to call Gemini after retries"));
}
