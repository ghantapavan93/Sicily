"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { ClipboardList, EyeOff, FlaskConical, Shuffle } from "lucide-react";
import { useState } from "react";
import { formatClock } from "@/domain/clock";
import { DUR, EASE } from "@/lib/motion";
import { useTwin } from "../experience/TwinContext";
import { Button, Eyebrow } from "../ui/primitives";
import { LineupCard } from "./LineupCard";

const TONE = {
  calm: "text-ink-hi",
  reading: "text-ink-hi",
  changed: "text-ink-hi",
  handled: "text-ink-hi",
  closed: "text-ink-hi",
} as const;

function Stat({ value, label, emphasis }: { value: number; label: string; emphasis?: boolean }) {
  return (
    <div className="min-w-[5.5rem]">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.p
          key={value}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: DUR.base, ease: EASE.outQuart }}
          className={clsx("font-display text-3xl font-light leading-none", emphasis ? "text-brass-ink" : "text-ink-hi")}
        >
          {value}
        </motion.p>
      </AnimatePresence>
      <p className="mt-1.5 text-[0.6875rem] leading-tight text-ink-lo">{label}</p>
    </div>
  );
}

/**
 * The Daily Pulse: one sentence about tonight, and the attention budget
 * beside it. Intelligence here means less to read, not more: how much
 * arrived, how little of it changed anything, how much needs the owner.
 */
export function PulseStrip() {
  const { state, ev, pulse, attention, setPressure, goTo, session } = useTwin();
  const [hidden, setHidden] = useState(false);
  const [lineup, setLineup] = useState(false);
  const decided = state.phase === "live" || state.phase === "closed" || state.phase === "remembered";

  return (
    <section aria-label="Daily Pulse" className="border-b border-line bg-ground-0">
      <div className="mx-auto grid max-w-[1500px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <Eyebrow>
            Daily Pulse · {ev.scenario.service} · <span className="font-mono normal-case tracking-normal text-ink-mid">{formatClock(state.clock)}</span>
          </Eyebrow>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={pulse.headline}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: DUR.base, ease: EASE.outQuart }}
            >
              <h1 className={clsx("mt-2 font-display text-[clamp(1.9rem,3.6vw,3rem)] font-light leading-[1.05] tracking-[-0.01em]", TONE[pulse.tone])}>
                {pulse.headline}
              </h1>
              <p className="mt-2 max-w-3xl text-lg leading-snug text-ink-mid">{pulse.sub}</p>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex flex-col items-start gap-4 lg:items-end">
          <div className="flex gap-6" aria-label="Attention budget">
            <Stat value={attention.signals} label="signals arrived" />
            <Stat value={decided ? attention.changedDecision : 0} label="changed a decision" />
            <Stat value={decided ? attention.needsYou : 0} label="need you now" emphasis={decided && attention.needsYou > 0} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" aria-expanded={hidden} onClick={() => setHidden(!hidden)} disabled={!decided}>
              <EyeOff aria-hidden className="size-3.5" />
              What did you hide?
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setLineup(true)} disabled={!decided}>
              <ClipboardList aria-hidden className="size-3.5" />
              Lineup card
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setPressure(true)} disabled={!session.live || state.phase === "idle"}>
              <FlaskConical aria-hidden className="size-3.5" />
              Pressure test
            </Button>
            <Button variant="ghost" size="sm" onClick={() => goTo("try")}>
              <Shuffle aria-hidden className="size-3.5" />
              Another night
            </Button>
          </div>
        </div>
      </div>

      <LineupCard open={lineup} onClose={() => setLineup(false)} />
      <AnimatePresence initial={false}>
        {hidden && decided && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: DUR.slow, ease: EASE.outQuart }}
            className="overflow-hidden border-t border-line-soft"
          >
            <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6">
              <p className="text-sm text-ink-mid">
                {attention.signals} signals arrived. {attention.changedDecision} changed a decision. Savy kept the rest out of your way. Here is all of it.
              </p>
              <ul className="mt-3 grid gap-x-8 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
                {attention.hidden.map((h, i) => (
                  <li key={`${h.what}-${i}`} className="flex gap-3 text-xs leading-snug">
                    <span className="w-14 shrink-0 font-mono text-ink-lo">{formatClock(h.at)}</span>
                    <span className="min-w-0">
                      <span className="text-ink-mid">{h.what}</span> <span className="text-ink-lo">{h.why}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
