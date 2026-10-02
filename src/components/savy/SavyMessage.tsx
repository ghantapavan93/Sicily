"use client";

import clsx from "clsx";
import { motion } from "framer-motion";
import { Check, ChevronDown, CircleAlert } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { contextFor, proposalEligibility } from "@/agent/tools";
import { findSituation } from "@/shadow/replay";
import { SOURCES } from "@/twin/sources";
import { useTwin } from "../experience/TwinContext";
import { MorphOrb } from "../ui/morph-orb";
import { Button, Chip, Eyebrow } from "../ui/primitives";
import { ThoughtChain, ThoughtChainContent, ThoughtChainItem, ThoughtChainStep, ThoughtChainTrigger } from "../ui/thought-chain";
import { useSavy, type SavyTurn } from "./SavyContext";
import { chainOf } from "./trace";

/* ------------------------------------------------------------------ */
/* Answer text: short lines, dash lists, and citations as chips        */
/* ------------------------------------------------------------------ */

const CITATION = /\[((?:evt|mem)_[a-z0-9_]+|DEC-[A-Z0-9]+(?:-[A-Z0-9]+)*|RCT-\d{3}|[A-Z]{2,6}-\d{2}|tonight)\]/g;

function Citation({ id }: { id: string }) {
  const { ev, openSituation, openRoom, goTo } = useTwin();
  const { setOpen } = useSavy();
  const event = id.startsWith("evt_") ? ev.processed.find((e) => e.id === id) : undefined;
  const decision = id.startsWith("DEC-") ? ev.decisions.find((d) => d.id === id) : undefined;
  const situation = !decision && id.includes("-") ? findSituation(id) : undefined;
  const isMemory = id.startsWith("mem_");

  const label = event ? SOURCES[event.source].label : decision ? decision.id : isMemory ? "memory" : id;
  const title = event
    ? `${event.summary} · ${event.kind} · ${event.id}`
    : decision
      ? `Open the decision room: ${decision.title}`
      : situation
        ? "Open this past situation in the replay"
        : isMemory
          ? "Open decision memory"
          : id;
  const className =
    "mx-0.5 inline-flex -translate-y-px items-center rounded-md border border-line bg-ground-3/80 px-1.5 py-px font-mono text-[0.6875rem] text-ink-mid";

  if (decision || situation || isMemory) {
    return (
      <button
        type="button"
        title={title}
        onClick={() => {
          if (decision) openRoom(decision.key);
          else if (situation) openSituation(id);
          else goTo("memory");
          setOpen(false);
        }}
        className={clsx(className, "transition-colors hover:border-brass hover:text-brass-ink")}
      >
        {label}
      </button>
    );
  }
  return (
    <span title={title} className={className}>
      {label}
    </span>
  );
}

function withCitations(line: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of line.matchAll(CITATION)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(line.slice(last, index));
    parts.push(<Citation key={`${index}:${match[1]}`} id={match[1] ?? ""} />);
    last = index + match[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

function Answer({ text }: { text: string }) {
  const lines = text.split("\n").filter((l) => l.trim());
  return (
    <div className="space-y-2 text-[0.9375rem] leading-relaxed text-ink-hi">
      {lines.map((line, i) =>
        /^\s*[-•]\s+/.test(line) ? (
          <p key={i} className="flex gap-2.5 pl-1">
            <span aria-hidden className="mt-[0.6rem] size-1 shrink-0 rounded-full bg-brass/70" />
            <span>{withCitations(line.replace(/^\s*[-•]\s+/, ""))}</span>
          </p>
        ) : (
          <p key={i}>{withCitations(line)}</p>
        ),
      )}
    </div>
  );
}

function Typing() {
  return (
    <span className="flex items-center gap-2 text-sm text-ink-lo" role="status">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="typing-dot size-1.5 rounded-full bg-brass-ink" style={{ animationDelay: `${i * 0.16}s` }} />
        ))}
      </span>
      Savy is working
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* What Savy did, as a chain of steps                                  */
/* ------------------------------------------------------------------ */

function Steps({ turn }: { turn: SavyTurn }) {
  const running = turn.status === "running";
  const phases = useMemo(() => chainOf(turn), [turn]);
  // Open while Savy works, folded away once it has answered, unless the person chose otherwise.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? running;
  const calls = turn.steps.length;

  return (
    <div className="rounded-2xl border border-line-soft bg-ground-0/55">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setChosen(!open)}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left"
      >
        <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-ink-lo">
          What Savy did
          <span className="ml-2 font-mono font-normal normal-case tracking-normal">
            {calls} {calls === 1 ? "call" : "calls"}
            {turn.ms !== null && ` · ${(turn.ms / 1000).toFixed(1)} s`}
          </span>
        </span>
        <ChevronDown aria-hidden className={clsx("size-4 text-ink-lo transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-line-soft px-3.5 py-3">
          <ThoughtChain>
            {phases.map((phase) => (
              <ThoughtChainStep key={phase.id} status={phase.status}>
                <ThoughtChainTrigger>{phase.title}</ThoughtChainTrigger>
                <ThoughtChainContent>
                  {phase.items.map((item) => (
                    <ThoughtChainItem key={item.key} tone={item.error ? "error" : "default"}>
                      {item.text}
                    </ThoughtChainItem>
                  ))}
                </ThoughtChainContent>
              </ThoughtChainStep>
            ))}
          </ThoughtChain>
          <p className="mt-3 text-[0.6875rem] leading-snug text-ink-lo">
            These are the calls Savy made and what came back. Not its reasoning.
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One turn                                                            */
/* ------------------------------------------------------------------ */

export function SavyMessage({ turn }: { turn: SavyTurn }) {
  const { state, session } = useTwin();
  const { confirm } = useSavy();
  const running = turn.status === "running";
  const ctx = useMemo(() => contextFor(state), [state]);
  const g = turn.grounding;
  const clean = g !== null && g.ungrounded.length === 0 && g.unknownCitations.length === 0;

  return (
    <article className="space-y-3.5">
      <motion.p
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-md border border-line bg-ground-3/70 px-4 py-2.5 text-[0.9375rem] text-ink-hi"
      >
        {turn.question}
      </motion.p>

      <div className="flex gap-3">
        <MorphOrb size={26} state={running ? (turn.text ? "speaking" : "thinking") : "idle"} className="mt-0.5" />
        <div className="min-w-0 flex-1 space-y-3">
          {turn.note && <p className="text-xs leading-snug text-brass-ink">{turn.note}</p>}

          <Steps turn={turn} />

          {turn.text ? <Answer text={turn.text} /> : running ? <Typing /> : null}
          {turn.error && (
            <p className="flex items-start gap-2 text-sm text-conflict">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {turn.error}
            </p>
          )}

          {turn.proposals.map((proposal) => {
            const eligible = session.live
              ? proposalEligibility(ctx, proposal.action)
              : { ok: false as const, why: "You are viewing an earlier point of the session. Return to live to act." };
            return (
              <motion.div
                key={proposal.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="rounded-2xl border border-brass/45 bg-brass/[0.06] p-4"
              >
                <Eyebrow className="!text-brass-ink">Waiting for you</Eyebrow>
                <p className="mt-1.5 text-sm leading-snug text-ink-hi">{proposal.reason}</p>
                <div className="mt-3.5 flex flex-wrap items-center gap-3">
                  {proposal.confirmed ? (
                    <Chip tone="verified">
                      <Check aria-hidden className="size-3" strokeWidth={3} /> Confirmed by you
                    </Chip>
                  ) : eligible.ok ? (
                    <Button variant="primary" onClick={() => confirm(turn.id, proposal.id)} className="h-auto min-h-10 py-2 text-left normal-case tracking-normal">
                      {proposal.label}
                    </Button>
                  ) : (
                    <Button variant="secondary" size="sm" disabled>
                      {proposal.label}
                    </Button>
                  )}
                </div>
                {!proposal.confirmed && (
                  <p className="mt-2.5 text-xs leading-snug text-ink-lo">
                    {eligible.ok ? "Savy has done nothing. This button does it, as you." : eligible.why}
                  </p>
                )}
              </motion.div>
            );
          })}

          {turn.status === "done" && (
            <footer className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-lo">
              <Chip tone={turn.mode === "model" ? "brass" : "neutral"}>
                {turn.mode === "model" ? (turn.model ?? "Claude") : "Sample-data answer"}
              </Chip>
              {g &&
                (clean ? (
                  g.figures > 0 && (
                    <span className="flex items-center gap-1.5 text-verified">
                      <Check aria-hidden className="size-3.5" strokeWidth={2.5} />
                      {g.figures} {g.figures === 1 ? "figure" : "figures"} found in tool results
                      {g.fromQuestion.length > 0 && <span className="text-ink-lo">· {g.fromQuestion.join(", ")} from your question</span>}
                    </span>
                  )
                ) : (
                  <span className="flex items-start gap-1.5 text-conflict">
                    <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
                    Not found in any tool result: {[...g.ungrounded, ...g.unknownCitations].join(", ")}
                  </span>
                ))}
              {turn.usage && (
                <span className="font-mono">
                  {turn.usage.input.toLocaleString("en-US")} in · {turn.usage.output.toLocaleString("en-US")} out
                </span>
              )}
            </footer>
          )}
        </div>
      </div>
    </article>
  );
}
