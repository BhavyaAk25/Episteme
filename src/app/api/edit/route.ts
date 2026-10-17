import { NextResponse } from "next/server";
import { z } from "zod";
import { getAiProvider } from "@/lib/ai/provider";
import { getGeminiErrorInfo, extractJSON } from "@/lib/gemini/client";
import { EDIT_SYSTEM_PROMPT, editUserContent } from "@/lib/gemini/prompts";
import { EditResponseSchema } from "@/lib/gemini/schemas";
import { checkRateLimit, clientKey } from "@/lib/server/rateLimit";

export const maxDuration = 60;

const EDIT_RATE_LIMIT = 15;
const EDIT_RATE_WINDOW_MS = 60_000;
const MAX_INSTRUCTION_LENGTH = 1000;
const MAX_SCHEMA_TEXT_LENGTH = 60_000;

const RequestSchema = z.object({
  instruction: z.string().trim().min(1).max(MAX_INSTRUCTION_LENGTH),
  // The client sends a compact text description of the current schema.
  schemaText: z.string().max(MAX_SCHEMA_TEXT_LENGTH),
});

/** POST { instruction, schemaText } → { summary, operations } */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Describe the change in 1–${MAX_INSTRUCTION_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const limit = checkRateLimit(clientKey(request, "edit"), EDIT_RATE_LIMIT, EDIT_RATE_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many AI edit requests. Please wait a moment.", retryAfterSec: limit.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  const provider = getAiProvider();
  if (!provider.config().ready) {
    return NextResponse.json(
      { error: "The AI model isn't configured on this deployment, so AI edits are unavailable. You can still edit by hand." },
      { status: 503 }
    );
  }

  let raw: string;
  try {
    raw = await provider.generateJson({
      system: EDIT_SYSTEM_PROMPT,
      user: editUserContent(parsed.data.schemaText, parsed.data.instruction),
      operation: "edit",
      maxOutputTokens: 8192,
      temperature: 0.3,
      useCache: false,
    });
  } catch (error) {
    const info = getGeminiErrorInfo(error);
    console.error("[edit] Provider error:", info.providerCode, info.message.slice(0, 300));
    const message = info.isQuotaOrRateLimited
      ? "The AI model's free-tier quota is used up right now. Try again shortly."
      : info.providerCode === "MAX_TOKENS"
        ? "That change was too large for one step. Try asking for a smaller change."
        : "The AI model couldn't be reached. Try again in a few seconds.";
    return NextResponse.json({ error: message }, { status: 503 });
  }

  let json: unknown;
  try {
    json = JSON.parse(extractJSON(raw));
  } catch {
    console.error("[edit] Malformed JSON:", raw.slice(0, 300));
    return NextResponse.json({ error: "The AI returned an unreadable answer. Try again." }, { status: 502 });
  }

  const result = EditResponseSchema.safeParse(json);
  if (!result.success) {
    return NextResponse.json({ error: "The AI returned changes in an unexpected format. Try again." }, { status: 502 });
  }

  return NextResponse.json({ summary: result.data.summary, operations: result.data.operations });
}
