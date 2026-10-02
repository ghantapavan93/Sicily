import type { TwinAction } from "@/twin/runtime";
import type { DecisionKey, ItemId } from "@/twin/types";

// The action log is validated and replayed by the twin runtime; the agent only relies on it.
export { lastNight, MAX_ACTIONS, nightTooLong, parseActions, validActions } from "@/twin/runtime";

/**
 * The wire contract between the Ask Savy panel and the agent route.
 *
 * The client never sends state. It sends the list of actions that produced
 * its state, and the server folds them through the same reducer. The agent
 * therefore reads exactly what the screen shows, and a request cannot hand
 * it a decision that the engine would not have produced.
 */

export type AgentMode = "model" | "rules";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AgentRequest {
  messages: ChatTurn[];
  actions: TwinAction[];
}

/** Things Savy may put in front of a person. Savy proposes; only a click on screen executes. */
export type ProposalAction =
  /** `version` is the decision's version when Savy proposed it, so a button can't approve a recommendation that has since changed. */
  | { kind: "approve"; decision: DecisionKey; version?: number }
  | { kind: "ask_manager"; item: ItemId; place: "line" | "backup" }
  | { kind: "recheck_pos" }
  | { kind: "submit_po" };

export interface Proposal {
  id: string;
  action: ProposalAction;
  label: string;
  reason: string;
}

export interface GroundingReport {
  /** Figures in the answer that were checked against tool results. */
  figures: number;
  /** Figures that appear in the answer and in no tool result. */
  ungrounded: string[];
  citations: string[];
  /** Cited ids that no tool returned. */
  unknownCitations: string[];
  /** Figures backed only by the person's own question: repeated back, not confirmed by any record. */
  fromQuestion: string[];
}

export type AgentEvent =
  /** The server rebuilt the night from the action log before anything else ran. */
  | { type: "state.replayed"; actions: number; clock: string; phase: string }
  | { type: "run.started"; mode: AgentMode; model: string | null; note: string | null }
  | { type: "tool.called"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool.returned"; id: string; summary: string; ms: number; isError: boolean }
  | { type: "text.delta"; text: string }
  | { type: "proposal"; proposal: Proposal }
  | { type: "grounding"; report: GroundingReport }
  | { type: "run.finished"; stopReason: string; ms: number; usage: { input: number; output: number } | null }
  | { type: "error"; message: string };

export const MAX_TURNS = 24;
export const MAX_QUESTION_CHARS = 1200;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseTurns(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: ChatTurn[] = [];
  for (const item of raw.slice(-MAX_TURNS)) {
    if (!isRecord(item)) continue;
    if ((item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string") continue;
    const content = item.content.trim().slice(0, item.role === "user" ? MAX_QUESTION_CHARS : 6000);
    if (content) turns.push({ role: item.role, content });
  }
  // The model API needs the conversation to open with the person. Trimming to the last turns can cut that.
  while (turns.length > 0 && turns[0]!.role === "assistant") turns.shift();
  return turns;
}

/** The one place a proposal becomes an action, and only when a person presses the button. */
export function actionFor(p: ProposalAction): TwinAction {
  switch (p.kind) {
    case "approve":
      return { type: "APPROVE", key: p.decision };
    case "ask_manager":
      return { type: "ASK_MANAGER", item: p.item, place: p.place };
    case "recheck_pos":
      return { type: "RECHECK_POS" };
    case "submit_po":
      return { type: "SUBMIT_PO" };
  }
}
