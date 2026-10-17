import { NextResponse } from "next/server";
import { getGeminiErrorInfo } from "@/lib/gemini/client";
import { GENERATION_SYSTEM_PROMPT, generationUserContent } from "@/lib/gemini/prompts";
import { getAiProvider } from "@/lib/ai/provider";
import { checkRateLimit, clientKey } from "@/lib/server/rateLimit";
import { MAX_PROMPT_LENGTH } from "@/lib/limits";
import {
  detectProgress,
  finalizeModelOutput,
  outcomeWithoutAi,
  type FailureArgs,
  type TemplateId,
} from "@/lib/generation/server";

// Generation usually takes 20–40s; leave headroom.
export const maxDuration = 120;

const GENERATE_RATE_LIMIT = 10; // requests per window per client
const GENERATE_RATE_WINDOW_MS = 60_000;

function failureFromError(error: unknown, prompt: string, templateId?: TemplateId): FailureArgs {
  const info = getGeminiErrorInfo(error);
  const quota = info.isQuotaOrRateLimited || info.isCooldown;
  console.error("[generate] Provider error:", info.providerCode, info.message.slice(0, 300));
  return {
    prompt,
    templateId,
    reason: quota ? "quota" : "provider_error",
    providerErrorCode: info.providerCode,
    retryAfterSec: info.retryAfterMs ? Math.ceil(info.retryAfterMs / 1000) : null,
    quotaState: info.isCooldown ? "cooldown" : info.isQuotaOrRateLimited ? "quota_exhausted" : "ok",
  };
}

/**
 * POST { prompt, templateId?, stream? }
 *
 * With `stream: true` the response is NDJSON: `progress` events while the
 * model writes (phase + tables seen so far), then one `result` or `error`.
 * Without it, a single JSON response (handy for scripts and curl).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const input = (typeof body === "object" && body !== null ? body : {}) as {
    prompt?: unknown;
    templateId?: unknown;
    stream?: unknown;
  };
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  const templateId =
    input.templateId === "inventory" || input.templateId === "ecommerce" || input.templateId === "saas"
      ? (input.templateId as TemplateId)
      : undefined;
  const wantsStream = input.stream === true;

  if (!prompt) {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { error: `Description is too long (${prompt.length} characters). Keep it under ${MAX_PROMPT_LENGTH}.` },
      { status: 400 }
    );
  }

  const limit = checkRateLimit(clientKey(request, "generate"), GENERATE_RATE_LIMIT, GENERATE_RATE_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "Too many generation requests. Please wait a moment and try again.",
        errorCode: "RATE_LIMITED",
        retryAfterSec: limit.retryAfterSec,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  const provider = getAiProvider();
  const config = provider.config();
  if (!config.ready) {
    const outcome = outcomeWithoutAi({
      prompt,
      templateId,
      reason: "config_error",
      providerErrorCode: config.reasonCode,
      retryAfterSec: null,
    });
    return NextResponse.json(outcome.body, { status: outcome.status });
  }

  const aiRequest = {
    system: GENERATION_SYSTEM_PROMPT,
    user: generationUserContent(prompt),
    operation: "generate" as const,
  };

  if (!wantsStream) {
    let raw: string;
    try {
      raw = await provider.generateJson(aiRequest);
    } catch (error) {
      const outcome = outcomeWithoutAi(failureFromError(error, prompt, templateId));
      return NextResponse.json(outcome.body, { status: outcome.status });
    }
    const result = finalizeModelOutput(raw, provider.id);
    if (result.ok) return NextResponse.json(result.body);
    const outcome = outcomeWithoutAi({
      prompt,
      templateId,
      reason: result.reason,
      providerErrorCode: result.code,
      retryAfterSec: null,
    });
    return NextResponse.json(outcome.body, { status: outcome.status });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const finish = (status: number, payload: Record<string, unknown>) =>
        send(status === 200 ? { type: "result", payload } : { type: "error", status, payload });

      send({ type: "progress", phase: "plan", tables: [] });

      let text = "";
      let lastSignature = "";
      try {
        for await (const chunk of provider.streamJson(aiRequest)) {
          text += chunk;
          const progress = detectProgress(text);
          const signature = `${progress.phase}|${progress.tables.join(",")}`;
          if (signature !== lastSignature) {
            lastSignature = signature;
            send({ type: "progress", ...progress });
          }
        }
        const result = finalizeModelOutput(text, provider.id);
        if (result.ok) {
          finish(200, result.body);
        } else {
          const outcome = outcomeWithoutAi({
            prompt,
            templateId,
            reason: result.reason,
            providerErrorCode: result.code,
            retryAfterSec: null,
          });
          finish(outcome.status, outcome.body);
        }
      } catch (error) {
        const outcome = outcomeWithoutAi(failureFromError(error, prompt, templateId));
        finish(outcome.status, outcome.body);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
