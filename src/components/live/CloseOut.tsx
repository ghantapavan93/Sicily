"use client";

import { motion } from "framer-motion";
import { ArrowRight, FastForward } from "lucide-react";
import { formatClock } from "@/domain/clock";
import { one, pct, usd } from "@/twin/format";
import { useTwin } from "../experience/TwinContext";
import { Button, Chip, Eyebrow, Panel } from "../ui/primitives";
import { SavyEdge } from "../ui/savy-moment";
import { MondayBriefing } from "./MondayBriefing";
import { Receipt } from "./Receipt";

/** Fast-forward, and the close: expected against what happened, the receipts, and what goes into memory. */
export function CloseOut() {
  const { state, ev, dispatch, goTo, moment, session } = useTwin();

  if (state.phase === "live") {
    const decided = state.receipts.length;
    return (
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-dashed border-line px-5 py-4">
        <p className="text-sm text-ink-mid">
          {decided ? `${decided} decision${decided === 1 ? "" : "s"} on the record.` : "Nothing decided yet."} Run the night forward to see what happens, and what Savy keeps.
        </p>
        <Button variant="secondary" disabled={!session.live} onClick={() => dispatch({ type: "FAST_FORWARD" })}>
          <FastForward aria-hidden className="size-4" />
          Fast forward to close
        </Button>
      </div>
    );
  }
  if (!state.outcome) return null;

  const o = state.outcome;
  const run = o.actual;
  const rows = [
    ["Sales", o.expected.sales === null ? "unknown" : usd(o.expected.sales), usd(run.totals.sales)],
    ["Labor", o.expected.laborPct === null ? "unknown" : pct(o.expected.laborPct), pct(run.totals.laborPct)],
    ["Peak covers per server", o.expected.peakLoad === null ? "unknown" : one(o.expected.peakLoad), one(run.totals.peakLoad)],
    ["Worst ticket time", "—", `${run.totals.worstTicket} min`],
    ["Sold out", "—", run.totals.soldOut.map((s) => `${s.name} ${formatClock(s.at)}`).join(", ") || "Nothing"],
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <Panel className="relative overflow-hidden">
        {moment?.kind === "learning" && <SavyEdge kind="learning" id={moment.id} />}
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-6 py-4">
          <div>
            <Eyebrow>Close · {formatClock(o.closedAt)}</Eyebrow>
            <h3 className="mt-1.5 font-display text-2xl font-light text-ink-hi">What was expected, and what happened</h3>
          </div>
          <Chip tone="neutral" title="The close is simulated from the same model.">
            Simulated close
          </Chip>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[0.6875rem] uppercase tracking-[0.12em] text-ink-lo">
              <th className="px-6 py-2.5 font-semibold" />
              <th className="px-6 py-2.5 font-semibold">Expected at {formatClock(ev.twin.clock)}</th>
              <th className="px-6 py-2.5 font-semibold">At close</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {rows.map(([l, a, b]) => (
              <tr key={l}>
                <td className="px-6 py-2.5 text-ink-mid">{l}</td>
                <td className="px-6 py-2.5 font-mono text-ink-lo">{a}</td>
                <td className="px-6 py-2.5 font-mono text-ink-hi">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-line bg-ground-2/50 px-6 py-5">
          <p className="font-display text-2xl font-light leading-snug text-ink-hi">Savy remembers the outcome, not just the recommendation.</p>
          <ul className="mt-2 space-y-1">
            {o.lessons.map((l) => (
              <li key={l} className="text-sm text-ink-mid">
                {l}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {state.phase === "remembered" ? <Chip tone="brass">Written to decision memory</Chip> : <Chip tone="neutral">Writing to decision memory</Chip>}
            <Button variant="primary" onClick={() => goTo("memory")}>
              See what Savy learned
              <ArrowRight aria-hidden className="size-4" />
            </Button>
          </div>
        </div>
      </Panel>
      <MondayBriefing />
      {state.receipts.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {state.receipts.map((r) => (
            <Receipt key={r.id} receipt={r} />
          ))}
        </div>
      )}
    </motion.div>
  );
}
