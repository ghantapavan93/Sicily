"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { actionFor, type AgentEvent, type AgentMode, type ChatTurn, type GroundingReport, type Proposal } from "@/agent/protocol";
import type { OrbState } from "../ui/morph-orb";
import { useTwin } from "../experience/TwinContext";

export interface SavyStep {
  id: string;
  name: string;
  input: Record<string, unknown>;
  summary: string | null;
  ms: number | null;
  isError: boolean;
}

export interface SavyProposal extends Proposal {
  /** Set once the person has pressed the button. */
  confirmed: boolean;
}

/** One question, and everything Savy observably did to answer it. */
export interface SavyTurn {
  id: string;
  question: string;
  text: string;
  steps: SavyStep[];
  proposals: SavyProposal[];
  grounding: GroundingReport | null;
  /** What the server rebuilt before answering. */
  replay: { actions: number; clock: string; phase: string } | null;
  mode: AgentMode | null;
  model: string | null;
  note: string | null;
  status: "running" | "done" | "error";
  error: string | null;
  ms: number | null;
  usage: { input: number; output: number } | null;
  stopReason: string | null;
}

interface SavyContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  turns: SavyTurn[];
  busy: boolean;
  /** Working before the first word, answering while words arrive, otherwise at rest. */
  orb: OrbState;
  /** Which planner will answer: Claude, or the rule-based fallback. Null until the server has said. */
  planner: { mode: AgentMode; model: string | null } | null;
  ask: (question: string) => void;
  confirm: (turnId: string, proposalId: string) => void;
  /** Read each finished answer aloud. Off until the person turns it on. */
  speak: boolean;
  setSpeak: (speak: boolean) => void;
  /** Whether this browser can speak at all. */
  canSpeak: boolean;
}

const SavyContext = createContext<SavyContextValue | null>(null);

function applyEvent(turn: SavyTurn, event: AgentEvent): SavyTurn {
  switch (event.type) {
    case "state.replayed":
      return { ...turn, replay: { actions: event.actions, clock: event.clock, phase: event.phase } };
    case "run.started":
      // A second start means the model run was replaced by the rule-based planner: begin clean.
      return { ...turn, mode: event.mode, model: event.model, note: event.note, steps: [], proposals: [], text: "" };
    case "tool.called":
      return {
        ...turn,
        steps: [...turn.steps, { id: event.id, name: event.name, input: event.input, summary: null, ms: null, isError: false }],
      };
    case "tool.returned":
      return {
        ...turn,
        steps: turn.steps.map((s) => (s.id === event.id ? { ...s, summary: event.summary, ms: event.ms, isError: event.isError } : s)),
      };
    case "text.delta":
      return { ...turn, text: turn.text + event.text };
    case "proposal":
      return { ...turn, proposals: [...turn.proposals, { ...event.proposal, confirmed: false }] };
    case "grounding":
      return { ...turn, grounding: event.report };
    case "run.finished":
      return { ...turn, status: "done", ms: event.ms, usage: event.usage, stopReason: event.stopReason };
    case "error":
      return { ...turn, status: "error", error: event.message };
  }
}

export function SavyProvider({ children }: { children: ReactNode }) {
  const { state, dispatch, actionLog } = useTwin();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<SavyTurn[]>([]);
  const [planner, setPlanner] = useState<SavyContextValue["planner"]>(null);
  const abort = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const [speak, setSpeakState] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const spoken = useRef<string | null>(null);

  useEffect(() => {
    setCanSpeak(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  const setSpeak = useCallback((next: boolean) => {
    setSpeakState(next);
    if (!next && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  // Each finished answer is read once: without its citations and list marks, which mean nothing aloud.
  useEffect(() => {
    const last = turns[turns.length - 1];
    if (!speak || !canSpeak || !last || last.status !== "done" || !last.text || spoken.current === last.id) return;
    spoken.current = last.id;
    const text = last.text.replace(/\[[^\]]+\]/g, "").replace(/^\s*[-•]\s+/gm, "").replace(/\s+/g, " ");
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }, [turns, speak, canSpeak]);

  useEffect(() => {
    let live = true;
    fetch("/api/savy")
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        if (live && info && (info.mode === "model" || info.mode === "rules")) setPlanner(info);
      })
      .catch(() => {
        // The panel still works; it just cannot say which planner will answer until the first run.
      });
    return () => {
      live = false;
    };
  }, []);

  // A reset scenario starts a new conversation.
  useEffect(() => {
    if (state.phase !== "idle") return;
    abort.current?.abort();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setTurns([]);
    setOpen(false);
  }, [state.phase]);

  useEffect(() => () => abort.current?.abort(), []);

  const busy = turns.some((t) => t.status === "running");
  const running = turns.find((t) => t.status === "running");
  const orb: OrbState = running ? (running.text ? "speaking" : "thinking") : "idle";

  const ask = useCallback(
    (raw: string) => {
      const question = raw.trim();
      if (!question || busy) return;

      const id = `turn_${++seq.current}`;
      const history: ChatTurn[] = turns
        .filter((t) => t.status === "done" && t.text)
        .flatMap((t) => [
          { role: "user" as const, content: t.question },
          { role: "assistant" as const, content: t.text },
        ]);

      setTurns((all) => [
        ...all,
        {
          id,
          question,
          text: "",
          steps: [],
          proposals: [],
          grounding: null,
          replay: null,
          mode: null,
          model: null,
          note: null,
          status: "running",
          error: null,
          ms: null,
          usage: null,
          stopReason: null,
        },
      ]);

      const update = (event: AgentEvent) =>
        setTurns((all) => all.map((t) => (t.id === id ? applyEvent(t, event) : t)));

      const controller = new AbortController();
      abort.current = controller;

      (async () => {
        try {
          const response = await fetch("/api/savy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: [...history, { role: "user", content: question }], actions: actionLog() }),
            signal: controller.signal,
          });
          if (!response.ok || !response.body) {
            // The route explains refusals (rate limit, oversized request) in one sentence; show it.
            const reason = await response.json().then((b: { error?: unknown }) => (typeof b.error === "string" ? b.error : null)).catch(() => null);
            update({ type: "error", message: reason ?? "Savy could not be reached." });
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let finished = false;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split("\n\n");
            buffer = frames.pop() ?? "";
            for (const frame of frames) {
              if (!frame.startsWith("data: ")) continue;
              const event = JSON.parse(frame.slice(6)) as AgentEvent;
              if (event.type === "run.finished" || event.type === "error") finished = true;
              update(event);
            }
          }
          // The stream ended without saying how. Do not leave the turn spinning.
          if (!finished) update({ type: "error", message: "The answer was cut off." });
        } catch {
          if (!controller.signal.aborted) update({ type: "error", message: "Savy could not be reached." });
        }
      })();
    },
    [busy, turns, actionLog],
  );

  const confirm = useCallback(
    (turnId: string, proposalId: string) => {
      const proposal = turns.find((t) => t.id === turnId)?.proposals.find((p) => p.id === proposalId);
      if (!proposal || proposal.confirmed) return;
      // The one place a proposal becomes an action, and only because a person pressed the button.
      dispatch(actionFor(proposal.action));
      setTurns((all) =>
        all.map((t) =>
          t.id === turnId
            ? { ...t, proposals: t.proposals.map((p) => (p.id === proposalId ? { ...p, confirmed: true } : p)) }
            : t,
        ),
      );
    },
    [turns, dispatch],
  );

  const value = useMemo<SavyContextValue>(
    () => ({ open, setOpen, turns, busy, orb, planner, ask, confirm, speak, setSpeak, canSpeak }),
    [open, turns, busy, orb, planner, ask, confirm, speak, setSpeak, canSpeak],
  );

  return <SavyContext.Provider value={value}>{children}</SavyContext.Provider>;
}

export function useSavy(): SavyContextValue {
  const value = useContext(SavyContext);
  if (!value) throw new Error("useSavy must be used inside <SavyProvider>");
  return value;
}
