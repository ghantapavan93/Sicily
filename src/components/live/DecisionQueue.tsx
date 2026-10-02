"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import type { Decision } from "@/twin/types";
import { useTwin } from "../experience/TwinContext";
import { ConfidenceMeter } from "../ui/badges";
import { Eyebrow } from "../ui/primitives";
import { SavyEdge } from "../ui/savy-moment";
import { DecisionActions, StatusChip } from "./DecisionActions";

const HANDLED = new Set<Decision["status"]>(["approved", "rejected", "resolved"]);

const GROUPS: { id: string; title: string; note: string; pick: (d: Decision) => boolean }[] = [
  { id: "now", title: "Needs you now", note: "Before service changes them for you.", pick: (d) => d.lane === "now" && !HANDLED.has(d.status) },
  { id: "fact", title: "Missing fact", note: "One answer from the floor settles it.", pick: (d) => d.lane === "missing_fact" && !HANDLED.has(d.status) },
  { id: "wait", title: "Can wait", note: "Named, so nothing is lost. Not tonight's problem.", pick: (d) => d.lane === "can_wait" && !HANDLED.has(d.status) },
  { id: "done", title: "Handled", note: "Decided by a person, or closed by evidence.", pick: (d) => HANDLED.has(d.status) },
];

function DecisionCard({ d }: { d: Decision }) {
  const { openRoom, moment, state } = useTwin();
  const versions = state.versions[d.key]?.length ?? 0;
  const lit = moment?.kind === "transition" && moment.keys.includes(d.key);

  return (
    <motion.li layout="position" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
      <article
        className={clsx(
          "relative rounded-2xl border bg-ground-1 p-5 transition-colors duration-500",
          d.status === "recommend" ? "border-brass/45" : d.status === "conflict" ? "border-conflict/45" : d.status === "held" || d.status === "needs_fact" ? "border-dashed border-unknown/50" : "border-line",
        )}
      >
        {lit && <SavyEdge kind="transition" id={moment!.id} />}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={d.status} lane={d.lane} />
            <span className="font-mono text-[0.6875rem] text-ink-lo">
              {d.id} · v{Math.max(1, versions)}
            </span>
          </div>
          <span className="text-xs text-ink-lo">{d.urgency.label}</span>
        </div>
        <button type="button" onClick={() => openRoom(d.key)} className="group mt-3 block w-full text-left">
          <h3 className="flex items-start gap-2 text-lg font-semibold leading-snug text-ink-hi">
            <span className="min-w-0 flex-1">{d.title}</span>
            <ArrowUpRight aria-hidden className="mt-1 size-4 shrink-0 text-ink-lo transition-colors group-hover:text-brass-ink" />
          </h3>
          <p className="mt-1 text-[0.9375rem] leading-snug text-ink-mid">{d.headline}</p>
          {d.recommendation && (
            <p className="mt-3 text-sm leading-snug">
              <span className="text-ink-lo">{d.recommendation.approvable ? "Savy recommends: " : "Next step: "}</span>
              <span className="text-ink-hi">{d.recommendation.action}</span>
            </p>
          )}
        </button>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <DecisionActions decision={d} compact />
          {d.confidence.level !== "none" && <ConfidenceMeter level={d.confidence.level} />}
        </div>
      </article>
    </motion.li>
  );
}

/** Tonight's decisions, by what they need: you now, one fact, or nothing yet. */
export function DecisionQueue() {
  const { ev, state } = useTwin();
  if (state.phase === "arriving" || state.phase === "waiting") return null;

  return (
    <div className="space-y-6">
      {GROUPS.map((g) => {
        const items = ev.decisions.filter(g.pick);
        if (items.length === 0) return null;
        return (
          <section key={g.id} aria-label={g.title}>
            <div className="flex items-baseline justify-between gap-3">
              <Eyebrow className={g.id === "now" ? "!text-brass-ink" : undefined}>
                {g.title} · {items.length}
              </Eyebrow>
              <span className="text-xs text-ink-lo">{g.note}</span>
            </div>
            <ul className="mt-3 space-y-3">
              <AnimatePresence initial={false}>
                {items.map((d) => (
                  <DecisionCard key={d.key} d={d} />
                ))}
              </AnimatePresence>
            </ul>
          </section>
        );
      })}
    </div>
  );
}
