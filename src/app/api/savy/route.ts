import { clientKey, MAX_BODY_BYTES, rateLimit } from "@/agent/limits";
import { parseActions, parseTurns, type AgentEvent } from "@/agent/protocol";
import { describeMode, runSavy } from "@/agent/run";
import { contextFor } from "@/agent/tools";
import { formatClock } from "@/domain/clock";
import { fold } from "@/twin/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A model run is capped at a few tool rounds; this is the ceiling on the whole stream. */
export const maxDuration = 60;

/** Which planner will answer. The panel shows this before the first question. */
export function GET() {
  return Response.json(describeMode());
}

/**
 * Runs Savy for one question and streams what it does as server-sent events.
 * The body carries the conversation and the action log; the night is rebuilt
 * here by replaying that log through the twin's reducer.
 */
export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request));
  if (!limit.ok) {
    return Response.json(
      { error: "Savy has answered a lot of questions from here recently. Try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return Response.json({ error: "The request is too large." }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "The request body was not JSON." }, { status: 400 });
  }

  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const turns = parseTurns(record.messages);
  if (turns.length === 0 || turns[turns.length - 1]?.role !== "user") {
    return Response.json({ error: "The last message must be a question from the user." }, { status: 400 });
  }

  const actions = parseActions(record.actions);
  const state = fold(actions);
  const ctx = contextFor(state);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        send({ type: "state.replayed", actions: actions.length, clock: formatClock(state.processedThrough), phase: state.phase });
        for await (const event of runSavy(turns, ctx, request.signal)) send(event);
      } catch (err) {
        // The detail stays in the server log. The person gets one plain sentence.
        console.error("[savy] run failed", err);
        send({ type: "error", message: "Savy could not finish that answer." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
