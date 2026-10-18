import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, clientKey } from "@/lib/server/rateLimit";

/**
 * Minimal, free error tracking: browser errors are posted here and written
 * to the server log (visible in Vercel's runtime logs). No third-party
 * service, no cookies, no personal data beyond what's in the message.
 */
const ReportSchema = z.object({
  kind: z.enum(["error", "unhandledrejection", "react"]),
  message: z.string().max(500),
  stack: z.string().max(4000).optional(),
  url: z.string().max(300).optional(),
});

export async function POST(request: Request) {
  const limit = checkRateLimit(clientKey(request, "client-error"), 20, 60_000);
  if (!limit.allowed) return new NextResponse(null, { status: 204 });

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  const parsed = ReportSchema.safeParse(body);
  if (parsed.success) {
    const { kind, message, stack, url } = parsed.data;
    console.error(`[client-error] ${kind}: ${message}`, url ? `@ ${url.replace(/#.*$/, "")}` : "", stack ? `\n${stack.split("\n").slice(0, 6).join("\n")}` : "");
  }
  return new NextResponse(null, { status: 204 });
}
