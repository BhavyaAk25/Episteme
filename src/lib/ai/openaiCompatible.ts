import { GeminiApiError as AiProviderError } from "@/lib/gemini/client";

/**
 * Minimal client for OpenAI-compatible chat APIs. Covers the free options:
 * Groq (free tier), OpenRouter (":free" models) and a local Ollama server.
 */
export interface OpenAICompatibleConfig {
  name: string;
  baseUrl: string;
  apiKey: string | null;
  model: string;
}

interface ChatArgs {
  system?: string;
  user: string;
  maxOutputTokens: number;
  temperature: number;
}

function toError(status: number, body: string): AiProviderError {
  const quota = status === 429 || /rate.?limit|quota/i.test(body);
  const providerCode =
    status === 401 || status === 403 ? "INVALID_API_KEY" : status === 404 ? "MODEL_NOT_FOUND" : status === 429 ? "HTTP_429" : status >= 500 ? "UNAVAILABLE" : `HTTP_${status}`;
  const message = `AI provider error ${status}: ${body.slice(0, 300)}`;
  return new AiProviderError(message, {
    isQuotaOrRateLimited: quota,
    isCooldown: false,
    isTruncated: false,
    providerCode,
    retryAfterMs: null,
    message,
  });
}

function request(config: OpenAICompatibleConfig, args: ChatArgs, stream: boolean): Promise<Response> {
  const messages = [
    ...(args.system ? [{ role: "system", content: args.system }] : []),
    { role: "user", content: args.user },
  ];
  return fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: args.maxOutputTokens,
      temperature: args.temperature,
      response_format: { type: "json_object" },
      stream,
    }),
  });
}

export async function chatJson(config: OpenAICompatibleConfig, args: ChatArgs): Promise<string> {
  const response = await request(config, args, false);
  const body = await response.text();
  if (!response.ok) throw toError(response.status, body);
  const parsed = JSON.parse(body) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
  const choice = parsed.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new AiProviderError("AI response was truncated.", {
      isQuotaOrRateLimited: false,
      isCooldown: false,
      isTruncated: true,
      providerCode: "MAX_TOKENS",
      retryAfterMs: null,
      message: "MAX_TOKENS",
    });
  }
  const content = choice?.message?.content;
  if (!content) throw toError(502, "Empty response");
  return content;
}

export async function* chatJsonStream(config: OpenAICompatibleConfig, args: ChatArgs): AsyncGenerator<string> {
  const response = await request(config, args, true);
  if (!response.ok || !response.body) throw toError(response.status, await response.text());

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const data = line.replace(/^data:\s*/, "").trim();
      if (!data || data === "[DONE]") continue;
      try {
        const event = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string }; finish_reason?: string }> };
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) yield delta;
        if (event.choices?.[0]?.finish_reason === "length") {
          throw new AiProviderError("AI response was truncated.", {
            isQuotaOrRateLimited: false,
            isCooldown: false,
            isTruncated: true,
            providerCode: "MAX_TOKENS",
            retryAfterMs: null,
            message: "MAX_TOKENS",
          });
        }
      } catch (error) {
        if (error instanceof AiProviderError) throw error;
        // Ignore keep-alive or partial lines.
      }
    }
  }
}
