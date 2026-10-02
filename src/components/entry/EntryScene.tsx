"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { formatClock } from "@/domain/clock";
import { VENUE } from "@/domain/venue";
import { DUR, EASE } from "@/lib/motion";
import { SCENARIO_ORDER, SCENARIOS } from "@/twin/scenarios";
import { useTwin } from "../experience/TwinContext";
import { usePresent } from "../present/Present";
import { Disclosure } from "../shell/Disclosure";
import { Button } from "../ui/primitives";
import { SceneBackdrop } from "./SceneBackdrop";

/** Each line arrives after the one before it. The interface stays out of the way. */
const reveal = (delay: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: DUR.reveal, ease: EASE.outQuart, delay },
});

const friday = SCENARIOS.friday_rush;

export function EntryScene() {
  const { openNight } = useTwin();
  const present = usePresent();

  return (
    <motion.main
      className="relative flex min-h-dvh flex-col overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.015 }}
      transition={{ duration: DUR.slow, ease: EASE.inOut }}
    >
      <SceneBackdrop />

      <header className="relative z-10 flex items-start justify-between gap-6 px-6 pt-6 sm:px-10 sm:pt-8">
        <motion.p {...reveal(0.2)} className="max-w-xs text-sm leading-relaxed text-ink-mid">
          I spent an evening inside OPSAVOR. My builder instinct got the better of me. So I built one idea for what Savy could feel like during a
          real shift.
        </motion.p>
        <motion.p {...reveal(0.2)} className="eyebrow hidden text-right sm:block">
          Savy Live Ops
          <span className="mt-1 block font-normal normal-case tracking-normal text-ink-lo">A living simulation of one restaurant night.</span>
        </motion.p>
      </header>

      <div className="relative z-10 flex flex-1 flex-col justify-center px-6 py-12 sm:px-10 lg:px-[12vw]">
        <motion.h1 {...reveal(0.7)} className="font-display text-[clamp(4rem,13vw,10.5rem)] font-light leading-[0.9] tracking-[-0.02em] text-ink-hi">
          {VENUE.name}
        </motion.h1>

        <motion.p {...reveal(1.0)} className="mt-5 font-mono text-sm uppercase tracking-[0.32em] text-brass-ink sm:text-base">
          {friday.day} · {formatClock(friday.openAt)}
        </motion.p>

        <motion.div {...reveal(1.5)} className="mt-10 max-w-xl space-y-2">
          <p className="text-xl leading-snug text-ink-hi sm:text-2xl">Dinner begins at {formatClock(friday.doorsAt)}. Tonight looks like the plan.</p>
          <p className="text-xl leading-snug text-ink-hi sm:text-2xl">In the next half hour, it won&apos;t be.</p>
        </motion.div>

        <motion.p {...reveal(2.0)} className="mt-6 max-w-md text-base leading-relaxed text-ink-mid">
          Eight systems will each learn part of what changes. None of them will learn all of it.
        </motion.p>

        <motion.div {...reveal(2.5)} className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
          <Button variant="primary" size="lg" autoFocus onClick={() => openNight("friday_rush")}>
            Open tonight
            <ArrowRight aria-hidden className="size-4" />
          </Button>
          <Button variant="secondary" size="lg" onClick={present.start}>
            Watch the three-minute story
          </Button>
          <span className="flex flex-wrap items-center gap-2 text-sm text-ink-lo">
            or another night:
            {SCENARIO_ORDER.filter((id) => id !== "friday_rush").map((id) => (
              <button key={id} type="button" onClick={() => openNight(id)} className="rounded-full border border-line px-3 py-1 text-ink-mid hover:border-ink-lo hover:text-ink-hi">
                {SCENARIOS[id].title}
              </button>
            ))}
          </span>
        </motion.div>
      </div>

      <motion.footer {...reveal(2.8)} className="relative z-10 px-6 pb-6 sm:px-10 sm:pb-8">
        <Disclosure />
      </motion.footer>
    </motion.main>
  );
}
