"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { formatClock } from "@/domain/clock";
import { pct, usd } from "@/twin/format";
import { FAULT_ORDER, FAULTS } from "@/twin/ledger";
import type { Evaluation, TwinState } from "@/twin/runtime";
import type { FaultId } from "@/twin/types";
import { useTwin } from "../experience/TwinContext";
import { useLayer } from "../ui/layer";
import { OriginIcon } from "../ui/badges";
import { Button, Eyebrow } from "../ui/primitives";

/** What the fault is doing to tonight right now, read off the twin. */
function liveEffect(fault: FaultId, ev: Evaluation, state: TwinState): string {
  const staff = ev.decisions.find((d) => d.key === "staffing");
  switch (fault) {
    case "pos_delayed": {
      const s = ev.twin.sales;
      return `Sales ${s ? `${ev.twin.clock - s.at} minutes old` : "missing"}. Labor: ${ev.twin.labor.pct === null ? "unknown" : pct(ev.twin.labor.pct)}. Staffing: ${staff?.status ?? "no decision"}.`;
    }
    case "reservations_disagree": {
      const c = ev.twin.ledger.conflicts[0];
      const held = ev.decisions.filter((d) => d.status === "conflict" || d.status === "held").length;
      return c ? `Book ${c.a.value} · host ${c.b.value}. ${c.resolvedBy ? `Settled by the ${c.resolvedBy}.` : `${held} decisions held. Savy won't pick.`}` : "Waiting for the host stand's count.";
    }
    case "invoice_duplicated": {
      const n = ev.twin.ledger.duplicates.filter((d) => d.reason.startsWith("Same vendor")).length;
      return n ? `${n} copy suppressed. Projected weekly cash stays ${usd(ev.twin.cash.projected)}.` : "No invoice tonight to duplicate.";
    }
    case "inventory_missing": {
      const missing = ev.twin.inventory.filter((i) => i.status === "needs_count").map((i) => i.name.toLowerCase());
      return missing.length ? `No count for ${missing.join(", ")}. Savy asks; it never estimates one.` : "Counts are in.";
    }
    case "vendor_timeout":
      if (!state.submission) return state.po === "approved" ? "Submit the approved order to see it." : "Approve tomorrow's order, then submit it, to see it.";
      return state.submission.status === "found" ? "Status was unknown. Reconciled: existing order found. One order, not two." : `Order status: ${state.submission.status}. Not retrying blindly.`;
    case "manager_rejects":
      if (staff?.status === "rejected") return "Overruled by the manager. Schedule unchanged. Disagreement recorded.";
      return staff?.status === "recommend" ? "Approve the staffing change to see it." : "No staffing change on the table.";
  }
}

const FAULT_SOURCE: Record<FaultId, Parameters<typeof OriginIcon>[0]["origin"]> = {
  pos_delayed: "pos",
  reservations_disagree: "reservations",
  invoice_duplicated: "suppliers",
  inventory_missing: "inventory",
  vendor_timeout: "vendor",
  manager_rejects: "manager",
};

const SHOWN = new Set([
  "fault.injected",
  "fault.cleared",
  "recommendation.withdrawn",
  "recommendation.restored",
  "decision.changed",
  "decision.drafted",
  "decision.resolved",
  "po.status_unknown",
  "po.reconciled",
  "po.confirmed",
  "decision.overruled",
  "disagreement.recorded",
  "evidence.conflict_resolved",
  "pos.recheck",
  "inventory.count.reported",
]);

/** Six ways the restaurant's data breaks, each teaching one reliability principle, toggled on tonight's live twin. */
export function FaultBoard({ dense = false }: { dense?: boolean }) {
  const { state, ev, dispatch, session } = useTwin();
  const log = state.audit.filter((a) => SHOWN.has(a.type)).slice(-7).reverse();
  const canToggle = session.live && state.phase !== "idle";

  return (
    <div className={clsx("grid gap-5", !dense && "lg:grid-cols-[minmax(0,1fr)_22rem]")}>
      <ul className={clsx("grid gap-3", !dense && "sm:grid-cols-2")}>
        {FAULT_ORDER.map((id) => {
          const f = FAULTS[id];
          const on = state.faults.includes(id);
          return (
            <li key={id} className={clsx("rounded-2xl border p-4 transition-colors", on ? "border-brass/50 bg-brass/[0.05]" : "border-line bg-ground-1")}>
              <div className="flex items-start justify-between gap-3">
                <span className="flex items-center gap-2 font-semibold text-ink-hi">
                  <OriginIcon origin={FAULT_SOURCE[id]} className="text-ink-mid" />
                  {f.label}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={f.label}
                  disabled={!canToggle}
                  onClick={() => dispatch({ type: "TOGGLE_FAULT", fault: id })}
                  className={clsx("relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-40", on ? "border-brass bg-brass/80" : "border-line bg-ground-3")}
                >
                  <motion.span layout className={clsx("absolute top-0.5 size-4.5 rounded-full", on ? "right-0.5 bg-ground-0" : "left-0.5 bg-ink-mid")} />
                </button>
              </div>
              <p className="mt-1.5 text-sm text-ink-mid">{f.what}</p>
              <p className="mt-2 text-sm leading-snug text-ink-hi">
                <span className="text-ink-lo">Promise: </span>
                {f.promise}
              </p>
              <AnimatePresence initial={false}>
                {on && (
                  <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <span className="mt-3 block rounded-lg bg-ground-0 px-3 py-2 font-mono text-[0.6875rem] leading-relaxed text-brass-ink">{liveEffect(id, ev, state)}</span>
                  </motion.p>
                )}
              </AnimatePresence>
              <p className="mt-2 text-[0.6875rem] uppercase tracking-[0.1em] text-ink-lo">{f.principle}</p>
            </li>
          );
        })}
      </ul>

      <div className="rounded-2xl border border-line bg-ground-0 p-4">
        <Eyebrow>What Savy did</Eyebrow>
        <ol className="mt-3 space-y-2.5">
          <AnimatePresence initial={false}>
            {log.map((a) => (
              <motion.li key={a.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="text-sm leading-snug">
                <span className="font-mono text-[0.6875rem] text-ink-lo">
                  {formatClock(a.at)} · {a.actor} · {a.type}
                </span>
                <span className="block text-ink-mid">{a.label}</span>
              </motion.li>
            ))}
          </AnimatePresence>
          {log.length === 0 && <li className="text-sm text-ink-lo">Break something. Savy&apos;s response appears here.</li>}
        </ol>
      </div>
    </div>
  );
}

/** The pressure test, opened over the live night so the ripple stays in view. */
export function PressurePanel() {
  const { pressure, setPressure, goTo } = useTwin();

  // Not modal: the ripple on the live night behind it is the point. It still takes Escape in turn.
  const layer = useLayer<HTMLElement>(pressure, () => setPressure(false));

  return (
    <AnimatePresence>
      {pressure && (
        <motion.aside
          ref={layer}
          tabIndex={-1}
          role="dialog"
          aria-label="Pressure test Savy"
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[34rem] flex-col outline-none border-l border-line bg-ground-1 shadow-[-30px_0_80px_-40px_rgba(0,0,0,0.95)]"
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", stiffness: 260, damping: 32 }}
        >
          <header className="flex items-start justify-between gap-3 border-b border-line px-6 py-5">
            <div>
              <Eyebrow>Pressure test Savy</Eyebrow>
              <p className="mt-1.5 font-display text-2xl font-light text-ink-hi">Break the data. Watch it fail safely.</p>
            </div>
            <button type="button" aria-label="Close" onClick={() => setPressure(false)} className="flex size-8 items-center justify-center rounded-full text-ink-lo hover:bg-ground-3 hover:text-ink-hi">
              <X aria-hidden className="size-4" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <FaultBoard dense />
          </div>
          <footer className="border-t border-line px-6 py-4">
            <Button variant="ghost" size="sm" onClick={() => goTo("lab")}>
              Run every combination in the lab
            </Button>
          </footer>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
