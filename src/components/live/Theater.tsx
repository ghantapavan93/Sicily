"use client";

import clsx from "clsx";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatClock } from "@/domain/clock";
import { HOUSE } from "@/domain/venue";
import { forkOf } from "@/twin/consequence";
import { floorsOf, type FloorState } from "@/twin/floor";
import { one, pct, usd } from "@/twin/format";
import type { NightRun } from "@/twin/types";
import { useTwin } from "../experience/TwinContext";
import { FloorPlan } from "../floor/FloorPlan";
import { useLayer } from "../ui/layer";
import { Button, Eyebrow } from "../ui/primitives";

const RUN_MS = 5200;
const W = 420;
const H = 110;
const MAX_LOAD = 24;

function Chart({ run, upto, tone }: { run: NightRun; upto: number; tone: "dim" | "brass" }) {
  const n = run.points.length;
  const x = (i: number) => 16 + (i / (n - 1)) * (W - 32);
  const y = (load: number) => H - 14 - (Math.min(load, MAX_LOAD) / MAX_LOAD) * (H - 28);
  const shown = run.points.slice(0, Math.max(1, Math.floor(upto) + 1));
  const d = shown.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.load).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Covers per server through the night, ${run.label}`}>
      <line x1={16} x2={W - 16} y1={y(HOUSE.loadCeiling)} y2={y(HOUSE.loadCeiling)} stroke="var(--color-ink-lo)" strokeDasharray="4 5" strokeWidth={1} />
      <text x={W - 16} y={y(HOUSE.loadCeiling) - 5} textAnchor="end" fontSize="10" fill="var(--color-ink-lo)">
        ceiling {HOUSE.loadCeiling}
      </text>
      {shown.map((p, i) => (
        <circle key={p.at} cx={x(i)} cy={y(p.load)} r={p.load > HOUSE.loadCeiling ? 4 : 3} fill={p.load > HOUSE.loadCeiling ? "var(--color-brass)" : "var(--color-ink-mid)"} />
      ))}
      <path d={d} fill="none" stroke={tone === "dim" ? "var(--color-ink-mid)" : "var(--color-brass-ink)"} strokeWidth={2} strokeLinejoin="round" />
      {run.points.map((p, i) => (i % 2 === 0 ? (
        <text key={p.at} x={x(i)} y={H - 1} textAnchor="middle" fontSize="9" fill="var(--color-ink-lo)">
          {formatClock(p.at).replace(" PM", "")}
        </text>
      ) : null))}
    </svg>
  );
}

function Branch({ run, floors, upto, tone, title }: { run: NightRun; floors: FloorState[]; upto: number; tone: "dim" | "brass"; title: string }) {
  const idx = Math.max(0, Math.min(run.points.length - 1, Math.floor(upto)));
  const p = run.points[idx]!;
  const done = upto >= run.points.length - 1;
  const peakIdx = run.points.reduce((best, pt, i) => (pt.load > run.points[best]!.load ? i : best), 0);
  const alerts = run.points.slice(0, idx + 1).flatMap((pt) => pt.alerts.map((a) => ({ at: pt.at, a })));
  const latest = alerts.filter((x, i, all) => all.findIndex((y) => y.a.replace(/\d+/g, "") === x.a.replace(/\d+/g, "")) === i).slice(-5);

  return (
    <div className={clsx("rounded-2xl border p-5", tone === "dim" ? "border-line bg-ground-1/70" : "border-brass/45 bg-ground-1")}>
      <div className="flex items-baseline justify-between gap-3">
        <Eyebrow className={tone === "brass" ? "!text-brass-ink" : undefined}>{title}</Eyebrow>
        <span className="font-mono text-xs text-ink-lo">{run.actions.join(" · ")}</span>
      </div>
      <div className="mt-3">
        {/* Running, the floor follows the clock. Finished, it holds on the branch's worst half hour. */}
        <FloorPlan floor={floors[done ? peakIdx : idx]!} title={title} />
        {done && <p className="mt-1 text-center text-[0.6875rem] text-ink-lo">Held at the peak, {formatClock(run.points[peakIdx]!.at)}</p>}
      </div>
      <div className="mt-2">
        <Chart run={run} upto={upto} tone={tone} />
      </div>
      <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
        {(done
          ? [
              ["Peak per server", one(run.totals.peakLoad)],
              ["Worst ticket", `${run.totals.worstTicket} min`],
              ["Walk-ins lost", String(run.totals.walkAways)],
              ["Sales", usd(run.totals.sales)],
            ]
          : [
              ["Servers", String(p.servers)],
              ["Per server", one(p.load)],
              ["Tickets", `${p.ticketMinutes} min`],
              ["Sales so far", usd(p.sales)],
            ]
        ).map(([l, v]) => (
          <div key={l}>
            <dt className="text-[0.625rem] uppercase tracking-[0.1em] text-ink-lo">{l}</dt>
            <dd className={clsx("mt-1 font-mono text-base", (l === "Tickets" && p.ticketMinutes >= 16) || (l === "Worst ticket" && run.totals.worstTicket >= 16) ? "text-brass-ink" : "text-ink-hi")}>{v}</dd>
          </div>
        ))}
      </dl>
      <ul className="mt-4 min-h-[6.5rem] space-y-1.5" aria-live="polite">
        <AnimatePresence initial={false}>
          {latest.map((x) => (
            <motion.li key={`${x.at}-${x.a}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex gap-3 text-sm">
              <span className="w-16 shrink-0 font-mono text-xs leading-5 text-ink-lo">{formatClock(x.at)}</span>
              <span className="text-brass-ink">{x.a}</span>
            </motion.li>
          ))}
        </AnimatePresence>
        {latest.length === 0 && <li className="text-sm text-ink-lo">No alerts.</li>}
      </ul>
      {done && (
        <p className="mt-3 border-t border-line-soft pt-3 text-sm text-ink-mid">
          {run.totals.covers} covers · {usd(run.totals.sales)} sales · {usd(run.totals.wages)} wages
          {run.totals.soldOut.length ? ` · ${run.totals.soldOut.map((s) => `${s.name} out ${formatClock(s.at)}`).join(", ")}` : ""}
        </p>
      )}
    </div>
  );
}

/**
 * "What happens if I do nothing?" The night is run forward from the same
 * twin twice: once as it stands, once with Savy's plan. Deterministic and
 * synthetic; it shows a choice's consequence, not a promise of money.
 */
export function Theater() {
  const { theater, setTheater, ev, openRoom, dispatch, session, state } = useTwin();
  const reduced = useReducedMotion();
  const open = theater !== null;
  const stage = theater ?? "nothing";
  const setStage = setTheater;
  const fork = useMemo(() => (open ? forkOf(ev.scenario, ev.twin, ev.decisions) : null), [open, ev]);
  const floors = useMemo(
    () => (fork ? { nothing: floorsOf(ev.twin, fork.choices.nothing, fork.nothing.points), plan: floorsOf(ev.twin, fork.choices.plan, fork.plan.points) } : null),
    [fork, ev.twin],
  );
  const [progress, setProgress] = useState(0);
  const raf = useRef<number | null>(null);
  const n = fork?.nothing.points.length ?? 1;

  useEffect(() => {
    if (!open || stage === "both") return;
    if (reduced) {
      setProgress(n - 1);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      // A frame's timestamp can be a little earlier than the start, so clamp at zero as well as one.
      const t = Math.min(1, Math.max(0, (now - start) / RUN_MS));
      setProgress(t * (n - 1));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    setProgress(0);
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [open, stage, reduced, n]);

  const layer = useLayer<HTMLDivElement>(open && fork !== null && floors !== null, () => setTheater(null));

  const finished = progress >= n - 1;
  const clockNow = fork ? fork.nothing.points[Math.max(0, Math.min(n - 1, Math.floor(progress)))]!.at : 0;
  const staffing = ev.decisions.find((d) => d.key === "staffing");

  return (
    <AnimatePresence>
      {open && fork && floors && (
        <motion.div
          ref={layer}
          tabIndex={-1}
          className="fixed inset-0 z-[60] overflow-y-auto bg-[#080605] outline-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45 }}
          role="dialog"
          aria-modal="true"
          aria-label="What happens if you do nothing"
        >
          <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Eyebrow>Decision simulator · synthetic</Eyebrow>
                <h2 className="mt-2 font-display text-[clamp(2rem,4vw,3.25rem)] font-light leading-tight text-ink-hi">
                  {stage === "nothing" ? "This is the branch where nothing changed." : "Same night. Two branches."}
                </h2>
                <p className="mt-2 max-w-2xl text-ink-mid">
                  Run forward from {formatClock(ev.twin.clock)}{" "}on tonight&apos;s twin. Simulated from sample history: it shows consequence, not money you will make.
                </p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setTheater(null)} className="flex size-10 shrink-0 items-center justify-center rounded-full border border-line text-ink-mid hover:text-ink-hi">
                <X aria-hidden className="size-4" />
              </button>
            </div>

            <p className="mt-6 font-mono text-5xl font-light tabular-nums text-ink-hi">{formatClock(stage === "both" ? fork.nothing.points[n - 1]!.at : clockNow)}</p>

            <div className={clsx("mt-6 grid gap-5", stage !== "nothing" && "lg:grid-cols-2")}>
              <Branch run={fork.nothing} floors={floors.nothing} upto={stage === "nothing" ? progress : n - 1} tone="dim" title="No change" />
              {stage !== "nothing" && <Branch run={fork.plan} floors={floors.plan} upto={stage === "plan" ? progress : n - 1} tone="brass" title="Savy's plan" />}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              {stage === "nothing" && finished && (
                <Button variant="primary" size="lg" onClick={() => setStage("plan")}>
                  <Sparkles aria-hidden className="size-4" />
                  Show me Savy&apos;s plan
                </Button>
              )}
              {stage === "plan" && finished && (
                <Button variant="primary" onClick={() => setStage("both")}>
                  Compare
                </Button>
              )}
              {stage !== "nothing" && (
                <Button variant="ghost" onClick={() => setStage("nothing")}>
                  <RotateCcw aria-hidden className="size-4" />
                  Rewind
                </Button>
              )}
            </div>

            {stage === "both" && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6 overflow-x-auto rounded-2xl border border-line bg-ground-1">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[0.6875rem] uppercase tracking-[0.12em] text-ink-lo">
                      <th className="px-5 py-3 font-semibold">At close</th>
                      <th className="px-5 py-3 font-semibold">No change</th>
                      <th className="px-5 py-3 font-semibold text-brass-ink">Savy&apos;s plan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {(
                      [
                        ["Peak covers per server", one(fork.nothing.totals.peakLoad), one(fork.plan.totals.peakLoad)],
                        ["Worst ticket time", `${fork.nothing.totals.worstTicket} min`, `${fork.plan.totals.worstTicket} min`],
                        ["Walk-ins who left", String(fork.nothing.totals.walkAways), String(fork.plan.totals.walkAways)],
                        ["Sold out", fork.nothing.totals.soldOut.map((s) => s.name).join(", ") || "Nothing", fork.plan.totals.soldOut.map((s) => s.name).join(", ") || "Nothing"],
                        ["Sales", usd(fork.nothing.totals.sales), usd(fork.plan.totals.sales)],
                        ["Wages", usd(fork.nothing.totals.wages), usd(fork.plan.totals.wages)],
                        ["Labor", pct(fork.nothing.totals.laborPct), pct(fork.plan.totals.laborPct)],
                      ] as const
                    ).map(([label, a, b]) => (
                      <tr key={label}>
                        <td className="px-5 py-2.5 text-ink-mid">{label}</td>
                        <td className="px-5 py-2.5 font-mono text-ink-hi">{a}</td>
                        <td className="px-5 py-2.5 font-mono text-ink-hi">{b}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
                  <p className="text-xs text-ink-lo">Synthetic. The same model runs both branches; only the decisions differ.</p>
                  {session.live && state.phase === "live" && staffing?.status === "recommend" && staffing.recommendation?.approvable && (
                    <Button
                      variant="primary"
                      onClick={() => {
                        dispatch({ type: "APPROVE", key: "staffing" });
                        setTheater(null);
                        openRoom("staffing");
                      }}
                    >
                      Approve: {staffing.recommendation.action}
                    </Button>
                  )}
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
