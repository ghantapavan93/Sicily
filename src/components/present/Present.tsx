"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Pause, Play, SkipForward, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTwin } from "../experience/TwinContext";
import { useLayer } from "../ui/layer";

/*
 * Present mode. The three-minute story, driven through the real product: each
 * step dispatches the same actions a person would and opens the same views.
 * Nothing here is a recording. Pause it, step it, or take the controls back
 * at any point; the night is still live underneath.
 */

type Controls = ReturnType<typeof useTwin>;

interface Step {
  title: string;
  line: string;
  /** How long the step stays on screen before the next one starts. */
  hold: number;
  run: (c: Controls) => void;
  /** What stopping on this step puts back, so a story cut short doesn't leave the night broken. */
  undo?: (c: Controls) => void;
}

const SCRIPT: Step[] = [
  { title: "Friday, 5:12 PM.", line: "Tonight looks like the plan. Watch what arrives.", hold: 7200, run: (c) => c.openNight("friday_rush") },
  { title: "Eight systems.", line: "Each one learns part of what changed. None of them learns all of it.", hold: 3200, run: () => undefined },
  { title: "Run Savy.", line: "Every event travels the same five engines to the owner. Watch the packets.", hold: 10500, run: (c) => c.dispatch({ type: "RUN_SAVY" }) },
  { title: "Tonight changed.", line: "Three decisions, one missing fact, two things that can wait. Nothing else.", hold: 5600, run: () => undefined },
  { title: "The Decision Room.", line: "What changed, what Savy doesn't know, and who decides. Note the patio: nobody owns it.", hold: 7500, run: (c) => c.openRoom("staffing") },
  { title: "What if nobody acts?", line: "The rest of the night, run forward. Priya and Dee carry the empty patio.", hold: 7800, run: (c) => c.setTheater("nothing") },
  { title: "The same night, with Savy's plan.", line: "Sam takes the patio. Every section stays under the ceiling.", hold: 7800, run: (c) => c.setTheater("plan") },
  {
    title: "Break the data.",
    line: "Sales stop syncing. The coverage risk stays; the priced recommendation is withdrawn.",
    hold: 6200,
    run: (c) => {
      c.setTheater(null);
      c.openRoom(null);
      c.setPressure(true);
      c.dispatch({ type: "TOGGLE_FAULT", fault: "pos_delayed" });
    },
    undo: (c) => {
      if (c.state.faults.includes("pos_delayed")) c.dispatch({ type: "TOGGLE_FAULT", fault: "pos_delayed" });
      c.setPressure(false);
    },
  },
  {
    title: "Restore it.",
    line: "Evidence returns, and the recommendation returns with it.",
    hold: 4200,
    run: (c) => {
      c.dispatch({ type: "TOGGLE_FAULT", fault: "pos_delayed" });
      c.setPressure(false);
    },
  },
  {
    title: "One approval.",
    line: "The floor, labor, cash, the record and the receipt all move. Savy sent nothing.",
    hold: 6500,
    run: (c) => {
      c.dispatch({ type: "APPROVE", key: "staffing" });
      c.openRoom("staffing");
    },
  },
  {
    title: "When the fact is on a shelf, ask the floor.",
    line: "One number from the manager. The burrata decision closes itself.",
    hold: 6800,
    run: (c) => {
      c.openRoom(null);
      c.dispatch({ type: "ASK_MANAGER", item: "burrata", place: "backup" });
    },
  },
  { title: "Under the hood.", line: "An event ledger, a twin, a decision ledger. Every block opens the live data.", hold: 6500, run: (c) => c.setView("engineering") },
  {
    title: "Fast forward to close.",
    line: "Expected against what happened, a receipt for each decision, and Monday's briefing.",
    hold: 6800,
    run: (c) => {
      c.setView("operator");
      c.goTo("live");
      c.dispatch({ type: "FAST_FORWARD" });
    },
  },
  { title: "What it learned.", line: "Outcomes, not opinions. One pattern got stronger. One is fading because the restaurant changed.", hold: 6800, run: (c) => c.goTo("memory") },
  { title: "Savy Tomorrow.", line: "The owner stops being the integration layer, without giving up being the owner.", hold: 8000, run: (c) => c.goTo("future") },
];

interface PresentValue {
  active: boolean;
  start: () => void;
}

const PresentContext = createContext<PresentValue | null>(null);

export function PresentProvider({ children }: { children: ReactNode }) {
  const twin = useTwin();
  const twinRef = useRef(twin);
  useEffect(() => {
    twinRef.current = twin;
  }, [twin]);
  const reduced = useReducedMotion();
  const [index, setIndex] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const ran = useRef<number | null>(null);

  const stop = useCallback(() => {
    const step = ran.current === null ? undefined : SCRIPT[ran.current];
    step?.undo?.(twinRef.current);
    setIndex(null);
    setPaused(false);
    ran.current = null;
  }, []);

  const start = useCallback(() => {
    const { state } = twinRef.current;
    // The story starts from an empty night. Say so before clearing one someone has been working in.
    if (state.phase !== "idle" && !window.confirm("Present starts a fresh night. Tonight's progress here will be cleared. Copy the session link first if you want to keep it.")) return;
    twinRef.current.reset();
    ran.current = null;
    setPaused(false);
    setIndex(0);
  }, []);

  const next = useCallback(() => setIndex((i) => (i === null ? null : i + 1 >= SCRIPT.length ? null : i + 1)), []);

  // Each step acts once, then holds.
  useEffect(() => {
    if (index === null) return;
    const step = SCRIPT[index];
    if (!step) return stop();
    if (ran.current !== index) {
      ran.current = index;
      step.run(twinRef.current);
    }
    if (paused) return;
    const id = window.setTimeout(next, reduced ? Math.min(step.hold, 2500) : step.hold);
    return () => window.clearTimeout(id);
  }, [index, paused, next, stop, reduced]);

  // Escape goes through the layer stack: with the room or the theater open, it closes those first.
  useLayer<HTMLElement>(index !== null, stop, { trap: false });

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      // Keys typed into a field stay with it, and Space on a button presses the button.
      const target = e.target as HTMLElement | null;
      if (target && (["TEXTAREA", "INPUT", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
      if (e.key === "ArrowRight") next();
      else if (e.key === " " && target?.tagName !== "BUTTON") {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, next]);

  const value = useMemo(() => ({ active: index !== null, start }), [index, start]);
  const step = index === null ? null : SCRIPT[index];

  return (
    <PresentContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {step && index !== null && (
          <motion.div
            key="present"
            role="status"
            aria-label="Present mode"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center px-4"
          >
            <div className="pointer-events-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-brass/40 bg-[#0b0908]/95 shadow-[0_30px_80px_-20px_rgba(0,0,0,1)] backdrop-blur">
              <div className="flex items-start gap-4 px-5 pb-3 pt-4">
                <span className="mt-1 font-mono text-xs text-ink-lo">
                  {String(index + 1).padStart(2, "0")}/{SCRIPT.length}
                </span>
                <AnimatePresence mode="wait">
                  <motion.div key={index} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="min-w-0 flex-1">
                    <p className="font-display text-2xl font-light leading-tight text-ink-hi">{step.title}</p>
                    <p className="mt-1 text-[0.9375rem] leading-snug text-ink-mid">{step.line}</p>
                  </motion.div>
                </AnimatePresence>
                <div className="flex shrink-0 gap-1">
                  <button type="button" aria-label={paused ? "Resume" : "Pause"} onClick={() => setPaused(!paused)} className="flex size-8 items-center justify-center rounded-full text-ink-mid hover:bg-ground-3 hover:text-ink-hi">
                    {paused ? <Play aria-hidden className="size-4" /> : <Pause aria-hidden className="size-4" />}
                  </button>
                  <button type="button" aria-label="Next" onClick={next} className="flex size-8 items-center justify-center rounded-full text-ink-mid hover:bg-ground-3 hover:text-ink-hi">
                    <SkipForward aria-hidden className="size-4" />
                  </button>
                  <button type="button" aria-label="Exit present mode" onClick={stop} className="flex size-8 items-center justify-center rounded-full text-ink-mid hover:bg-ground-3 hover:text-ink-hi">
                    <X aria-hidden className="size-4" />
                  </button>
                </div>
              </div>
              <div className="h-0.5 bg-line">
                <motion.div
                  key={`${index}-${paused}`}
                  className="h-full bg-brass"
                  initial={{ width: "0%" }}
                  animate={{ width: paused ? "0%" : "100%" }}
                  transition={{ duration: paused ? 0 : (reduced ? Math.min(step.hold, 2500) : step.hold) / 1000, ease: "linear" }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </PresentContext.Provider>
  );
}

export function usePresent(): PresentValue {
  const value = useContext(PresentContext);
  if (!value) throw new Error("usePresent must be used inside <PresentProvider>");
  return value;
}
