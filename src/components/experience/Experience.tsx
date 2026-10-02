"use client";

import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { useEffect, useRef } from "react";
import { DUR, EASE } from "@/lib/motion";
import { EngineeringRoom } from "../engineering/EngineeringRoom";
import { TimeTravelBanner } from "../engineering/SessionPanel";
import { EntryScene } from "../entry/EntryScene";
import { FutureMode } from "../future/FutureMode";
import { LabMode } from "../lab/LabMode";
import { PressurePanel } from "../lab/PressurePanel";
import { DecisionRoom } from "../live/DecisionRoom";
import { LiveMode } from "../live/LiveMode";
import { ManagerPhone } from "../live/ManagerPhone";
import { Theater } from "../live/Theater";
import { MemoryMode } from "../memory/MemoryMode";
import { PresentProvider } from "../present/Present";
import { AskChapter } from "../savy/AskChapter";
import { SavyProvider } from "../savy/SavyContext";
import { SavyDock } from "../savy/SavyDock";
import { SavyLauncher } from "../savy/SavyLauncher";
import { Disclosure } from "../shell/Disclosure";
import { TopBar } from "../shell/TopBar";
import { TryMode } from "../try/TryMode";
import { TwinProvider, useTwin } from "./TwinContext";

function Stage() {
  const { state, mode, view } = useTwin();
  const screen = view === "engineering" ? "engineering" : mode;
  const mainRef = useRef<HTMLElement>(null);

  // A pressed button often disappears with what it did (Open tonight, Run Savy, Approve). When that drops
  // keyboard focus to the page itself, it lands on the content instead of starting over at the top.
  useEffect(() => {
    if (document.activeElement === document.body) mainRef.current?.focus({ preventScroll: true });
  }, [state, screen]);

  return (
    <AnimatePresence mode="wait" initial={false}>
      {state.phase === "idle" ? (
        <EntryScene key="entry" />
      ) : (
        <motion.div
          key="shell"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR.slow, ease: EASE.inOut }}
          className="flex min-h-dvh flex-col"
        >
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[90] focus:rounded-full focus:bg-brass focus:px-4 focus:py-2 focus:text-xs focus:font-semibold focus:text-ground-0">
            Skip to content
          </a>
          <TopBar />
          <TimeTravelBanner />
          <main id="main" ref={mainRef} tabIndex={-1} className="flex-1 outline-none">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={screen}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: DUR.base, ease: EASE.outQuart }}
              >
                {screen === "engineering" && <EngineeringRoom />}
                {screen === "live" && <LiveMode />}
                {screen === "try" && <TryMode />}
                {screen === "lab" && <LabMode />}
                {screen === "memory" && <MemoryMode />}
                {screen === "future" && <FutureMode />}
                {screen === "ask" && <AskChapter />}
              </motion.div>
            </AnimatePresence>
          </main>
          <footer className="border-t border-line px-4 py-5 sm:px-6">
            <Disclosure className="mx-auto max-w-[1500px]" />
          </footer>
          <DecisionRoom />
          <Theater />
          <PressurePanel />
          <ManagerPhone />
          <SavyLauncher />
          <SavyDock />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * One page, one restaurant state. Live, Try it, Lab, Memory, Future, Ask
 * and the engineering view all read the same reducer, so one action ripples
 * through every one of them.
 */
export function Experience() {
  return (
    <MotionConfig reducedMotion="user">
      <TwinProvider>
        <SavyProvider>
          <PresentProvider>
            <Stage />
          </PresentProvider>
        </SavyProvider>
      </TwinProvider>
    </MotionConfig>
  );
}
