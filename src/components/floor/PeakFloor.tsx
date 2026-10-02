"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { formatClock } from "@/domain/clock";
import { chosenChoices, simulate } from "@/twin/consequence";
import { floorAt, type FloorState } from "@/twin/floor";
import type { Evaluation } from "@/twin/runtime";
import { useTwin } from "../experience/TwinContext";
import { Eyebrow, Panel } from "../ui/primitives";
import { FloorPlan } from "./FloorPlan";

/** The floor at tonight's busiest half hour, as things have been decided so far. */
export function peakFloorOf(ev: Evaluation): FloorState | null {
  const choices = chosenChoices(ev.twin, ev.decisions);
  const run = simulate(ev.scenario, ev.twin, choices, "chosen", "As decided");
  if (!run) return null;
  const peak = run.points.reduce((a, b) => (b.load > a.load ? b : a));
  return floorAt(ev.twin, choices, peak);
}

/**
 * Where tonight's load actually lands. Folded to one line by default; open,
 * it is the dining room at the peak. Approve the on-call server and watch the
 * patio get its own server and the hot sections cool.
 */
export function PeakFloor() {
  const { ev } = useTwin();
  const [open, setOpen] = useState(false);
  const floor = useMemo(() => peakFloorOf(ev), [ev]);
  if (!floor) return null;
  const over = floor.servers.filter((s) => s.over);

  return (
    <Panel className="overflow-hidden">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-left sm:px-6">
        <span>
          <Eyebrow>The floor at {formatClock(floor.at)}</Eyebrow>
          <span className="mt-1 block text-sm text-ink-mid">
            {over.length === 0 ? (
              <span className="text-ink-hi">Every server is under the ceiling.</span>
            ) : (
              <>
                <span className="text-brass-ink">{over.map((s) => `${s.name} ${s.load.toFixed(1)}`).join(" · ")}</span> over the ceiling
                {floor.sections.some((s) => !s.server) ? `, because the ${floor.sections.filter((s) => !s.server).map((s) => s.name.toLowerCase()).join(" and the ")} has no server of its own.` : "."}
              </>
            )}
          </span>
        </span>
        <ChevronDown aria-hidden className={clsx("size-4 text-ink-lo transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="border-t border-line-soft px-5 pb-5 pt-4 sm:px-6">
              <FloorPlan floor={floor} title="Tonight at the peak" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  );
}
