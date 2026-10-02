"use client";

import clsx from "clsx";
import { motion } from "framer-motion";
import { Clapperboard, RotateCcw, Sparkles } from "lucide-react";
import { formatClock } from "@/domain/clock";
import { VENUE } from "@/domain/venue";
import { SPRING } from "@/lib/motion";
import { useTwin, type Mode, type View } from "../experience/TwinContext";
import { usePresent } from "../present/Present";
import { useSavy } from "../savy/SavyContext";
import { Button } from "../ui/primitives";

const MODES: { id: Mode; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "try", label: "Try it" },
  { id: "lab", label: "Lab" },
  { id: "memory", label: "Memory" },
  { id: "future", label: "Future" },
  { id: "ask", label: "Ask" },
];

const VIEWS: { id: View; label: string }[] = [
  { id: "operator", label: "Operator" },
  { id: "engineering", label: "Engineering" },
];

export function TopBar() {
  const { state, ev, mode, goTo, view, setView, reset } = useTwin();
  const savy = useSavy();
  const present = usePresent();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ground-0/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-2xl leading-none text-ink-hi">{VENUE.name}</span>
          <span className="font-mono text-xs uppercase tracking-[0.14em] text-ink-lo" title="Scenario clock. Not the real time.">
            {ev.scenario.day.slice(0, 3)} · <span className="text-brass-ink">{formatClock(state.clock)}</span>
          </span>
        </div>

        <nav aria-label="Modes" className="order-3 flex w-full gap-0.5 overflow-x-auto sm:order-none sm:w-auto">
          {MODES.map((m, i) => {
            const active = mode === m.id && view === "operator";
            return (
              <button
                key={m.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  setView("operator");
                  goTo(m.id);
                }}
                className={clsx("relative shrink-0 rounded-lg px-3 py-1.5 transition-colors", active ? "text-ink-hi" : "text-ink-lo hover:text-ink-mid")}
              >
                <span className="flex items-baseline gap-1.5">
                  <span className="font-mono text-[0.625rem] text-ink-lo">0{i + 1}</span>
                  <span className="text-xs font-semibold uppercase tracking-[0.14em]">{m.label}</span>
                </span>
                {active && <motion.span layoutId="mode-underline" transition={SPRING.snappy} className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-brass" />}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          {!present.active && (
            <Button variant="ghost" size="sm" aria-label="Present" onClick={present.start} title="Play the two-minute story through the real product">
              <Clapperboard aria-hidden className="size-3.5" />
              <span className="hidden sm:inline">Present</span>
            </Button>
          )}
          {mode !== "ask" && (
            <Button variant="secondary" size="sm" aria-label="Ask Savy" aria-expanded={savy.open} onClick={() => savy.setOpen(!savy.open)}>
              <Sparkles aria-hidden className="size-3.5 text-brass-ink" />
              <span className="max-[420px]:hidden">Ask Savy</span>
            </Button>
          )}
          <div role="group" aria-label="View" className="flex rounded-full border border-line bg-ground-1 p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-pressed={view === v.id}
                onClick={() => setView(v.id)}
                className={clsx(
                  "rounded-full px-3 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] transition-colors",
                  view === v.id ? "bg-ground-3 text-ink-hi" : "text-ink-lo hover:text-ink-mid",
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" aria-label="Reset" onClick={reset} title="Start again from the entry scene">
            <RotateCcw aria-hidden className="size-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
