"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, CloudRain, Flame, PackageX, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { forkNight, type Assumptions } from "@/twin/fork";
import { pulseOf } from "@/twin/pulse";
import { fold } from "@/twin/runtime";
import { SCENARIO_ORDER, SCENARIOS } from "@/twin/scenarios";
import type { ScenarioId } from "@/twin/types";
import { useTwin } from "../experience/TwinContext";
import { Button, Chip, Eyebrow, Panel } from "../ui/primitives";

const ICON: Record<ScenarioId, LucideIcon> = { friday_rush: Flame, supplier_problem: PackageX, slow_night: CloudRain };

/** What each night turns into once Savy has read it, computed by running it. */
const PREVIEW = Object.fromEntries(
  SCENARIO_ORDER.map((id) => {
    const s = fold([{ type: "OPEN", scenario: id }, { type: "SKIP" }, { type: "RUN_SAVY" }, { type: "SKIP" }]);
    return [id, pulseOf(s).sub.replace("Your original service plan is no longer the plan I would use. ", "")];
  }),
) as Record<ScenarioId, string>;

function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line bg-ground-2/50 px-4 py-3">
      <span className="text-sm text-ink-hi">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={clsx("relative h-6 w-11 rounded-full border transition-colors", on ? "border-brass bg-brass/80" : "border-line bg-ground-3")}
      >
        <motion.span layout className={clsx("absolute top-0.5 size-4.5 rounded-full", on ? "right-0.5 bg-ground-0" : "left-0.5 bg-ink-mid")} />
      </button>
    </label>
  );
}

function ForkPanel() {
  const { state, ev } = useTwin();
  const booked = ev.twin.demand.booked?.value ?? ev.scenario.plan.covers;
  const backupItem = ev.twin.inventory.find((i) => i.backup === null && i.status !== "not_due")?.item ?? null;
  const [covers, setCovers] = useState(booked);
  const [backup, setBackup] = useState(0);
  const [onCallDeclines, setOnCallDeclines] = useState(false);
  const [eventCancelled, setEventCancelled] = useState(false);

  const assumptions = useMemo<Assumptions>(() => {
    const a: Assumptions = {};
    if (covers !== booked) a.covers = covers;
    if (backupItem && backup > 0) a.backup = { [backupItem]: backup };
    if (onCallDeclines) a.onCallDeclines = true;
    if (eventCancelled) a.eventCancelled = true;
    return a;
  }, [covers, booked, backupItem, backup, onCallDeclines, eventCancelled]);
  const touched = Object.keys(assumptions).length > 0;
  const fork = useMemo(() => (touched ? forkNight(state, assumptions) : null), [state, assumptions, touched]);
  const plan = fork?.nights.fork?.plan;
  const base = fork?.nights.base?.plan;

  return (
    <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="space-y-3">
        <div className="rounded-xl border border-line bg-ground-2/50 px-4 py-3">
          <div className="flex items-baseline justify-between">
            <label htmlFor="fork-covers" className="text-sm text-ink-hi">
              Covers booked
            </label>
            <span className="font-mono text-sm text-ink-hi">
              {covers}
              {covers !== booked && <span className="ml-1.5 text-ink-lo">was {booked}</span>}
            </span>
          </div>
          <input id="fork-covers" type="range" className="scrub mt-3 w-full" min={Math.max(40, booked - 60)} max={booked + 40} value={covers} onChange={(e) => setCovers(Number(e.target.value))} />
        </div>
        {backupItem && (
          <div className="rounded-xl border border-line bg-ground-2/50 px-4 py-3">
            <div className="flex items-baseline justify-between">
              <label htmlFor="fork-backup" className="text-sm text-ink-hi">
                {ev.scenario.items[backupItem]?.name} in the walk-in
              </label>
              <span className="font-mono text-sm text-ink-hi">{backup === 0 ? "not counted" : backup}</span>
            </div>
            <input id="fork-backup" type="range" className="scrub mt-3 w-full" min={0} max={20} value={backup} onChange={(e) => setBackup(Number(e.target.value))} />
          </div>
        )}
        {ev.twin.staffing.onCall && <Toggle on={onCallDeclines} onChange={setOnCallDeclines} label={`${ev.twin.staffing.onCall.name} can't come in`} />}
        {ev.twin.demand.nearbyEvent && <Toggle on={eventCancelled} onChange={setEventCancelled} label={`${ev.twin.demand.nearbyEvent.value.name} is cancelled`} />}
        <p className="text-xs leading-relaxed text-ink-lo">A fork runs the same engine on a copy of tonight. The live night doesn&apos;t change until a person acts on it.</p>
      </div>

      <div>
        <AnimatePresence mode="wait" initial={false}>
          {!fork ? (
            <motion.p key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-2xl border border-dashed border-line p-6 text-ink-mid">
              Change one assumption on the left. Savy reruns only what depends on it, and says what stayed the same.
            </motion.p>
          ) : (
            <motion.div key="fork" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
              <p className="font-display text-2xl font-light text-ink-hi">
                {fork.changed.length === 0 ? "No decision moved." : `${fork.changed.length} decision${fork.changed.length === 1 ? "" : "s"} recomputed.`}{" "}
                <span className="text-ink-mid">{fork.unchanged.length} stayed exactly as they were.</span>
              </p>
              <ul className="space-y-2">
                {fork.changed.map((c) => (
                  <li key={c.key} className="rounded-xl border border-brass/40 bg-brass/[0.04] px-4 py-3">
                    <p className="flex items-center gap-2 text-sm font-semibold text-ink-hi">
                      <span className="font-mono text-xs text-brass-ink">{c.id}</span>
                      {c.title}
                    </p>
                    <p className="mt-1 text-sm text-ink-lo line-through decoration-ink-lo/50">{c.before ?? "No decision"}</p>
                    <p className="text-sm text-ink-hi">{c.after ?? "No decision needed"}</p>
                  </li>
                ))}
              </ul>
              {fork.unchanged.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {fork.unchanged.map((u) => (
                    <Chip key={u.key} tone="neutral">
                      {u.id} unchanged
                    </Chip>
                  ))}
                </div>
              )}
              {fork.figures.length > 0 && (
                <dl className="divide-y divide-line-soft rounded-xl border border-line px-4">
                  {fork.figures.map((f) => (
                    <div key={f.label} className="flex justify-between gap-3 py-2 text-sm">
                      <dt className="text-ink-mid">{f.label}</dt>
                      <dd className="font-mono">
                        <span className="text-ink-lo">{f.before}</span> → <span className="text-ink-hi">{f.after}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {plan && base && (
                <p className="text-sm text-ink-mid">
                  Run forward with Savy&apos;s plan, the fork peaks at <span className="font-mono text-ink-hi">{plan.totals.peakLoad.toFixed(1)}</span> covers per server and{" "}
                  <span className="font-mono text-ink-hi">{plan.totals.worstTicket}</span>-minute tickets, against {base.totals.peakLoad.toFixed(1)} and {base.totals.worstTicket} tonight. Simulated.
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * TRY IT. A different night is not a different page: the same twin, the
 * same engines and the same surfaces reconfigure around new events. And any
 * night can be forked to ask "what if".
 */
export function TryMode() {
  const { state, openNight } = useTwin();
  const live = state.phase === "live";

  return (
    <div className="mx-auto max-w-[1300px] space-y-10 px-4 py-8 sm:px-6">
      <header className="max-w-3xl">
        <Eyebrow>Try another night</Eyebrow>
        <h1 className="mt-3 font-display text-[clamp(2rem,4.4vw,3.5rem)] font-light leading-[1.05] tracking-[-0.01em] text-ink-hi">
          Same restaurant. Same Savy. A different night.
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-ink-mid">
          Nothing below is a separate demo. Each night is a plan and a list of events. Savy reads it with the same engines and builds a different
          operating picture from it.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {SCENARIO_ORDER.map((id) => {
          const s = SCENARIOS[id];
          const Icon = ICON[id];
          const current = state.scenario === id && state.phase !== "idle";
          return (
            <Panel key={id} className={clsx("flex flex-col p-6", current && "border-brass/50")}>
              <div className="flex items-center justify-between">
                <span className="flex size-11 items-center justify-center rounded-2xl border border-line bg-ground-2 text-brass-ink">
                  <Icon aria-hidden className="size-5" strokeWidth={1.75} />
                </span>
                {current && <Chip tone="brass">Tonight</Chip>}
              </div>
              <h2 className="mt-5 font-display text-2xl font-light text-ink-hi">{s.title}</h2>
              <p className="mt-1 text-sm text-ink-lo">{s.service}</p>
              <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-mid">{s.tagline}</p>
              <p className="mt-4 border-t border-line-soft pt-3 text-sm leading-snug text-ink-hi">
                Savy finds {PREVIEW[id].replace(/^I found /, "").replace(/\.$/, "")}.
              </p>
              <div className="mt-auto pt-5">
                <Button variant={current ? "secondary" : "primary"} onClick={() => openNight(id)}>
                  {current ? "Start it over" : "Run this night"}
                  <ArrowRight aria-hidden className="size-4" />
                </Button>
              </div>
            </Panel>
          );
        })}
      </div>

      <section aria-label="Fork this night">
        <Eyebrow>Fork this night</Eyebrow>
        <h2 className="mt-2 font-display text-3xl font-light text-ink-hi">Change one assumption. Rerun the plan.</h2>
        <div className="mt-5">
          {live ? (
            <ForkPanel key={state.scenario} />
          ) : (
            <p className="rounded-2xl border border-dashed border-line p-6 text-ink-mid">Run a night and let Savy read it first. Then fork it here.</p>
          )}
        </div>
      </section>
    </div>
  );
}
