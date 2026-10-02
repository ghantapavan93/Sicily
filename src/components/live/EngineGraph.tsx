"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Play, User } from "lucide-react";
import { ENGINES, type EngineId } from "@/twin/pulse";
import { SOURCES } from "@/twin/sources";
import { useTwin } from "../experience/TwinContext";
import { OriginIcon } from "../ui/badges";
import { EngineIcon } from "../ui/engine-icon";
import { Button, Eyebrow, Panel } from "../ui/primitives";
import { SavyEdge } from "../ui/savy-moment";

const PACKET_S = 1.05;
/** Engines a packet passes through on its way to the owner. Learn waits for the outcome. */
const PATH: EngineId[] = ["observe", "reconcile", "understand", "plan", "guard"];

function Counter({ value, label, tone }: { value: number; label: string; tone?: "brass" | "verified" | "unknown" }) {
  return (
    <div className="flex items-baseline gap-2">
      <motion.span
        key={value}
        initial={{ opacity: 0.3 }}
        animate={{ opacity: 1 }}
        className={clsx(
          "font-mono text-lg font-semibold",
          tone === "brass" ? "text-brass-ink" : tone === "verified" ? "text-verified" : tone === "unknown" ? "text-unknown" : "text-ink-hi",
        )}
      >
        {value}
      </motion.span>
      <span className="text-xs text-ink-lo">{label}</span>
    </div>
  );
}

/**
 * Savy at work. Each event Savy reads travels through the same five engines
 * to the owner; each engine says what it did with it. The sixth, Learn,
 * waits for the night's outcome. Nothing here is a spinner: every line is
 * the engine's own output for the event on screen.
 */
export function EngineGraph() {
  const { state, ev, dispatch, trace, traceSeq, moment, session } = useTwin();
  const phase = state.phase;
  const waiting = ev.timeline.filter((e) => e.availableAt >= ev.scenario.burstFrom && e.availableAt <= state.clock && !e.routine).length;
  const reading = phase === "processing";
  const before = phase === "arriving" || phase === "waiting";
  const ledger = ev.twin.ledger;
  const event = reading ? trace?.event ?? null : null;

  // At rest, each engine reports on the whole night.
  const summary: Record<EngineId, string> = {
    observe: `${ev.processed.length} signals read`,
    reconcile: `${ledger.verified.length} verified · ${ledger.duplicates.length} duplicate${ledger.duplicates.length === 1 ? "" : "s"} · ${ledger.stale.length} stale`,
    understand: ev.twin.demand.peakCovers !== null ? `${ev.twin.demand.peakCovers} covers at the 7 PM peak` : "Cover count unsettled",
    plan: `${ev.decisions.length} decisions`,
    guard: `${ev.decisions.filter((d) => d.guard.requiresApproval).length} need a person · 0 external actions allowed`,
    learn: phase === "remembered" ? "Tonight written to memory" : phase === "closed" ? "Writing tonight to memory" : "Waits for the outcome",
  };
  const lineFor = (id: EngineId) => (reading && trace ? trace.lines[id][0] ?? "—" : before ? "Idle" : summary[id]);

  const stations: { id: string; label: string; icon: React.ReactNode; line: string; engine?: EngineId }[] = [
    {
      id: "event",
      label: event ? SOURCES[event.source].label : "Event",
      icon: event ? <OriginIcon origin={event.source} className="size-4" /> : <span className="size-1.5 rounded-full bg-ink-lo" />,
      line: event ? event.summary : before ? `${waiting} waiting` : "—",
    },
    ...PATH.map((id) => ({ id, label: ENGINES.find((e) => e.id === id)!.label, icon: <EngineIcon engine={id} />, line: lineFor(id), engine: id })),
    { id: "owner", label: "Owner", icon: <User aria-hidden className="size-4" strokeWidth={1.75} />, line: before || reading ? "—" : `${ev.decisions.filter((d) => d.lane !== "can_wait" && (d.status === "recommend" || d.status === "held" || d.status === "conflict" || d.status === "needs_fact")).length} to decide` },
  ];
  const count = stations.length;

  return (
    <Panel className="relative overflow-hidden">
      {moment?.kind === "synthesis" && <SavyEdge kind="synthesis" id={moment.id} delay={200} />}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
        <div>
          <Eyebrow>Savy engines</Eyebrow>
          <p className="mt-1 text-sm text-ink-mid">
            {before ? "Tonight changed while you were busy. Savy hasn't read it yet." : reading ? "Reading what arrived, in the order it arrived." : "Every event went through the same path to you."}
          </p>
        </div>
        <p className="max-w-[16rem] text-right text-[0.6875rem] leading-snug text-ink-lo">Six engines are a prototype hypothesis, not a claim about OPSAVOR&apos;s architecture.</p>
      </div>

      <div className="overflow-x-auto px-5 pb-5 pt-6 sm:px-6">
        <div className="relative min-w-[640px]">
          {/* The rail the packets travel on. */}
          <div aria-hidden className="absolute top-5 h-px bg-line" style={{ left: `${50 / count}%`, right: `${50 / count}%` }} />
          <AnimatePresence>
            {reading && event && (
              <motion.div
                key={traceSeq}
                aria-hidden
                className="absolute top-5 z-10 -translate-x-1/2 -translate-y-1/2"
                initial={{ left: `${50 / count}%`, opacity: 0 }}
                animate={{ left: [`${50 / count}%`, `${100 - 50 / count}%`], opacity: [0, 1, 1, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: PACKET_S, ease: [0.45, 0, 0.2, 1] }}
              >
                <span className="whitespace-nowrap rounded-full border border-brass/60 bg-ground-0 px-2.5 py-1 font-mono text-[0.625rem] text-brass-ink shadow-[0_0_18px_-4px_rgba(210,162,76,0.8)]">
                  {event.kind}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
            {stations.map((st, i) => (
              <li key={st.id} className="flex flex-col items-center px-1.5 text-center">
                <span
                  className={clsx(
                    "relative flex size-10 items-center justify-center rounded-full border bg-ground-1 transition-colors duration-500",
                    st.id === "owner" && !before && !reading ? "border-brass/60 text-brass-ink" : "border-line text-ink-mid",
                  )}
                >
                  {st.icon}
                  {reading && (
                    <motion.span
                      key={traceSeq}
                      aria-hidden
                      className="absolute inset-[-3px] rounded-full border-2 border-brass-ink"
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: [0, 1, 0], scale: [0.85, 1.05, 1.1] }}
                      transition={{ duration: 0.55, delay: (i / (count - 1)) * PACKET_S * 0.92 }}
                    />
                  )}
                </span>
                <span className="mt-2 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-ink-hi">{st.label}</span>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={`${traceSeq}-${st.line}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25, delay: reading ? (i / (count - 1)) * PACKET_S * 0.9 : 0 }}
                    className="mt-1 line-clamp-3 min-h-[2.6rem] text-[0.6875rem] leading-snug text-ink-lo"
                  >
                    {st.line}
                  </motion.span>
                </AnimatePresence>
              </li>
            ))}
          </ol>
        </div>

        {before ? (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-brass/40 bg-brass/[0.05] px-5 py-4">
            <p className="text-[0.9375rem] text-ink-hi">
              {phase === "arriving" ? "Signals are still arriving." : `${waiting} new signals. None of them has been connected to the others yet.`}
            </p>
            <Button variant="primary" size="lg" disabled={!session.live} onClick={() => dispatch({ type: "RUN_SAVY" })}>
              <Play aria-hidden className="size-4" />
              Run Savy
            </Button>
          </div>
        ) : (
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-line-soft pt-4">
            <Counter value={ledger.verified.length} label="facts verified" tone="verified" />
            <Counter value={ledger.stale.length} label="sources stale" tone={ledger.stale.length ? "brass" : undefined} />
            <Counter value={ledger.duplicates.length} label="duplicates ignored" />
            <Counter value={ledger.conflicts.filter((c) => !c.resolvedBy).length} label="conflicts open" tone={ledger.conflicts.some((c) => !c.resolvedBy) ? "brass" : undefined} />
            <Counter value={ledger.missing.length} label="facts missing" tone={ledger.missing.length ? "unknown" : undefined} />
            <Counter value={ev.decisions.length} label="decisions created" tone="brass" />
            {reading && (
              <button type="button" onClick={() => dispatch({ type: "SKIP" })} className="ml-auto text-xs font-semibold uppercase tracking-[0.1em] text-ink-lo hover:text-ink-hi">
                Skip to the plan
              </button>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
