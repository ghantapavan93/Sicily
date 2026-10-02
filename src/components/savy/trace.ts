import type { ThoughtStatus } from "../ui/thought-chain";
import type { SavyStep, SavyTurn } from "./SavyContext";

/**
 * Two readings of one Savy run, both derived from the events the server
 * streamed: a chain of phases for the conversation, and a pipeline for the
 * system view. Neither invents a step. If a tool was not called it is not
 * shown as called.
 */

/* ------------------------------------------------------------------ */
/* Naming                                                              */
/* ------------------------------------------------------------------ */

const SOURCE_LABEL: Record<string, string> = {
  pos: "POS",
  reservations: "Reservations",
  schedule: "Schedule",
  staff: "Staff app",
  inventory: "Inventory",
  suppliers: "Supplier email",
  bank: "Bank and accounting",
  events: "Local events",
};

const TOOL_LABEL: Record<string, string> = {
  get_pulse: "Daily Pulse",
  list_decisions: "Tonight's decisions",
  get_decision: "Decision",
  what_changed: "What changed",
  simulate_night: "Run the night forward",
  what_if: "Fork the night",
  explain: "Explain",
  get_memory: "Decision memory",
  get_shadow_summary: "Last 30 services",
  search_history: "Past situations",
};

const PROPOSAL_LABEL: Record<string, string> = {
  approve: "Owner approval",
  ask_manager: "Ask the manager",
  recheck_pos: "Re-check POS",
  submit_po: "Submit the order",
};

export function stepLabel(step: SavyStep): string {
  if (step.name === "read_source") return SOURCE_LABEL[String(step.input.source)] ?? "Source";
  if (step.name === "get_surface") return `${String(step.input.surface ?? "Surface").replace(/^./, (c) => c.toUpperCase())}`;
  if (step.name === "get_decision" || step.name === "explain") return `${TOOL_LABEL[step.name]} ${String(step.input.id ?? "")}`.trim();
  if (step.name === "propose_action") return PROPOSAL_LABEL[String(step.input.action)] ?? "Proposal";
  return TOOL_LABEL[step.name] ?? step.name;
}

const argsOf = (step: SavyStep) =>
  Object.entries(step.input)
    .filter(([key]) => key !== "reason")
    .map(([, value]) => String(value))
    .join(", ");

/* ------------------------------------------------------------------ */
/* The chain shown in the conversation                                 */
/* ------------------------------------------------------------------ */

type PhaseId = "replay" | "systems" | "engine" | "future" | "history" | "gate" | "check";

const PHASE_OF: Record<string, PhaseId> = {
  read_source: "systems",
  what_changed: "systems",
  get_surface: "systems",
  get_pulse: "engine",
  list_decisions: "engine",
  get_decision: "engine",
  explain: "engine",
  what_if: "future",
  simulate_night: "future",
  get_shadow_summary: "history",
  search_history: "history",
  get_memory: "history",
  propose_action: "gate",
};

const PHASE_TITLE: Record<PhaseId, string> = {
  replay: "Rebuilding tonight from what you did",
  systems: "Reading the restaurant twin",
  engine: "Asking the decision engine",
  future: "Running the night forward on a copy",
  history: "Looking at past nights and memory",
  gate: "Putting it in front of you",
  check: "Checking every figure",
};

export interface ChainPhase {
  id: PhaseId;
  title: string;
  status: ThoughtStatus;
  items: { key: string; text: string; error: boolean }[];
}

export function chainOf(turn: SavyTurn): ChainPhase[] {
  const running = turn.status === "running";
  const phases: ChainPhase[] = [];

  phases.push({
    id: "replay",
    title: PHASE_TITLE.replay,
    status: turn.replay ? "done" : running ? "active" : "error",
    items: turn.replay
      ? [
          { key: "actions", text: `${turn.replay.actions} actions replayed through the reducer`, error: false },
          { key: "clock", text: `Savy's picture as of ${turn.replay.clock} · ${turn.replay.phase}`, error: false },
        ]
      : [],
  });

  // Tool phases appear in the order Savy first reached them.
  for (const step of turn.steps) {
    const id = PHASE_OF[step.name] ?? "engine";
    let phase = phases.find((p) => p.id === id);
    if (!phase) {
      phase = { id, title: PHASE_TITLE[id], status: "done", items: [] };
      phases.push(phase);
    }
    const pending = step.summary === null;
    phase.items.push({
      key: step.id,
      text: pending ? `${stepLabel(step)} · reading` : `${stepLabel(step)} · ${step.summary}`,
      error: step.isError,
    });
    if (pending && running) phase.status = "active";
    else if (step.isError && phase.status !== "active") phase.status = "error";
  }

  const g = turn.grounding;
  const clean = g !== null && g.ungrounded.length === 0 && g.unknownCitations.length === 0;
  phases.push({
    id: "check",
    title: PHASE_TITLE.check,
    status: g === null ? (running && turn.text ? "active" : running ? "pending" : "error") : clean ? "done" : "error",
    items:
      g === null
        ? []
        : [
            {
              key: "figures",
              text:
                g.ungrounded.length === 0
                  ? `${g.figures} ${g.figures === 1 ? "figure" : "figures"} found in tool results`
                  : `Not found in any tool result: ${g.ungrounded.join(", ")}`,
              error: g.ungrounded.length > 0,
            },
            {
              key: "citations",
              text:
                g.unknownCitations.length === 0
                  ? `${g.citations.length} ${g.citations.length === 1 ? "citation resolves" : "citations resolve"}`
                  : `Unknown citations: ${g.unknownCitations.join(", ")}`,
              error: g.unknownCitations.length > 0,
            },
          ],
  });

  return phases;
}

/* ------------------------------------------------------------------ */
/* The pipeline shown in the system view                               */
/* ------------------------------------------------------------------ */

export type NodeStatus = "idle" | "active" | "done" | "error";

export interface PipelineView {
  live: boolean;
  nodes: Record<"question" | "replay" | "agent" | "check" | "answer", NodeStatus>;
  branches: { id: string; label: string; status: NodeStatus; calls: number }[];
  log: string[];
}

const BRANCHES: { id: string; label: string }[] = [
  { id: "twin", label: "Restaurant twin" },
  { id: "staffing", label: "Staffing" },
  { id: "inventory", label: "Inventory" },
  { id: "money", label: "Purchasing and cash" },
  { id: "engine", label: "Decision engine" },
  { id: "future", label: "Night forward" },
  { id: "history", label: "History and memory" },
  { id: "explain", label: "Explain" },
  { id: "gate", label: "Human gate" },
];

function branchOf(step: SavyStep): string {
  if (step.name === "get_surface") {
    const s = String(step.input.surface);
    return s === "staffing" ? "staffing" : s === "inventory" ? "inventory" : s === "health" ? "twin" : "money";
  }
  if (step.name === "read_source" || step.name === "what_changed") return "twin";
  if (step.name === "explain") return "explain";
  const phase = PHASE_OF[step.name];
  return phase === "history" ? "history" : phase === "gate" ? "gate" : phase === "future" ? "future" : "engine";
}

export function pipelineOf(turn: SavyTurn | null): PipelineView {
  const idle: PipelineView["nodes"] = { question: "idle", replay: "idle", agent: "idle", check: "idle", answer: "idle" };
  if (!turn) {
    return { live: false, nodes: idle, branches: BRANCHES.map((b) => ({ ...b, status: "idle", calls: 0 })), log: [] };
  }

  const running = turn.status === "running";
  const failed = turn.status === "error";
  const anyPending = turn.steps.some((s) => s.summary === null);

  const branches = BRANCHES.map((b) => {
    const steps = turn.steps.filter((s) => branchOf(s) === b.id);
    const status: NodeStatus =
      steps.length === 0
        ? "idle"
        : steps.some((s) => s.summary === null) && running
          ? "active"
          : steps.some((s) => s.isError)
            ? "error"
            : "done";
    return { ...b, status, calls: steps.length };
  });

  const nodes: PipelineView["nodes"] = {
    question: "done",
    replay: turn.replay ? "done" : running ? "active" : "error",
    agent: !turn.replay ? "idle" : running && !turn.text ? "active" : failed ? "error" : "done",
    check: turn.grounding
      ? turn.grounding.ungrounded.length + turn.grounding.unknownCitations.length === 0
        ? "done"
        : "error"
      : running && turn.text && !anyPending
        ? "active"
        : "idle",
    answer: turn.status === "done" ? "done" : failed ? "error" : turn.text ? "active" : "idle",
  };

  const log: string[] = [`question · "${turn.question}"`];
  if (turn.replay) {
    log.push(`state · replayed ${turn.replay.actions} actions → ${turn.replay.phase} @ ${turn.replay.clock}`);
  }
  if (turn.mode) log.push(`planner · ${turn.mode === "model" ? turn.model : "sample-data rules"}`);
  for (const step of turn.steps) {
    log.push(
      `tool · ${step.name}(${argsOf(step)}) → ${step.summary ?? "…"}${step.ms !== null ? ` · ${step.ms} ms` : ""}`,
    );
  }
  for (const p of turn.proposals) {
    log.push(`gate · ${p.action.kind} → ${p.confirmed ? "confirmed by a person" : "waiting for a person"}`);
  }
  if (turn.grounding) {
    log.push(
      `check · ${turn.grounding.figures} figures, ${turn.grounding.ungrounded.length} ungrounded, ${turn.grounding.citations.length} citations`,
    );
  }
  if (turn.status === "done" && turn.ms !== null) log.push(`done · ${turn.ms} ms`);
  if (turn.error) log.push(`error · ${turn.error}`);

  return { live: running, nodes, branches, log };
}

export interface RunStats {
  runs: number;
  toolCalls: number;
  avgMs: number | null;
  figures: number;
  ungrounded: number;
  proposals: number;
  confirmed: number;
}

export function statsOf(turns: readonly SavyTurn[]): RunStats {
  const finished = turns.filter((t) => t.status === "done" && t.ms !== null);
  const proposals = turns.flatMap((t) => t.proposals);
  return {
    runs: turns.length,
    toolCalls: turns.reduce((n, t) => n + t.steps.length, 0),
    avgMs: finished.length ? Math.round(finished.reduce((n, t) => n + (t.ms ?? 0), 0) / finished.length) : null,
    figures: turns.reduce((n, t) => n + (t.grounding?.figures ?? 0), 0),
    ungrounded: turns.reduce((n, t) => n + (t.grounding?.ungrounded.length ?? 0), 0),
    proposals: proposals.length,
    confirmed: proposals.filter((p) => p.confirmed).length,
  };
}
