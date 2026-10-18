import {
  callGemini,
  getGeminiConfigStatus,
  getGeminiErrorInfo,
  isTransientError,
  streamGemini,
  MODEL_NAME as GEMINI_MODEL,
} from "@/lib/gemini/client";
import { chatJson, chatJsonStream, type OpenAICompatibleConfig } from "./openaiCompatible";

/**
 * One interface over the AI backends Episteme can use. All supported
 * options are free: Gemini's free tier (default), Groq's free tier,
 * OpenRouter ":free" models, or a local Ollama server.
 *
 *   AI_PROVIDER = gemini | groq | openrouter | ollama   (default: gemini)
 *   AI_API_KEY  = key for groq/openrouter (Gemini uses GEMINI_API_KEY)
 *   AI_MODEL    = model id (each provider has a default)
 *   AI_BASE_URL = override the API base URL (optional)
 *
 * Optional backup, used when the main provider is out of quota or down:
 *   AI_FALLBACK_PROVIDER = groq | openrouter | ollama | gemini
 *   AI_FALLBACK_API_KEY, AI_FALLBACK_MODEL, AI_FALLBACK_BASE_URL
 */
export interface AiRequest {
  system?: string;
  user: string;
  operation: "generate" | "autofix" | "edit";
  maxOutputTokens?: number;
  temperature?: number;
  useCache?: boolean;
  maxRetries?: number;
  retryDelay?: number;
  responseSchema?: unknown;
}

export interface AiConfigStatus {
  ready: boolean;
  reasonCode: string | null;
  message: string;
}

export interface AiProvider {
  id: string;
  model: string;
  config(): AiConfigStatus;
  generateJson(request: AiRequest): Promise<string>;
  streamJson(request: AiRequest): AsyncGenerator<string>;
}

const DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.3-70b-instruct:free" },
  ollama: { baseUrl: "http://localhost:11434/v1", model: "llama3.1" },
};

function tokenBudget(request: AiRequest): number {
  const fromEnv = Number.parseInt(process.env.GEMINI_GENERATE_MAX_OUTPUT_TOKENS ?? "", 10);
  if (request.maxOutputTokens) return request.maxOutputTokens;
  if (request.operation === "generate" && Number.isFinite(fromEnv)) return fromEnv;
  return request.operation === "generate" ? 16384 : 8192;
}

const geminiProvider: AiProvider = {
  id: "gemini",
  model: GEMINI_MODEL,
  config: () => getGeminiConfigStatus(),
  generateJson: (request) =>
    callGemini(request.user, {
      operation: request.operation === "autofix" ? "autofix" : "generate",
      systemInstruction: request.system,
      maxOutputTokens: request.maxOutputTokens,
      temperature: request.temperature,
      useCache: request.useCache,
      maxRetries: request.maxRetries,
      retryDelay: request.retryDelay,
      responseSchema: request.responseSchema,
    }),
  streamJson: (request) =>
    streamGemini(request.user, {
      systemInstruction: request.system,
      maxOutputTokens: tokenBudget(request),
      temperature: request.temperature,
    }),
};

function openAiCompatibleProvider(id: string, envPrefix = "AI"): AiProvider {
  const defaults = DEFAULTS[id];
  const env = (name: string) => process.env[`${envPrefix}_${name}`]?.trim();
  const config: OpenAICompatibleConfig = {
    name: id,
    baseUrl: env("BASE_URL") || defaults.baseUrl,
    apiKey: env("API_KEY") || null,
    model: env("MODEL") || defaults.model,
  };
  const args = (request: AiRequest) => ({
    system: request.system,
    user: request.user,
    maxOutputTokens: tokenBudget(request),
    temperature: request.temperature ?? (request.operation === "generate" ? 0.7 : 0.2),
  });

  return {
    id,
    model: config.model,
    config: () =>
      !config.apiKey && id !== "ollama"
        ? { ready: false, reasonCode: "MISSING_API_KEY", message: `AI_API_KEY is not configured for ${id}` }
        : { ready: true, reasonCode: null, message: `${id} configuration is valid` },
    generateJson: (request) => chatJson(config, args(request)),
    streamJson: (request) => chatJsonStream(config, args(request)),
  };
}

/** Errors where trying another provider makes sense (not bad requests). */
function shouldFallBack(error: unknown): boolean {
  const info = getGeminiErrorInfo(error);
  const code = info.providerCode ?? "";
  return (
    info.isQuotaOrRateLimited ||
    info.isCooldown ||
    info.isTruncated ||
    ["UNAVAILABLE", "INTERNAL", "MAX_TOKENS", "INVALID_API_KEY", "UNAUTHENTICATED", "MISSING_API_KEY", "MODEL_NOT_FOUND"].includes(code) ||
    isTransientError(info.message)
  );
}

/** Try `primary`; on quota/outage errors, retry the same request on `backup`. */
function withFallback(primary: AiProvider, backup: AiProvider): AiProvider {
  return {
    id: `${primary.id}+${backup.id}`,
    model: primary.model,
    config: () => {
      const main = primary.config();
      return main.ready ? main : backup.config();
    },
    generateJson: async (request) => {
      if (!primary.config().ready) return backup.generateJson(request);
      try {
        return await primary.generateJson(request);
      } catch (error) {
        if (!shouldFallBack(error)) throw error;
        console.warn(`[ai] ${primary.id} failed (${getGeminiErrorInfo(error).providerCode}); using ${backup.id}.`);
        return backup.generateJson(request);
      }
    },
    streamJson: async function* (request) {
      if (!primary.config().ready) {
        yield* backup.streamJson(request);
        return;
      }
      let started = false;
      try {
        for await (const chunk of primary.streamJson(request)) {
          started = true;
          yield chunk;
        }
      } catch (error) {
        // Only switch if nothing was streamed yet; a half answer can't be resumed.
        if (started || !shouldFallBack(error)) throw error;
        console.warn(`[ai] ${primary.id} failed (${getGeminiErrorInfo(error).providerCode}); using ${backup.id}.`);
        yield* backup.streamJson(request);
      }
    },
  };
}

function providerFor(id: string, envPrefix: string): AiProvider {
  return id in DEFAULTS ? openAiCompatibleProvider(id, envPrefix) : geminiProvider;
}

let cached: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (cached) return cached;
  const primaryId = (process.env.AI_PROVIDER ?? "gemini").trim().toLowerCase();
  const primary = providerFor(primaryId, "AI");
  const backupId = process.env.AI_FALLBACK_PROVIDER?.trim().toLowerCase();
  const backup = backupId && backupId !== primaryId ? providerFor(backupId, "AI_FALLBACK") : null;
  cached = backup && backup.config().ready ? withFallback(primary, backup) : primary;
  return cached;
}
