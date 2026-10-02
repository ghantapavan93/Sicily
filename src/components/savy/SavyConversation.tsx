"use client";

import clsx from "clsx";
import { motion } from "framer-motion";
import { useEffect, useMemo, useRef } from "react";
import { VENUE } from "@/domain/venue";
import { useTwin } from "../experience/TwinContext";
import { MorphOrb } from "../ui/morph-orb";
import { SavyComposer } from "./SavyComposer";
import { useSavy } from "./SavyContext";
import { SavyMessage } from "./SavyMessage";
import { followUpsFor, OWNER_QUESTIONS, QUICK_ACTIONS, situationLine } from "./prompts";

interface SavyConversationProps {
  /** The dock is narrow; the page has room for a larger welcome. */
  variant: "dock" | "page";
  autoFocus?: boolean;
}

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as const, delay },
});

function Welcome({ variant }: { variant: "dock" | "page" }) {
  const { state, pulse } = useTwin();
  const { ask, busy } = useSavy();
  const page = variant === "page";

  return (
    <div className={clsx("mx-auto flex w-full flex-col items-center text-center", page ? "max-w-2xl py-2" : "py-1")}>
      <motion.div {...rise(0)}>
        <MorphOrb size={page ? 76 : 60} state="idle" />
      </motion.div>

      <motion.h2
        {...rise(0.08)}
        className={clsx("mt-5 font-display font-light leading-tight text-ink-hi", page ? "text-4xl" : "text-3xl")}
      >
        Good evening, {VENUE.owner}.
      </motion.h2>
      <motion.p {...rise(0.14)} className={clsx("mt-2.5 text-ink-mid", page ? "text-lg" : "text-[0.9375rem]")}>
        {situationLine(state, pulse)}
      </motion.p>
      <motion.p {...rise(0.2)} className="mt-2 max-w-md text-sm leading-relaxed text-ink-lo">
        I answer from {VENUE.name}'s connected records, show each step I take, and wait for you to act.
      </motion.p>

      <motion.ul {...rise(0.28)} className="mt-6 grid w-full grid-cols-1 gap-2.5 text-left sm:grid-cols-2">
        {OWNER_QUESTIONS.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => ask(p.question)}
              className="group flex h-full w-full items-start gap-3 rounded-2xl border border-line bg-ground-2/50 p-3.5 text-left transition-colors hover:border-brass/60 hover:bg-ground-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-line bg-ground-1 text-brass-ink transition-colors group-hover:border-brass/60">
                <p.icon aria-hidden className="size-4" strokeWidth={1.75} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink-hi">{p.label}</span>
                <span className="mt-0.5 block text-xs leading-snug text-ink-lo">{p.hint}</span>
              </span>
            </button>
          </li>
        ))}
      </motion.ul>

      <motion.ul {...rise(0.36)} className="mt-4 flex flex-wrap justify-center gap-2">
        {QUICK_ACTIONS.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => ask(p.question)}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-ground-2/40 px-3 py-1.5 text-xs font-medium text-ink-mid transition-colors hover:border-brass/60 hover:text-ink-hi disabled:cursor-not-allowed disabled:opacity-60"
            >
              <p.icon aria-hidden className="size-3.5 text-brass-ink" strokeWidth={1.75} />
              {p.label}
            </button>
          </li>
        ))}
      </motion.ul>
    </div>
  );
}

/**
 * The conversation with Savy: a welcome until the first question, then the
 * turns, with the composer pinned underneath. The dock and the full page
 * render this same component over the same state.
 */
export function SavyConversation({ variant, autoFocus = false }: SavyConversationProps) {
  const { state, ev } = useTwin();
  const { turns, planner } = useSavy();
  const endRef = useRef<HTMLDivElement>(null);
  const followUps = useMemo(() => (turns.length > 0 ? followUpsFor(state, ev) : []), [turns.length, state, ev]);

  // Keep the newest words in view while an answer streams.
  const last = turns[turns.length - 1];
  const progress = (last?.text.length ?? 0) + (last?.steps.length ?? 0) * 1000 + (last?.proposals.length ?? 0);
  useEffect(() => {
    // The welcome starts at its top; only a conversation follows its newest line.
    if (turns.length > 0) endRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, progress, last?.status]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={clsx("min-h-0 flex-1 overflow-y-auto", variant === "page" ? "px-5 py-6 sm:px-8" : "px-5 py-5")}>
        {turns.length === 0 ? (
          <Welcome variant={variant} />
        ) : (
          <div className={clsx("mx-auto space-y-7", variant === "page" && "max-w-3xl")}>
            {turns.map((turn) => (
              <SavyMessage key={turn.id} turn={turn} />
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className={clsx("border-t border-line/70", variant === "page" ? "px-5 pt-4 pb-5 sm:px-8" : "px-5 pt-3.5 pb-4")}>
        <div className={clsx("mx-auto", variant === "page" && "max-w-3xl")}>
          <SavyComposer autoFocus={autoFocus} followUps={followUps} />
          <p className="mt-2.5 text-center text-[0.6875rem] leading-snug text-ink-lo">
            {planner?.mode === "model"
              ? `${planner.model} · synthetic data · Savy proposes, you confirm`
              : "Sample-data demo · no live model · Savy proposes, you confirm"}
          </p>
        </div>
      </div>
    </div>
  );
}
