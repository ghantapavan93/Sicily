"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SPRING } from "@/lib/motion";
import { useTwin } from "../experience/TwinContext";
import { MorphOrb } from "../ui/morph-orb";
import { useSavy } from "./SavyContext";

/** Changes worth a tap on the shoulder, and the question that explains each. */
const WORTH_SAYING: Record<string, string> = {
  "recommendation.restored": "What needs my attention?",
  "recommendation.withdrawn": "What don't you know right now?",
  "decision.resolved": "What needs my attention?",
  "po.reconciled": "What's going into tomorrow's order?",
  "decision.overruled": "What needs my attention?",
};

interface Nudge {
  id: string;
  text: string;
  question: string;
}

const NUDGE_MS = 9000;

/**
 * Savy's resting place: an orb in the corner of every mode. Savy also speaks
 * first: when it finishes reading the night, or when its recommendation
 * moves, a short note rises from the orb. The note is the audit line the
 * engine wrote, so it says only what actually changed.
 */
export function SavyLauncher() {
  const { state, pulse, mode, session, moment } = useTwin();
  const { open, setOpen, orb, turns, ask, busy } = useSavy();
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const seen = useRef(state.audit.length);

  useEffect(() => {
    const fresh = state.audit.slice(seen.current);
    seen.current = state.audit.length;
    if (!session.live || (state.phase !== "live" && state.phase !== "processing")) {
      setNudge(null);
      return;
    }
    const synthesized = fresh.find((a) => a.type === "plan.synthesized");
    if (synthesized) {
      setNudge({ id: synthesized.id, text: `${pulse.headline} ${pulse.sub.replace("Your original service plan is no longer the plan I would use. ", "")}`, question: "What needs my attention?" });
      return;
    }
    const entry = [...fresh].reverse().find((a) => a.type in WORTH_SAYING);
    if (entry) setNudge({ id: entry.id, text: entry.label, question: WORTH_SAYING[entry.type] ?? "What needs my attention?" });
  }, [state.audit, state.phase, session.live, pulse]);

  useEffect(() => {
    if (!nudge) return;
    const id = window.setTimeout(() => setNudge(null), NUDGE_MS);
    return () => window.clearTimeout(id);
  }, [nudge]);

  const visible = !open && mode !== "ask";
  const last = turns[turns.length - 1];

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="launcher"
          initial={{ opacity: 0, y: 16, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.94 }}
          transition={SPRING.snappy}
          className="fixed bottom-5 right-5 z-30 flex flex-col items-end gap-2.5"
        >
          <AnimatePresence>
            {nudge && (
              <motion.div
                key={nudge.id}
                role="status"
                initial={{ opacity: 0, y: 10, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.96 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="glass w-[min(21rem,calc(100vw-2.5rem))] rounded-2xl rounded-br-md border border-brass/45 p-3.5 shadow-[0_18px_50px_-18px_rgba(0,0,0,0.95)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-brass-ink">Savy</p>
                  <button type="button" aria-label="Dismiss" onClick={() => setNudge(null)} className="-m-1 flex size-6 items-center justify-center rounded-full text-ink-lo hover:text-ink-hi">
                    <X aria-hidden className="size-3.5" />
                  </button>
                </div>
                <p className="mt-1 text-sm leading-snug text-ink-hi">{nudge.text}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setOpen(true);
                    ask(nudge.question);
                    setNudge(null);
                  }}
                  className="mt-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-brass-ink underline-offset-4 hover:underline disabled:opacity-50"
                >
                  Ask Savy why
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button
            type="button"
            onClick={() => {
              setOpen(true);
              setNudge(null);
            }}
            whileHover={{ y: -2 }}
            className="glass flex items-center gap-3 rounded-full border border-line py-2 pr-5 pl-2 text-left shadow-[0_18px_50px_-18px_rgba(0,0,0,0.95)] transition-colors hover:border-brass/60"
          >
            <motion.span layoutId="savy-orb" className="flex">
              <MorphOrb size={38} state={orb} alive={moment !== null} />
            </motion.span>
            <span>
              <span className="block text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-brass-ink">Ask Savy</span>
              <span className="block text-sm text-ink-hi">{orb === "idle" ? (last ? "Pick up where you left off" : "Ask about tonight") : "Working on it"}</span>
            </span>
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
