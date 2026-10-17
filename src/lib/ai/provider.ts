import {
  callGemini,
  getGeminiConfigStatus,
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

function openAiCompatibleProvider(id: string): AiProvider {
  const defaults = DEFAULTS[id];
  const config: OpenAICompatibleConfig = {
    name: id,
    baseUrl: process.env.AI_BASE_URL?.trim() || defaults.baseUrl,
    apiKey: process.env.AI_API_KEY?.trim() || null,
    model: process.env.AI_MODEL?.trim() || defaults.model,
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

let cached: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (cached) return cached;
  const id = (process.env.AI_PROVIDER ?? "gemini").trim().toLowerCase();
  cached = id in DEFAULTS ? openAiCompatibleProvider(id) : geminiProvider;
  return cached;
}
