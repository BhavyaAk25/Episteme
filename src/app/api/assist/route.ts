import { NextResponse } from "next/server";
import { z } from "zod";
import { getAiProvider } from "@/lib/ai/provider";
import { getGeminiErrorInfo, extractJSON } from "@/lib/gemini/client";
import { EXPLAIN_SYSTEM_PROMPT, SQL_SYSTEM_PROMPT, explainUserContent, sqlUserContent } from "@/lib/gemini/prompts";
import { ExplainAnswerSchema, SqlAnswerSchema } from "@/lib/gemini/schemas";
import { checkRateLimit, clientKey } from "@/lib/server/rateLimit";

export const maxDuration = 60;

const RATE_LIMIT = 15;
const RATE_WINDOW_MS = 60_000;
const MAX_QUESTION_LENGTH = 500;
const MAX_SCHEMA_TEXT_LENGTH = 60_000;

const RequestSchema = z.discriminatedUnion("task", [
  z.object({
    task: z.literal("sql"),
    question: z.string().trim().min(1).max(MAX_QUESTION_LENGTH),
    schemaText: z.string().min(1).max(MAX_SCHEMA_TEXT_LENGTH),
  }),
  z.object({
    task: z.literal("explain"),
    schemaText: z.string().min(1).max(MAX_SCHEMA_TEXT_LENGTH),
  }),
]);

/**
 * POST { task: "sql", question, schemaText } → { sql, explanation }
 * POST { task: "explain", schemaText }       → { overview, tables, flows, notes }
 *
 * The answers are only ever shown to the user (and SQL runs only when they
 * click Run, in the in-browser sample database), never executed server-side.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: `Ask a question in 1–${MAX_QUESTION_LENGTH} characters.` }, { status: 400 });
  }

  const limit = checkRateLimit(clientKey(request, "assist"), RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many AI requests. Please wait a moment.", retryAfterSec: limit.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  const provider = getAiProvider();
  if (!provider.config().ready) {
    return NextResponse.json({ error: "The AI model isn't configured on this deployment." }, { status: 503 });
  }

  const input = parsed.data;
  let raw: string;
  try {
    raw = await provider.generateJson({
      system: input.task === "sql" ? SQL_SYSTEM_PROMPT : EXPLAIN_SYSTEM_PROMPT,
      user: input.task === "sql" ? sqlUserContent(input.schemaText, input.question) : explainUserContent(input.schemaText),
      operation: "assist",
      maxOutputTokens: input.task === "sql" ? 2048 : 4096,
      temperature: 0.2,
      useCache: false,
    });
  } catch (error) {
    const info = getGeminiErrorInfo(error);
    console.error("[assist] Provider error:", info.providerCode, info.message.slice(0, 300));
    const message = info.isQuotaOrRateLimited
      ? "The AI model's free-tier quota is used up right now. Try again shortly."
      : "The AI model couldn't be reached. Try again in a few seconds.";
    return NextResponse.json({ error: message }, { status: 503 });
  }

  let json: unknown;
  try {
    json = JSON.parse(extractJSON(raw));
  } catch {
    console.error("[assist] Malformed JSON:", raw.slice(0, 300));
    return NextResponse.json({ error: "The AI returned an unreadable answer. Try again." }, { status: 502 });
  }

  const answer = input.task === "sql" ? SqlAnswerSchema.safeParse(json) : ExplainAnswerSchema.safeParse(json);
  if (!answer.success) {
    return NextResponse.json({ error: "The AI answered in an unexpected format. Try again." }, { status: 502 });
  }
  return NextResponse.json(answer.data);
}
