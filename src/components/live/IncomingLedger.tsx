"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { formatClock } from "@/domain/clock";
import { SOURCES } from "@/twin/sources";
import { useTwin } from "../experience/TwinContext";
import { OriginIcon } from "../ui/badges";
import { Eyebrow, Panel } from "../ui/primitives";

/**
 * Everything that arrived tonight, newest first, as the restaurant's systems
 * sent it. A dot means Savy hasn't read it yet. Routine syncs are counted,
 * then folded away.
 */
export function IncomingLedger() {
  const { state, ev } = useTwin();
  const dups = new Set(ev.twin.ledger.duplicates.map((d) => d.ignored));
  const real = ev.arrived.filter((e) => !e.routine).sort((a, b) => b.availableAt - a.availableAt || b.id.localeCompare(a.id));
  const routine = ev.arrived.filter((e) => e.routine).length;
  const unread = real.filter((e) => e.availableAt > state.processedThrough).length;

  return (
    <Panel className="flex max-h-[calc(100dvh-7rem)] flex-col overflow-hidden xl:sticky xl:top-20">
      <div className="border-b border-line px-4 py-3.5">
        <Eyebrow>Incoming</Eyebrow>
        <p className="mt-1 text-sm text-ink-mid">
          {real.length} signals{unread ? <span className="text-brass-ink"> · {unread} unread</span> : null}
        </p>
      </div>
      <ol className="min-h-0 flex-1 divide-y divide-line-soft overflow-y-auto">
        <AnimatePresence initial={false}>
          {real.map((e) => {
            const isUnread = e.availableAt > state.processedThrough;
            const isDup = dups.has(e.id);
            return (
              <motion.li
                key={e.id}
                layout="position"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: isDup ? 0.55 : 1, x: 0 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className={clsx("px-4 py-3", isUnread && "bg-brass/[0.04]")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-ink-mid">
                    <OriginIcon origin={e.source} className="size-3.5 text-ink-lo" />
                    {SOURCES[e.source].label}
                  </span>
                  <span className="flex items-center gap-2 font-mono text-[0.6875rem] text-ink-lo">
                    {isUnread && <span aria-label="Not read yet" className="size-1.5 rounded-full bg-brass" />}
                    {formatClock(e.availableAt)}
                  </span>
                </div>
                <p className={clsx("mt-1 text-sm leading-snug", isDup ? "text-ink-lo line-through decoration-ink-lo/50" : "text-ink-hi")}>{e.summary}</p>
                <p className="mt-0.5 font-mono text-[0.625rem] text-ink-lo">
                  {e.kind}
                  {isDup && " · duplicate ignored"}
                  {e.cause && ` · ${e.cause}`}
                </p>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
      {routine > 0 && <p className="border-t border-line px-4 py-2.5 text-xs text-ink-lo">+ {routine} routine syncs, read and folded away.</p>}
    </Panel>
  );
}
