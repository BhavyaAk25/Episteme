import { useErdStore } from "@/store/useErdStore";
import { describeErdForAi } from "@/lib/erd/applyOps";
import type { ExplainAnswer } from "@/lib/gemini/schemas";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function callAssist<T>(payload: Record<string, unknown>): Promise<Result<T>> {
  const erd = useErdStore.getState().erd;
  if (!erd || erd.tables.length === 0) return { ok: false, error: "Add some tables first." };
  try {
    const response = await fetch("/api/assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, schemaText: describeErdForAi(erd) }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
    if (!response.ok) return { ok: false, error: body.error ?? "The AI couldn't answer. Try again." };
    return { ok: true, data: body };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection." };
  }
}

/** Turn a plain-English question into SQL for the current schema. */
export const askForSql = (question: string) => callAssist<{ sql: string; explanation: string }>({ task: "sql", question });

/** AI explanation of the current schema. */
export const askForExplanation = () => callAssist<ExplainAnswer>({ task: "explain" });
