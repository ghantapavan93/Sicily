import Anthropic from "@anthropic-ai/sdk";
import { checkGrounding } from "./grounding";
import type { AgentEvent, AgentMode, ChatTurn } from "./protocol";
import { answerByRules } from "./rules";
import { SAVY_MODEL, SAVY_SYSTEM } from "./system";
import { runTool, TOOLS, type AgentContext } from "./tools";

/**
 * One Savy run: a question in, a stream of observable events out.
 *
 * With a credential, Claude drives the loop: it decides which tools to call
 * and words the answer. Without one, a rule-based planner drives the same
 * tools. Either way the tool layer, the proposal gate and the grounding
 * check are identical, and the trace shows what was called, never how the
 * model reasoned.
 */

const MAX_ITERATIONS = 8;
const TOOL_PACE_MS = 420;
const TEXT_PACE_MS = 26;
const MAX_UNPARSEABLE_RETRIES = 2;

export function modelAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function describeMode(): { mode: AgentMode; model: string | null } {
  return modelAvailable() ? { mode: "model", model: SAVY_MODEL } : { mode: "rules", model: null };
}

const MODEL_TOOLS: Anthropic.Beta.BetaTool[] = TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.input_schema,
  // Inputs stream as generated; runTool validates each one before it runs.
  eager_input_streaming: true,
}));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Turns an API failure into one sentence a person can act on. Most specific class first. */
function explain(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The model key was rejected.";
  if (err instanceof Anthropic.PermissionDeniedError) return "The model key is not allowed to use this model.";
  if (err instanceof Anthropic.RateLimitError) return "The model is rate limited right now.";
  if (err instanceof Anthropic.APIConnectionError) return "The model could not be reached.";
  if (err instanceof Anthropic.APIError) return `The model returned an error (${err.status ?? "no status"}).`;
  return "The model run failed.";
}

interface ModelOutcome {
  text: string;
  toolResults: string[];
  stopReason: string;
  usage: { input: number; output: number };
}

async function* answerByModel(
  turns: ChatTurn[],
  ctx: AgentContext,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent, ModelOutcome> {
  const client = new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = turns.map((t) => ({ role: t.role, content: t.content }));
  const toolResults: string[] = [];
  const usage = { input: 0, output: 0 };
  let text = "";
  let stopReason = "end_turn";
  let unparseable = 0;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const stream = client.beta.messages.stream(
      {
        model: SAVY_MODEL,
        // Answers are under 120 words; tool calls are small. This bounds what one turn can cost.
        max_tokens: 4096,
        system: SAVY_SYSTEM,
        tools: MODEL_TOOLS,
        messages,
        output_config: { effort: "low" },
        // A policy decline is re-run on Anthropic's recommended fallback model inside the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { signal },
    );

    let iterationText = "";
    let message: Anthropic.Beta.BetaMessage;
    try {
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          // A second block of prose starts on its own line.
          const delta = iterationText === "" && text !== "" ? `\n${event.delta.text}` : event.delta.text;
          iterationText += event.delta.text;
          yield { type: "text.delta", text: delta };
        }
      }
      message = await stream.finalMessage();
      unparseable = 0;
    } catch (err) {
      // With eager input streaming a tool input can fail to parse. Only that case is retried.
      if (err instanceof Anthropic.APIError || signal.aborted || unparseable++ >= MAX_UNPARSEABLE_RETRIES) throw err;
      continue;
    }

    if (iterationText) text += (text ? "\n" : "") + iterationText;
    usage.input += message.usage.input_tokens;
    usage.output += message.usage.output_tokens;
    stopReason = message.stop_reason ?? "end_turn";

    // A refusal can cut a tool call off mid-input. Never run that turn's tools.
    if (stopReason === "refusal") {
      const note = "I can't help with that request.";
      text += (text ? "\n" : "") + note;
      yield { type: "text.delta", text: note };
      break;
    }

    const calls = message.content.filter(
      (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use",
    );
    if (calls.length === 0) break;
    if (stopReason === "max_tokens") throw new Error("A tool call was cut off before it finished.");

    messages.push({ role: "assistant", content: message.content });

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      const started = Date.now();
      const input = typeof call.input === "object" && call.input !== null ? (call.input as Record<string, unknown>) : {};
      yield { type: "tool.called", id: call.id, name: call.name, input };

      const proposalsBefore = ctx.proposals.length;
      const run = runTool(ctx, call.name, call.input);
      toolResults.push(run.json);
      for (const proposal of ctx.proposals.slice(proposalsBefore)) yield { type: "proposal", proposal };

      yield { type: "tool.returned", id: call.id, summary: run.summary, ms: Date.now() - started, isError: run.isError };
      results.push({ type: "tool_result", tool_use_id: call.id, content: run.json, is_error: run.isError });
    }
    // All results go back in one message, so parallel calls stay parallel.
    messages.push({ role: "user", content: results });
  }

  return { text, toolResults, stopReason, usage };
}

export async function* runSavy(turns: ChatTurn[], ctx: AgentContext, signal: AbortSignal): AsyncGenerator<AgentEvent> {
  const started = Date.now();
  const question = [...turns].reverse().find((t) => t.role === "user")?.content ?? "";
  if (!question) {
    yield { type: "error", message: "There was no question to answer." };
    return;
  }

  let text = "";
  let toolResults: string[] = [];
  let stopReason = "end_turn";
  let usage: { input: number; output: number } | null = null;
  let fellBack: string | null = null;

  if (modelAvailable()) {
    yield { type: "run.started", mode: "model", model: SAVY_MODEL, note: null };
    let streamed = false;
    try {
      const run = answerByModel(turns, ctx, signal);
      let step = await run.next();
      while (!step.done) {
        if (step.value.type === "text.delta") streamed = true;
        yield step.value;
        step = await run.next();
      }
      ({ text, toolResults, stopReason, usage } = step.value);
    } catch (err) {
      if (signal.aborted) return;
      // Once words are on screen the run cannot be silently replaced. Say what happened and stop.
      if (streamed) {
        yield { type: "error", message: explain(err) };
        return;
      }
      fellBack = explain(err);
    }
  }

  if (!modelAvailable() || fellBack !== null) {
    yield {
      type: "run.started",
      mode: "rules",
      model: null,
      note: fellBack ? `${fellBack} Answered by the rule-based planner instead.` : null,
    };
    ctx.proposals.length = 0;
    const emitted = { proposals: 0 };
    // Paced like a real run so each step can be read as it happens.
    const run = answerByRules(question, ctx, (kind) => sleep(kind === "tool" ? TOOL_PACE_MS : TEXT_PACE_MS));
    let step = await run.next();
    while (!step.done) {
      yield step.value;
      // The rules planner raises proposals through the same tool; forward each one once.
      for (const proposal of ctx.proposals.slice(emitted.proposals)) yield { type: "proposal", proposal };
      emitted.proposals = ctx.proposals.length;
      step = await run.next();
    }
    ({ text, toolResults } = step.value);
    stopReason = "end_turn";
    usage = null;
  }

  yield { type: "grounding", report: checkGrounding(text, toolResults, question) };
  yield { type: "run.finished", stopReason, ms: Date.now() - started, usage };
}
